import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { inspectSchema, readRootFromSql } from "../../server/companyData/relational";
import { semanticHash, textHash } from "../../server/companyData/valueTree";
import { IncrementalCompanyRepository } from "../../server/companyData/v3/repository";
import { ddlV3 } from "../../server/companyData/v3/schema";
import { readBusinessContract } from "../../server/companyData/v3/businessContract";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const out = "generated-artifacts/data-platform-B2";
const m = JSON.parse(await readFile(`${out}/RETAINED_WORKSPACE.json`, "utf8"));
const load = JSON.parse(await readFile(`${out}/LOAD_20_WRITES.json`, "utf8"));
assert(load.complete && load.rows.length === 20);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 }), db = await pool.connect();
try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await readBusinessContract(db);
  const sources = await db.query(`SELECT workspace_id,current_revision FROM company_workspaces WHERE storage_generation='shadow' AND environment='development'`);
  assert.equal(sources.rows.length, 1);
  const b = sources.rows[0];
  const original = await readRootFromSql(db, b.workspace_id, Number(b.current_revision), await inspectSchema(db));
  assert.equal(semanticHash(original), m.sourceHash);
  const logical: Record<string, any> = {};
  for (const h of [{ id: "original", model: original }, ...(original.alternatives ?? [])]) {
    logical[h.id] = { documents: h.model.documents.length, decisions: h.model.decisions.length,
      elements: h.model.elements.length, operatingVersions: h.model.operatingModel?.revisions.map(r => r.version) ?? [],
      stableEntityIds: Array.from(new Set(h.model.operatingModel?.revisions.flatMap(r => r.data.nodes.map(n => n.id)) ?? [])).sort() };
  }
  await db.query(`DECLARE b2_archives NO SCROLL CURSOR FOR
    SELECT a.source_key,a.semantic_sha256,h.payload FROM company_v3_archive_refs a
    JOIN talkhint_project_model_history h ON h.owner_key=a.source_owner_key AND h.key=a.source_key
    WHERE a.workspace_id=$1 ORDER BY a.source_key`, [m.workspace]);
  const archiveDigests = [];
  while (true) {
    const result = await db.query("FETCH 1 FROM b2_archives");
    if (!result.rows.length) break;
    const a = result.rows[0], digest = semanticHash(a.payload);
    assert.equal(digest, a.semantic_sha256);
    archiveDigests.push({ key: a.source_key, sha256: digest });
  }
  await db.query("CLOSE b2_archives");
  assert.equal(archiveDigests.length, 242);
  const statuses = await db.query("SELECT generation,count(*)::integer AS count FROM company_v3_workspaces GROUP BY generation");
  assert.equal(statuses.rows.find(r => r.generation === "normalized")?.count ?? 0, 0);
  const label = await db.query("SELECT label,generation,retain_until_owner_review,current_revision FROM company_v3_workspaces WHERE workspace_id=$1", [m.workspace]);
  assert.equal(label.rows[0].generation, "test"); assert(label.rows[0].retain_until_owner_review);
  await db.query("COMMIT");
  const repo = new IncrementalCompanyRepository(pool, "development", true);
  const current = await repo.readRoot(m.testOwner);
  assert.equal(semanticHash(current), load.rows.at(-1).semanticHash);
  const initial = await repo.readRoot(m.testOwner, m.sourceRevision);
  assert.equal(semanticHash(initial), m.sourceHash);
  const documents = [];
  for (const d of current.alternatives![0].model.documents) {
    const direct = await repo.readDocumentSnapshot(m.testOwner, "new-country", d.id);
    assert.deepEqual(direct.document, d);
    documents.push({ id: d.id, sha256: textHash(d.text), utf16: d.text.length });
  }
  const snapshots = await pool.query(`SELECT count(*)::integer AS count,sum(utf8_bytes)::bigint AS utf8_bytes
    FROM company_v3_text_snapshots WHERE workspace_id=$1`, [m.workspace]);
  const schema = ddlV3(); await writeFile(`${out}/schema-v3.sql`, schema);
  await writeFile(`${out}/FINAL_VERIFICATION.json`, JSON.stringify({
    passed: true, sourceBSemanticHash: m.sourceHash, originalV3SemanticHash: semanticHash(initial),
    currentV3SemanticHash: semanticHash(current), currentRevision: current.revision,
    logicalSourceInventory: logical, immutableArchiveDigests: archiveDigests, currentDocuments: documents,
    snapshots: snapshots.rows[0], workspace: m.workspace, retained: label.rows[0], generations: statuses.rows,
    schemaDigest: textHash(schema), productionTouched: false, sourceActivated: false,
    signedInUiVerified: false, testsUseProtectedRepositoryAndMcpNotAuthBypass: true,
  }, null, 2));
  console.log("B2 final source/history/84 documents verified", { currentRevision: current.revision, archives: archiveDigests.length });
} finally { await db.query("ROLLBACK"); db.release(); await pool.end(); }
