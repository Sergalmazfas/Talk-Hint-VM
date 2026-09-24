import { describe, it, expect, vi } from "vitest";
import { Script } from "node:vm";
import { OpenAIRealtimeTranslationSession } from "../translation/openaiRealtimeTranslator";
import { buildCopilotBenchPage, copilotBenchConfig, handleCopilotBenchStream } from "../translation/copilotBench";
import { COPILOT_GUIDED_CASES } from "../translation/copilotGuidedCases";

const startSession = vi.hoisted(() => vi.fn());
vi.mock("../translation/openaiRealtimeTranslator", async (importOriginal) => ({
  ...await importOriginal<typeof import("../translation/openaiRealtimeTranslator")>(),
  openaiRealtimeTranslationProvider: { startSession },
}));

function socket() {
  const callbacks: Record<string, Function[]> = {};
  const sent: any[] = [];
  return {
    OPEN: 1, readyState: 1,
    on(type: string, cb: Function) { (callbacks[type] ||= []).push(cb); },
    send(raw: string) { sent.push(JSON.parse(raw)); },
    close() { this.readyState = 3; for (const cb of callbacks.close || []) cb(); },
    async message(payload: object | Buffer, binary = false) {
      for (const cb of callbacks.message || [])
        await cb(Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload)), binary);
    },
    sent,
  };
}

describe("Copilot translation comparison (no phone calls)", () => {
  it("uses exact current Copilot settings and keeps the voice Translator baseline distinct", () => {
    const current = copilotBenchConfig("copilot-current", "private");
    expect(current).toMatchObject({
      languages: ["ru", "en"], outputLanguage: "en", outputMode: "text", microturnMinAudioMs: 0,
    });
    expect(current.sourceLangHint).toBeUndefined();
    expect(current.model).toBeUndefined();
    expect(copilotBenchConfig("copilot-fixed", "guest")).toMatchObject({
      languages: ["en", "ru"], outputLanguage: "ru", sourceLangHint: "en", outputMode: "text",
    });
    expect(copilotBenchConfig("realtime-mini", "private").model).toBe("gpt-realtime-mini");
    const baseline = copilotBenchConfig("translator-voice", "guest");
    expect(baseline.languages).toEqual(["ru", "en"]);
    expect(baseline.outputMode).toBeUndefined();
    expect(baseline.microturnMinAudioMs).toBeUndefined();
    expect(baseline.outputLanguage).toBeUndefined();
  });

  it("only the comparison selects a different model; default provider remains unchanged", () => {
    const config = copilotBenchConfig("realtime-mini", "private");
    const mini = new OpenAIRealtimeTranslationSession(config);
    const normal = new OpenAIRealtimeTranslationSession(copilotBenchConfig("copilot-current", "private"));
    expect((mini as any).model).toBe("gpt-realtime-mini");
    expect((normal as any).model).toBe(process.env.TRANSLATOR_SPIKE_MODEL || "gpt-realtime");
  });

  it("renders a recorded-audio comparison without exposing a key or changing calls", () => {
    const html = buildCopilotBenchPage("only-for-test");
    expect(html).toContain("/copilot-bench-stream?token=");
    expect(html).toContain("Guest EN → RU");
    expect(html).toContain("Owner private RU → EN");
    expect(html).toContain("без телефонного звонка");
    expect(html).toContain("Скачать JSON с результатами и аудио");
    expect(html).toContain("runGuidedAll");
    expect(html).toContain("readAsDataURL(c.blob)");
    expect(html).not.toContain("OPENAI_API_KEY");
    const js = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(js).toBeTruthy();
    expect(() => new Script(js!)).not.toThrow();
  });

  it("offers 15 distinct guided speech cases for both call directions without a real caller's number", () => {
    expect(COPILOT_GUIDED_CASES).toHaveLength(15);
    expect(new Set(COPILOT_GUIDED_CASES.map(c => c.id)).size).toBe(15);
    expect(COPILOT_GUIDED_CASES.filter(c => c.direction === "private").length).toBeGreaterThan(10);
    expect(COPILOT_GUIDED_CASES.filter(c => c.direction === "guest").length).toBeGreaterThan(1);
    expect(COPILOT_GUIDED_CASES.map(c => c.phrase).join(" ")).toContain("не раньше");
    expect(COPILOT_GUIDED_CASES.map(c => c.phrase).join(" ")).not.toContain("954-218-7485");
  });

  it("validates candidate, relays text evidence, never relays voice audio and cancels on close", async () => {
    const ws = socket();
    let emit: (ev: any) => void = () => {};
    const cancel = vi.fn(), sendAudio = vi.fn();
    startSession.mockResolvedValue({
      cancel, sendAudio, stop: vi.fn(),
      onEvent: (fn: typeof emit) => { emit = fn; },
    });
    handleCopilotBenchStream(ws as any);
    await ws.message({ type: "start", candidate: "invented", direction: "guest" });
    expect(ws.sent.at(-1)).toMatchObject({ type: "error", fatal: true });
    expect(startSession).not.toHaveBeenCalled();
    await ws.message({ type: "start", candidate: "copilot-current", direction: "guest" });
    expect(startSession).toHaveBeenCalledWith(copilotBenchConfig("copilot-current", "guest"));
    await ws.message(Buffer.alloc(4800), true);
    expect(sendAudio).toHaveBeenCalledWith(expect.any(Buffer));
    emit({ type: "translated_audio", base64: "secret-audio" });
    expect(ws.sent.some(m => m.type === "translated_audio")).toBe(false);
    emit({ type: "source_transcript", text: "No", itemId: "i1" });
    emit({ type: "translated_transcript_delta", text: "Н", responseId: "r1" });
    emit({ type: "translated_transcript_done", text: "Нет", responseId: "r1" });
    emit({ type: "turn_completed", metrics: { sourceTranscript: "No", translatedTranscript: "Нет", model: "gpt-realtime" } });
    expect(ws.sent).toContainEqual({ type: "translated_transcript_done", text: "Нет", responseId: "r1" });
    ws.close();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized audio without silently truncating the test", async () => {
    const ws = socket();
    const cancel = vi.fn();
    startSession.mockResolvedValue({ cancel, sendAudio: vi.fn(), onEvent: vi.fn() });
    handleCopilotBenchStream(ws as any);
    await ws.message({ type: "start", candidate: "copilot-current", direction: "private" });
    await ws.message(Buffer.alloc(24_000 * 2 * 21), true);
    expect(ws.sent.at(-1)).toMatchObject({ type: "error", fatal: true });
    expect(cancel).toHaveBeenCalled();
    expect(ws.readyState).toBe(3);
  });
});