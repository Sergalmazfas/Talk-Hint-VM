import { dbReady, isDevDatabase, pool } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { prepareLandingGearCase } from "./landingGearCase";
import { landingGearCaseId, landingGearDocumentTitle, landingGearCaseDocument } from "./landingGearCaseContent";
import { readHypothesis } from "../hypotheses";
import { isDeepStrictEqual } from "node:util";

async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw new Error("Dev database only");
  await dbReady;
  if (!pool) throw new Error("Database unavailable");
  const owners = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) a WHERE a->>'id'='new-country')`);
  if (owners.rows.length !== 1) throw new Error("Ambiguous owner; no update");
  const owner = owners.rows[0].owner_key;
  const updated = await persistModelUpdate(pool, owner, s => prepareLandingGearCase(s, owner), true);
  const saved = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const actual = readHypothesis(saved.rows[0].state, "new-country");
  if (!isDeepStrictEqual(actual, readHypothesis(updated, "new-country"))) throw new Error("Readback mismatch");
  const latest = actual.operatingModel!.revisions.at(-1)!;
  const doc = actual.documents.find(d => d.title === landingGearDocumentTitle)!;
  if (doc.text !== landingGearCaseDocument || !latest.data.nodes.find(n => n.id === landingGearCaseId)?.referenceIds.includes(doc.id))
    throw new Error("Case/document link mismatch");
  console.log(JSON.stringify({ readback: true, caseId: landingGearCaseId, documentId: doc.id,
    modelVersion: latest.version, revision: actual.revision, nodes: latest.data.nodes.length, links: latest.data.links.length,
    documentCharacters: doc.text.length, crewStarted: false, externalActions: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Import failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
