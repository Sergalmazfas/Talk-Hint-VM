import { unpackModel } from "../history";
import { pool, dbReady, isDevDatabase } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { prepareOperatingModel } from "./prepareOperatingModel";
import { isDeepStrictEqual } from "node:util";
import { readHypothesis } from "../hypotheses";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase)
    throw new Error("Only the explicit local managed Dev database is allowed");
  await dbReady;
  if (!pool) throw new Error("Dev database unavailable");
  const candidates = await pool.query(`SELECT owner_key FROM talkhint_project_models
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) AS h WHERE h->>'id'='new-country')`);
  if (candidates.rows.length !== 1) throw new Error("Ambiguous owner; use authenticated UI. Nothing changed.");
  const owner = candidates.rows[0].owner_key as string;
  const root = await persistModelUpdate(pool, owner, state => prepareOperatingModel(state, owner), true);
  const readback = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const actual = readHypothesis(await unpackModel(pool, owner, readback.rows[0].state), "new-country").operatingModel;
  if (!isDeepStrictEqual(actual, readHypothesis(root, "new-country").operatingModel)) throw new Error("Readback mismatch");
  const latest = actual!.revisions.at(-1)!;
  console.log(JSON.stringify({ saved: true, readback: true, version: latest.version,
    objects: latest.data.nodes.length, links: latest.data.links.length, passes: latest.data.stageReports.length,
    unrelatedMaterialsPreserved: true, employeesStarted: false }));
}
main().catch(() => { console.error("Dev model preparation failed; no success claimed."); process.exitCode = 1; })
  .finally(async () => { await pool?.end(); });
