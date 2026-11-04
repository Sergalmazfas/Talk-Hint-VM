import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: f.create }; } }));
import { SecretaryConversationEngine, type EngineStream } from "./conversationEngine";
import { selectPhonePrompt } from "./phonePrompt";
import { bindPhoneRollout, changePhoneVariant, claimCReview, rolloutState, selectedPhoneVariant } from "./phoneRollout";
import { phoneMetrics, phoneSpeechTiming } from "./phoneMetrics";
import { initialState } from "../aiCrew/domain";
import { IVR_INSTRUCTIONS } from "./ivr";
import { secretaryIntroductionPolicy } from "./ownerIdentity";
import { CResponseBuffer } from "../secretaryLab/cResponseBuffer";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";

const registries: RetellEngineRegistry[] = [];
beforeEach(() => {
  f.create.mockReset().mockImplementation(async () => (async function* () {
    yield { type: "response.output_text.delta", delta: "Ready." };
    yield { type: "response.completed", response: { output: [], usage: {
      input_tokens: 100, output_tokens: 3, input_tokens_details: { cached_tokens: 50 } } } };
  })());
});
afterEach(() => { registries.splice(0).forEach(r => r.dispose()); vi.useRealTimers(); vi.restoreAllMocks(); });
const makeEngine = (variant: "C" | "legacy", assignment = "Ask about parking.") =>
  new SecretaryConversationEngine("fixture-owner", assignment, undefined, true, undefined, [], undefined, undefined, variant);
