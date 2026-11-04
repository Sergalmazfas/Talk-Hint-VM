import { describe, expect, it, vi } from "vitest";
import { compactSpeedPrompt, speedAgentDraft, speedProfiles, speedStream, speedSummary, type SpeedTurn } from "./speedExperiment";

const context = { plan: { goal: "Ask about a repair price. No order or payment.", language: "en" },
  runtimeUtc: "2026-11-04T00:00:00Z" };
const request = { instructions: "A frozen policy", input: [{ role: "user", content: "How much?" }],
  signal: new AbortController().signal };
const collect = async (iterable: AsyncIterable<unknown>) => {
  const rows = []; for await (const row of iterable) rows.push(row); return rows;
};

describe("isolated Secretary speed experiment", () => {
  it("leaves A at the original model, reasoning and output budget; B/C differ by model only", () => {
    expect(speedProfiles.A).toEqual({ model: "gpt-6.1-sol", reasoning: "medium", maxOutput: 1600 });
    expect(speedProfiles.B).toEqual({ ...speedProfiles.C, model: "gpt-6.1-sol" });
  });
  it("places unchanged policy at the start and all plan/time data at the end", () => {
    const a = compactSpeedPrompt(context);
    const b = compactSpeedPrompt({ plan: { goal: "Another goal", language: "ru" }, runtimeUtc: "2026-11-05T00:00:00Z" });
    expect(a.prefix).toBe(b.prefix);
    expect(a.prefixHash).toBe(b.prefixHash);
    expect(a.hash).not.toBe(b.hash);
    expect(a.instructions.startsWith(a.prefix)).toBe(true);
    expect(a.prefix).not.toContain(context.runtimeUtc);
    expect(a.prefix).not.toContain(context.plan.goal);
    expect(a.chars).toBeLessThanOrEqual(9000);
    expect(a.instructions).toContain("ask briefly"); // Language behaviour is NOT this experiment.
    expect(a.instructions).toContain("Listen to the whole menu");
    expect(a.instructions).toContain("Only after acceptance or explicit refusal");
    expect(a.instructions).toContain("Never request or disclose card details");
    expect(a.instructions).toContain("No payments");
    expect(a.instructions).toContain("AI telephone secretary"); // Truthful identity.
  });
  it("refuses oversized facts rather than truncating policy or the plan", () => {
    expect(() => compactSpeedPrompt({ ...context, plan: { goal: "x".repeat(9500) } }))
      .toThrow("COMPACT_PROMPT_EXCEEDS_9000");
    expect(() => compactSpeedPrompt({ ...context, runtimeUtc: "bad" })).toThrow("INVALID_RUNTIME_CLOCK");
  });
  it("does not edit voice, language, backchannel, greeting or the caller's original snapshot", () => {
    const base = { agent_id: "production-id", version: 5, voice_id: "retell-Merritt",
      response_engine: { type: "custom-llm", llm_websocket_url: "wss://talkhint.app/production" },
      language: ["en-US", "ru-RU", "es-ES"], enable_backchannel: false,
      begin_message: "Original", responsiveness: 1, interruption_sensitivity: 0.9 };
    const before = structuredClone(base);
    const draft = speedAgentDraft(base, "B", "wss://unit.replit.dev/retell-engine-stream/{{talkhint_engine_ticket}}");
    expect(base).toEqual(before);
    for (const key of ["voice_id", "language", "enable_backchannel", "begin_message"])
      expect((draft as any)[key]).toEqual((base as any)[key]);
    expect(draft).not.toHaveProperty("agent_id");
    expect(draft).not.toHaveProperty("version");
    expect(draft).toMatchObject({ responsiveness: 1, interruption_sensitivity: 0.85,
      enable_dynamic_responsiveness: true, stt_mode: "fast" });
    expect(() => speedAgentDraft(base, "C", "wss://talkhint.app/production")).toThrow("DEV_CALLBACK_REQUIRED");
    expect(() => speedAgentDraft({ response_engine: { type: "retell-llm" } }, "B",
      "wss://unit.replit.dev/retell-engine-stream/{{talkhint_engine_ticket}}")).toThrow("CUSTOM_LLM_REQUIRED");
  });
  it("delivers the first token before waiting for response completion and records real cache usage", async () => {
    let finish!: () => void;
    const gate = new Promise<void>(r => { finish = r; });
    const create = vi.fn(async () => (async function* () {
      yield { type: "response.output_text.delta", delta: "Hello" };
      await gate;
      yield { type: "response.completed", response: { output: [], usage: {
        input_tokens: 1100, input_tokens_details: { cached_tokens: 1024 }, output_tokens: 20 } } };
    })());
    const iter = speedStream({ responses: { create } }, "B", [])(request)[Symbol.asyncIterator]();
    expect((await iter.next()).value).toEqual({ type: "text", text: "Hello" });
    finish();
    expect((await iter.next()).value).toEqual({ type: "usage", input: 1100, cachedInput: 1024, output: 20 });
    expect((await iter.next()).value).toEqual({ type: "complete", output: [], tools: [] });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-6.1-sol", reasoning: { effort: "low" }, max_output_tokens: 300,
      tools: [], stream: true, store: false, parallel_tool_calls: false,
    }), { signal: request.signal });
  });
  it("has no retry/fallback on an unavailable C model", async () => {
    const create = vi.fn().mockRejectedValue(new Error("model unavailable"));
    await expect(collect(speedStream({ responses: { create } }, "C", [])(request))).rejects.toThrow("model unavailable");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].model).toBe("gpt-6-sol");
  });
  it.each(["response.incomplete", "response.failed", "error"])("does not classify %s as a successful reply", async type => {
    const create = vi.fn(async () => (async function* () { yield { type }; })());
    await expect(collect(speedStream({ responses: { create } }, "B", [])(request))).rejects.toThrow("SPEED_RESPONSE_NOT_COMPLETE");
  });
  it("rejects a truncated stream, aborted request or oversized prompt", async () => {
    const create = vi.fn(async () => (async function* () { yield { type: "response.output_text.delta", delta: "short" }; })());
    await expect(collect(speedStream({ responses: { create } }, "B", [])(request))).rejects.toThrow("SPEED_STREAM_TRUNCATED");
    create.mockClear();
    await expect(collect(speedStream({ responses: { create } }, "B", [])({
      ...request, instructions: "x".repeat(9001),
    }))).rejects.toThrow("COMPACT_PROMPT_EXCEEDS_9000");
    const abort = new AbortController(); abort.abort();
    await expect(collect(speedStream({ responses: { create } }, "A", [])({
      ...request, signal: abort.signal,
    }))).rejects.toThrow("EXPERIMENT_ABORTED");
    expect(create).not.toHaveBeenCalled();
  });
});

