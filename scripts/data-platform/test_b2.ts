import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { initialModel } from "../../server/projectModel/seed";
import { activeModelSize } from "../../server/projectModel/sizeBudget";
import { applyHypothesisCommand } from "../../server/projectModel/hypotheses";
import { inspectSchema, businessTables } from "../../server/companyData/relational";
import { semanticHash, textHash } from "../../server/companyData/valueTree";
import { at, arrayLength, decode, encode, replace } from "../../server/companyData/v3/codec";
import { projectFragment } from "../../server/companyData/v3/projection";
import { SqlFrameStore } from "../../server/companyData/v3/store";
import { IncrementalCompanyRepository } from "../../server/companyData/v3/repository";
import { CommandCompanyRepository } from "../../server/companyData/v3/commands";
import { ddlV3, payloadTables, physicalTable } from "../../server/companyData/v3/schema";
import { ProductCrewService } from "../../server/productCrew/service";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const out = "generated-artifacts/data-platform-B2";
const manifest = JSON.parse(await readFile(`${out}/RETAINED_WORKSPACE.json`, "utf8"));
const data = new IncrementalCompanyRepository(pool, "development", true);
const commands = new CommandCompanyRepository(data);
const controls = ["company_v3_document_heads", "company_v3_revision_heads", "company_v3_archive_refs",
  "company_v3_size_budgets", "company_v3_payload_text_refs", "company_v3_frames", "company_v3_text_snapshots"];

