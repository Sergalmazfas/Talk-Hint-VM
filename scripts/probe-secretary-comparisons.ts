/** Opt-in real development DB check. Uses fictional rows, no paid voice calls,
 * no real calendar/notifications and removes all probe data in finally. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dbReady, pool } from "../server/db";
import { PgComparisonRepository } from "../server/secretaryLab/comparisonStore";
import type { ComparisonRun } from "../shared/secretaryLabComparison";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1")
  throw new Error("Comparison persistence probe is development-only.");
await dbReady;
if (!pool) throw new Error("Development database unavailable");
const store = new PgComparisonRepository(pool);
if (process.argv[2] === "--read") {
  try {
    const item = await store.get(process.argv[3]);
    assert.ok(item);
    assert.equal(item.runs[0].model, "fictional-probe-model");
    assert.equal(item.runs[0].voice, "fictional-probe-voice");
    assert.equal(item.evaluation.score, 4);
    assert.deepEqual((item.runs[0].engine as any).actions, [{ name: "prepare_test_booking", result: { testOnly: true, calendarWritten: false } }]);
    console.log("[comparison-probe] Independent Node process read the committed snapshot.");
  } finally { await pool.end(); }
} else {
  const owner = randomUUID();
  let createdOwner = false;
  try {
    await pool.query("INSERT INTO users (id,email) VALUES ($1,$2)", [owner, `comparison-probe-${owner}@example.invalid`]);
    createdOwner = true;
    const run: ComparisonRun = {
      mode: "retell-engine", id: randomUUID(), runtime: "fictional-probe-runtime", model: "fictional-probe-model",
      voice: "fictional-probe-voice", instruction: "Fictional probe assignment", status: "ended",
      createdAt: new Date().toISOString(), verification: "test_fixture",
      engine: { actions: [{ name: "prepare_test_booking", result: { testOnly: true, calendarWritten: false } }] },
    };
    const saved = await store.save(owner, { title: "Fictional persistence probe", instruction: run.instruction,
      evaluation: { score: 4, note: "Not a live provider test" }, runs: [run] });
    assert.ok(Math.abs(Date.parse(saved.expiresAt) - Date.parse(saved.createdAt) - 30 * 86400_000) < 1000);
    execFileSync(process.execPath, ["--import", "tsx", "scripts/probe-secretary-comparisons.ts", "--read", saved.id],
      { env: process.env, stdio: "inherit", timeout: 30_000 });
    assert.ok((await store.list()).some(item => item.id === saved.id));
    const edited = await store.evaluate(saved.id, { score: 5, note: "Updated" });
    assert.equal(edited?.expiresAt, saved.expiresAt);
    await pool.query("UPDATE secretary_lab_comparisons SET expires_at=now()-interval '1 second' WHERE id=$1", [saved.id]);
    assert.equal(await store.get(saved.id), undefined);
    assert.ok(!(await store.list()).some(item => item.id === saved.id));
    assert.equal(await store.evaluate(saved.id, { score: 1, note: "Expired" }), undefined);
    await store.purge();
    assert.equal((await pool.query("SELECT id FROM secretary_lab_comparisons WHERE id=$1", [saved.id])).rowCount, 0);
    const deletion = await store.save(owner, { title: "Fictional delete probe", instruction: run.instruction, runs: [run], evaluation: { score: null, note: "" } });
    assert.equal(await store.remove(deletion.id), true);
    assert.equal((await pool.query("SELECT id FROM secretary_lab_comparisons WHERE id=$1", [deletion.id])).rowCount, 0);
    console.log("[comparison-probe] Restart persistence, list, evaluation, expiry and physical deletion passed.");
  } finally {
    if (createdOwner) await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    await pool.end();
  }
}
