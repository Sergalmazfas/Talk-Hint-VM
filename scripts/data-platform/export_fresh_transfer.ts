/** Offline Dev-only export, NOT a production importer. All staging writes ROLLBACK.
 * Genuine accepted B is read-only. No DDL, DELETE, activation, calls or mail.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { Pool } from "pg";
import { inspectSchema, readRootFromSql } from "../../server/companyData/relational";
import { child, semanticHash, textHash } from "../../server/companyData/valueTree";
import { at, encode, decode, type Frame } from "../../server/companyData/v3/codec";
import { ddlV3, payloadTables, physicalTable } from "../../server/companyData/v3/schema";
import { SqlFrameStore } from "../../server/companyData/v3/store";
import { readBusinessContract } from "../../server/companyData/v3/businessContract";
import { activeModelSize } from "../../server/projectModel/sizeBudget";
import type { TransferManifest, TransferRecord } from "../../server/companyData/v3/transport";
import { reviewedAccountBinding as binding } from "../../server/companyData/v3/importApproval";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const out = "generated-artifacts/data-platform-publish2";
await mkdir(out, { recursive: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = await pool.connect();
await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
const workspace = `company-transfer-fresh-B-${randomUUID()}`;
try {
  const q = await db.query(`SELECT w.*,m.revision AS legacy_revision,m.state AS packed_state
    FROM company_workspaces w JOIN talkhint_project_models m ON m.owner_key=w.owner_key
    WHERE w.workspace_id=$1 AND w.owner_key=$2 AND w.environment='development' AND w.storage_generation='shadow'`,
  [binding.sourceBWorkspace, binding.sourceOwner]);
  assert.equal(q.rowCount, 1, "Only genuine shadow B, never B2");
  const b = q.rows[0];
  assert.equal(Number(b.current_revision), Number(b.legacy_revision), "Fresh source differs from legacy");
  const schema = await inspectSchema(db), contract = await readBusinessContract(db);
  const root = await readRootFromSql(db, b.workspace_id, b.current_revision, schema);
  const sourceHash = semanticHash(root);
  const hypotheses = [{ id: "original", model: root, prefix: [] as string[] },
    ...(root.alternatives ?? []).map((a, i) => ({ ...a, prefix: ["alternatives", String(i), "model"] }))];
  const documents = hypotheses.flatMap(h => h.model.documents.map(d =>
    ({ hypothesis: h.id, id: d.id, sha256: textHash(d.text), semanticHash: semanticHash(d), utf8Bytes: Buffer.byteLength(d.text) })));
  assert.equal(documents.length, 84);
  assert.equal(documents.filter(d => d.hypothesis === "original").length, 34);
  assert.equal(documents.filter(d => d.hypothesis === "new-country").length, 50);
  const archives: {key: string; semanticHash: string}[] = [];
  await db.query(`DECLARE export_archives NO SCROLL CURSOR FOR
    SELECT a.source_key,a.semantic_sha256,h.payload FROM company_source_archives a
    JOIN talkhint_project_model_history h ON h.owner_key=a.source_owner_key AND h.key=a.source_key
    WHERE a.workspace_id=$1 ORDER BY a.source_key`, [b.workspace_id]);
  while (true) {
    const r = await db.query("FETCH 1 FROM export_archives");
    if (!r.rowCount) break;
    const a = r.rows[0], sha = semanticHash(a.payload);
    assert.equal(sha, a.semantic_sha256);
    archives.push({key: a.source_key, semanticHash: sha});
  }
  await db.query("CLOSE export_archives");
  assert.equal(archives.length, 242);
  await db.query(`INSERT INTO company_v3_workspaces
    (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
    VALUES($1,$2,'development','UNCOMMITTED fresh shadow B transfer encoder','test',$3,'pending')`,
  [workspace, `transfer-encoding:${workspace}`, root.revision]);
  const store = new SqlFrameStore(db, workspace, contract), columns = new Map<string, Frame>();
  const counts: Record<string, number> = {};
  for (const table of payloadTables) {
    const keys = new Map<string, string>();
    await db.query(`DECLARE export_payload NO SCROLL CURSOR FOR SELECT * FROM ${table} WHERE workspace_id=$1`, [b.workspace_id]);
    let count = 0;
    while (true) {
      const result = await db.query("FETCH 4096 FROM export_payload");
      if (!result.rowCount) break;
      for (const row of result.rows) {
        const hash = await store.payload(table, row);
        keys.set(JSON.stringify(schema[table].keys.map(k => String(row[k]))), hash);
        count++;
      }
    }
    await db.query("CLOSE export_payload");
    await db.query(`DECLARE export_locations NO SCROLL CURSOR FOR
      SELECT source_pointer,key_values,source_fields,target_columns FROM company_record_locations
      WHERE workspace_id=$1 AND revision=$2 AND target_table=$3`, [b.workspace_id, root.revision, table]);
    while (true) {
      const result = await db.query("FETCH 4096 FROM export_locations");
      if (!result.rowCount) break;
      for (const row of result.rows) {
        const record = keys.get(JSON.stringify(row.key_values));
        assert(record, `Missing typed B payload ${table}`);
        row.source_fields.forEach((field: string, i: number) =>
          columns.set(field === "$value" ? row.source_pointer : child(row.source_pointer, field),
            { kind: "column", table, record, column: row.target_columns[i] }));
      }
    }
    await db.query("CLOSE export_locations");
    await store.flush();
    store.records.clear();
    counts[table] = count;
    console.log("fresh B typed", table, count);
  }
  const rootHash = await encode(root, store, columns); columns.clear();
  await store.flush();
  await db.query(`INSERT INTO company_v3_revision_heads
    (workspace_id,revision,root_hash,actor,source_semantic_hash) VALUES($1,$2,$3,'fresh B transfer',$4)`,
  [workspace, root.revision, rootHash, sourceHash]);
  for (const h of hypotheses) for (let i = 0; i < h.model.documents.length; i++) {
    const hash = await at(rootHash, [...h.prefix, "documents", String(i)], store);
    await db.query("INSERT INTO company_v3_document_heads VALUES($1,$2,$3,$4,$5)",
      [workspace, h.id, h.model.documents[i].id, root.revision, hash]);
    const actual = await decode(hash, new SqlFrameStore(db, workspace, contract));
    assert.equal(semanticHash(actual), semanticHash(h.model.documents[i]), "Independent direct document");
  }
  await db.query(`INSERT INTO company_v3_archive_refs SELECT $1,source_owner_key,source_key,semantic_sha256
    FROM company_source_archives WHERE workspace_id=$2`, [workspace, b.workspace_id]);
  const { alternatives: _a, ...original } = root;
  for (const [id, size] of [["$root", activeModelSize(root)], ["original", activeModelSize(original as any)],
    ...(root.alternatives ?? []).map(a => [a.id, activeModelSize(a.model)])] as [string, number][])
    await db.query("INSERT INTO company_v3_size_budgets VALUES($1,$2,$3)", [workspace, id, size]);
  await db.query("UPDATE company_v3_workspaces SET root_hash=$2 WHERE workspace_id=$1", [workspace, rootHash]);
  const independent = new SqlFrameStore(db, workspace, contract);
  await independent.preload();
  assert.equal(semanticHash(await decode(rootHash, independent)), sourceHash, "Full independent v3 roundtrip");
  console.log("full fresh B readback PASS", {revision: root.revision, sourceHash});
  const recordsFile = `${out}/records.ndjson`, stream = createWriteStream(recordsFile, {flags: "wx", mode: 0o600});
  const recordsDigest = createHash("sha256"), recordsFileDigest = createHash("sha256");
  let recordCount = 0, maximumRecordLineBytes = 0, recordsBytes = 0;
  async function emit(table: string, raw: any) {
    const record: TransferRecord = JSON.parse(JSON.stringify({table, row: raw}));
    const line = JSON.stringify(record) + "\n", size = Buffer.byteLength(line);
    recordsDigest.update(semanticHash(record)).update("\n");
    recordsFileDigest.update(line); recordsBytes += size;
    maximumRecordLineBytes = Math.max(maximumRecordLineBytes, size);
    recordCount++;
    if (!stream.write(line)) await once(stream, "drain");
  }
  await emit("talkhint_project_models", {owner_key: b.owner_key, revision: b.legacy_revision, state: b.packed_state});
  await db.query(`DECLARE export_history NO SCROLL CURSOR FOR
    SELECT h.* FROM company_source_archives a JOIN talkhint_project_model_history h
    ON h.owner_key=a.source_owner_key AND h.key=a.source_key WHERE a.workspace_id=$1 ORDER BY h.key`, [b.workspace_id]);
  while (true) {
    const r = await db.query("FETCH 1 FROM export_history");
    if (!r.rowCount) break;
    await emit("talkhint_project_model_history", r.rows[0]);
  }
  await db.query("CLOSE export_history");
  const tables = ["company_v3_business_contract", "company_v3_contracts", "company_v3_text_snapshots",
    ...payloadTables.map(physicalTable), "company_v3_payload_text_refs", "company_v3_frames",
    "company_v3_revision_heads", "company_v3_document_heads", "company_v3_archive_refs", "company_v3_size_budgets"];
  for (const table of tables) {
    const global = ["company_v3_business_contract", "company_v3_contracts"].includes(table);
    await db.query(`DECLARE export_records NO SCROLL CURSOR FOR SELECT * FROM ${table} ${global ? "" : "WHERE workspace_id=$1"}`,
      global ? [] : [workspace]);
    while (true) {
      const r = await db.query("FETCH 64 FROM export_records");
      if (!r.rowCount) break;
      for (const row of r.rows) await emit(table, row);
    }
    await db.query("CLOSE export_records");
  }
  stream.end(); await once(stream, "finish");
  const manifest: TransferManifest = {schemaVersion: 3, schemaDigest: textHash(ddlV3()),
    sourceOwner: b.owner_key, sourceEnvironment: "development", sourceWorkspace: workspace,
    sourceBWorkspace: b.workspace_id, scope: "new-country", revision: Number(root.revision),
    rootHash, semanticHash: sourceHash, recordCount, recordsDigest: recordsDigest.digest("hex")};
  await writeFile(`${out}/MANIFEST.json`, JSON.stringify(manifest, null, 2));
  await writeFile(`${out}/SOURCE_PROOF.json`, JSON.stringify({
    capturedAt: new Date().toISOString(), source: "genuine accepted shadow B, NOT B2",
    workspace: b.workspace_id, revision: root.revision, semanticHash: sourceHash,
    encodedWorkspace: workspace, scope: "new-country", original: "technical archive, NOT activated",
    documentCount: documents.length, documents, archiveCount: archives.length, archives,
    sourceCounts: counts, independentFullReadback: true, directDocumentsVerified: 84,
    recordsBytes, recordsFileSha256: recordsFileDigest.digest("hex"), maximumRecordLineBytes,
    recordCount, sourceRowsChanged: false, staging: "ROLLBACK", productionTouched: false,
  }, null, 2));
  console.log("EXPORT PASS", {recordCount, maximumRecordLineBytes, recordsBytes});
} finally {
  await db.query("ROLLBACK"); db.release(); await pool.end();
}
