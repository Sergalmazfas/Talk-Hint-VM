import { expect, it } from "vitest";
import { SpeedRequestBudget, SpeedLimitError, speedSettlement, SPEED_MODEL_ENVELOPE } from "./speedRequestBudget";
const body = { instructions: "test", input: [], tools: [], max_output_tokens: 300 };
it("admits more than twelve completed small requests, reserving BEFORE each request", () => {
  const b = new SpeedRequestBudget();
  for (let i = 0; i < 40; i++) {
    const r = b.admit(body);
    expect(b.snapshot().totalHeldMicroUsd).toBeGreaterThan(100 * i);
    b.complete(r, { input_tokens: 10, output_tokens: 5 });
  }
  expect(b.snapshot()).toMatchObject({ admitted: 40, denied: 0, totalHeldMicroUsd: 4000 });
});
it("retains concurrent/cancelled/unknown reservations and rejects before overspending", () => {
  const b = new SpeedRequestBudget();
  let admitted = 0;
  try {
    for (;;) { const r = b.admit(body); b.unknown(r); admitted++; }
  } catch (e) { expect(e).toBeInstanceOf(SpeedLimitError); }
  const before = b.snapshot();
  expect(before.totalHeldMicroUsd).toBeLessThanOrEqual(SPEED_MODEL_ENVELOPE);
  expect(before.unknown).toBe(admitted);
  expect(() => b.admit(body)).toThrow("SPEED_SESSION_BUDGET_EXHAUSTED");
  expect(b.snapshot().admitted).toBe(admitted);
  expect(b.snapshot().totalHeldMicroUsd).toBe(before.totalHeldMicroUsd);
});
it("settles terminal usage once, and does not refund unknowns by late evidence", () => {
  const b = new SpeedRequestBudget(), a = b.admit(body), c = b.admit(body);
  b.complete(a, { input_tokens: 2, output_tokens: 1 });
  expect(b.complete(a, { input_tokens: 0, output_tokens: 0 })).toBe(false);
  b.unknown(c);
  expect(b.complete(c, { input_tokens: 0, output_tokens: 0 })).toBe(false);
  expect(b.snapshot().unknown).toBe(1);
  expect(b.snapshot().totalHeldMicroUsd).toBeGreaterThan(20);
});
it.each([NaN, -1, 20_000, "1"])("invalid provider usage %s fails closed", input_tokens => {
  const b = new SpeedRequestBudget(), row = b.admit(body);
  expect(() => b.complete(row, { input_tokens, output_tokens: 1 })).toThrow("SPEED_USAGE_UNVERIFIABLE");
  expect(speedSettlement({ requests: 1, requestBudget: b.snapshot() }, 120)).toBeNull();
});
it("includes all JSON/framing in the bound and rejects oversized input/output/premium tier locally", () => {
  for (const bad of [{ ...body, input: ["x".repeat(20001)] }, { ...body, max_output_tokens: 1601 },
    { ...body, service_tier: "priority" }]) {
    const b = new SpeedRequestBudget();
    expect(() => b.admit(bad)).toThrow(SpeedLimitError);
    expect(b.snapshot()).toMatchObject({ admitted: 0, denied: 1, totalHeldMicroUsd: 0 });
  }
});
it("settlement holds unknown/pending envelopes plus protective audio, never beyond the durable $2", () => {
  const b = new SpeedRequestBudget();
  b.unknown(b.admit(body)); b.admit(body);
  const m = { requests: 2, requestBudget: b.snapshot() };
  const debit = speedSettlement(m, 300)!;
  expect(debit).toBeGreaterThan(1_000_000); expect(debit).toBeLessThanOrEqual(2_000_000);
  expect(speedSettlement(m, 301)).toBeNull();
  expect(speedSettlement({ ...m, requests: 3 }, 120)).toBeNull();
  expect(speedSettlement({ requests: 2, requestBudget: { ...m.requestBudget, totalHeldMicroUsd: 1_000_001 } }, 120)).toBeNull();
});
