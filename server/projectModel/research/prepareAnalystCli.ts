import { unpackModel } from "../history";
/** Explicit Dev-only one-time preparation. No calls, external APIs, scheduling or production bootstrap. */
import { pool, dbReady, isDevDatabase } from "../../db";
import { persistAnalystPackage } from "./prepareAnalyst";
import { isDeepStrictEqual } from "node:util";

async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase)
    throw new Error("Requires explicit development environment and the local managed Dev database");
  await dbReady;
  if (!pool) throw new Error("Dev database unavailable");
  const candidates = await pool.query(`SELECT owner_key FROM talkhint_project_models
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) AS h WHERE h->>'id'='new-country')`);
  if (candidates.rows.length !== 1)
    throw new Error("Owner is not unambiguous; nothing saved. Use the authenticated interface instead.");
  const owner: string = candidates.rows[0].owner_key;
  const saved = await persistAnalystPackage(pool, owner);
  const row = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const actual = (await unpackModel(pool, owner, row.rows[0].state)).alternatives?.find(x => x.id === "new-country")?.model?.analystPreparation;
  if (!isDeepStrictEqual(actual, saved.analystPreparation)) throw new Error("Readback mismatch");
  const latest = actual!.revisions.at(-1)!;
  console.log(JSON.stringify({ saved: true, readback: true, version: latest.version, status: latest.status,
    competitors: latest.basisVersions.length, sources: latest.data.sources.length,
    pilotSourceCount: latest.data.pilot.sourceIds.length, liveRunStarted: false, otherMaterialsPreserved: true }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Preparation failed"); process.exitCode = 1; })
  .finally(async () => { if (pool) await pool.end(); });
