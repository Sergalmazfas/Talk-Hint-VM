import { dbReady, isDevDatabase, pool } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { prepareStructureFirst } from "./structureFirst";
import { structureFirstTitle, descriptionMissing } from "./structureFirstContent";

async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw Error("Dev database only");
  await dbReady;
  if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner; no changes");
  const saved = await persistModelUpdate(pool, rows[0].owner_key, s => prepareStructureFirst(s, rows[0].owner_key), true);
  const m = readHypothesis(saved, "new-country"), rev = m.operatingModel!.revisions.at(-1)!;
  const doc = m.documents.find(d => d.title === structureFirstTitle)!;
  const card = rev.data.nodes.find(n => n.id === "criteria")!;
  console.log(JSON.stringify({ savedAndReread: true, rootRevision: saved.revision, operatingVersion: rev.version,
    documentId: doc.id, documentCharacters: doc.text.length, cardId: card.id, status: card.status,
    descriptionMissing: descriptionMissing(card), nodes: rev.data.nodes.length,
    approved: false, executorStarted: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Update failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
