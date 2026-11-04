import { afterEach, expect, it, vi } from "vitest";
import { SecretaryConversationEngine } from "../secretary/conversationEngine";
import { speedEngine } from "./speedRuntime";
afterEach(() => vi.unstubAllEnvs());
it("refuses experimental engines outside Dev and in a deployment", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(() => speedEngine("fixture-owner", "Fictional test only", "B")).toThrow("SPEED_DEV_ONLY");
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "1");
  expect(() => speedEngine("fixture-owner", "Fictional test only", "C")).toThrow("SPEED_DEV_ONLY");
});
it("a compact lab override can never affect a telephone engine", () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(() => new SecretaryConversationEngine("fixture", "test", undefined, true, undefined, [], undefined,
    { instructions: "lab", model: "gpt-6-sol" })).toThrow("Speed experiment is Dev-only and never telephone");
});
it("B/C use their actual models, keep test-only permissions and start with zero paid requests", () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "0");
  vi.stubEnv("OPENAI_API_KEY", "unit-test-placeholder-not-a-credential");
  for (const [variant, model] of [["B", "gpt-6.1-sol"], ["C", "gpt-6-sol"]] as const) {
    const e = speedEngine("fixture", "Fictional test: no prices or commitments", variant);
    expect(e.report.model).toBe(model); expect(e.report.testOnly).toBe(true);
    expect(e.instructions.length).toBeLessThanOrEqual(5000);
    expect((e.report as any).speed.requests).toBe(0);
    expect(e.instructions).toContain("No payments");
  }
});
