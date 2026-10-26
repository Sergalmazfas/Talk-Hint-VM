import { dbReady, isDevDatabase, pool } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { prepareBenchmarkChain, benchmarkRoadmapTitle } from "./benchmarkChain";
import { benchmarkChain, chainId } from "./benchmarkChainSpec";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw Error("Dev database only");
  await dbReady;
  if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner; no namespace creation");
  const saved = await persistModelUpdate(pool, rows[0].owner_key, s => prepareBenchmarkChain(s, rows[0].owner_key), true);
  const m = readHypothesis(saved, "new-country"), rev = m.operatingModel!.revisions.at(-1)!, doc = m.documents.find(d => d.title === benchmarkRoadmapTitle)!;
  const ids = new Set(benchmarkChain.map(s => chainId(s.key)));
  console.log(JSON.stringify({ savedAndReread: true, revision: saved.revision, operatingVersion: rev.version,
    actions: rev.data.nodes.filter(n => n.kind === "action").length, focusedActions: ids.size,
    focusedFormalGaps: actionChainGaps(rev.data, ids).length, allFormalGaps: actionChainGaps(rev.data).length,
    documentId: doc.id, documentCharacters: doc.text.length,
    next: rev.data.nodes.find(n => n.id === "crew-product-roadmap")?.nextId,
    executorsStarted: false, formsDeveloped: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Update failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
