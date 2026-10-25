import { dbReady, isDevDatabase, pool } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { prepareCrewSetup, crewSetupTitle, crewPositions } from "./crewSetup";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw new Error("Dev only");
  await dbReady; if (!pool) throw new Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw new Error("Ambiguous owner");
  const owner = rows[0].owner_key;
  await persistModelUpdate(pool, owner, s => prepareCrewSetup(s, owner), true);
  const saved = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const model = readHypothesis(saved.rows[0].state, "new-country");
  const doc = model.documents.find(d => d.title === crewSetupTitle);
  if (!doc || !crewPositions.every(p => model.operatingModel!.revisions.at(-1)!.data.nodes.some(n => n.id === `resource-profile-${p.id}`))) throw new Error("Readback mismatch");
  console.log(JSON.stringify({ readback: true, modelVersion: model.operatingModel!.revisions.at(-1)!.version,
    describedPositions: crewPositions.length, documentCharacters: doc.text.length, pluginConnected: false, crewRunning: false, resourcesChanged: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Import failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
