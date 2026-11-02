import { describe, expect, it } from "vitest";
import { comparison, percentile } from "./report";
import { LIMIT_MICRO_USD, SERIES } from "./contracts";

const state = { series: SERIES, limitMicro: LIMIT_MICRO_USD, entries: [] };
describe("honest preparation and matched comparison reporting", () => {
  it("keeps all unmeasured cells null, rather than inventing zero latency/quality/cost", () => {
    const result = comparison([], ["a", "b"], "corpus", "panel", state);
    expect(result.pairedComplete).toBe(false);
    for (const row of result.rows) {
      expect(row.status).toBe("NOT_RUN_PREPARATION_ONLY");
      expect(row.p50FirstWordMs).toBeNull(); expect(row.quality).toBeNull();
      expect(row.eligibleTurnCoverage).toBeNull(); expect(row.heldCostMicroUsd).toBeNull();
    }
    expect(result.heldMicroUsd).toBe(0);
  });
  it("computes p50/p95 only from physical nonnegative timings", () => {
    expect(percentile([500, 100, 300, 200], .5)).toBe(200);
    expect(percentile([500, 100, 300, 200], .95)).toBe(500);
    expect(percentile([], .95)).toBeNull();
    expect(() => percentile([-1], .5)).toThrow("INVALID_LATENCY");
  });
  it("does not accept a different panel/corpus as a comparable run", () => {
    expect(() => comparison([{
      provider: "openai", fixtureId: "a", corpusHash: "other", panelHash: "panel",
    } as any], ["a"], "corpus", "panel", state)).toThrow("UNMATCHED_COMPARISON_INPUTS");
  });
});
