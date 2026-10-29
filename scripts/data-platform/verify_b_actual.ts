/** Read-only checks of the committed Dev shadow. No external model or mail calls. */
import { Pool } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { CompanyModelRepository } from "../../server/companyData/repository";
import { businessTables } from "../../server/companyData/relational";
import { semanticHash, textHash } from "../../server/companyData/valueTree";
import { unpackModel } from "../../server/projectModel/history";
import { readHypothesis } from "../../server/projectModel/hypotheses";
const url = process.env.DATABASE_URL!;
assert.equal(new URL(url).hostname, "helium", "Only Dev verification is permitted");
const pool = new Pool({ connectionString: url, max: 2 });
try {
  const evidence = JSON.parse(readFileSync("generated-artifacts/data-platform-B/IMPORT_VERIFICATION.json", "utf8"));
  const scope = await pool.query(`SELECT workspace_id,owner_key,current_revision,storage_generation FROM company_workspaces
    WHERE environment='development' AND storage_generation='shadow'`);
  assert.equal(scope.rowCount, 1);
  const w = scope.rows[0];
  assert.equal(w.current_revision, evidence.sourceRevision);
  const actual: Record<string, number> = {};
  for (const table of businessTables) {
    actual[table] = Number((await pool.query(`SELECT count(*) FROM public.${table} WHERE workspace_id=$1`,
      [w.workspace_id])).rows[0].count);
    assert.equal(actual[table], evidence.counts[table], `Unexpected committed rows: ${table}`);
  }
  const repo = new CompanyModelRepository(async () => pool, "development", { shadowVerification: true });
  const docs = JSON.parse(readFileSync("generated-artifacts/data-platform-A/DOCUMENT_INVENTORY.json", "utf8"));
  for (const d of docs) {
    const actual = await repo.readDocument(w.owner_key, d.hypothesis, d.id);
    assert.equal(textHash(actual.text), d.sha256, `Document digest: ${d.id}`);
    assert.equal(actual.text.length, d.length, `Document UTF-16 length: ${d.id}`);
    assert.equal(actual.elementIds.length, d.elementLinks, `Document links: ${d.id}`);
  }
  const old = await pool.query(`SELECT substring(a.source_key from '^r:([0-9]+)$')::bigint AS source_revision,h.payload
    FROM company_source_archives a
    JOIN talkhint_project_model_history h ON h.owner_key=a.source_owner_key AND h.key=a.source_key
    WHERE a.workspace_id=$1 AND substring(a.source_key from '^r:([0-9]+)$')::bigint<$2
    ORDER BY source_revision DESC LIMIT 1`, [w.workspace_id, w.current_revision]);
  assert.equal(old.rowCount, 1);
  const expected = readHypothesis(await unpackModel(pool, w.owner_key, old.rows[0].payload), "original");
  const historical = await repo.readRevision(w.owner_key, Number(old.rows[0].source_revision), "original");
  assert.equal(semanticHash(historical), semanticHash(expected));
  writeFileSync("generated-artifacts/data-platform-B/COMMITTED_READ_CHECKS.json", JSON.stringify({
    readOnly: true, environment: "development", generation: w.storage_generation,
    actualCounts: actual, countsEqualProjection: true, verifiedDocuments: docs.length,
    documentDigestsAndLengthsAndLinksEqual: true,
    archivedRevision: Number(old.rows[0].source_revision), archivedReadEqual: true,
    rootReconstructionHash: evidence.reconstructedHash, productionTouched: false,
    capturedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`PASS: committed counts, ${docs.length} exact document reads, archived revision ${old.rows[0].source_revision}`);
} finally { await pool.end(); }
