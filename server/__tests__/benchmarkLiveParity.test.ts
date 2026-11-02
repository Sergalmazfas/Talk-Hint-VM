import { describe, it, expect, vi } from "vitest";
import { buildLiveSystemPrompt, buildLiveUserPrompt } from "../../shared/prompts";
import { buildOpenAIChatBody } from "../hintProvider";
import { withActionResults } from "../hintActionResults";
import { buildLiveBenchmarkRequest, parseLiveBenchmarkReply, inspectTimedCorpus,
  benchmarkValidity, measuredStages, hashText } from "../benchmark/liveParity";
import { chatOnce } from "../benchmark/openaiClient";
import { runBrainBenchmark } from "../benchmark/brainHarness";
import { REALTIME_ACCEL, scoreTurn } from "../benchmark/earsHarness";

const context = { goal: "Ask about opening hours", language: "ru",
  conversationContext: "Owner: Hello\nGuest: How can I help?",
  contextSections: "USER_CONTEXT:\nOnly known facts", strategyMemory: "RECENT STRATEGY MEMORY:\nNo cycles",
  translateEnabled: true, actionResultsEnabled: true };
const fixture = (id = "test") => ({ id, goal: "Ask hours", audioBase64: "internal-test-only",
  referenceTurns: [
    { idx: 0, role: "owner", text: "Hello", tStartMs: 0, tEndMs: 800 },
    { idx: 1, role: "guest", text: "How can I help?", tStartMs: 1000, tEndMs: 1800 },
  ] });
const reply = JSON.stringify({ translation: "Чем помочь?", sentiment: "neutral",
  suggestion: { type: "direct", en: "What time do you close?", translation: "Когда вы закрываетесь?" } });

