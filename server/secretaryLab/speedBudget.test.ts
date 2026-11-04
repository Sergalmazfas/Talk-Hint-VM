import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpeedBudget } from "./speedBudget";
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function budget() {
  const d = await mkdtemp(join(tmpdir(), "speed-budget-")); dirs.push(d);
  const path = join(d, "budget.json"); return { b: new SpeedBudget(path), path };
}
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
    if (n === 0) await expect(b.settle(String(n), 2_000_001)).rejects.toThrow("SPEED_ACCOUNTING_OUT_OF_BOUNDS");
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
