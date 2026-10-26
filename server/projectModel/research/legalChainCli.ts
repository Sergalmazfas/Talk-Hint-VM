import { dbReady, isDevDatabase, pool } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { prepareLegalChain, legalRoadmapTitle } from "./legalChain";
import { legalChain, legalActionId } from "./legalChainSpec";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw Error("Dev database only");
  await dbReady; if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner; no namespace creation");
  const saved = await persistModelUpdate(pool, rows[0].owner_key, s => prepareLegalChain(s, rows[0].owner_key), true);
  const m = readHypothesis(saved, "new-country"), rev = m.operatingModel!.revisions.at(-1)!, d = rev.data;
  const doc = m.documents.find(d => d.title === legalRoadmapTitle)!;
  console.log(JSON.stringify({ savedAndReread: true, revision: saved.revision, operatingVersion: rev.version,
    directions: d.nodes.filter(n => n.kind === "department" && n.id.startsWith("dir-")).length,
    otherPreservedDepartments: d.nodes.filter(n => n.kind === "department" && !n.id.startsWith("dir-")).length,
    roles: d.nodes.filter(n => n.kind === "role").length,
    actions: d.nodes.filter(n => n.kind === "action").length, legalActions: legalChain.length,
    legalFormalGaps: actionChainGaps(d, new Set(legalChain.map(s => legalActionId(s.key)))).length,
    documentId: doc.id, documentCharacters: doc.text.length, executorsStarted: false, legalComplianceVerified: false, formsCreated: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Update failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
