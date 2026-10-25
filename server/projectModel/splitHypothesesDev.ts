import assert from "node:assert/strict";
import { dbReady, isDevDatabase, pool } from "../db";
import { splitProductHypotheses } from "./hypotheses";
import { archiveModel, ensureModelHistory, unpackModel } from "./history";

async function main() {
  assert.equal(process.env.NODE_ENV, "development", "Explicit Dev environment required");
  assert.ok(isDevDatabase, "Only the existing internal Dev database is allowed");
  const owner = process.argv[2];
  assert.ok(owner && /^[a-zA-Z0-9_-]+$/.test(owner), "Explicit owner ID required");
  await dbReady;
  assert.ok(pool, "Database unavailable");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT state,revision FROM talkhint_project_models WHERE owner_key=$1 FOR UPDATE", [owner]);
    assert.equal(result.rowCount, 1, "Existing workspace required; no model invented");
    const before = await unpackModel(client, owner, result.rows[0].state);
    const next = splitProductHypotheses(before, owner);
    // Content outside the restored product and explicit hypothesis/audit data is immutable.
    assert.deepEqual(next.elements.filter(e => e.id !== "TH-PRODUCT"), before.elements.filter(e => e.id !== "TH-PRODUCT"));
    for (const key of ["documents", "relations", "proposals", "taskDrafts"] as const)
      assert.deepEqual(next[key], before[key]);
    if (next !== before) {
      await ensureModelHistory(client);
      await archiveModel(client, owner, before);
      const stored = await archiveModel(client, owner, next);
      const saved = await client.query("UPDATE talkhint_project_models SET state=$2::jsonb,revision=$3,updated_at=now() WHERE owner_key=$1 AND revision=$4",
        [owner, JSON.stringify(stored), next.revision, before.revision]);
      assert.equal(saved.rowCount, 1);
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ revision: next.revision, originalElements: next.elements.length,
      documents: next.documents.length, alternatives: next.alternatives?.map(a => ({ id: a.id,
        blocks: a.model.elements.length, filled: a.model.elements.filter(e => e.description.trim()).length })),
      primary: next.primaryHypothesisId, otherMaterialsUnchanged: true, idempotent: next === before }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
main().catch(() => { console.error("Hypothesis correction stopped; transaction rolled back. No production or external actions."); process.exitCode = 1; })
  .finally(async () => { await pool?.end(); });
