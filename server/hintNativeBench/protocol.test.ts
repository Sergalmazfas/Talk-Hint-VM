import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { firstCompleteEnglishWord, assertPaidExecutionAuthorized, instructions, plainEnglish } from "./contracts";
import { NativeProtocol, assertOutbound, ownerContext, setup } from "./protocol";
import { readCatalog, selectedModel } from "./catalog";
import { JUDGE_PROMPT, judgeRequests, parseJudge, sendJudge } from "./judge";
import { liveTransport } from "./adapter";

const ready = () => ({ type: "session.updated", session: (setup("openai", "catalog-id", "saved", 250) as any).session });
describe("native TEXT and automatic EOT contract (offline only)", () => {
  it("keeps both providers automatic, plain EN and separate labelled Owner context", () => {
    const a = setup("openai", "catalog-id", "goal", 250) as any;
    expect(a.session.audio.input.turn_detection).toMatchObject({ type: "server_vad", create_response: true });
    expect(a.session.output_modalities).toEqual(["text"]);
    const b = setup("gemini", "models/catalog-id", "goal", 250) as any;
    expect(b.setup.realtimeInputConfig.automaticActivityDetection.disabled).toBe(false);
    expect(b.setup.generationConfig.responseModalities).toEqual(["TEXT"]);
    expect(JSON.stringify(b)).not.toMatch(/outputAudioTranscription|activityEnd|activityStart/);
    expect(instructions("a saved goal")).toContain("a saved goal");
    for (const p of ["openai", "gemini"] as const) {
      assertOutbound(p, setup(p, "catalog-id", "goal", 250));
      assertOutbound(p, ownerContext(p, "My answer"));
      expect(JSON.stringify(ownerContext(p, "My answer"))).toContain("Owner already said");
    }
  });
  it("forbids manual commit/response/activity commands", () => {
    for (const type of ["input_audio_buffer.commit", "response.create", "response.cancel"])
      expect(() => assertOutbound("openai", { type })).toThrow("FORBIDDEN");
    for (const key of ["activityStart", "activityEnd", "audioStreamEnd"])
      expect(() => assertOutbound("gemini", { realtimeInput: { [key]: {} } })).toThrow("FORBIDDEN");
    expect(() => assertOutbound("gemini", { clientContent: { turnComplete: true } })).toThrow("FORBIDDEN");
  });
  it("does not count a partial token or JSON as an English word", () => {
    expect(firstCompleteEnglishWord("Hel")).toBeNull();
    expect(firstCompleteEnglishWord("Hello ")).toBe("Hello");
    expect(firstCompleteEnglishWord("I'd ")).toBe("I'd");
    expect(firstCompleteEnglishWord("Hello", true)).toBe("Hello");
    expect(() => plainEnglish('{"en":"Hello"}')).toThrow();
    expect(() => plainEnglish("Hello привет")).toThrow();
  });
  it("requires the effective OpenAI model and TEXT/auto-response handshake", () => {
    const p = new NativeProtocol("openai", "catalog-id");
    p.receive(ready(), 0); expect(p.ready).toBe(true);
    const bad = ready(); bad.session.model = "replacement";
    expect(() => new NativeProtocol("openai", "catalog-id").receive(bad, 0)).toThrow("MODEL_SUBSTITUTION");
    const manual = ready(); manual.session.audio.input.turn_detection.create_response = false;
    expect(() => new NativeProtocol("openai", "catalog-id").receive(manual, 0)).toThrow("NOT_CONFIRMED");
  });
  it("records complete first word, auto-EOT, full reply and interrupted replies separately", () => {
    const p = new NativeProtocol("openai", "catalog-id");
    p.receive(ready(), 0);
    p.receive({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 1000, item_id: "i" }, 1600);
    p.receive({ type: "response.created", response: { id: "r" } }, 1620);
    p.receive({ type: "response.output_text.delta", response_id: "r", delta: "Hel" }, 1700);
    p.receive({ type: "response.output_text.delta", response_id: "r", delta: "lo " }, 1750);
    p.receive({ type: "response.output_text.delta", response_id: "r", delta: "there." }, 1800);
    p.receive({ type: "response.done", response: { id: "r", status: "completed", usage: {} } }, 1900);
    expect(p.hints[0]).toMatchObject({ text: "Hello there.", firstWordAt: 1750, fullAt: 1900, completed: true });
    expect(p.events.find(e => e.kind === "eot")).toMatchObject({ at: 1600, audioEndMs: 1000 });
    p.receive({ type: "response.created", response: { id: "x" } }, 2000);
    p.receive({ type: "response.done", response: { id: "x", status: "cancelled" } }, 2100);
    expect(p.hints[1]).toMatchObject({ completed: false, interrupted: true });
  });
  it("rejects audio transcript substitution for both providers", () => {
    const a = new NativeProtocol("openai", "catalog-id");
    expect(() => a.receive({ type: "response.output_audio_transcript.delta", delta: "Hello " }, 10))
      .toThrow("AUDIO_TRANSCRIPT_NOT_TEXT");
    const b = new NativeProtocol("gemini", "models/catalog-id");
    b.receive({ setupComplete: {} }, 0);
    expect(b.events[0]).toEqual({ kind: "ready", modelEcho: null });
    expect(() => b.receive({ serverContent: { outputTranscription: { text: "Hello " } } }, 10))
      .toThrow("AUDIO_TRANSCRIPT_NOT_TEXT");
  });
  it("Gemini only accepts actual text parts, excluding thoughts", () => {
    const p = new NativeProtocol("gemini", "models/catalog-id");
    p.receive({ serverContent: { modelTurn: { parts: [{ text: "Hidden thought ", thought: true }, { text: "Hi " }] } } }, 50);
    p.receive({ serverContent: { modelTurn: { parts: [{ text: "there." }] }, turnComplete: true } }, 100);
    expect(p.hints[0]).toMatchObject({ text: "Hi there.", firstWordAt: 50, fullAt: 100 });
    expect(p.events.some(e => e.kind === "eot")).toBe(false);
  });
  it("preparation cannot open real sockets or judge calls", async () => {
    expect(() => assertPaidExecutionAuthorized()).toThrow("PREPARATION_ONLY");
    expect(() => liveTransport("openai", "any", vi.fn(), vi.fn(), vi.fn(), vi.fn())).toThrow("PREPARATION_ONLY");
    await expect(sendJudge()).rejects.toThrow("PREPARATION_ONLY");
  });
});

