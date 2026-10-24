import { dbReady, pool, isDevDatabase } from "../server/db";
import { isBenchmarkAdmin } from "../server/benchmark/adminGate";
import { persistApprovedMaterial } from "../server/projectModel/materialImport";
import { randomUUID } from "node:crypto";

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("Explicit Dev environment required");
  if (!isDevDatabase) throw new Error("Workspace development database required");
  await dbReady;
  if (!pool) throw new Error("Development database unavailable");
  // No identity from names or a newly created account: same verified admin allowlist as API.
  const candidates = await pool.query("SELECT id,email FROM users");
  const owners = candidates.rows.filter(row => isBenchmarkAdmin(row.email));
  if (owners.length !== 1) throw new Error("Exactly one existing allowlisted owner required; no data written.");
  const state = await persistApprovedMaterial(pool, String(owners[0].id));
  if (process.argv.includes("--verify-storage")) {
    const temporaryOwner = `project-benchmark-smoke-${randomUUID()}`;
    try {
      const first = await persistApprovedMaterial(pool, temporaryOwner);
      const second = await persistApprovedMaterial(pool, temporaryOwner);
      if (first.revision !== second.revision || first.decisions.length !== second.decisions.length)
        throw new Error("Repeat changed persistent revision/history");
      const isolated = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [temporaryOwner]);
      if (isolated.rows[0].state.revision !== first.revision) throw new Error("Independent readback failed");
      console.log("Independent Dev storage smoke passed: JSON readback, repeat idempotency, isolated temporary namespace.");
    } finally { await pool.query("DELETE FROM talkhint_project_models WHERE owner_key=$1", [temporaryOwner]); }
  }
  console.log(JSON.stringify({ saved: true, revision: state.revision, elements: state.elements.length,
    relations: state.relations.length, documents: state.documents.length, proposals: state.proposals.length,
    decisions: state.decisions.length, taskDrafts: state.taskDrafts.length,
    competitors: state.elements.filter(e => e.details.benchmarkType === "competitor").map(e => e.id),
    assessments: state.elements.filter(e => e.details.benchmarkType === "assessment").length,
    practicalTests: 0, sourceReadback: true }));
  await pool.end();
}
main().then(() => process.exit(0)).catch(() => {
  console.error("Dev material import failed; owner binding/storage must be checked. No raw data or credentials logged.");
  process.exit(1);
});
