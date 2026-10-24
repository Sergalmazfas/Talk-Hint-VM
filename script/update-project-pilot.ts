import { dbReady, pool, isDevDatabase } from "../server/db";
import { isBenchmarkAdmin } from "../server/benchmark/adminGate";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyPilotUpdate, assertPilotPreservation, findPilotCompetitor } from "../server/projectModel/pilotUpdate";

async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw new Error("Explicit workspace Dev required");
  await dbReady;
  if (!pool) throw new Error("Development storage unavailable");
  const owners = (await pool.query("SELECT id,email FROM users")).rows.filter(r => isBenchmarkAdmin(r.email));
  if (owners.length !== 1) throw new Error("Exactly one existing allowlisted owner required");
  const owner = String(owners[0].id);
  const row = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  if (row.rows.length !== 1) throw new Error("Existing owner model required");
  const before = row.rows[0].state;
  const result = await persistModelUpdate(pool, owner, s => applyPilotUpdate(s, owner), true);
  assertPilotPreservation(before, result);
  console.log(JSON.stringify({ saved: true, revision: result.revision, elements: result.elements.length,
    competitors: result.elements.filter(e => e.details.benchmarkType === "competitor").map(e => ({ id: e.id, title: e.title, priority: e.details.competitorPriority })),
    pilotAssessments: result.elements.filter(e => e.details.benchmarkSuite === "pilot" && e.details.benchmarkType === "assessment").length,
    generalAssessments: result.elements.filter(e => e.details.benchmarkType === "assessment" && e.details.benchmarkSuite !== "pilot").length,
    primaryLinks: (["massagebook", "clinicsense"] as const).map(k => `/admin/project-model?view=benchmark&suite=pilot&element=${findPilotCompetitor(result, k)!.id}`),
    decisions: result.decisions.length, documents: result.documents.length, preservedPreviousIdsAndHistory: true, practicalTests: 0 }));
  await pool.end();
}
main().then(() => process.exit(0)).catch(e => {
  const safe = e instanceof Error && /^(Explicit workspace|Development storage|Exactly one|Existing owner|Existing project|Multiple existing|Lost existing|Existing decision|Existing source|Existing example|Duplicate update)/.test(e.message) ? e.message : "Transaction/readback failed; inspect Dev model storage.";
  console.error(`Pilot update stopped: ${safe}`);
  process.exit(1);
});
