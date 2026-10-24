import { dbReady, pool, isDevDatabase } from "../server/db";
import { isBenchmarkAdmin } from "../server/benchmark/adminGate";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyProjectPackage, assertPackagePreservation } from "../server/projectModel/packageUpdate";
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw new Error("Explicit workspace Dev required");
  await dbReady;
  if (!pool) throw new Error("Development storage unavailable");
  const owners = (await pool.query("SELECT id,email FROM users")).rows.filter(r => isBenchmarkAdmin(r.email));
  if (owners.length !== 1) throw new Error("Exactly one existing allowlisted owner required");
  const owner = String(owners[0].id);
  const saved = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  if (saved.rows.length !== 1) throw new Error("Existing owner model required");
  const before = saved.rows[0].state;
  const after = await persistModelUpdate(pool, owner, s => applyProjectPackage(s, owner), true);
  assertPackagePreservation(before, after);
  console.log(JSON.stringify({ saved: true, revision: after.revision, elements: after.elements.length,
    competitors: after.elements.filter(e => e.details.benchmarkType === "competitor").length,
    assessments: after.elements.filter(e => e.details.benchmarkType === "assessment").length,
    differenceAssessments: after.elements.filter(e => e.details.benchmarkType === "assessment" && e.details.benchmarkSuite === "difference").length,
    priceEvidence: after.elements.filter(e => e.details.benchmarkType === "pricing-evidence").length,
    documents: after.documents.length, decisions: after.decisions.length, preservedPreviousIdsAndHistory: true,
    externalActions: 0, practicalCompetitorTests: 0 }));
  await pool.end();
}
main().then(() => process.exit(0)).catch(e => {
  const safe = e instanceof Error && /^(Explicit workspace|Development storage|Exactly one|Existing owner|Existing pilot|Existing |Prior |Old example)/.test(e.message) ? e.message : "Transaction/readback failed; inspect Dev model storage.";
  console.error(`Package update stopped: ${safe}`); process.exit(1);
});
