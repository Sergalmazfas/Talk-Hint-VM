import { afterEach, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: network.create }; } }));
import { SecretaryConversationEngine } from "../secretary/conversationEngine";
import { speedEngine } from "./speedRuntime";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("refuses experimental engines outside Dev and in a deployment", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(() => speedEngine("fixture-owner", "Fictional test only", "B")).toThrow("SPEED_DEV_ONLY");
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "1");
  expect(() => speedEngine("fixture-owner", "Fictional test only", "C")).toThrow("SPEED_DEV_ONLY");
});
function setup() {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "0");
  vi.stubEnv("OPENAI_API_KEY", "unit-test-placeholder-not-a-credential");
  return speedEngine("fixture", "Fictional test: clarify the goal only", "C");
}
function response(broken = false) {
  return { withResponse: async () => ({
    response: new Response(null, { status: 200, headers: { "x-request-id": "fixture-request-id" } }),
    data: (async function* () {
      if (broken) throw Error("fixture stream interrupted");
      yield { type: "response.output_text.delta", delta: "Hello" };
      yield { type: "response.completed", response: { output: [], usage: { input_tokens: 100, output_tokens: 10 } } };
    })(),
  }) };
}
it("reproduces a long multi-turn call: the thirteenth provider request succeeds without paid traffic", async () => {
  network.create.mockImplementation(() => response());
  const e = setup();
  for (let i = 0; i < 20; i++)
    await e.respond([{ role: "user", content: "Continue the test" }], new AbortController().signal, () => {});
  expect(network.create).toHaveBeenCalledTimes(20);
  expect(network.create.mock.calls.every(([body]) => body.service_tier === "default")).toBe(true);
  expect((e.report as any).speed).toMatchObject({ requests: 20, usageRequests: 20, limitReason: null,
    requestBudget: { admitted: 20, totalHeldMicroUsd: 12_000 } });
});
it("stream cancellation keeps its envelope; local money refusals never call OpenAI or count as requests", async () => {
  network.create.mockImplementation(() => response(true));
  const e = setup();
  let denied = false;
  for (let i = 0; i < 100; i++) {
    try { await e.respond([{ role: "user", content: "Pause and resume" }], new AbortController().signal, () => {}); }
    catch (error: any) { if (error.code === "SPEED_SESSION_BUDGET_EXHAUSTED") { denied = true; break; } }
  }
  const m = (e.report as any).speed;
  expect(denied).toBe(true);
  expect(m.requests).toBe(network.create.mock.calls.length);
  expect(m.usageRequests).toBe(0);
  expect(m.requestBudget).toMatchObject({ unknown: m.requests, denied: 1 });
  expect(m.limitReason.code).toBe("SPEED_SESSION_BUDGET_EXHAUSTED");
  expect(m.requestBudget.totalHeldMicroUsd).toBeLessThanOrEqual(2_000_000);
  expect(m.requestLog.every((r: any) => r.httpStatus === 200 && r.requestId === "fixture-request-id")).toBe(true);
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
    expect(e.instructions.length).toBeLessThanOrEqual(9000);
    expect((e.report as any).speed.requests).toBe(0);
    expect(e.instructions).toContain("No payments");
  }
});