describe("free catalogue and same independent judge", () => {
  it("reads later Gemini pages and requires bidi support, not guessed names", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      models: [{ name: "models/text", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "page2",
    }))).mockResolvedValueOnce(new Response(JSON.stringify({
      models: [{ name: "models/live", supportedGenerationMethods: ["bidiGenerateContent"] }],
    })));
    const catalog = await readCatalog("gemini", fetcher);
    expect(catalog.pages).toHaveLength(2); expect(catalog.complete).toBe(true);
    expect(selectedModel(catalog, "models/live")).toBe("models/live");
    expect(() => selectedModel(catalog, "models/text")).toThrow("NO_LIVE_METHOD");
    expect(() => selectedModel(catalog, "guessed-id")).toThrow("NOT_IN_VERIFIED_CATALOG");
    expect(String(fetcher.mock.calls[1][0])).toContain("pageToken=page2");
    expect(fetcher.mock.calls.every(c => !c[1].method)).toBe(true);
  });
  it("fails closed on HTTP errors, repeated tokens and malformed catalogues", async () => {
    await expect(readCatalog("openai", vi.fn().mockResolvedValue(new Response("{}", { status: 403 }))))
      .rejects.toThrow("CATALOG_HTTP_403");
    await expect(readCatalog("gemini", vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      models: [], nextPageToken: "repeat",
    }))))).rejects.toThrow("INCOMPLETE_CATALOG");
    await expect(readCatalog("openai", vi.fn().mockResolvedValue(new Response("{}")))).rejects.toThrow();
  });
  it("freezes the exact old rubric and never hides null hints or leaks future Owner replies", () => {
    const old = readFileSync("server/hintPolygon/provider.ts", "utf8");
    expect(old).toContain(JSON.stringify(JUDGE_PROMPT));
    const reference = [
      { id: "g", role: "guest" as const, text: "Question?", startMs: 0, endMs: 1000 },
      { id: "o", role: "owner" as const, text: "Future secret answer", startMs: 2000, endMs: 3000 },
    ];
    const requests = judgeRequests("saved", reference, [{
      turnId: "g", speechEndMs: 900, hint: null, firstWordMs: null, fullHintMs: null,
      autoEotMs: null, ambiguous: false, reason: "NO_HINT",
    }], "gpt-realtime-2.1");
    const evidence = JSON.parse(requests[0].messages[1].content);
    expect(evidence.items).toHaveLength(1);
    expect(evidence.items[0].hint).toBe("");
    expect(JSON.stringify(evidence)).not.toContain("Future secret answer");
    expect(requests[0].model).toBe("gpt-4.1-mini");
    expect(() => judgeRequests("g", [], [], "gpt-4.1-mini")).toThrow("NOT_INDEPENDENT");
  });
  it("validates every judge dimension and every turn exactly once", () => {
    const row = { turnId: "g", grounding: 5, relevance: 4, speakability: 3, translation: 0 };
    expect(parseJudge(JSON.stringify({ items: [row] }), ["g"])[0].score).toBe(3);
    expect(() => parseJudge(JSON.stringify({ items: [row, row] }), ["g", "h"])).toThrow("WRONG_TURN");
    expect(() => parseJudge(JSON.stringify({ items: [{ ...row, grounding: 6 }] }), ["g"])).toThrow("MALFORMED");
    expect(() => parseJudge('{"items":[]}', ["g"])).toThrow("INCOMPLETE");
  });
});
