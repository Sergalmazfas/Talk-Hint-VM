/** Dev-only staged importer/verification. Not imported by the application or build. */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { unpackModel } from "../../server/projectModel/history";
import { inspectSchema, project, reconstruct, insertProjection, readRootFromSql } from "../../server/companyData/relational";
import { semanticHash, textHash } from "../../server/companyData/valueTree";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const db = await pool.connect();
const out = "generated-artifacts/data-platform-B";
try {
  const source = await db.query(`SELECT owner_key,revision,state FROM talkhint_project_models WHERE
    EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) a WHERE a->>'id'='new-country')`);
  assert.equal(source.rowCount, 1);
  const row = source.rows[0];
  const root = await unpackModel(db, row.owner_key, row.state);
  const schema = await inspectSchema(db);
  console.log(JSON.stringify({ sourceRevision: row.revision, unpackedBytes: Buffer.byteLength(JSON.stringify(root)) }));
  const workspace = `company-dev-${semanticHash(row.owner_key).slice(0, 20)}`;
  const projection = project(root, workspace, schema);
  const counts = Object.fromEntries(Array.from(projection.tables.entries()).map(([t, rows]) => [t, rows.length]));
  console.log(JSON.stringify({ sourceRevision: row.revision, counts, extra: projection.extraSummary }));
  if (!process.argv.includes("--import")) {
    console.log("DRY RUN ONLY: no writes.");
  } else {
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL lock_timeout='2s'");
      await db.query("SET CONSTRAINTS ALL DEFERRED");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`company-import:${workspace}`]);
      const existing = await db.query("SELECT current_revision,storage_generation FROM company_workspaces WHERE workspace_id=$1", [workspace]);
      assert(!existing.rowCount || existing.rows[0].current_revision === root.revision, "Existing revision differs; reconcile, do not overwrite.");
      assert(!existing.rowCount || existing.rows[0].storage_generation === "shadow", "Only shadow import authorized.");
      await db.query(`INSERT INTO company_workspaces(workspace_id,owner_key,environment,current_revision,
        storage_generation,primary_hypothesis_id) VALUES($1,$2,'development',$3,'shadow',$4)
        ON CONFLICT DO NOTHING`, [workspace, row.owner_key, root.revision, root.primaryHypothesisId ?? null]);
      await insertProjection(db, projection, schema, { verifyAndRelease: true });
      const reconstructed = await readRootFromSql(db, workspace, root.revision, schema);
      assert.equal(semanticHash(root), semanticHash(reconstructed), "PostgreSQL roundtrip");
      for (const [table, count] of Object.entries(counts)) {
        const actual = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`, [workspace]);
        assert.equal(actual.rows[0].n, count, table);
      }
      const expectedArchives = JSON.parse(await readFile("generated-artifacts/data-platform-A/HISTORY_HASHES.json", "utf8"));
      const archiveHashes = new Map(expectedArchives.map((r: any) => [r.key, r.canonicalSemanticHash]));
      let verifiedArchives = 0;
      await db.query(`DECLARE archive_verify NO SCROLL CURSOR FOR
        SELECT key,payload FROM talkhint_project_model_history WHERE owner_key=$1 ORDER BY key`, [row.owner_key]);
      try {
        while (true) {
          const batch = await db.query("FETCH FORWARD 1 FROM archive_verify");
          if (!batch.rowCount) break;
          const item = batch.rows[0], digest = semanticHash(item.payload);
          assert.equal(digest, archiveHashes.get(item.key), "Archive changed or missing from approved inventory");
          await db.query(`INSERT INTO company_source_archives(workspace_id,source_owner_key,source_key,semantic_sha256)
            VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [workspace, row.owner_key, item.key, digest]);
          verifiedArchives++;
        }
      } finally { await db.query("CLOSE archive_verify"); }
      assert.equal(verifiedArchives, expectedArchives.length, "Archive count");
      const latest = await db.query("SELECT revision FROM talkhint_project_models WHERE owner_key=$1", [row.owner_key]);
      assert.equal(latest.rows[0].revision, root.revision, "Source changed during import; retry from new snapshot");
      const schemaDigest = textHash(await readFile("docs/data-platform/checkpoint-A.sql", "utf8"));
      const runId = `B:${root.revision}:${schemaDigest.slice(0, 16)}`;
      await db.query(`INSERT INTO company_import_runs(workspace_id,run_id,source_revision,source_sha256,status,schema_digest,finished_at)
        VALUES($1,$2,$3,$4,'passed',$5,now()) ON CONFLICT DO NOTHING`,
      [workspace, runId, root.revision, projection.hash, schemaDigest]);
      for (const [id, value] of Object.entries({ source_digest: projection.hash, graph_roundtrip: projection.hash,
        archive_count: String(verifiedArchives), active_generation: "shadow" })) {
        await db.query(`INSERT INTO company_import_checks(workspace_id,run_id,check_id,expected,actual,status,checked_at)
          VALUES($1,$2,$3,$4,$4,'passed',now()) ON CONFLICT DO NOTHING`, [workspace, runId, id, value]);
      }
      await db.query("SET CONSTRAINTS ALL IMMEDIATE");
      await db.query("COMMIT");
      await mkdir(out, { recursive: true });
      const evidence = { sourceRevision: root.revision, schemaVersion: 2, sourceHash: semanticHash(root),
        reconstructedHash: semanticHash(reconstructed), counts, extraFields: projection.extraSummary,
        databaseRoundtrip: true, boundedCursorRead: true, generation: "shadow", cutover: false,
        verifiedArchives, schemaDigest, runId,
        productionTouched: false, HintChanged: false, capturedAt: new Date().toISOString() };
      await writeFile(`${out}/IMPORT_VERIFICATION.json`, JSON.stringify(evidence, null, 2));
      console.log("COMMITTED SHADOW ONLY; all checks passed");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  }
} finally { db.release(); await pool.end(); }
