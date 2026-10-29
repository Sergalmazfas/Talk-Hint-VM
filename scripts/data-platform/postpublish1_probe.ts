/** DEV ONLY. Every test/measurement is inside one outer ROLLBACK.
 * No DDL, DELETE, production connection, models, calls, mail or retained-copy edits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { CommandCompanyRepository } from "../../server/companyData/v3/commands";
import { IncrementalCompanyRepository } from "../../server/companyData/v3/repository";
import { payloadTables, physicalTable, ddlV3 } from "../../server/companyData/v3/schema";
import { OwnerImportService, transferDigest, type TransferRecord, type TransferManifest } from "../../server/companyData/v3/transport";
import { semanticHash, textHash } from "../../server/companyData/valueTree";
import { unpackModel } from "../../server/projectModel/history";
import type { ModelCommand } from "../../shared/projectModel";
import { SqlFrameStore } from "../../server/companyData/v3/store";
import { at, encode } from "../../server/companyData/v3/codec";
import { readBusinessContract } from "../../server/companyData/v3/businessContract";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const out = "generated-artifacts/data-platform-postpublish1";
const realPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = await realPool.connect();
await db.query("BEGIN");
let depth = 0;
const query = async (sql: string, params?: any[]) => {
  if (/^BEGIN\b/.test(sql)) return db.query(`SAVEPOINT probe_${++depth}`);
  if (sql === "COMMIT") return db.query(`RELEASE SAVEPOINT probe_${depth--}`);
  if (sql === "ROLLBACK") {
    await db.query(`ROLLBACK TO SAVEPOINT probe_${depth}`);
    return db.query(`RELEASE SAVEPOINT probe_${depth--}`);
  }
  return db.query(sql, params);
};
const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
try {
  const tag = `company-postpublish-probe:${randomUUID()}`;
  const fixture = JSON.parse(await readFile("generated-artifacts/data-platform-B2/RETAINED_WORKSPACE.json", "utf8"));
  const original = await db.query("SELECT * FROM company_v3_workspaces WHERE workspace_id=$1", [fixture.workspace]);
  assert.equal(original.rowCount, 1);
  assert.equal(original.rows[0].generation, "test");
  const workspace = `${tag}:copy`, owner = `${tag}:owner`;
  await db.query(`INSERT INTO company_v3_workspaces
    (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
    VALUES($1,$2,'development','UNCOMMITTED performance probe only','test',$3,$4)`,
  [workspace, owner, original.rows[0].current_revision, original.rows[0].root_hash]);
  const copyTables = ["company_v3_text_snapshots", ...payloadTables.map(physicalTable),
    "company_v3_payload_text_refs", "company_v3_frames", "company_v3_revision_heads",
    "company_v3_document_heads", "company_v3_archive_refs", "company_v3_size_budgets"];
  let copied = 0;
  for (const table of copyTables) {
    assert(/^[a-z0-9_]+$/.test(table));
    const c = await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
    const names = c.rows.map(r => r.column_name as string);
    assert(names.every(n => /^[a-z0-9_]+$/.test(n)));
    const select = names.map(n => n === "workspace_id" ? "$1::text" : `"${n}"`).join(",");
    const r = await db.query(`INSERT INTO ${table} (${names.map(n => `"${n}"`).join(",")})
      SELECT ${select} FROM ${table} WHERE workspace_id=$2`, [workspace, fixture.workspace]);
    copied += r.rowCount ?? 0;
  }
  const data = new IncrementalCompanyRepository(pool, "development", true);
  const commands = new CommandCompanyRepository(data);
  let state = await commands.read(owner, "new-country");
  const results: any[] = [];
  for (const optimized of [false, true]) for (const kind of ["document", "role"]) {
    let command: ModelCommand;
    if (kind === "document") {
      const d = state.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL") ?? state.documents[0];
      assert(d);
      command = { type: "saveDocument", id: d.id, title: d.title,
        text: d.text + `\n[UNCOMMITTED probe ${optimized}]`, url: d.url, elementIds: d.elementIds };
    } else {
      const latest = state.operatingModel!.revisions.at(-1)!;
      const graph = structuredClone(latest.data);
      const role = graph.nodes.find(n => n.kind === "role")!;
      assert(role);
      role.description += `\n[UNCOMMITTED response benchmark ${optimized}]`;
      command = { type: "saveOperatingModel", baseVersion: latest.version, data: graph };
    }
    const start = performance.now();
    let result;
    if (optimized) result = await commands.updateMany(owner, state.revision, [command], "new-country");
    else {
      await commands.writeMany(owner, state.revision, [command], "new-country");
      result = await data.read(owner, "new-country"); // exact old response path
    }
    const elapsed = performance.now() - start;
    // Untimed, independent persisted reader verifies COMPLETE response contract.
    const persisted = await data.read(owner, "new-country");
    assert.equal(semanticHash(result), semanticHash(persisted), "Complete response must equal DB reader");
    results.push({ optimized, kind, totalMs: elapsed, writerMs: commands.lastReceipt!.writerMs,
      responseMs: elapsed - commands.lastReceipt!.writerMs,
      revision: result.revision, fullResponseDigestMatches: true });
    state = await commands.read(owner, "new-country");
    console.log("response benchmark", results.at(-1));
  }
  // Validate the source intended for FUTURE import, never the mutated test copies.
  const source = await db.query(`SELECT w.workspace_id,w.owner_key,w.current_revision,m.revision,m.state
    FROM company_workspaces w JOIN talkhint_project_models m ON m.owner_key=w.owner_key
    WHERE w.environment='development' AND w.storage_generation='shadow'`);
  assert.equal(source.rowCount, 1);
  const b = source.rows[0];
  assert.equal(Number(b.current_revision), Number(b.revision));
  const sourceRoot = await unpackModel(db, b.owner_key, b.state);
  const sourceProof = { sourceKind: "accepted genuine shadow B, NOT B2", workspace: b.workspace_id,
    revision: b.revision, semanticHash: semanticHash(sourceRoot),
    documents: sourceRoot.alternatives?.find(a => a.id === "new-country")?.model.documents.length,
    mustRecomputeImmediatelyBeforeImport: true };

  // A small independent transport fixture, NOT the full-size or real source.
  // Do not keep a second 144 MB decoded history merely to test security.
  const transportWorkspace = `${tag}:transport`, transportOwner = `${tag}:source`;
  const selected = { schema: 1, revision: 9, elements: [], relations: [],
    documents: [{ id: "DOC-PROBE", title: "Synthetic", text: "Exact 😀\r\n".repeat(600),
      url: "", elementIds: [], updatedAt: "2026-10-28" }],
    decisions: [], proposals: [], taskDrafts: [] };
  const root = { ...selected, alternatives: [{ id: "new-country", title: "Synthetic", model: selected }] };
  await db.query(`INSERT INTO company_v3_workspaces
    (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
    VALUES($1,$2,'development','UNCOMMITTED synthetic transport','test',9,'pending')`,
  [transportWorkspace, transportOwner]);
  const store = new SqlFrameStore(db, transportWorkspace, await readBusinessContract(db));
  const rootHash = await encode(root, store); await store.flush();
  await db.query("UPDATE company_v3_workspaces SET root_hash=$2 WHERE workspace_id=$1", [transportWorkspace, rootHash]);
  await db.query(`INSERT INTO company_v3_revision_heads(workspace_id,revision,root_hash,actor,source_semantic_hash)
    VALUES($1,9,$2,'uncommitted synthetic',$3)`, [transportWorkspace, rootHash, semanticHash(root)]);
  for (const [hypothesis, path] of [["original", ["documents", "0"]],
    ["new-country", ["alternatives", "0", "model", "documents", "0"]]] as [string, string[]][]) {
    await db.query("INSERT INTO company_v3_document_heads VALUES($1,$2,'DOC-PROBE',9,$3)",
      [transportWorkspace, hypothesis, await at(rootHash, path, store)]);
  }
  const records: TransferRecord[] = [];
  for (const table of ["company_v3_business_contract", "company_v3_contracts", ...copyTables]) {
    const global = table.includes("contract");
    const r = await db.query(`SELECT * FROM ${table} ${global ? "" : "WHERE workspace_id=$1"}`, global ? [] : [transportWorkspace]);
    // Copy's archive refs still point at source owner; synthetic transfer has its
    // own tiny archive below, rather than moving real history in this test.
    if (table === "company_v3_archive_refs") continue;
    for (const row of r.rows) records.push(JSON.parse(JSON.stringify({ table, row })));
  }
  const archive = { ...root, revision: root.revision - 1 };
  records.unshift({ table: "talkhint_project_models", row: { owner_key: transportOwner, revision: root.revision, state: root } },
    { table: "talkhint_project_model_history", row: { owner_key: transportOwner, key: `r:${archive.revision}`, payload: archive } });
  records.push({ table: "company_v3_archive_refs", row: { workspace_id: transportWorkspace, source_owner_key: transportOwner,
    source_key: `r:${archive.revision}`, semantic_sha256: semanticHash(archive) } });
  const manifest: TransferManifest = { schemaVersion: 3, schemaDigest: textHash(ddlV3()), sourceOwner: transportOwner,
    sourceEnvironment: "development", sourceWorkspace: transportWorkspace, revision: root.revision,
    rootHash, semanticHash: semanticHash(root), recordCount: records.length, recordsDigest: transferDigest(records) };
  const service = new OwnerImportService(pool, "development"), target = `${tag}:target`;
  const auth = (ownerKey = target) => ({ ownerKey, isOwner: true, csrfVerified: true });
  async function* stream(rows = records) { for (const row of rows) yield row; }
  const checks: Record<string, boolean> = {};
  await assert.rejects(service.grant({ ...auth(), csrfVerified: false }, manifest, target));
  await assert.rejects(service.grant(auth(), manifest, `${target}:other`));
  checks.csrfAndBinding = true;
  const token = await service.grant(auth(), manifest, target);
  await assert.rejects(service.consume(auth(`${target}:other`), token, manifest, stream()));
  await assert.rejects(service.consume(auth(), token, { ...manifest, sourceEnvironment: "production" }, stream()));
  await assert.rejects(service.consume(auth(), token, { ...manifest, revision: 0 }, stream()));
  await assert.rejects(service.consume(auth(), token, manifest, stream(), true));
  checks.wrongOwnerEnvironmentPackageAndActivation = true;
  const exp = await service.grant(auth(`${tag}:expired`), manifest, `${tag}:expired`);
  await db.query("UPDATE company_v3_import_grants SET expires_at=now()-interval '1 second' WHERE grant_hash=$1", [textHash(exp)]);
  await assert.rejects(service.consume(auth(`${tag}:expired`), exp, manifest, stream()));
  checks.expiry = true;
  // Digest failure rolls the entire import back; grant stays unused.
  const bad = [...records.slice(0, -1)];
  await assert.rejects(service.consume(auth(), token, manifest, stream(bad)));
  assert.equal((await db.query("SELECT 1 FROM company_v3_workspaces WHERE owner_key=$1", [target])).rowCount, 0);
  checks.corruptionAtomicRollback = true;
  const result = await service.consume(auth(), token, manifest, stream());
  assert.equal(result.activated, false);
  assert.equal((await db.query("SELECT 1 FROM talkhint_project_models WHERE owner_key=$1", [target])).rowCount, 0);
  assert.equal((await db.query("SELECT 1 FROM talkhint_project_models WHERE owner_key=$1", [result.archiveOwner])).rowCount, 1);
  const a = await db.query("SELECT payload FROM talkhint_project_model_history WHERE owner_key=$1 AND key=$2",
    [result.archiveOwner, `r:${archive.revision}`]);
  assert.equal(semanticHash(a.rows[0].payload), semanticHash(archive));
  checks.shadowAndQuarantinedLegacyNoLiveOwnerRow = true;
  await assert.rejects(service.consume(auth(), token, manifest, stream()));
  checks.replay = true;
  const token2 = await service.grant(auth(), manifest, target);
  await assert.rejects(service.consume(auth(), token2, manifest, stream()), /not empty/);
  checks.nonempty = true;
  const unchanged = await db.query("SELECT current_revision,root_hash,generation FROM company_v3_workspaces WHERE workspace_id=$1",
    [fixture.workspace]);
  assert.equal(JSON.stringify(unchanged.rows[0]), JSON.stringify({
    current_revision: original.rows[0].current_revision, root_hash: original.rows[0].root_hash, generation: "test" }));
  await writeFile(`${out}/DEV_PROBE.json`, JSON.stringify({
    passed: true, copiedRowsInRolledBackTransaction: copied, results, checks,
    sourceProof, retainedCopyUnchanged: true, productionTouched: false,
    testDataPersistence: "all changes ROLLBACK, no DELETE or DDL", coldResponse:
      "A cache miss does one full pre-write read. Timings above use the preceding client read.",
  }, null, 2));
  console.log("All DEV probes PASS; rolling back uncommitted workspace/import.");
} finally {
  await db.query("ROLLBACK");
  db.release(); await realPool.end();
}
