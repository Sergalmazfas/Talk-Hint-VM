import { dbReady, isDevDatabase, pool } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { prepareActionRegister, registerRoadmapTitle } from "./actionRegister";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw Error("Dev only");
  await dbReady;
  if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner; do not create namespace");
  const saved = await persistModelUpdate(pool, rows[0].owner_key, s => prepareActionRegister(s, rows[0].owner_key, new Date().toISOString().slice(0, 10)), true);
  const model = readHypothesis(saved, "new-country"), rev = model.operatingModel!.revisions.at(-1)!;
  console.log(JSON.stringify({ savedAndRead: true, revision: saved.revision, operatingVersion: rev.version,
    actions: rev.data.nodes.filter(n => n.kind === "action").length, newDrafts: rev.data.nodes.filter(n => n.id.startsWith("company-action-") && n.kind === "action").length,
    documentId: model.documents.find(d => d.title === registerRoadmapTitle)?.id,
    documentCharacters: model.documents.find(d => d.title === registerRoadmapTitle)?.text.length,
    next: rev.data.nodes.find(n => n.id === "crew-product-roadmap")?.nextId, startedExecutors: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Update failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
