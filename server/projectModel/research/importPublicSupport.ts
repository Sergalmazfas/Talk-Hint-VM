import { unpackModel } from "../history";
/**
 * Explicit one-off command, never imported by the application:
 * NODE_ENV=development npx tsx server/projectModel/research/importPublicSupport.ts --verify --owner EXISTING_OWNER
 * Replace --verify with --apply only to import the approved public-source data.
 */
import { isDeepStrictEqual } from "node:util";
import { persistPublicSupport, publicSupportResearch } from "./publicSupport";
import { readHypothesis } from "../hypotheses";

async function main() {
  const args = process.argv.slice(2);
  if (process.env.NODE_ENV !== "development" || args.length !== 3 ||
    !["--verify", "--apply"].includes(args[0]) || args[1] !== "--owner" || !/^[a-zA-Z0-9_-]{1,100}$/.test(args[2]))
    throw new Error("Dev-only: specify --verify|--apply --owner EXISTING_OWNER");
  const d = await import("../../db");
  await d.dbReady;
  const pool = d.pool;
  if (!pool || !d.isDevDatabase) {
    await pool?.end();
    throw new Error("Dev database required; no import performed");
  }
  try {
    const owner = args[2];
    const importResult = args[0] === "--apply" ? await persistPublicSupport(pool, owner) : null;
    const row = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
    if (row.rows.length !== 1) throw new Error("Existing owner model required");
    const root = await unpackModel(pool, owner, row.rows[0].state), model = readHypothesis(root, "new-country");
    const records = model.competitorDirectory?.records ?? [];
    const verified = Object.entries(publicSupportResearch).map(([appId, expected]) => {
      const matches = records.filter(r => r.revisions.at(-1)?.snapshot.appStore.match(/\/id(\d+)/)?.[1] === appId);
      if (matches.length !== 1) throw new Error("Exactly one existing card per approved app required");
      const record = matches[0], latest = record.revisions.at(-1)!;
      if (!isDeepStrictEqual(latest.snapshot.supportResearch, expected)) throw new Error(`Saved support profile mismatch: ${appId}`);
      return {
        name: latest.snapshot.name, version: latest.version, supportFields: Object.keys(expected).length,
        sourceDates: Array.from(new Set(Object.values(expected).map(f => f!.checkedAt))),
        personalChecks: Object.values(latest.snapshot.assessments ?? {}).flat().length,
        readbackMatches: true,
      };
    });
    // Summaries only: never emit the owner's full model, identity or connection string.
    console.log(JSON.stringify({ importResult, revision: root.revision, verifiedProfiles: verified }, null, 2));
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Dev support import/verification failed; no secret details logged. Check arguments, existing model and saved profiles."); process.exitCode = 1; });