async function inventory(workspace: string, legacy = false) {
  const tables = legacy ? [...businessTables, "company_source_archives", "company_import_runs", "company_import_checks"] :
    [...payloadTables.map(physicalTable), ...controls];
  const result: Record<string, any> = {};
  for (const table of tables) {
    const q = await pool.query(`SELECT count(*)::bigint AS rows,coalesce(sum(pg_column_size(t)),0)::bigint AS tuple_bytes
      FROM ${table} t WHERE workspace_id=$1`, [workspace]);
    const p = await pool.query(`SELECT pg_total_relation_size($1::regclass)::bigint AS physical_bytes`, [table]);
    result[table] = { rows: Number(q.rows[0].rows), tupleBytes: Number(q.rows[0].tuple_bytes),
      tableAndIndexAndToastBytesAllWorkspaces: Number(p.rows[0].physical_bytes) };
  }
  const database = await pool.query("SELECT pg_database_size(current_database())::bigint AS bytes");
  return { tables: result, workspaceRows: Object.values(result).reduce((n: number, r: any) => n + r.rows, 0),
    workspaceTupleBytes: Object.values(result).reduce((n: number, r: any) => n + r.tupleBytes, 0),
    physicalTablesAllWorkspaces: Object.values(result).reduce((n: number, r: any) => n + r.tableAndIndexAndToastBytesAllWorkspaces, 0),
    devDatabasePhysicalBytes: Number(database.rows[0].bytes),
    scope: "tupleBytes = pg_column_size scoped rows; physical table bytes include indexes/TOAST/free/dead pages, all workspaces; DB bytes include accepted B and unrelated data" };
}
async function preflight() {
  const id = `company-b2-fixture:${randomUUID()}`, owner = `${id}:owner`, db = await pool.connect();
  const root = initialModel();
  root.revision = 0;
  const doc = { id: "DOC-B2", title: "B2", text: "Текст 😀\r\n", url: "", elementIds: [], updatedAt: "2026-10-28T00:00:00.000Z" };
  root.alternatives = [{ id: "new-country", title: "Fixture", model: {
    schema: 1, revision: 0, elements: [], relations: [], documents: [doc], decisions: [], proposals: [], taskDrafts: [],
    operatingModel: { schema: 1, revisions: [{ version: 1, actor: "fixture", at: "2026-10-28",
      data: { nodes: [], links: [], stageReports: [] } }] },
  } }];
  const result: Record<string, any> = {};
  try {
    await db.query("BEGIN");
    await db.query(`INSERT INTO company_v3_workspaces(workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
      VALUES($1,$2,'development','B2 small fixture only','test',0,'pending')`, [id, owner]);
    const store = new SqlFrameStore(db, id, await inspectSchema(db)), columns = await projectFragment(root, store, store.schema);
    const hash = await encode(root, store, columns); await store.flush();
    await db.query("UPDATE company_v3_workspaces SET root_hash=$2 WHERE workspace_id=$1", [id, hash]);
    await db.query("INSERT INTO company_v3_revision_heads(workspace_id,revision,root_hash,actor,source_semantic_hash) VALUES($1,0,$2,'fixture',$3)",
      [id, hash, semanticHash(root)]);
    await db.query("INSERT INTO company_v3_document_heads VALUES($1,'new-country','DOC-B2',0,$2)",
      [id, await at(hash, ["alternatives", "0", "model", "documents", "0"], store)]);
    const { alternatives, ...original } = root;
    for (const [h, n] of [["$root", activeModelSize(root)], ["original", activeModelSize(original)],
      ["new-country", activeModelSize(root.alternatives[0].model)]] as [string, number][])
      await db.query("INSERT INTO company_v3_size_budgets VALUES($1,$2,$3)", [id, h, n]);
    await db.query("COMMIT");
    assert.equal(semanticHash(await data.readRoot(owner)), semanticHash(root));
    result.initialRoundtrip = true;
    await assert.rejects(data.readRoot(owner + "-other"));
    await assert.rejects(new IncrementalCompanyRepository(pool, "production").readRoot(owner));
    await assert.rejects(new IncrementalCompanyRepository(pool, "development").readRoot(owner));
    result.ownerEnvironmentInactiveIsolation = true;
    const c = { type: "saveDocument" as const, id: doc.id, title: doc.title, text: "changed 😀",
      url: "", elementIds: [] };
    const receipt = await commands.writeMany(owner, 0, [c], "new-country");
    assert.equal(receipt.revision, 1);
    const current = await data.readDocumentSnapshot(owner, "new-country", doc.id);
    assert.equal(current.document.text, c.text);
    assert.equal((await data.readDocumentSnapshot(owner, "new-country", doc.id, 0)).document.text, doc.text);
    assert.equal(semanticHash(await data.readRoot(owner, 0)), semanticHash(root));
    result.normalCommandOldRevisionDirectDocument = true;
    const service = new ProductCrewService(commands);
    assert.equal((await service.call(owner, "get_document", { documentId: doc.id })).text, c.text);
    result.existingMcpGetDocument = true;
    const settled = await Promise.allSettled([
      commands.writeMany(owner, 1, [{ ...c, text: "A" }], "new-country"),
      commands.writeMany(owner, 1, [{ ...c, text: "B" }], "new-country"),
    ]);
    assert.equal(settled.filter(r => r.status === "fulfilled").length, 1);
    result.concurrentCasOneWinner = true;
    const before = await data.readRoot(owner);
    await assert.rejects(commands.writeMany(owner, 2, [c, { ...c, id: "missing" }], "new-country"));
    assert.equal(semanticHash(await data.readRoot(owner)), semanticHash(before));
    result.multiCommandRollback = true;
    await assert.rejects(data.commitDelta(owner, 2, async store => {
      await store.db.query("UPDATE company_v3_workspaces SET label='must rollback' WHERE workspace_id=$1", [id]);
      throw new Error("interrupted");
    }, owner));
    assert.equal(semanticHash(await data.readRoot(owner)), semanticHash(before));
    result.interruptedWriteRollback = true;
    const noop = await commands.writeMany(owner, 2, [{ type: "saveOperatingModel", baseVersion: 1,
      data: { nodes: [], links: [], stageReports: [] } }], "new-country");
    assert.equal(noop.revision, 2);
    result.noopDoesNotCreateRevision = true;
    await commands.writeMany(owner, 2, [{ type: "saveOperatingModel", baseVersion: 1,
      data: { nodes: [], links: [], stageReports: [], customerPath: [] } }], "new-country");
    assert.equal((await data.readRoot(owner)).alternatives![0].model.operatingModel!.revisions.length, 2);
    result.operatingRevisionAppend = true;
    const payloads = await db.query("SELECT record_hash,text_body FROM company_v3_document_versions WHERE workspace_id=$1", [id]);
    try {
      await db.query("UPDATE company_v3_document_versions SET text_body='corrupt' WHERE workspace_id=$1", [id]);
      await assert.rejects(data.readDocumentSnapshot(owner, "new-country", doc.id), /digest mismatch/);
      result.corruptDocumentFailsClosed = true;
    } finally {
      for (const r of payloads.rows) await db.query(`UPDATE company_v3_document_versions SET text_body=$3
        WHERE workspace_id=$1 AND record_hash=$2`, [id, r.record_hash, r.text_body]);
    }
    const mixes = [
      { name: "updateThenAppend", rows: [{ ...c, text: "updated before append" },
        { ...c, type: "createDocument" as const, id: "DOC-B2-NEW-1", text: "new one" }] },
      { name: "appendThenUpdate", rows: [{ ...c, type: "createDocument" as const, id: "DOC-B2-NEW-2", text: "new two" },
        { ...c, text: "updated after append" }] },
      { name: "updateAppendUpdateSameDocument", rows: [{ ...c, text: "intermediate" },
        { ...c, type: "createDocument" as const, id: "DOC-B2-NEW-3", text: "new three" }, { ...c, text: "final value" }] },
      { name: "updateTwoExistingAndAppend", rows: [{ ...c, text: "original updated" },
        { ...c, id: "DOC-B2-NEW-1", text: "first added updated" },
        { ...c, type: "createDocument" as const, id: "DOC-B2-NEW-4", text: "new four" }] },
    ];
    for (const mix of mixes) {
      const old = await data.readRoot(owner);
      let expected = structuredClone(old);
      for (const command of mix.rows) expected = applyHypothesisCommand(expected, "new-country", command, owner);
      expected = JSON.parse(JSON.stringify(expected)); // Same persisted JSON boundary.
      await commands.writeMany(owner, old.revision, mix.rows, "new-country");
      const actual = await data.readRoot(owner);
      normalizeGenerated(expected, actual, old);
      assert.deepEqual(actual, expected);
      assert.equal(semanticHash(actual), semanticHash(expected));
      assert.equal(semanticHash(await data.readRoot(owner, old.revision)), semanticHash(old));
      for (const document of expected.alternatives![0].model.documents) {
        const direct = await data.readDocumentSnapshot(owner, "new-country", document.id);
        assert.deepEqual(direct.document, document);
        assert.equal((await service.call(owner, "get_document", { documentId: document.id })).text, document.text);
      }
      result[mix.name + "FullOracleAndDirectReaders"] = true;
    }
    await writeFile(`${out}/INTEGRATION_TESTS.json`, JSON.stringify({ passed: true, checks: result }, null, 2));
    console.log("B2 preflight PASSED", Object.keys(result));
  } finally {
    await db.query("ROLLBACK");
    // Cleanup is expressly limited to this small fixture. NEVER retained load copy.
    assert(id.startsWith("company-b2-fixture:") && id !== manifest.workspace);
    await db.query("BEGIN");
    for (const table of [...controls, ...payloadTables.map(physicalTable)].filter(t => t !== "company_v3_text_snapshots"))
      await db.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [id]);
    await db.query("DELETE FROM company_v3_text_snapshots WHERE workspace_id=$1", [id]);
    await db.query("DELETE FROM company_v3_workspaces WHERE workspace_id=$1", [id]);
    await db.query("COMMIT"); db.release();
  }
}

