import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpeedBudget } from "./speedBudget";
import { SpeedRequestBudget, speedSettlement } from "./speedRequestBudget";
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function budget() {
  const d = await mkdtemp(join(tmpdir(), "speed-budget-")); dirs.push(d);
  const path = join(d, "budget.json"); return { b: new SpeedBudget(path), path };
}
it("the explicit Dev-only $10 decision preserves every previous debit and survives restart", async () => {
  const { b, path } = await budget();
  await b.reserve("old", "C"); await b.settle("old", null);
  const before = await b.state();
  vi.stubEnv("NODE_ENV", "development");
  await b.approveTenDollarSeries(); await b.approveTenDollarSeries();
  const after = await new SpeedBudget(path).state();
  expect(after.limitMicroUsd).toBe(10_000_000);
  expect(after.runs).toEqual(before.runs); expect(after.spentMicroUsd).toBe(before.spentMicroUsd);
  expect(after.remainingMicroUsd).toBe(before.remainingMicroUsd + 5_000_000);
  vi.stubEnv("NODE_ENV", "production");
  expect(() => b.approveTenDollarSeries()).toThrow("SPEED_DEV_ONLY");
});
it("the one-time +$20 decision removes exhaustion without repricing history or changing C reserve", async () => {
  const { b, path } = await budget();
  vi.stubEnv("NODE_ENV", "development");
  await b.approveTenDollarSeries();
  await b.reserve("legacy", "A"); await b.settle("legacy", null);
  await b.reserve("unknown-c", "C"); await b.settle("unknown-c", null);
  await b.reserve("settled-c", "C"); await b.settle("settled-c", 3_000_000);
  await expect(b.reserve("blocked", "C")).rejects.toThrow("SPEED_SERIES_BUDGET_EXHAUSTED");
  const before = await b.state();
  await b.approveThirtyDollarSeries(); await b.approveThirtyDollarSeries();
  await b.approveTenDollarSeries(); // Old operator scripts cannot downgrade the new decision.
  const after = await new SpeedBudget(path).state();
  expect(after.limitMicroUsd).toBe(30_000_000);
  expect(after.remainingMicroUsd).toBe(before.remainingMicroUsd + 20_000_000);
  expect(after.runs).toEqual(before.runs);
  expect(after.spentMicroUsd).toBe(before.spentMicroUsd);
  expect(after.probeDebitMicroUsd).toBe(before.probeDebitMicroUsd);
  await b.reserve("new-c", "C");
  expect((await b.state()).runs["new-c"]).toEqual({
    variant: "C", reserved: 3_000_000, spent: 0, status: "reserved", admissionMicroUsd: 3_000_000,
  });
});
it("top-up preserves an active reservation and cannot create a parallel session", async () => {
  const { b } = await budget(); vi.stubEnv("NODE_ENV", "development");
  await b.approveTenDollarSeries(); await b.reserve("active", "C");
  const before = await b.state(); await b.approveThirtyDollarSeries();
  expect((await b.state()).runs).toEqual(before.runs);
  expect((await b.state()).reservedMicroUsd).toBe(3_000_000);
  await expect(b.reserve("parallel", "C")).rejects.toThrow("SPEED_SESSION_ACTIVE_OR_UNKNOWN");
});
it("the fixed $30 -> $40 top-up preserves unknowns, unblocks the $3 C reserve, and is idempotent after reload", async () => {
  const { b, path } = await budget();
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "");
  await b.approveTenDollarSeries(); await b.approveThirtyDollarSeries();
  for (let i = 0; i < 9; i++) { await b.reserve(`old-${i}`, "C"); await b.settle(`old-${i}`, null); }
  await expect(b.reserve("blocked", "C")).rejects.toThrow("SPEED_SERIES_BUDGET_EXHAUSTED");
  const before = await b.state();
  await b.approveFortyDollarSeries();
  await new SpeedBudget(path).approveFortyDollarSeries();
  await b.approveTenDollarSeries();
  const after = await new SpeedBudget(path).state();
  expect(after.limitMicroUsd).toBe(40_000_000);
  expect(after.remainingMicroUsd).toBe(before.remainingMicroUsd + 10_000_000);
  expect(after.spentMicroUsd).toBe(before.spentMicroUsd);
  expect(after.runs).toEqual(before.runs);
  expect(after.probeDebitMicroUsd).toBe(before.probeDebitMicroUsd);
  expect(after.runs.blocked).toBeUndefined();
  await b.reserve("owner-next", "C");
  expect((await b.state()).runs["owner-next"]).toMatchObject({ reserved: 3_000_000, spent: 0, status: "reserved" });
  await b.approveFortyDollarSeries();
  expect((await b.state()).reservedMicroUsd).toBe(3_000_000);
  await expect(b.reserve("parallel", "C")).rejects.toThrow("SPEED_SESSION_ACTIVE_OR_UNKNOWN");
});
it("$40 top-up refuses production, deployment and unexpected previous limits", async () => {
  const { b } = await budget();
  vi.stubEnv("NODE_ENV", "production");
  expect(() => b.approveFortyDollarSeries()).toThrow("SPEED_DEV_ONLY");
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "1");
  expect(() => b.approveFortyDollarSeries()).toThrow("SPEED_DEV_ONLY");
  vi.stubEnv("REPLIT_DEPLOYMENT", "");
  await expect(b.approveFortyDollarSeries()).rejects.toThrow("SPEED_TOPUP_EXPECTED_THIRTY_DOLLAR_SERIES");
  expect((await b.state()).limitMicroUsd).toBe(5_000_000);
});
it("top-up is Dev-only and fails closed on an unexpected previous ceiling", async () => {
  const { b, path } = await budget();
  vi.stubEnv("NODE_ENV", "production");
  expect(() => b.approveThirtyDollarSeries()).toThrow("SPEED_DEV_ONLY");
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "1");
  expect(() => b.approveThirtyDollarSeries()).toThrow("SPEED_DEV_ONLY");
  vi.stubEnv("REPLIT_DEPLOYMENT", "");
  await expect(b.approveThirtyDollarSeries()).rejects.toThrow("SPEED_TOPUP_EXPECTED_TEN_DOLLAR_SERIES");
  expect((await b.state()).limitMicroUsd).toBe(5_000_000);
  await writeFile(path, JSON.stringify({ limitMicroUsd: 20_000_000, probeDebitMicroUsd: 100_000, runs: {} }));
  await expect(b.approveThirtyDollarSeries()).rejects.toThrow("SPEED_BUDGET_INVALID");
});
it("persists the fixed total across restarts, counts probes and never repeats an unknown request", async () => {
  const { b, path } = await budget();
  await b.reserve("one", "A");
  expect((await new SpeedBudget(path).state()).remainingMicroUsd).toBe(2_900_000);
  await expect(b.reserve("two", "B")).rejects.toThrow("SPEED_SESSION_ACTIVE_OR_UNKNOWN");
  await b.settle("one", null);
  await expect(b.reserve("one", "A")).rejects.toThrow("SPEED_REQUEST_ALREADY_RESERVED_NO_RETRY");
  await b.reserve("two", "B"); await b.settle("two", null);
  await expect(b.reserve("three", "C")).rejects.toThrow("SPEED_SERIES_BUDGET_EXHAUSTED");
  expect((await new SpeedBudget(path).state()).spentMicroUsd).toBe(4_100_000);
});
it("settles known estimates once and leaves manual testing inside the same total budget", async () => {
  const { b } = await budget();
  for (let n = 0; n < 4; n++) {
    await b.reserve(String(n), "C");
    if (n === 0) await expect(b.settle(String(n), 3_000_001)).rejects.toThrow("SPEED_ACCOUNTING_OUT_OF_BOUNDS");
    await b.settle(String(n), 1000);
    await b.settle(String(n), 1000);
  }
  await b.reserve("owner-manual", "C"); await b.settle("owner-manual", 1000);
  expect((await b.state()).spentMicroUsd).toBe(105_000);
});
it("corrupt or untyped expenditure cannot turn the limit into NaN", async () => {
  const { b, path } = await budget();
  await writeFile(path, JSON.stringify({ limitMicroUsd: 5_000_000, probeDebitMicroUsd: 100_000,
    runs: { bad: { variant: "A", status: "settled", spent: "missing", reserved: 0 } } }));
  await expect(b.state()).rejects.toThrow("SPEED_BUDGET_INVALID");
  await expect(b.reserve("new", "B")).rejects.toThrow("SPEED_BUDGET_INVALID");
});
it("concurrent admissions cannot both reserve money", async () => {
  const { b } = await budget();
  const results = await Promise.allSettled([b.reserve("one", "A"), b.reserve("two", "B")]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((await b.state()).reservedMicroUsd).toBe(2_000_000);
});
it("C reserves $3, preserves legacy $2 unknowns, and never raises the series limit", async () => {
  const { b, path } = await budget();
  await b.reserve("new-c", "C");
  expect((await b.state()).reservedMicroUsd).toBe(3_000_000);
  await b.settle("new-c", null);
  const reloaded = await new SpeedBudget(path).state();
  expect(reloaded.runs["new-c"].spent).toBe(3_000_000);
  expect(reloaded.limitMicroUsd).toBe(5_000_000);
  await expect(b.reserve("too-much", "C")).rejects.toThrow("SPEED_SERIES_BUDGET_EXHAUSTED");
});
it("new per-request settlement preserves old unknowns and cannot reset or replenish the series", async () => {
  const { b, path } = await budget();
  await b.reserve("legacy", "A"); await b.settle("legacy", null);
  const old = JSON.stringify((await b.state()).runs.legacy);
  await expect(b.reserve("bounded-new", "C")).rejects.toThrow("SPEED_SERIES_BUDGET_EXHAUSTED");
  await b.reserve("bounded-new", "B");
  const ledger = new SpeedRequestBudget();
  for (let i = 0; i < 20; i++)
    ledger.complete(ledger.admit({ instructions: "fixture", max_output_tokens: 300 }), { input_tokens: 10, output_tokens: 10 });
  ledger.unknown(ledger.admit({ instructions: "fixture", max_output_tokens: 300 }));
  const debit = speedSettlement({ requests: 21, requestBudget: ledger.snapshot() }, 120)!;
  await b.settle("bounded-new", debit);
  const state = await new SpeedBudget(path).state();
  expect(JSON.stringify(state.runs.legacy)).toBe(old);
  expect(state.spentMicroUsd).toBe(2_100_000 + debit);
  expect(state.runs["bounded-new"].status).toBe("settled");
  await b.settle("legacy", 0);
  expect((await b.state()).spentMicroUsd).toBe(state.spentMicroUsd);
});