describe("LIVE benchmark parity", () => {
  it("sends exactly the live builders, all blocks, 250 tokens and reasoning none", () => {
    const r = buildLiveBenchmarkRequest("gpt-5.6-terra", "How can I help?", context);
    const system = withActionResults(buildLiveSystemPrompt(context), true);
    expect(r.body).toEqual(buildOpenAIChatBody("gpt-5.6-terra", system, buildLiveUserPrompt("How can I help?"), 250));
    expect(r.body.max_completion_tokens).toBe(250);
    expect(r.body.reasoning_effort).toBe("none");
    expect(r.body).not.toHaveProperty("stream");
    expect(r.body).not.toHaveProperty("response_format");
    expect(r.system).toContain("OWNER ACTION / RESULT OPTIONS");
    expect(r.system).toContain("STRATEGY MEMORY");
    expect(r.system).toContain(context.goal);
    expect(r.systemHash).toBe(hashText(system));
  });
  it.each(["goal", "language", "conversationContext", "contextSections", "strategyMemory"] as const)(
    "hash records dynamic %s rather than only a static prompt version", key => {
      const a = buildLiveBenchmarkRequest("gpt-5.6-terra", "Hello", context);
      const b = buildLiveBenchmarkRequest("gpt-5.6-terra", "Hello", { ...context, [key]: key === "language" ? "es" : "different" });
      expect(a.systemHash).not.toBe(b.systemHash);
    });
  it("user hash changes when only the current Guest changes", () => {
    const a = buildLiveBenchmarkRequest("gpt-5.6-terra", "a", context);
    const b = buildLiveBenchmarkRequest("gpt-5.6-terra", "b", context);
    expect(a.systemHash).toBe(b.systemHash); expect(a.userHash).not.toBe(b.userHash);
  });
  it("uses LIVE schema, not old benchmark envelope; translation-off stays off", () => {
    expect(parseLiveBenchmarkReply(reply, true)?.suggested_reply).toContain("close");
    expect(parseLiveBenchmarkReply(reply, false)?.translation).toBe("");
    expect(parseLiveBenchmarkReply('{"should_suggest":true,"suggested_reply":"yes"}', true)).toBeNull();
    expect(parseLiveBenchmarkReply('{"translation":"x","suggestion":"broken"}', true)).toBeNull();
    expect(parseLiveBenchmarkReply('{"translation":', true)).toBeNull();
  });
  it("compares no zero-output/error/self-judged/incompletely judged run", () => {
    for (const overrides of [{ requested: 0, successful: 0 }, { errors: 1 }, { schemaInvalid: 1 },
      { independentJudge: false }, { judged: 0 }]) {
      expect(benchmarkValidity({ requested: 1, successful: 1, errors: 0, schemaInvalid: 0,
        independentJudge: true, judged: 1, ...overrides }).excludedFromComparison).toBe(true);
    }
    expect(benchmarkValidity({ requested: 1, successful: 1, errors: 0, schemaInvalid: 0,
      judged: 1, independentJudge: true }).status).toBe("valid");
  });
  it("requires the same 10–20 distinct audio recordings with real ordered boundaries", () => {
    const corpus = Array.from({ length: 10 }, (_, i) => fixture(String(i)));
    expect(inspectTimedCorpus(corpus).valid).toBe(true);
    expect(inspectTimedCorpus(corpus.slice(0, 9)).valid).toBe(false);
    expect(inspectTimedCorpus([...corpus, corpus[0]]).valid).toBe(false);
    corpus[0].referenceTurns[1].tEndMs = NaN;
    expect(inspectTimedCorpus(corpus).problems.join()).toContain("SPEECH_BOUNDARIES");
  });
  it("fails missing goal/audio and reversed reference boundaries before paid requests", () => {
    const f = fixture();
    expect(inspectTimedCorpus([{ ...f, audioBase64: null, goal: "" }], 1).valid).toBe(false);
    f.referenceTurns[0].tEndMs = -1;
    expect(inspectTimedCorpus([f], 1).valid).toBe(false);
  });
  it("keeps all four clocks, never invents missing STT/word timing", () => {
    expect(measuredStages({ speechEnd: 100, sttFinal: 400, firstHintWord: 900, fullHint: 1800 }))
      .toEqual({ speechEnd: 100, sttFinal: 400, firstHintWord: 900, fullHint: 1800,
        valid: true, firstWordMs: 800, fullHintMs: 1700 });
    expect(measuredStages({ speechEnd: null, sttFinal: 400, firstHintWord: 900, fullHint: 1800 }).valid).toBe(false);
    expect(measuredStages({ speechEnd: 400, sttFinal: 100, firstHintWord: 900, fullHint: 1800 }).valid).toBe(false);
  });
  it("replays at 1x and measures each turn, not the end of the recording", () => {
    expect(REALTIME_ACCEL).toBe(1);
    const aligned = { refTurn: fixture().referenceTurns[1] as any, hypText: "How can I help?",
      hypAtMs: 2300, hypEndOfTurn: true };
    const critical = { money: [], dates: [], digits: [], names: [], decisions: [] };
    expect(scoreTurn("flux", aligned, critical, 50_000).speechEndToFinalMs).toBe(500);
    expect(scoreTurn("flux", { ...aligned, refTurn: { ...aligned.refTurn, tEndMs: undefined } },
      critical, 50_000).speechEndToFinalMs).toBeNull();
  });
  it("nonstream timing includes complete JSON download, not only response headers", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => { now = 50; return { ok: true, status: 200,
      headers: { get: () => "request-id-test" }, text: async () => "",
      json: async () => { now = 900; return { choices: [{ message: { content: reply }, finish_reason: "stop" }] }; } }; });
    const r = await chatOnce({ model: "gpt-5.6-terra", system: "", user: "", maxTokens: 250,
      timeoutMs: 1000, nowMs: () => now, fetchImpl });
    expect(r.latencyMs).toBe(900); expect(r.requestId).toBe("request-id-test");
  });
  it("bounds a stalled nonstream JSON body; does not retry", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => "",
      json: () => new Promise(() => {}) }));
    const r = await chatOnce({ model: "gpt-5.6-terra", system: "", user: "", maxTokens: 250,
      timeoutMs: 5, nowMs: () => Date.now(), fetchImpl });
    expect(r.ok).toBe(false); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("actual harness calls the live body and persists only hashes as provenance", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.max_completion_tokens).toBe(250);
      expect(body).not.toHaveProperty("stream");
      expect(body.messages[0].content).toContain("ADAPTIVE HINT");
      return { ok: true, status: 200, text: async () => "",
        json: async () => ({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 5000, completion_tokens: 60 } }) };
    });
    const result = await runBrainBenchmark({ fixture: { ...fixture(), confirmedFacts: [],
      criticalEntities: { money: [], dates: [], digits: [], names: [], decisions: [] } } as any,
      candidates: [{ id: "base", model: "gpt-5.6-terra" }] as any,
      availability: [{ candidateId: "base", status: "AVAILABLE" }] as any,
      liveContext: context, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((result.turnResults[0] as any).systemHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.turnResults[0].schemaValid).toBe(true);
  });
});
