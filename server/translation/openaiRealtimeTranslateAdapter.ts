// OpenAI gpt-realtime-translate adapter behind RealtimeTranslationProvider.
//
// This is the SECOND provider on the Translator Spike stand (task #286). It
// talks to the dedicated translation endpoint:
//
//   wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate
//
// Contract facts verified against the official docs + a live probe
// (2026-08-18, see docs/translator-spike-realtime-translate-comparison-report.md):
// - Continuous stream: `session.input_audio_buffer.append` with base64 PCM16
//   24 kHz, INCLUDING silence between phrases. No turn lifecycle, no
//   `response.create`, no cancellation semantics, no VAD events.
// - Output: `session.output_audio.delta` (base64 PCM16 24 kHz, ~200 ms
//   chunks), `session.output_transcript.delta` (append-only text),
//   `session.input_transcript.delta` (ONLY when `audio.input.transcription`
//   is configured — we use the official companion `gpt-realtime-whisper`).
// - Config surface: `session.update` supports ONLY `audio.output.language`,
//   `audio.input.transcription`, `audio.input.noise_reduction`. There is NO
//   custom prompt and NO voice selection (dynamic voice adaptation instead).
// - Graceful end: client `session.close` → server flushes → `session.closed`.
// - Pricing: $0.034 per minute of audio (duration-based, not tokens).
//
// Because the provider has no turn lifecycle, per-turn metrics REQUIRED by
// the harness (speech start/end, latency) are derived by a LOCAL energy
// (RMS) segmenter over the input PCM on OUR side. That is honest — the
// TranslationTurnMetrics contract already states timestamps are measured on
// our side — but attribution of transcripts to turns is approximate (FIFO
// between local segment boundaries) and is labeled as such in the report.
// Do NOT copy the conversational adapter's suppression gates here: task #286
// requires measuring the NATIVE behavior of the purpose-built model first.

import WebSocket from "ws";
import { tlog as log } from "./logger";
import type {
  RealtimeTranslationConfig,
  RealtimeTranslationProvider,
  RealtimeTranslationSession,
  TranslationEvent,
  TranslationTurnMetrics,
} from "./provider";

export const TRANSLATE_MODEL = "gpt-realtime-translate";
const TRANSLATE_URL = `wss://api.openai.com/v1/realtime/translations?model=${TRANSLATE_MODEL}`;
export const TRANSLATE_USD_PER_AUDIO_MINUTE = 0.034; // official model page
/** Companion source-transcript model (official pairing per OpenAI docs). */
export const TRANSLATE_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";

/**
 * Capabilities actually supported by the verified API contract. The stand UI
 * adapts to these instead of showing dead controls; limitations here are
 * provider facts, not bugs.
 */
export const TRANSLATE_CAPABILITIES = {
  voiceSelection: false, // dynamic voice adaptation only — no voice parameter
  customPrompt: false, // session.update accepts no instructions field
  sourceTranscriptBuiltIn: false, // requires gpt-realtime-whisper companion
  sourceTranscriptCompanion: TRANSLATE_TRANSCRIPTION_MODEL,
  dynamicVoiceAdaptation: true,
  turnLifecycle: false, // continuous stream; local RMS segmentation instead
  cancellation: false, // no response.cancel equivalent exists
  /** Output languages per official docs (subset relevant to the stand). */
  outputLanguages: ["en", "ru", "es"],
} as const;

/**
 * Local energy-based speech segmenter. Pure factory (no I/O) so unit tests
 * exercise the EXACT logic the adapter runs. Feed sequential PCM16 frames;
 * it reports segment transitions.
 *
 * Thresholds: speech opens when frame RMS >= openRms; a segment closes after
 * hangoverMs of consecutive sub-threshold audio (speech end is backdated to
 * the LAST voiced frame, so the hangover does not inflate latency).
 */
