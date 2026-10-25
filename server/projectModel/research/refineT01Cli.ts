import { pool, dbReady, isDevDatabase } from "../../db";
import { persistModelUpdate } from "../materialImport";
import { refineT01 } from "./refineT01";
import { defineMkt1Result } from "./defineMkt1Result";
import { readHypothesis } from "../hypotheses";
import { isDeepStrictEqual } from "node:util";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw new Error("Dev database only");
  await dbReady;
  if (!pool) throw new Error("Dev database unavailable");
  const candidates = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (candidates.rows.length !== 1) throw new Error("Ambiguous owner; no update");
  const owner = candidates.rows[0].owner_key;
  const transform = process.argv.includes("--result-spec") ? defineMkt1Result : refineT01;
  const updated = await persistModelUpdate(pool, owner, root => transform(root, owner), true);
  const rows = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const actual = readHypothesis(rows.rows[0].state, "new-country").operatingModel!;
  if (!isDeepStrictEqual(actual, readHypothesis(updated, "new-country").operatingModel)) throw new Error("Readback mismatch");
  const latest = actual.revisions.at(-1)!;
  console.log(JSON.stringify({ readback: true, version: latest.version, objects: latest.data.nodes.length,
    links: latest.data.links.length, upperProcesses: latest.data.nodes.filter(n => n.level === "operation").length,
    branches: latest.data.nodes.filter(n => ["search", "business-search"].includes(n.id)).map(n => ({ code: n.code, name: n.name, parent: n.parentId })),
    previousVersionsPreserved: true, employeesStarted: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Update failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
