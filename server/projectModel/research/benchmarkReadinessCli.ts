import { dbReady, isDevDatabase, pool } from "../../db";
import { unpackModel } from "../history";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { benchmarkReadinessSpecs, benchmarkReadinessTitle, prepareBenchmarkReadiness } from "./benchmarkReadiness";

async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw Error("Dev database only");
  await dbReady;
  if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner; no namespace creation");
  const checkOnly = process.argv.includes("--check");
  const saved = checkOnly
    ? prepareBenchmarkReadiness(await unpackModel(pool, rows[0].owner_key, rows[0].state), rows[0].owner_key)
    : await persistModelUpdate(pool, rows[0].owner_key, s => prepareBenchmarkReadiness(s, rows[0].owner_key), true);
  const m = readHypothesis(saved, "new-country"), rev = m.operatingModel!.revisions.at(-1)!;
  const doc = m.documents.find(d => d.title === benchmarkReadinessTitle)!;
  console.log(JSON.stringify({
    savedAndReread: !checkOnly, checkOnly, revision: saved.revision, operatingVersion: rev.version,
    preparationActions: benchmarkReadinessSpecs.length,
    actions: rev.data.nodes.filter(n => n.kind === "action").length,
    roles: rev.data.nodes.filter(n => n.kind === "role").length,
    scopedGaps: actionChainGaps(rev.data, new Set(benchmarkReadinessSpecs.map(s => s.id))),
    formalGapsAll: actionChainGaps(rev.data).length,
    documentId: doc.id, documentCharacters: doc.text.length,
    idempotent: prepareBenchmarkReadiness(saved, rows[0].owner_key) === saved,
    integrationsConnected: false, workerStarted: false, scheduleEnabled: false, pilotRun: false,
  }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Update failed"); process.exitCode = 1; })
  .finally(async () => { await pool?.end(); });
