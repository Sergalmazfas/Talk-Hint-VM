import { dbReady, isDevDatabase, pool } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { prepareBenchmarkForms, formsRoadmapTitle, candidatesFormId, decisionFormId } from "./benchmarkForms";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { benchmarkChain, chainId } from "./benchmarkChainSpec";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw Error("Dev database only");
  await dbReady; if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner; no namespace creation");
  const saved = await persistModelUpdate(pool, rows[0].owner_key, s => prepareBenchmarkForms(s, rows[0].owner_key), true);
  const m = readHypothesis(saved, "new-country"), rev = m.operatingModel!.revisions.at(-1)!;
  console.log(JSON.stringify({ savedAndReread: true, revision: saved.revision, operatingVersion: rev.version,
    roles: rev.data.nodes.filter(n => n.kind === "role").length,
    actions: rev.data.nodes.filter(n => n.kind === "action").length,
    reporting: rev.data.nodes.filter(n => n.reporting).length,
    focusedGaps: actionChainGaps(rev.data, new Set(benchmarkChain.map(s => chainId(s.key)))).length,
    forms: m.documents.filter(d => [candidatesFormId, decisionFormId].includes(d.id)).map(d => ({ id: d.id, title: d.title })),
    roadmap: m.documents.find(d => d.title === formsRoadmapTitle)?.id, executorsStarted: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Update failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