// UUIDs and clock values are independently generated by the old pure command.
// Only changed/generated metadata is normalized; business fields are never copied.
function normalizeGenerated(expected: any, actual: any, before: any) {
  if (!expected || typeof expected !== "object" || !actual || typeof actual !== "object") return;
  for (const key of Object.keys(expected)) {
    const value = expected[key];
    if (["at", "updatedAt", "createdAt"].includes(key) && before?.[key] !== value) expected[key] = actual[key];
    else if (key === "id" && typeof value === "string" && /[a-f0-9]{8}-[a-f0-9-]{27}/i.test(value) && before?.[key] !== value)
      expected[key] = actual[key];
    else normalizeGenerated(value, actual[key], before?.[key]);
  }
}

async function load() {
  const source = await pool.query("SELECT workspace_id FROM company_workspaces WHERE storage_generation='shadow' AND environment='development'");
  assert.equal(source.rows.length, 1);
  const w = await pool.query("SELECT current_revision FROM company_v3_workspaces WHERE workspace_id=$1", [manifest.workspace]);
  assert.equal(Number(w.rows[0].current_revision), manifest.sourceRevision, "Load already started; preserve copy and inspect evidence");
  let oracle = await data.readRoot(manifest.testOwner);
  assert.equal(semanticHash(oracle), manifest.sourceHash);
  const beforeB = await inventory(source.rows[0].workspace_id, true), before = await inventory(manifest.workspace);
  const rows: any[] = [];
  const prefix = ["alternatives", "0", "model"], journalId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
  for (let i = 1; i <= 20; i++) {
    const old = oracle, model = old.alternatives![0].model;
    let expected: any, receipt: any, kind: string, command: any;
    if (i === 20) {
      kind = "prepend operatingModel revision (reuse complete graph)";
      const revisions = model.operatingModel!.revisions, last = revisions.at(-1)!;
      const added = { ...last, version: Math.max(...revisions.map(r => r.version)) + 1,
        actor: manifest.testOwner, at: "2026-10-28T00:00:20.000Z" };
      expected = { ...old, revision: old.revision + 1, alternatives: [{ ...old.alternatives![0],
        model: { ...model, operatingModel: { ...model.operatingModel!, revisions: [added, ...revisions] } } }] };
      receipt = await data.commitDelta(manifest.testOwner, old.revision, async store => {
        const head = await store.db.query("SELECT root_hash FROM company_v3_workspaces WHERE workspace_id=$1", [store.workspace]);
        const path = [...prefix, "operatingModel", "revisions"], array = await at(head.rows[0].root_hash, path, store);
        let item = await at(head.rows[0].root_hash, [...path, String(await arrayLength(array, store) - 1)], store);
        for (const key of ["version", "actor", "at"]) item = await replace(item, [key], await encode((added as any)[key], store), store);
        return { edits: [{ path, insertAt: 0, referenceHash: item }] };
      }, manifest.testOwner);
    } else if ([4, 8, 12, 16].includes(i)) {
      const latest = model.operatingModel!.revisions.at(-1)!, graph = structuredClone(latest.data);
      const roles = graph.nodes.filter(n => n.kind === "role").slice(0, i === 8 ? 3 : 1);
      assert(roles.length);
      for (const role of roles) role.description += `\n[B2 retained test ${i}; no product change]`;
      kind = i === 8 ? "one operating revision changes three roles" : "one role, new operating revision";
      command = { type: "saveOperatingModel", baseVersion: latest.version, data: graph };
    } else if ([3, 7, 11, 15, 19].includes(i)) {
      kind = "append decision";
      const decision = { id: `DEC-B2-LOAD-${i}`, at: `2026-10-28T00:00:${String(i).padStart(2, "0")}.000Z`,
        actor: manifest.testOwner, action: "B2 retained load test", reason: `Decision ${i}; not a live company decision`, elementIds: [] };
      expected = { ...old, revision: old.revision + 1, alternatives: [{ ...old.alternatives![0],
        model: { ...model, decisions: [...model.decisions, decision] } }] };
      receipt = await data.commitDelta(manifest.testOwner, old.revision, async store => {
        const q = await store.db.query("SELECT root_hash FROM company_v3_workspaces WHERE workspace_id=$1", [store.workspace]);
        const path = [...prefix, "decisions"], n = await arrayLength(await at(q.rows[0].root_hash, path, store), store);
        return { edits: [{ path, value: decision, insertAt: n }] };
      }, manifest.testOwner);
    } else {
      kind = "journal document via normal domain command";
      const doc = model.documents.find(d => d.id === journalId)!;
      assert(doc);
      const body = JSON.parse(doc.text);
      body.b2RetainedLoadTest = { step: i, workspace: manifest.workspace, liveProductChanged: false };
      command = { type: "saveDocument", id: doc.id, title: doc.title, text: JSON.stringify(body, null, 2),
        url: doc.url, elementIds: doc.elementIds };
    }
    if (command) {
      expected = applyHypothesisCommand(old, "new-country", command, manifest.testOwner);
      receipt = await commands.writeMany(manifest.testOwner, old.revision, [command], "new-country");
    }
    await writeFile(`${out}/PENDING_WRITE.json`, JSON.stringify({ step: i, kind, receipt }, null, 2));
    const verifyStart = performance.now(), actual = await data.readRoot(manifest.testOwner);
    if (command) normalizeGenerated(expected, actual, old);
    const actualHash = semanticHash(actual), expectedHash = semanticHash(expected);
    if (actualHash !== expectedHash) {
      await writeFile(`${out}/FAILED_EXPECTED_PRIVATE.json`, JSON.stringify(expected));
      await writeFile(`${out}/FAILED_ACTUAL_PRIVATE.json`, JSON.stringify(actual));
    }
    assert.equal(actualHash, expectedHash, `Full semantic equality after write ${i}`);
    const fullVerificationMs = performance.now() - verifyStart;
    const readStart = performance.now(), direct = await data.readDocumentSnapshot(manifest.testOwner, "new-country", journalId);
    const journalReadMs = performance.now() - readStart, wanted = actual.alternatives![0].model.documents.find(d => d.id === journalId)!;
    assert.equal(textHash(direct.document.text), textHash(wanted.text)); assert.equal(direct.document.text.length, wanted.text.length);
    const historyStart = performance.now(), previous = await data.readRoot(manifest.testOwner, old.revision);
    assert.equal(semanticHash(previous), semanticHash(old), `Previous immutable revision ${old.revision}`);
    const size = await inventory(manifest.workspace);
    rows.push({ step: i, kind, ...receipt, semanticHash: actualHash, expectedHash, fullVerificationMs,
      previousRevisionVerified: old.revision, historyVerificationMs: performance.now() - historyStart,
      journalReadMs, journalSha256: textHash(direct.document.text), journalUtf16: direct.document.text.length, inventory: size });
    await writeFile(`${out}/LOAD_20_WRITES.json`, JSON.stringify({ complete: false, beforeB, before, rows }, null, 2));
    oracle = actual;
    console.log("B2 full load verified", { step: i, kind, revision: actual.revision,
      writerMs: Math.round(receipt.writerMs), rowsInserted: Object.values(receipt.delta).reduce((n: number, s: any) => n + s.inserted, 0) });
  }
  const after = await inventory(manifest.workspace), afterB = await inventory(source.rows[0].workspace_id, true);
  for (const table of Object.keys(beforeB.tables)) assert.equal(beforeB.tables[table].rows, afterB.tables[table].rows, `B unchanged ${table}`);
  const archived = await data.readRoot(manifest.testOwner, 908);
  assert.equal(archived.revision, 908);
  const result = { complete: true, sourceHash: manifest.sourceHash, workspace: manifest.workspace,
    beforeB, before, after, afterB, rows, historicalArchive908Read: true,
    retainedForOwnerReview: true, cleanupPerformed: false, productionTouched: false,
    oracle: "old pure domain command; only newly generated UUID/clock metadata normalized before full SHA comparison",
    fullVerificationIsOutsideWriter: true };
  await writeFile(`${out}/LOAD_20_WRITES.json`, JSON.stringify(result, null, 2));
  console.log("B2 20 writes PASSED", { beforeRows: before.workspaceRows, afterRows: after.workspaceRows });
}

try {
  if (process.argv.includes("--load")) await load();
  else await preflight();
} finally { await pool.end(); }