describe("Reviewed telephone C without lab budgets, scripts or synthetic speech", () => {
  it("uses the exact C request, real phone tools and a stable cache prefix", async () => {
    const e = makeEngine("C"), text: string[] = [];
    await e.respond([{ role: "user", content: "Hello" }], new AbortController().signal, t => text.push(t));
    const body = f.create.mock.calls[0][0];
    expect(body).toMatchObject({ model: "gpt-6-sol", reasoning: { effort: "low" },
      max_output_tokens: 300, stream: true, store: false, parallel_tool_calls: false });
    expect(body.prompt_cache_key).toMatch(/^katya-C-/);
    expect(body.tools.map((t: any) => t.name)).toEqual([
      "prepare_call_end", "press_digits", "request_menu_help", "confirm_menu_reached",
    ]);
    expect(body.instructions).toContain(IVR_INSTRUCTIONS);
    expect(body.instructions).toContain(secretaryIntroductionPolicy(undefined));
    expect(text.join("")).toBe("Ready.");
    expect(e.report.usage).toMatchObject({ input: 100, cachedInput: 50, output: 3 });
    expect(e.report.phoneRuntime).toMatchObject({ variant: "C", promptMode: "compact", fallbackReason: null });
  });
  it("oversized rules/plan preserve the entire previous prompt; call/model still work", async () => {
    const plan = "AUTHORIZED_FACT_KEEP: " + "x".repeat(9500);
    const full = makeEngine("legacy", plan).instructions;
    const e = makeEngine("C", plan);
    // The only volatile old prompt field is its runtime clock.
    expect(e.instructions.replace(/Current time: [^\n]+/, "CLOCK"))
      .toBe(full.replace(/Current time: [^\n]+/, "CLOCK"));
    // The existing checklist normalizer may split oversized raw input.
    // Exact equality above proves fallback preserves the whole legacy prompt.
    expect(e.instructions).toContain("AUTHORIZED_FACT_KEEP:");
    expect(e.report.phoneRuntime).toMatchObject({ variant: "C", promptMode: "full",
      fallbackReason: "COMPACT_PROMPT_EXCEEDS_9000", maxOutput: 300 });
    await e.respond([{ role: "user", content: "Hello" }], new AbortController().signal, () => {});
    expect(f.create.mock.calls[0][0]).toMatchObject({ model: "gpt-6-sol", max_output_tokens: 300 });
    expect(e.report.events.some(e => e.type === "compact_fallback_full_prompt")).toBe(true);
  });
  it("legacy rollback restores the old model/reasoning/cap and full prompt", async () => {
    const e = makeEngine("legacy");
    await e.respond([{ role: "user", content: "Hello" }], new AbortController().signal, () => {});
    expect(f.create.mock.calls[0][0]).toMatchObject({ model: "gpt-6.1-sol",
      reasoning: { effort: "medium" }, max_output_tokens: 1600 });
    expect(f.create.mock.calls[0][0].prompt_cache_key).toBeUndefined();
  });
  it("task facts/time cannot move into the cache prefix", () => {
    const a = selectPhonePrompt("old", "fixture-owner", "first fact", undefined, [], "2026-11-03T00:00:00Z");
    const b = selectPhonePrompt("old", "fixture-owner", "second fact", undefined, [], "2026-11-03T01:00:00Z");
    expect(a.cacheKey).toBe(b.cacheKey); expect(a.hash).not.toBe(b.hash);
    expect(a.instructions).not.toContain("second fact"); expect(b.instructions).toContain("second fact");
  });
  it("accepts 5001..9000 intact with stable prefix caching; 9001 falls back without losing rules", () => {
    const now = "2026-11-04T00:00:00Z", full = "UNCHANGED FULL PROMPT";
    const base = selectPhonePrompt(full, "fixture-owner", "", undefined, [], now);
    // Greeting rules grew: the feasible lower boundary is the actual intact prefix,
    // not a fabricated 5001-char prompt shorter than its own mandatory rules.
    expect(base.chars).toBeLessThan(8999);
    for (const length of [Math.max(5001, base.chars + 1), 8999, 9000]) {
      const plan = "x".repeat(length - base.chars);
      const p = selectPhonePrompt(full, "fixture-owner", plan, undefined, [], now);
      expect(p.mode).toBe("compact"); expect(p.reason).toBeNull();
      expect(p.chars).toBe(length); expect(p.instructions).toContain(plan);
      expect(p.instructions).toContain(IVR_INSTRUCTIONS);
      expect(p.instructions).toContain(secretaryIntroductionPolicy(undefined));
      expect(p.cacheKey).toBe(base.cacheKey);
    }
    const over = selectPhonePrompt(full, "fixture-owner", "x".repeat(9001 - base.chars), undefined, [], now);
    expect(over).toMatchObject({ mode: "full", reason: "COMPACT_PROMPT_EXCEEDS_9000", instructions: full });
  });
});
describe("Persistent owner rollback and first five", () => {
  it("defaults to the explicitly promoted C but fails safe to old on unreadable controls", async () => {
    const s = initialState();
    expect(rolloutState(s).variant).toBe("C");
    bindPhoneRollout(() => ({ read: async () => s, change: async () => { throw Error(); } }));
    expect(await selectedPhoneVariant()).toBe("C");
    bindPhoneRollout(() => ({ read: async () => { throw Error(); }, change: async () => { throw Error(); } }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await selectedPhoneVariant()).toBe("legacy");
  });
  it("CAS toggle persists without changing limits, agents, task history or review quota", () => {
    const s = initialState(), old = structuredClone(s);
    claimCReview(s, "call-one");
    changePhoneVariant(s, { revision: 0, variant: "legacy" }, "owner");
    const restored = JSON.parse(JSON.stringify(s));
    expect(rolloutState(restored).variant).toBe("legacy");
    expect(restored.control).toEqual(old.control); expect(restored.agents).toEqual(old.agents);
    expect(restored.tasks).toEqual(old.tasks); expect(restored.secretaryPhoneRollout.reviews).toHaveLength(1);
    expect(() => changePhoneVariant(s, { revision: 10, variant: "C" }, "owner")).toThrow("STALE_REVISION");
    expect(() => changePhoneVariant(s, { revision: 0, variant: "C", voice: "other" }, "owner")).toThrow();
  });
  it("claim is idempotent, bounded at five, survives restart and rollback", () => {
    let s = initialState();
    for (let i = 0; i < 8; i++) { claimCReview(s, `call-${i}`); claimCReview(s, `call-${i}`); }
    expect(rolloutState(s).reviews.map(r => r.ordinal)).toEqual([1, 2, 3, 4, 5]);
    s = JSON.parse(JSON.stringify(s));
    changePhoneVariant(s, { revision: 0, variant: "legacy" }, "owner");
    changePhoneVariant(s, { revision: 0, variant: "C" }, "owner");
    expect(claimCReview(s, "new-call")).toBeUndefined();
  });
});
describe("C audio evidence", () => {
  it("keeps live word clocks when Retell basic-attributes storage omits postcall transcripts", () => {
    const playback=phoneSpeechTiming([
      {role:"user",words:[{word:"private",start:0,end:1}]},
      {role:"agent",words:[{word:"Поняла.",start:1.7,end:2},{word:"150",start:2.1,end:2.5}]},
    ]);
    expect(JSON.stringify(playback)).not.toContain("private");
    expect(JSON.stringify(playback)).not.toContain("150");
    expect(phoneMetrics({playback},{latency:{e2e:{p50:750,p95:1800}}})).toMatchObject({
      audioTimingSource:"retell-websocket-word-clocks",clientPlaybackVerified:false,
      endToSoundMedianMs:700,endToContentMedianMs:1100,providerReportedE2eMs:{p50:750,p95:1800},
    });
  });
  it("never labels TTFT or websocket send time as sound latency", () => {
    const result = phoneMetrics({ interruption: { events: [
      { kind: "generation_started", id: 1, at: "2026-11-03T00:00:00Z" },
      { kind: "first_token", id: 1, at: "2026-11-03T00:00:00.700Z" },
    ] } });
    expect(result.generations[0].ttftMs).toBe(700);
    expect(result.endToSoundMedianMs).toBeNull(); expect(result.audioSamples).toBe(0);
  });
  it("separates bridge sound from substantive answer using provider word clocks", () => {
    const result = phoneMetrics({}, { transcript_object: [
      { role: "user", words: [{ word: "Question", start: 0, end: 1 }] },
      { role: "agent", words: [{ word: "Got", start: 1.8, end: 1.9 },
        { word: "it.", start: 1.9, end: 2 }, { word: "150", start: 2.2, end: 2.4 }] },
    ] });
    expect(result).toMatchObject({ audioSamples: 1, endToSoundMedianMs: 800, endToContentMedianMs: 1200 });
    expect(JSON.stringify(result)).not.toContain("Question");
    expect(JSON.stringify(result)).not.toContain("150");
  });
  it("excludes overlap/invalid times and incomplete caller fragments", () => {
    expect(phoneMetrics({}, { transcript_object: [
      { role: "user", words: [{ start: 0, end: 3 }] },
      { role: "agent", words: [{ start: 2, end: 4 }] },
    ] }).audioSamples).toBe(0);
  });
});
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent: any[] = [];
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.emit("close"); }
  frame(value: any) { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
}
describe("Production C buffer transport", () => {
  it("retains a generation on acknowledgement, blocks keypad while caller speaks and pins C per call", async () => {
    vi.useFakeTimers(); let mode: "C" | "legacy" = "C";
    const emissions: ((text: string) => void)[] = [];
    const stream: EngineStream = async function* () {
      const text = await new Promise<string>(r => emissions.push(r));
      yield { type: "text", text }; yield { type: "complete", output: [], tools: [] };
    };
    const r = new RetellEngineRegistry(stream, { phone: true, phoneProfile: () => mode });
    registries.push(r);
    const reservation = r.reserve("fixture-owner", "Ask a question", "task");
    const path = `/retell-phone-engine/${reservation.ticket}/call_test`; r.registered("task", "call_test");
    const ws = new Socket(); r.attach(ws as any, path);
    ws.frame({ interaction_type: "response_required", response_id: 1, transcript: [{ role: "user", content: "Tell me" }] });
    await vi.advanceTimersByTimeAsync(0);
    ws.frame({ interaction_type: "update_only", turntaking: "user_turn",
      transcript: [{ role: "user", content: "Tell me" }, { role: "user", content: "mhm" }] });
    expect(() => r.pressDigits("task", "8")).toThrow("transport unavailable");
    ws.frame({ interaction_type: "response_required", response_id: 2,
      transcript: [{ role: "user", content: "Tell me" }, { role: "user", content: "mhm" }] });
    expect(emissions).toHaveLength(1);
    mode = "legacy";
    emissions[0]("Safe answer."); await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent.some(f => f.response_id === 2 && f.content === "Safe answer.")).toBe(true);
    expect(r.diagnostics("task")?.runtime?.variant).toBe("C");
    expect(r.diagnostics("task")?.interruption).toMatchObject({ a: 1, reused: 1 });
    const next = r.reserve("fixture-owner", "Next call", "next");
    expect(next.engine.phoneRuntime?.variant).toBe("legacy");
  });
  it("buffers the prepared farewell, but never sends end_call while the caller interrupts", async () => {
    vi.useFakeTimers(); let done!: (value: unknown) => void, emit!: (text: string) => void;
    const frames: any[] = [];
    const b = new CResponseBuffer({ generate: (_t, _s, fn) => { emit = fn; return new Promise(r => { done = r; }); },
      send: frame => frames.push(frame), record: () => {}, error: () => ({ message: "Error", end: false }) });
    b.request(1, [{ role: "user", content: "Bye" }]);
    emit("Goodbye."); b.update([{ role: "user", content: "No, wait" }], true);
    done({ farewell: "Goodbye." }); await vi.advanceTimersByTimeAsync(0);
    expect(frames.some(f => f.end_call)).toBe(false);
    b.close();
  });
  it("marks a genuinely completed prepared farewell end_call on the buffered response", async () => {
    const frames: any[] = [];
    const b = new CResponseBuffer({ generate: async (_t, _s, fn) => { fn("Goodbye."); return { farewell: "Goodbye." }; },
      send: frame => frames.push(frame), record: () => {}, error: () => ({ message: "Error", end: false }) });
    b.request(1, [{ role: "user", content: "Bye" }]); await Promise.resolve(); await Promise.resolve();
    expect(frames.at(-1)).toMatchObject({ content_complete: true, end_call: true }); b.close();
  });
});
