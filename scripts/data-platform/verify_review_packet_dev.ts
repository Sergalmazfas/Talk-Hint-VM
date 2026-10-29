/** Owner-requested reverse assembly of the SEALED PACKAGE in Dev only.
 * Private technical workspace, single transaction, ALWAYS ROLLBACK.
 * No import handler/service/grant, COMMIT, DDL, DELETE, activation, calls or mail.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { inspectSchema, readRootFromSql } from "../../server/companyData/relational";
import { semanticHash, textHash } from "../../server/companyData/valueTree";
import { ddlV3, payloadTables, physicalTable } from "../../server/companyData/v3/schema";
import { storedTransfer } from "../../server/companyData/v3/packageStorage";
import { reviewedPackage as pin } from "../../server/companyData/v3/reviewedPackage";
import { reviewedAccountBinding } from "../../server/companyData/v3/importApproval";
import { SqlFrameStore } from "../../server/companyData/v3/store";
import { readBusinessContract } from "../../server/companyData/v3/businessContract";
import { decode } from "../../server/companyData/v3/codec";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
assert(pin && pin.manifest.scope === "new-country");
const base = "generated-artifacts/data-platform-publish2";
const out = "generated-artifacts/data-platform-claude-review";
await mkdir(out, {recursive: true});
const baseline = JSON.parse(await readFile("generated-artifacts/data-platform-B2/LOAD_20_WRITES.json", "utf8"));
assert.equal(baseline.before.workspaceRows, 129518);
const sourceProof = JSON.parse(await readFile(`${base}/SOURCE_PROOF.json`, "utf8"));
const pool = new Pool({connectionString: process.env.DATABASE_URL, max: 1});
const db = await pool.connect();
const workspace = `verify-packet-UNCOMMITTED-${randomUUID()}`;
const archiveOwner = `verify-packet-archive:${workspace}`;
const counts: Record<string, number> = {};
let report: any;
await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
try {
  const source = await db.query(`SELECT current_revision,storage_generation,owner_key FROM company_workspaces
    WHERE workspace_id=$1`, [reviewedAccountBinding.sourceBWorkspace]);
  assert.equal(source.rowCount, 1);
  assert.equal(source.rows[0].owner_key, pin.manifest.sourceOwner);
  assert.equal(source.rows[0].storage_generation, "shadow");
  assert.equal(Number(source.rows[0].current_revision), pin.manifest.revision);
  // Only a digest/document inventory survives this block, not a second full root.
  let sourceHash: string;
  {
    const root = await readRootFromSql(db, reviewedAccountBinding.sourceBWorkspace,
      pin.manifest.revision, await inspectSchema(db));
    sourceHash = semanticHash(root);
    assert.equal(sourceHash, pin.manifest.semanticHash);
  }
  console.log("SOURCE verified", {revision: pin.manifest.revision, semanticHash: sourceHash});
  await db.query(`INSERT INTO company_v3_workspaces
    (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
    VALUES($1,$2,'development','UNCOMMITTED sealed package reverse assembly, NOT import','test',$3,'pending')`,
  [workspace, `verify-packet:${workspace}`, pin.manifest.revision]);
  const global = new Set(["company_v3_business_contract", "company_v3_contracts"]);
  const legacy = new Set(["talkhint_project_models", "talkhint_project_model_history"]);
  const allowed = new Set([...global, ...legacy, ...payloadTables.map(physicalTable),
    "company_v3_text_snapshots", "company_v3_payload_text_refs", "company_v3_frames",
    "company_v3_revision_heads", "company_v3_document_heads", "company_v3_archive_refs", "company_v3_size_budgets"]);
  let batch: any[] = [], batchTable = "", batchBytes = 0;
  async function flush() {
    if (!batch.length) return;
    const names = Object.keys(batch[0]);
    assert(names.every(n => /^[a-z_][a-z0-9_]*$/.test(n)));
    assert(batch.every(row => Object.keys(row).join("|") === names.join("|")), "Homogeneous columns");
    const columns = names.map(n => `"${n}"`).join(",");
    await db.query(`INSERT INTO ${batchTable} (${columns}) SELECT ${columns}
      FROM jsonb_populate_recordset(NULL::${batchTable},$1::jsonb)
      ${batchTable === "company_v3_contracts" ? "ON CONFLICT(contract_hash) DO NOTHING" :
        batchTable === "company_v3_business_contract" ? "ON CONFLICT(version) DO NOTHING" : ""}`,
    [JSON.stringify(batch)]);
    console.log("Loaded batch", batchTable, counts[batchTable]);
    batch = []; batchBytes = 0;
  }
  let count = 0;
  const digest = createHash("sha256");
  for await (const record of storedTransfer(pin)) {
    assert(allowed.has(record.table), "Only sealed-package tables");
    counts[record.table] = (counts[record.table] ?? 0) + 1;
    digest.update(semanticHash(record)).update("\n"); count++;
    const row = {...record.row};
    if (global.has(record.table)) {
      if (record.table === "company_v3_contracts") assert.equal(
        semanticHash({version: row.version, kind: row.kind, field_names: row.field_names}), row.contract_hash);
      else assert.equal(textHash(row.definition_text), row.sha256);
    } else if (legacy.has(record.table)) {
      assert.equal(row.owner_key, pin.manifest.sourceOwner); row.owner_key = archiveOwner;
    } else {
      assert.equal(row.workspace_id, pin.manifest.sourceWorkspace); row.workspace_id = workspace;
      if (record.table === "company_v3_archive_refs") {
        assert.equal(row.source_owner_key, pin.manifest.sourceOwner);
        row.source_owner_key = archiveOwner;
      }
    }
    const size = Buffer.byteLength(JSON.stringify(row));
    if (batch.length && (batchTable !== record.table || batch.length >= 256 || batchBytes + size > 8 * 1024 * 1024))
      await flush();
    batchTable = record.table; batch.push(row); batchBytes += size;
    if (size > 8 * 1024 * 1024) await flush();
  }
  await flush();
  assert.equal(count, pin.manifest.recordCount);
  assert.equal(digest.digest("hex"), pin.manifest.recordsDigest);
  const store = new SqlFrameStore(db, workspace, await readBusinessContract(db));
  await store.preload();
  const root = await decode(pin.manifest.rootHash, store);
  const actualHash = semanticHash(root);
  assert.equal(actualHash, sourceHash);
  assert.equal(root.revision, pin.manifest.revision);
  const hypotheses = [{id: "original", model: root}, ...(root.alternatives ?? [])];
  const documents: any[] = [];
  for (const h of hypotheses) for (const doc of h.model.documents) {
    const expected = sourceProof.documents.find((d: any) => d.hypothesis === h.id && d.id === doc.id);
    assert(expected, "Source document identity");
    assert.equal(textHash(doc.text), expected.sha256, "Exact UTF-8 SHA");
    assert.equal(Buffer.byteLength(doc.text), expected.utf8Bytes);
    const index = await db.query(`SELECT frame_hash FROM company_v3_document_heads WHERE workspace_id=$1
      AND hypothesis_id=$2 AND document_id=$3 AND valid_from<=$4 ORDER BY valid_from DESC LIMIT 1`,
    [workspace, h.id, doc.id, pin.manifest.revision]);
    assert.equal(index.rowCount, 1);
    const direct = await decode(index.rows[0].frame_hash, store);
    assert.equal(semanticHash(direct), expected.semanticHash);
    assert.equal(textHash(direct.text), expected.sha256);
    documents.push({...expected, directIndexVerified: true});
  }
  assert.equal(documents.length, 84);
  assert.equal(documents.filter(d => d.hypothesis === "original").length, 34);
  assert.equal(documents.filter(d => d.hypothesis === "new-country").length, 50);
  const archives: any[] = [];
  await db.query(`DECLARE verify_packet_archives NO SCROLL CURSOR FOR
    SELECT a.source_key,a.semantic_sha256,h.payload FROM company_v3_archive_refs a
    JOIN talkhint_project_model_history h ON h.owner_key=a.source_owner_key AND h.key=a.source_key
    WHERE a.workspace_id=$1 ORDER BY a.source_key`, [workspace]);
  while (true) {
    const r = await db.query("FETCH 1 FROM verify_packet_archives");
    if (!r.rowCount) break;
    const a = r.rows[0], sha = semanticHash(a.payload);
    assert.equal(sha, a.semantic_sha256);
    assert.equal(sha, sourceProof.archives.find((x: any) => x.key === a.source_key)?.semanticHash);
    archives.push({key: a.source_key, semanticHash: sha});
  }
  await db.query("CLOSE verify_packet_archives");
  assert.equal(archives.length, 242);
  const comparison = Object.keys({...baseline.before.tables, ...counts}).sort().map(table => ({
    table, baselineB2Rows: baseline.before.tables[table]?.rows ?? 0,
    packageRecords: counts[table] ?? 0,
    delta: (counts[table] ?? 0) - (baseline.before.tables[table]?.rows ?? 0),
    scope: global.has(table) ? "global contract, excluded from B2 workspaceRows" :
      legacy.has(table) ? "legacy archive transport, excluded from B2 workspaceRows" : "workspace-scoped rows",
  }));
  assert.equal(comparison.reduce((n, r) => n + r.delta, 0), 434);
  assert.equal(textHash(ddlV3()), pin.manifest.schemaDigest);
  report = {
    passed: true, selfAcceptance: false, review: "Claude and owner pending",
    method: "Download sealed object from App Storage; load isolated UNCOMMITTED Dev workspace; SQL-backed decode, direct document reads, archive payloads; ROLLBACK",
    handlerCalled: false, grantCreated: false, commitExecuted: false,
    workspace, sourceB: reviewedAccountBinding.sourceBWorkspace,
    sourceRevision: pin.manifest.revision, sourceSemanticSha256: sourceHash,
    reconstructedSemanticSha256: actualHash, rootHash: pin.manifest.rootHash,
    recordCount: count, tableCounts: counts, comparison, baselineRows: 129518, delta: 434,
    documents, documentCount: 84, originalDocuments: 34, newCountryDocuments: 50,
    archives, archiveCount: 242, checkedAt: new Date().toISOString(),
    sourceRowsChanged: false, productionTouched: false, activated: false, published: false,
  };
} finally {
  await db.query("ROLLBACK");
  const residue = await db.query(`SELECT
    (SELECT count(*) FROM company_v3_workspaces WHERE workspace_id=$1) AS workspaces,
    (SELECT count(*) FROM talkhint_project_models WHERE owner_key=$2) AS parents`,
  [workspace, archiveOwner]);
  assert.equal(Number(residue.rows[0].workspaces), 0);
  assert.equal(Number(residue.rows[0].parents), 0);
  if (report) {
    report.rolledBack = true; report.residue = residue.rows[0];
    await writeFile(`${out}/DEV_PACKAGE_ROUNDTRIP.json`, JSON.stringify(report, null, 2));
  }
  db.release(); await pool.end();
}
console.log("SEALED PACKAGE DEV ROUNDTRIP PASS", {records: report.recordCount, semanticHash: report.reconstructedSemanticSha256});
