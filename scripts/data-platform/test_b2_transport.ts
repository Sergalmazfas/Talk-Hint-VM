/** Synthetic Dev-only owner import tests. No real owner grant or production connection. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { ddlV3, payloadTables, physicalTable } from "../../server/companyData/v3/schema";
import { prepareBusinessContract } from "../../server/companyData/v3/businessContract";
import { SqlFrameStore } from "../../server/companyData/v3/store";
import { at, encode } from "../../server/companyData/v3/codec";
import { semanticHash, textHash } from "../../server/companyData/valueTree";
import { OwnerImportService, transferDigest, type TransferRecord, type TransferManifest } from "../../server/companyData/v3/transport";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const tag = `company-b2-transport:${randomUUID()}`, source = `${tag}:source`, sourceOwner = `${tag}:source-owner`;
const owners: string[] = [], workspaces: string[] = [source];
const target = () => { const owner = `${tag}:target-${owners.length}`; owners.push(owner); return owner; };
const auth = (ownerKey: string) => ({ ownerKey, isOwner: true, csrfVerified: true });
const service = new OwnerImportService(pool, "development");
const checks: Record<string, boolean> = {};
async function* stream(records: TransferRecord[]) { for (const r of records) yield r; }
const root = { schema: 1, revision: 9, elements: [], relations: [], documents: [], decisions: [], proposals: [], taskDrafts: [],
  alternatives: [{ id: "new-country", title: "Synthetic source", model: {
    schema: 1, revision: 9, elements: [], relations: [], documents: [{ id: "DOC-TRANSPORT", title: "Synthetic",
      text: "Exact 😀\r\n".repeat(600), url: "", elementIds: [], updatedAt: "2026-10-28" }],
    decisions: [], proposals: [], taskDrafts: [],
  } }] };
try {
  const db = await pool.connect();
  let rootHash: string;
  try {
    await db.query("BEGIN"); await db.query(ddlV3());
    const schema = await prepareBusinessContract(db);
    await db.query(`INSERT INTO company_v3_workspaces
      (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
      VALUES($1,$2,'development','B2 transport synthetic only','test',9,'pending')`, [source, sourceOwner]);
    const store = new SqlFrameStore(db, source, schema);
    rootHash = await encode(root, store); await store.flush();
    await db.query("UPDATE company_v3_workspaces SET root_hash=$2 WHERE workspace_id=$1", [source, rootHash]);
    await db.query(`INSERT INTO company_v3_revision_heads(workspace_id,revision,root_hash,actor,source_semantic_hash)
      VALUES($1,9,$2,'synthetic',$3)`, [source, rootHash, semanticHash(root)]);
    await db.query("INSERT INTO company_v3_document_heads VALUES($1,'new-country','DOC-TRANSPORT',9,$2)",
      [source, await at(rootHash, ["alternatives", "0", "model", "documents", "0"], store)]);
    await db.query("COMMIT");
  } catch (e) { await db.query("ROLLBACK"); throw e; }
  finally { db.release(); }
  const records: TransferRecord[] = [];
  // Portable records are JSON-normalized BEFORE computing the transport hash.
  for (const table of ["company_v3_business_contract", "company_v3_contracts", "company_v3_text_snapshots",
    "company_v3_frames", "company_v3_revision_heads", "company_v3_document_heads"]) {
    const r = await pool.query(`SELECT * FROM ${table} ${table.includes("contract") ? "" : "WHERE workspace_id=$1"}`,
      table.includes("contract") ? [] : [source]);
    for (const row of r.rows) records.push(JSON.parse(JSON.stringify({ table, row })));
  }
  const old = { ...root, revision: 8, alternatives: root.alternatives.map(a => ({ ...a, model: { ...a.model, revision: 8 } })) };
  records.unshift(
    { table: "talkhint_project_models", row: { owner_key: sourceOwner, revision: 9, state: root } },
    { table: "talkhint_project_model_history", row: { owner_key: sourceOwner, key: "r:8", payload: old } });
  records.push({ table: "company_v3_archive_refs", row: { workspace_id: source,
    source_owner_key: sourceOwner, source_key: "r:8", semantic_sha256: semanticHash(old) } });
  const manifest: TransferManifest = { schemaVersion: 3, schemaDigest: textHash(ddlV3()), sourceOwner,
    sourceEnvironment: "development", sourceWorkspace: source, revision: 9, rootHash: rootHash!,
    semanticHash: semanticHash(root), recordCount: records.length, recordsDigest: transferDigest(records) };
  const a = target();
  await assert.rejects(service.grant({ ...auth(a), csrfVerified: false }, manifest, a));
  await assert.rejects(service.grant({ ...auth(a), isOwner: false }, manifest, a));
  await assert.rejects(service.grant(auth(a), manifest, sourceOwner));
  await assert.rejects(new OwnerImportService(pool, "production").grant(auth(a), manifest, a));
  checks.ownerCsrfTargetBindingAndProductionDisabled = true;
  const token = await service.grant(auth(a), manifest, a);
  const tampered = structuredClone(records);
  tampered.at(-1)!.row.actor = "tampered";
  await assert.rejects(service.consume(auth(a), token, manifest, stream(tampered)));
  assert.equal((await pool.query("SELECT 1 FROM company_v3_workspaces WHERE owner_key=$1", [a])).rowCount, 0);
  checks.tamperAtomicRollback = true;
  await assert.rejects(service.consume(auth(sourceOwner), token, manifest, stream(records)));
  await assert.rejects(service.consume(auth(a), token, { ...manifest, sourceEnvironment: "production" }, stream(records)));
  checks.ownerAndEnvironmentIsolation = true;
  const good = await service.consume(auth(a), token, manifest, stream(records));
  workspaces.push(good.workspace);
  assert.equal(good.semanticHash, semanticHash(root)); assert.equal(good.activated, false); assert.equal(good.generation, "shadow");
  checks.successfulSyntheticImportNotActivated = true;
  owners.push(good.archiveOwner);
  assert.equal((await pool.query("SELECT 1 FROM talkhint_project_models WHERE owner_key=$1", [a])).rowCount, 0);
  const archive = await pool.query("SELECT payload FROM talkhint_project_model_history WHERE owner_key=$1 AND key='r:8'", [good.archiveOwner]);
  assert.equal(semanticHash(archive.rows[0].payload), semanticHash(old));
  checks.archiveOwnerRemapAndExactPayload = true;
  checks.longTextSnapshotAndDirectDocumentIndex = true;
  await assert.rejects(service.consume(auth(a), token, manifest, stream(records)));
  checks.replayRejected = true;
  const expiredOwner = target(), expired = await service.grant(auth(expiredOwner), manifest, expiredOwner);
  await pool.query("UPDATE company_v3_import_grants SET expires_at=now()-interval '1 second' WHERE grant_hash=$1", [textHash(expired)]);
  await assert.rejects(service.consume(auth(expiredOwner), expired, manifest, stream(records)));
  checks.expiredGrantRejected = true;
  await assert.rejects(service.consume(auth(a), token, manifest, stream(records), "false" as any), /boolean activation/);
  checks.activationCannotBeCoercedFromString = true;
  const incompatibleOwner = target(), incompatible = structuredClone(records);
  const business = incompatible.find(r => r.table === "company_v3_business_contract")!.row;
  business.definition_text = JSON.stringify({ ...JSON.parse(business.definition_text), incompatibleSynthetic: true });
  business.sha256 = textHash(business.definition_text);
  const incompatibleManifest = { ...manifest, recordsDigest: transferDigest(incompatible) };
  const incompatibleToken = await service.grant(auth(incompatibleOwner), incompatibleManifest, incompatibleOwner);
  await assert.rejects(service.consume(auth(incompatibleOwner), incompatibleToken, incompatibleManifest, stream(incompatible)),
    /Incompatible business contract/);
  checks.frozenBusinessContractMismatchRejected = true;
  const badOwner = target(), badIndex = structuredClone(records);
  badIndex.find(r => r.table === "company_v3_document_heads")!.row.frame_hash = rootHash;
  const badManifest = { ...manifest, recordsDigest: transferDigest(badIndex) };
  const badToken = await service.grant(auth(badOwner), badManifest, badOwner);
  await assert.rejects(service.consume(auth(badOwner), badToken, badManifest, stream(badIndex)), /document index mismatch/);
  assert.equal((await pool.query("SELECT 1 FROM company_v3_workspaces WHERE owner_key=$1", [badOwner])).rowCount, 0);
  checks.badDocumentIndexAtomicRollback = true;
  const b = target(), tokens = [await service.grant(auth(b), manifest, b), await service.grant(auth(b), manifest, b)];
  const race = await Promise.allSettled(tokens.map(t => service.consume(auth(b), t, manifest, stream(records))));
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  for (const r of race) if (r.status === "fulfilled") {
    workspaces.push(r.value.workspace); owners.push(r.value.archiveOwner);
  }
  const candidate = await pool.query("SELECT workspace_id FROM company_v3_workspaces WHERE owner_key=$1", [b]);
  assert.equal(candidate.rowCount, 1);
  checks.concurrentTargetEmptinessRecheckOneWinner = true;
  await writeFile("generated-artifacts/data-platform-B2/TRANSPORT_TESTS.json", JSON.stringify({
    passed: true, checks, recordCount: records.length, realOwnerGrantCreated: false, productionImported: false,
    sourceActivated: false, controller: "prepared service; no HTTP route installed",
  }, null, 2));
  console.log("B2 transport PASSED", checks);
} finally {
  // Exact synthetic owners/workspaces only. Retained load workspace is not in this allowlist.
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const workspace of workspaces) {
      assert(workspace === source || workspace.startsWith("company-import-"));
      const row = await db.query("SELECT owner_key FROM company_v3_workspaces WHERE workspace_id=$1", [workspace]);
      if (!row.rowCount) continue;
      assert([sourceOwner, ...owners].includes(row.rows[0].owner_key));
      for (const table of ["company_v3_document_heads", "company_v3_revision_heads", "company_v3_archive_refs",
        "company_v3_size_budgets", "company_v3_payload_text_refs", "company_v3_frames",
        ...payloadTables.map(physicalTable), "company_v3_text_snapshots"])
        await db.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [workspace]);
      await db.query("DELETE FROM company_v3_workspaces WHERE workspace_id=$1", [workspace]);
    }
    await db.query("DELETE FROM company_v3_import_grants WHERE target_owner=ANY($1::text[])", [owners]);
    await db.query("DELETE FROM talkhint_project_model_history WHERE owner_key=ANY($1::text[])", [owners]);
    await db.query("DELETE FROM talkhint_project_models WHERE owner_key=ANY($1::text[])", [owners]);
    await db.query("COMMIT");
  } catch (e) { await db.query("ROLLBACK"); throw e; }
  finally { db.release(); await pool.end(); }
}