export function createSpeechSegmenter(opts: {
  openRms: number;
  hangoverMs: number;
}) {
  let inSpeech = false;
  let lastVoicedTs = 0;
  let startTs = 0;
  return {
    /** Returns a transition for this frame, or null. */
    feed(frame: {
      rms: number;
      ts: number;
      durationMs: number;
    }):
      | { transition: "speech_start"; ts: number }
      | { transition: "speech_end"; startTs: number; endTs: number }
      | null {
      const voiced = frame.rms >= opts.openRms;
      if (voiced) lastVoicedTs = frame.ts + frame.durationMs;
      if (!inSpeech && voiced) {
        inSpeech = true;
        startTs = frame.ts;
        return { transition: "speech_start", ts: frame.ts };
      }
      if (inSpeech && !voiced && frame.ts - lastVoicedTs >= opts.hangoverMs) {
        inSpeech = false;
        return { transition: "speech_end", startTs, endTs: lastVoicedTs };
      }
      return null;
    },
    /** Force-close an open segment (stream stop). */
    flush(now: number): { startTs: number; endTs: number } | null {
      if (!inSpeech) return null;
      inSpeech = false;
      return { startTs, endTs: lastVoicedTs || now };
    },
    get active() {
      return inSpeech;
    },
  };
}

/** RMS of a PCM16LE buffer, normalized to 0..1. */
export function pcm16Rms(buf: Buffer): number {
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/** Default segmenter tuning (exported so tests and report agree on values). */
export const SEGMENTER_DEFAULTS = { openRms: 0.02, hangoverMs: 600 };

// Exported for behavioral tests (handleMessage-driven, no network).
export class OpenAIRealtimeTranslateSession implements RealtimeTranslationSession {
  private ws: WebSocket | null = null;
  private listeners: Array<(ev: TranslationEvent) => void> = [];
  private closedEmitted = false;
  private config: RealtimeTranslationConfig;
  private segmenter = createSpeechSegmenter(SEGMENTER_DEFAULTS);

  // Per-segment ("turn") bookkeeping — local, because the provider stream
  // has no turn lifecycle. One pending turn at a time: a new speech_start
  // finalizes the previous pending turn first (FIFO attribution).
  private turnIndex = 0;
  private pending: {
    speechStartTs: number;
    speechEndTs?: number;
    firstTranslatedAudioTs?: number;
    audioInBytes: number;
  } | null = null;
  private srcAccum = "";
  private dstAccum = "";
  private audioOutBytesSinceTurn = 0;
  private stopping = false;
  private loggedFirstAudioOut = false;
  private loggedFirstAudioIn = false;
  private closeTimer: NodeJS.Timeout | null = null;
  private readyEvent: TranslationEvent | null = null;

  constructor(
    config: RealtimeTranslationConfig,
    opts?: { url?: string; handshakeTimeoutMs?: number },
  ) {
    this.config = config;
    this.url = opts?.url ?? TRANSLATE_URL;
    this.handshakeTimeoutMs = opts?.handshakeTimeoutMs ?? 10_000;
  }

  private url: string;
  private handshakeTimeoutMs: number;

  async connect(): Promise<void> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    if (this.config.inputFormat.sampleRateHz !== 24000 || this.config.outputFormat.sampleRateHz !== 24000) {
      // Contract: the translation endpoint speaks 24 kHz PCM16 only.
      throw new Error("gpt-realtime-translate requires 24 kHz PCM16 input and output");
    }
    const outputLanguage = this.config.outputLanguage || this.config.languages[1];
    if (!TRANSLATE_CAPABILITIES.outputLanguages.includes(outputLanguage as any)) {
      throw new Error(`unsupported output language for gpt-realtime-translate: ${outputLanguage}`);
    }
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, {
        headers: { Authorization: `Bearer ${key}` },
      });
      let settled = false;
      let handshakeProviderError: Error | null = null;
      // Bounded handshake: if the server accepts the socket but never sends
      // session.updated, startSession() must still settle (and the socket
      // must be torn down) — a pending-forever start leaks the upstream
      // session and wedges the stand's `starting` flag.
      const handshakeTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.terminate(); } catch {}
          reject(new Error("gpt-realtime-translate handshake timed out (no session.updated)"));
        }
      }, this.handshakeTimeoutMs);
      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(handshakeTimer);
          try { ws.terminate(); } catch {}
          reject(err);
        }
      };
      ws.on("open", () => {
        this.ws = ws;
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              audio: {
                output: { language: outputLanguage },
                input: {
                  transcription: { model: TRANSLATE_TRANSCRIPTION_MODEL },
                  // Stand runs on a laptop/phone mic (open speakers in the
                  // echo test) — far_field is the honest default there.
                  noise_reduction: { type: "far_field" },
                },
              },
            },
          }),
        );
      });
      ws.on("message", (data) => {
        let msg: any;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!settled && msg.type === "error") {
          const detail = JSON.stringify(msg.error || msg);
          handshakeProviderError = new Error(`provider error: ${detail}`);
          fail(handshakeProviderError);
        }
        if (!settled && msg.type === "session.updated") {
          settled = true;
          clearTimeout(handshakeTimer);
          resolve();
        }
        this.handleMessage(msg);
      });
      ws.on("error", (err) => {
        fail(err as Error);
        this.emit({ type: "error", message: (err as Error).message, fatal: true });
      });
      ws.on("close", () => {
        fail(handshakeProviderError || new Error("translation socket closed before session.updated"));
        this.emitClosed();
      });
    });
    log("[Translate] session ready (handshake ok)", "translator");
    this.readyEvent = {
      type: "ready",
      provider: "openai-realtime-translate",
      model: TRANSLATE_MODEL,
      // No custom prompt exists on this endpoint — report that honestly.
      instructions: "(none — gpt-realtime-translate does not support custom instructions)",
    };
    this.emit(this.readyEvent);
  }

  // ---- provider events --------------------------------------------------

  handleMessage(msg: any): void {
    switch (msg.type) {
      case "session.output_audio.delta": {
        const now = Date.now();
        if (this.audioOutBytesSinceTurn === 0 && this.turnIndex === 0 && !this.loggedFirstAudioOut) {
          this.loggedFirstAudioOut = true;
          log("[Translate] first translated audio delta received", "translator");
        }
        if (this.pending && this.pending.speechEndTs && !this.pending.firstTranslatedAudioTs) {
          this.pending.firstTranslatedAudioTs = now;
        }
        const bytes = Buffer.from(String(msg.delta || ""), "base64").length;
        this.audioOutBytesSinceTurn += bytes;
        this.emit({ type: "translated_audio", base64: String(msg.delta || "") });
        break;
      }
      case "session.output_transcript.delta": {
        this.dstAccum += String(msg.delta || "");
        this.emit({ type: "translated_transcript_delta", text: String(msg.delta || "") });
        break;
      }
      case "session.input_transcript.delta": {
        this.srcAccum += String(msg.delta || "");
        break;
      }
      case "session.closed": {
        this.finalizePendingTurn(Date.now());
        if (this.closeTimer) clearTimeout(this.closeTimer);
        this.ws?.close();
        break;
      }
      case "error": {
        log(`[Translate] provider error: ${JSON.stringify(msg.error || msg).slice(0, 300)}`, "translator");
        this.emit({
          type: "error",
          message: `provider error: ${JSON.stringify(msg.error || msg)}`,
          fatal: false,
        });
        break;
      }
    }
  }

  // ---- audio in ----------------------------------------------------------

  sendAudio(chunk: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.stopping) return;
    if (!this.loggedFirstAudioIn) {
      this.loggedFirstAudioIn = true;
      log(`[Translate] first mic frame received from stand (${chunk.length} bytes)`, "translator");
    }
    const now = Date.now();
    const durationMs = (chunk.length / 2 / this.config.inputFormat.sampleRateHz) * 1000;
    const tr = this.segmenter.feed({ rms: pcm16Rms(chunk), ts: now, durationMs });
    if (tr?.transition === "speech_start") {
      // FIFO: a new utterance closes the previous pending turn.
      this.finalizePendingTurn(now);
      this.pending = { speechStartTs: tr.ts, audioInBytes: 0 };
      this.emit({ type: "speech_started", ts: tr.ts });
    } else if (tr?.transition === "speech_end") {
      if (this.pending) this.pending.speechEndTs = tr.endTs;
      this.emit({ type: "speech_stopped", ts: tr.endTs });
    }
    if (this.pending) this.pending.audioInBytes += chunk.length;
    // Contract: stream continuously, INCLUDING silence between phrases.
    this.ws.send(
      JSON.stringify({ type: "session.input_audio_buffer.append", audio: chunk.toString("base64") }),
    );
  }

  /**
   * Emit turn_completed for the pending local segment. Called on the next
   * speech_start, on session close, and on stop() — never twice for one
   * segment (pending is cleared).
   */
  finalizePendingTurn(now: number): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (!p.speechEndTs) {
      const flushed = this.segmenter.flush(now);
      p.speechEndTs = flushed?.endTs ?? now;
    }
    const audioInMs = (p.audioInBytes / 2 / this.config.inputFormat.sampleRateHz) * 1000;
    const audioOutMs = (this.audioOutBytesSinceTurn / 2 / this.config.outputFormat.sampleRateHz) * 1000;
    const sourceTranscript = this.srcAccum.trim() || undefined;
    const translatedTranscript = this.dstAccum.trim() || undefined;
    this.srcAccum = "";
    this.dstAccum = "";
    this.audioOutBytesSinceTurn = 0;
    if (sourceTranscript) this.emit({ type: "source_transcript", text: sourceTranscript });
    if (translatedTranscript)
      this.emit({ type: "translated_transcript_done", text: translatedTranscript });
    const metrics: TranslationTurnMetrics = {
      turnIndex: this.turnIndex++,
      speechStartTs: p.speechStartTs,
      speechEndTs: p.speechEndTs,
      firstTranslatedAudioTs: p.firstTranslatedAudioTs,
      latencyMs:
        p.firstTranslatedAudioTs && p.speechEndTs
          ? Math.max(0, p.firstTranslatedAudioTs - p.speechEndTs)
          : undefined,
      sourceTranscript,
      translatedTranscript,
      provider: "openai-realtime-translate",
      model: TRANSLATE_MODEL,
      audioInMs: Math.round(audioInMs),
      audioOutMs: Math.round(audioOutMs),
      // Duration-based pricing: charge THIS turn's input audio minutes.
      // (Silence between turns also bills; the stand's scorecard reports
      // wall-clock cost separately from per-turn estimates.)
      estimatedCostUsd: (audioInMs / 60000) * TRANSLATE_USD_PER_AUDIO_MINUTE,
    };
    this.emit({ type: "turn_completed", metrics });
  }

  // ---- lifecycle -----------------------------------------------------------

  async stop(): Promise<void> {
    this.stopping = true;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.finalizePendingTurn(Date.now());
      this.emitClosed();
      return;
    }
    // Graceful drain per contract: session.close → wait for session.closed
    // (handleMessage finalizes + closes). Bounded: force-close after 5 s so
    // a hung drain can never leak a session.
    ws.send(JSON.stringify({ type: "session.close" }));
    await new Promise<void>((resolve) => {
      this.closeTimer = setTimeout(() => {
        log("[Translate] session.closed never arrived — force close", "translator");
        this.finalizePendingTurn(Date.now());
        ws.close();
        resolve();
      }, 5000);
      ws.on("close", () => {
        if (this.closeTimer) clearTimeout(this.closeTimer);
        resolve();
      });
    });
  }

  cancel(): void {
    this.stopping = true;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.ws?.close();
    this.emitClosed();
  }

  onEvent(cb: (ev: TranslationEvent) => void): void {
    this.listeners.push(cb);
    // `ready` fires inside connect(), BEFORE the caller of startSession()
    // can subscribe — replay it so the stand always sees session metadata.
    if (this.readyEvent) cb(this.readyEvent);
  }

  private emit(ev: TranslationEvent): void {
    for (const cb of this.listeners) cb(ev);
  }

  private emitClosed(): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.emit({ type: "closed" });
  }
}

export const openaiRealtimeTranslateProvider: RealtimeTranslationProvider = {
  name: "openai-realtime-translate",
  async startSession(config: RealtimeTranslationConfig): Promise<RealtimeTranslationSession> {
    const session = new OpenAIRealtimeTranslateSession(config);
    await session.connect();
    return session;
  },
};
