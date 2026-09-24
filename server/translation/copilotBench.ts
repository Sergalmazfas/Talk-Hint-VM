// Dev-only, isolated recorded-audio comparison. Never attaches to a phone call.
import type WebSocket from "ws";
import { openaiRealtimeTranslationProvider } from "./openaiRealtimeTranslator";
import type { RealtimeTranslationConfig, RealtimeTranslationSession } from "./provider";
import { buildCopilotBenchPage } from "./copilotBenchPage";

export { buildCopilotBenchPage };

export const COPILOT_BENCH_CANDIDATES = [
  { id: "copilot-current", label: "Current Copilot · gpt-realtime · text / auto" },
  { id: "copilot-fixed", label: "gpt-realtime · text / fixed source language" },
  { id: "realtime-mini", label: "gpt-realtime-mini · text / fixed source language" },
  { id: "translator-voice", label: "Current Translator · gpt-realtime · voice / pair" },
] as const;

export type BenchDirection = "guest" | "private";
export type BenchCandidate = typeof COPILOT_BENCH_CANDIDATES[number]["id"];

export function copilotBenchConfig(candidate: BenchCandidate, direction: BenchDirection): RealtimeTranslationConfig {
  const source = direction === "guest" ? "en" : "ru";
  const target = direction === "guest" ? "ru" : "en";
  const audio = { encoding: "pcm16" as const, sampleRateHz: 24_000 };
  const base: RealtimeTranslationConfig = {
    languages: [source, target], inputFormat: audio, outputFormat: audio,
  };
  switch (candidate) {
    case "copilot-current":
      return { ...base, outputLanguage: target, outputMode: "text", microturnMinAudioMs: 0 };
    case "copilot-fixed":
      return { ...base, sourceLangHint: source, outputLanguage: target, outputMode: "text", microturnMinAudioMs: 0 };
    case "realtime-mini":
      return { ...base, model: "gpt-realtime-mini", sourceLangHint: source, outputLanguage: target, outputMode: "text", microturnMinAudioMs: 0 };
    case "translator-voice":
      return { ...base, languages: ["ru", "en"], sourceLangHint: "auto", voice: "marin" };
  }
}

const MAX_AUDIO_BYTES = 24_000 * 2 * 20; // 20 seconds; never accept unbounded paid input.

export function handleCopilotBenchStream(ws: WebSocket): void {
  let session: RealtimeTranslationSession | undefined;
  let opening = false;
  let closed = false;
  let bytes = 0;
  const send = (obj: object) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  ws.on("message", async (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (!session || !Buffer.isBuffer(data) || data.length % 2 || bytes + data.length > MAX_AUDIO_BYTES) {
        send({ type: "error", message: "Invalid or excessive PCM16 audio", fatal: true });
        session?.cancel();
        ws.close();
        return;
      }
      bytes += data.length;
      session.sendAudio(data);
      return;
    }
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === "start") {
      if (opening || session) { send({ type: "error", message: "Session already started", fatal: true }); return; }
      if (!COPILOT_BENCH_CANDIDATES.some(c => c.id === msg.candidate) ||
          (msg.direction !== "guest" && msg.direction !== "private")) {
        send({ type: "error", message: "Invalid benchmark candidate or direction", fatal: true });
        return;
      }
      opening = true;
      try {
        const opened = await openaiRealtimeTranslationProvider.startSession(
          copilotBenchConfig(msg.candidate, msg.direction),
        );
        if (closed) { opened.cancel(); return; }
        session = opened;
        opened.onEvent(ev => {
          if (ev.type === "translated_audio") return; // voice baseline: collect text, never play TTS.
          send(ev);
        });
      } catch (e) {
        send({ type: "error", message: (e as Error).message, fatal: true });
      } finally {
        opening = false;
      }
    } else if (msg.type === "stop") {
      session?.cancel();
      session = undefined;
      ws.close();
    }
  });
  ws.on("close", () => {
    closed = true;
    session?.cancel();
  });
}