const turn = (n: number): SpeedTurn => ({
  conversation: `fixture-${n}`, language: n % 2 ? "ru" : "en", variant: "B",
  firstTextMs: 400, speechEndToAudioMs: 1000, outputChars: 70, inputTokens: 1200,
  cachedTokens: 1024, outputTokens: 25, complete: true, quality: "pass", durationSeconds: 30, costUsd: 0.01,
});
describe("measurements are not fabricated from model timing", () => {
  it("requires ten real conversations, complete audio and quality review", () => {
    expect(speedSummary(Array.from({ length: 10 }, (_, i) => turn(i)), "B")).toMatchObject({
      conversations: 10, eligibleForOwnerReview: true, firstTextMedianMs: 400,
      speechEndToAudioMedianMs: 1000, costPerMinuteUsd: expect.closeTo(0.02),
    });
    expect(speedSummary([turn(0)], "B").eligibleForOwnerReview).toBe(false);
  });
  it("does not convert text-only TTFT into physical audio latency or unknown cost into zero", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...turn(i), speechEndToAudioMs: null, costUsd: null }));
    expect(speedSummary(rows, "B")).toMatchObject({ firstTextMedianMs: 400,
      speechEndToAudioMedianMs: null, costPerMinuteUsd: null, eligibleForOwnerReview: false });
  });
  it.each(["unreviewed", "fail"] as const)("does not accept %s quality", quality => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...turn(i), quality }));
    expect(speedSummary(rows, "B").eligibleForOwnerReview).toBe(false);
  });
  it("counts incomplete outcomes, not just the favourable timing subset", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...turn(i), complete: i !== 0 }));
    expect(speedSummary(rows, "B")).toMatchObject({ incomplete: 1, eligibleForOwnerReview: false });
  });
  it("refuses nonfinite/negative timings and impossible cache counts", () => {
    expect(() => speedSummary([{ ...turn(0), firstTextMs: NaN }], "B")).toThrow("INVALID_MEASUREMENT");
    expect(() => speedSummary([{ ...turn(0), firstTextMs: -1 }], "B")).toThrow("INVALID_MEASUREMENT");
    expect(() => speedSummary([{ ...turn(0), cachedTokens: 1300 }], "B")).toThrow("INVALID_MEASUREMENT");
  });
});
