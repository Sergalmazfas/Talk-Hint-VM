import { Pool } from "pg";
import { unpackModel } from "../history";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { prepareCaliforniaAcquisition } from "./californiaAcquisition";
import { caActions, caActionId, caDocumentId } from "./californiaAcquisitionSpec";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
async function main() {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== "development" || !url || !/helium|lithium/.test(new URL(url).hostname))
    throw Error("Explicit Dev database only; no production fallback");
  const pool = new Pool({ connectionString: url });
  try {
    const rows = (await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`)).rows;
    if (rows.length !== 1) throw Error("Ambiguous owner; no namespace created");
    const check = process.argv.includes("--check");
    const saved = check
      ? prepareCaliforniaAcquisition(await unpackModel(pool, rows[0].owner_key, rows[0].state), rows[0].owner_key)
      : await persistModelUpdate(pool, rows[0].owner_key, s => prepareCaliforniaAcquisition(s, rows[0].owner_key), true);
    const m = readHypothesis(saved, "new-country"), rev = m.operatingModel!.revisions.at(-1)!;
    console.log(JSON.stringify({ savedAndReread: !check, revision: saved.revision, operatingVersion: rev.version,
      documentId: caDocumentId, documentVersion: 1, actionCount: caActions.length,
      formalChainGaps: actionChainGaps(rev.data, new Set(caActions.map(s => caActionId(s.key)))).length,
      idempotent: prepareCaliforniaAcquisition(saved, rows[0].owner_key) === saved,
      realLaunches: 0, budgetApproved: false, crewStarted: false }));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Update failed"); process.exitCode = 1; });
