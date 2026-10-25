import { unpackModel } from "../history";
import { dbReady, isDevDatabase, pool } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { prepareCrewRoadmap } from "./crewRoadmap";
import { crewIntakeFindings, crewRoadmapId, crewRoadmapTitle } from "./crewRoadmapContent";
import { readHypothesis } from "../hypotheses";
import { isDeepStrictEqual } from "node:util";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw new Error("Dev database only");
  await dbReady; if (!pool) throw new Error("Database unavailable");
  const r = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (r.rows.length !== 1) throw new Error("Ambiguous owner; no update");
  const owner = r.rows[0].owner_key;
  const expected = await persistModelUpdate(pool, owner, s => prepareCrewRoadmap(s, owner), true);
  const saved = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const actual = readHypothesis(await unpackModel(pool, owner, saved.rows[0].state), "new-country");
  if (!isDeepStrictEqual(actual, readHypothesis(expected, "new-country"))) throw new Error("Readback mismatch");
  const latest = actual.operatingModel!.revisions.at(-1)!;
  console.log(JSON.stringify({ readback: true, version: latest.version, roadmap: crewRoadmapId,
    nodes: latest.data.nodes.length, links: latest.data.links.length,
    findings: crewIntakeFindings.filter(f => actual.elements.some(e => e.id === f.id)).length,
    documentCharacters: actual.documents.find(d => d.title === crewRoadmapTitle)!.text.length,
    actualCrewStarted: false, mode: "manual_preparation", originalCasePreserved: true }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Import failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
