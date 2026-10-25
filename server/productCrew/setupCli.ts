import { dbReady, pool, isDevDatabase } from "../db";
import { persistModelUpdate } from "../projectModel/materialImport";
import { readHypothesis } from "../projectModel/hypotheses";
import { prepareProductCrewConnection, productCrewGuideTitle } from "./setup";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase || !process.env.REPLIT_DEV_DOMAIN) throw Error("Dev only");
  await dbReady; if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner");
  const owner = rows[0].owner_key;
  await persistModelUpdate(pool, owner, s => prepareProductCrewConnection(s, owner, `https://${process.env.REPLIT_DEV_DOMAIN}`), true);
  const saved = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const model = readHypothesis(saved.rows[0].state, "new-country"), data = model.operatingModel!.revisions.at(-1)!;
  if (!model.documents.some(d => d.title === productCrewGuideTitle) || data.data.nodes.find(n => n.id === "head-engineering")?.executorId !== "replit-current-dev-session") throw Error("Readback mismatch");
  console.log(JSON.stringify({ savedAndReread: true, operatingVersion: data.version, chiefEngineer: "head-engineering", executor: "current Replit session only", pluginInstalledInChatGPT: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Import failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
