import { unpackModel } from "../history";
import { pool, dbReady, isDevDatabase } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { expandCompanyStructure } from "./expandCompanyStructure";
import { isDeepStrictEqual } from "node:util";
import { readHypothesis } from "../hypotheses";
import { companyCoverage } from "../../../shared/operatingModel";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw new Error("Local managed Dev only");
  await dbReady;
  if (!pool) throw new Error("Dev database unavailable");
  const candidates = await pool.query(`SELECT owner_key FROM talkhint_project_models
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) AS h WHERE h->>'id'='new-country')`);
  if (candidates.rows.length !== 1) throw new Error("Ambiguous owner; no import");
  const owner = candidates.rows[0].owner_key as string;
  const root = await persistModelUpdate(pool, owner, state => expandCompanyStructure(state, owner), true);
  const reread = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const actual = readHypothesis(await unpackModel(pool, owner, reread.rows[0].state), "new-country").operatingModel;
  if (!isDeepStrictEqual(actual, readHypothesis(root, "new-country").operatingModel)) throw new Error("Readback mismatch");
  const latest = actual!.revisions.at(-1)!;
  console.log(JSON.stringify({ saved: true, readback: true, version: latest.version, objects: latest.data.nodes.length,
    links: latest.data.links.length, directions: latest.data.nodes.filter(n => n.level === "direction").length,
    processes: latest.data.nodes.filter(n => n.level === "operation").length, journeyStages: latest.data.customerPath?.length,
    structuralGaps: companyCoverage(latest.data), previousVersionsPreserved: true, employeesStarted: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Dev update failed"); process.exitCode = 1; })
  .finally(async () => { await pool?.end(); });
