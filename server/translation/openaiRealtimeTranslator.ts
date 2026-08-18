// OpenAI Realtime adapter for the RealtimeTranslationProvider boundary.
//
// This is the ONLY file that knows OpenAI Realtime wire details. It speaks the
// GA realtime protocol (wss://api.openai.com/v1/realtime?model=...) and also
// understands the older beta event names defensively. Fail-closed: protocol
// errors surface as { type:"error" } events — no silent fallback to a
// different model or mode.

import WebSocket from "ws";
import { tlog as log } from "./logger";
import type {
  RealtimeTranslationConfig,
  RealtimeTranslationProvider,
  RealtimeTranslationSession,
  TranslationEvent,
  TranslationTurnMetrics,
} from "./provider";

const DEFAULT_MODEL = process.env.TRANSLATOR_SPIKE_MODEL || "gpt-realtime";
const DEFAULT_VOICE = process.env.TRANSLATOR_SPIKE_VOICE || "marin";

// FROZEN interpreter prompt (attached verbatim to the spike report).
// Pure-translation behavior is the top acceptance gate: the model must never
// answer, advise, converse, add fillers, or change meaning.
//
// Hardening v2 (Run #1 forensic): the confirmed defect was an UNSOLICITED
// RESPONSE — after a faithful translation of an invitation the model added
// "Yeah, I'm coming." Rules 11-13 exist specifically to kill that class of
// failure: exactly one rendition per utterance, never a participant, context
// only for disambiguation.
export interface InterpreterPromptOptions {
  /** "auto" (default) or an expected source language code. */
  inputLang?: "auto" | string;
  /** Directed mode: translate everything into this language. */
  outputLang?: string;
}

const LANG_NAMES: Record<string, string> = {
  ru: "Russian", en: "English", es: "Spanish", uk: "Ukrainian", kk: "Kazakh",
};
const langName = (c: string) => LANG_NAMES[c] || c;

function strictInterpreterRules(): string[] {
  return [
    `Strict rules:`,
    `1. Output ONLY the translation of what was just said. Nothing else.`,
    `2. NEVER answer questions, give advice, add opinions, or continue the conversation yourself. If the speaker asks "what time is it?", you translate the question — you do not answer it.`,
    `3. NEVER add filler words or acknowledgements (no "yeah", "okay", "mm-hmm", "sure", "got it") that the speaker did not say.`,
    `4. NEVER explain, comment, apologize, or mention that you are translating.`,
    `5. Preserve meaning exactly. Do not soften, embellish, summarize, or "improve" facts.`,
    `6. Numbers, dates, times, prices, addresses, phone numbers and proper names must be carried over EXACTLY. Spell out phone numbers digit by digit in the target language.`,
    `7. Keep the speaker's tone and register (formal/informal).`,
    `8. If the speaker corrects themselves mid-sentence, translate only the corrected final meaning.`,
    `9. If the audio is unintelligible or silent, say NOTHING. Never invent content.`,
    `10. Keep translations as short as the original — do not pad.`,
    `11. Produce EXACTLY ONE rendition per speaker utterance, then STOP and stay silent until the speaker talks again. Never add a second sentence that was not spoken. Never respond to, acknowledge, or react to your own previous translation.`,
    `12. You are NEVER a participant in the conversation. You never accept or decline invitations, never congratulate, never thank, never agree or disagree, never express emotion, and never speak on anyone's behalf. If the speaker says "come with us tonight", you translate the invitation — you NEVER say anything like "Sure" or "I'm coming".`,
    `13. Earlier turns may be used ONLY to disambiguate pronouns, names, terms, or an unfinished thought. NEVER carry facts, intentions, or replies from earlier turns into the current translation. Each translation must contain only what was said in the current utterance.`,
  ];
}

export function buildInterpreterInstructions(
  langs: [string, string],
  opts?: InterpreterPromptOptions,
): string {
  const [a, b] = langs;
  if (opts?.outputLang) {
    // Directed mode (experimental language controls on the spike stand).
    const out = langName(opts.outputLang);
    const inputLine =
      opts.inputLang && opts.inputLang !== "auto"
        ? `The speaker speaks ${langName(opts.inputLang)}.`
        : `Detect the speaker's language automatically. It may be any of: ${[a, b].map(langName).join(", ")}, or a mix.`;
    return [
      `You are a simultaneous interpreter on a live phone call. Translate EVERY speaker utterance into ${out}.`,
      inputLine,
      ``,
      `Your ONLY function is translation:`,
      `- Whatever language the speech is in, say the same thing in ${out}.`,
      `- If a single utterance mixes languages (for example a Russian sentence containing English words), treat it as ONE utterance and produce ONE single ${out} rendition of the entire meaning. Never split it, never translate only part of it.`,
      `- If the speech is already entirely in ${out}, repeat it in ${out} verbatim (clean interpretation, same meaning).`,
      ``,
      ...strictInterpreterRules(),
    ].join("\n");
  }
  return [
    `You are a simultaneous interpreter on a live phone call between a ${langName(a)} speaker and a ${langName(b)} speaker.`,
    ``,
    `Your ONLY function is translation:`,
    `- If the speech is in ${langName(a)}, say the same thing in ${langName(b)}.`,
    `- If the speech is in ${langName(b)}, say the same thing in ${langName(a)}.`,
    `- If a sentence mixes both languages, translate each part into the other language so the full sentence is understandable to the other side.`,
    ``,
    ...strictInterpreterRules(),
  ].join("\n");
}

// Published OpenAI pricing (USD per 1M tokens) at the time of the spike.
// Keyed by model prefix; used for ESTIMATED cost only, reported as such.
const PRICING: Record<
  string,
  { audioIn: number; audioInCached: number; audioOut: number; textIn: number; textInCached: number; textOut: number }
> = {
  "gpt-realtime": { audioIn: 32, audioInCached: 0.4, audioOut: 64, textIn: 4, textInCached: 0.4, textOut: 16 },
  "gpt-4o-realtime": { audioIn: 40, audioInCached: 2.5, audioOut: 80, textIn: 5, textInCached: 2.5, textOut: 20 },
  "gpt-realtime-mini": { audioIn: 10, audioInCached: 0.3, audioOut: 20, textIn: 0.6, textInCached: 0.06, textOut: 2.4 },
};

export function estimateTurnCostUsd(model: string, usage: any): number | undefined {
  const key = Object.keys(PRICING)
    .sort((x, y) => y.length - x.length)
    .find((k) => model.startsWith(k));
  if (!key || !usage) return undefined;
  const p = PRICING[key];
  const inDet = usage.input_token_details || {};
  const outDet = usage.output_token_details || {};
  const cachedDet = inDet.cached_tokens_details || {};
  const cachedAudio = cachedDet.audio_tokens ?? 0;
  const cachedText = cachedDet.text_tokens ?? (inDet.cached_tokens ?? 0) - cachedAudio;
  const audioIn = Math.max(0, (inDet.audio_tokens ?? 0) - cachedAudio);
  const textIn = Math.max(0, (inDet.text_tokens ?? 0) - Math.max(0, cachedText));
  const audioOut = outDet.audio_tokens ?? 0;
  const textOut = outDet.text_tokens ?? 0;
  return (
    (audioIn * p.audioIn +
      cachedAudio * p.audioInCached +
      textIn * p.textIn +
      Math.max(0, cachedText) * p.textInCached +
      audioOut * p.audioOut +
      textOut * p.textOut) /
    1_000_000
  );
}

// Exported for behavioral tests (handleMessage-driven, no network).
export class OpenAIRealtimeTranslationSession implements RealtimeTranslationSession {
  private ws: WebSocket | null = null;
  private listeners: Array<(ev: TranslationEvent) => void> = [];
  private connected = false;
  private closedEmitted = false;
  private model = DEFAULT_MODEL;
  private voice: string;
  private instructions: string;
  private config: RealtimeTranslationConfig;

  // Per-turn tracking
  private turnIndex = 0;
  private speechStartTs?: number;
  private speechEndTs?: number;
  private firstAudioTs?: number;
  private sourceTranscript = "";
  // item_id → source transcript. Input transcription is asynchronous and can
  // arrive after the response it belongs to (or around a later turn), so
  // attributed turns must read their transcript by item id — never from the
  // mutable "latest transcript" field.
  private transcriptsByItem = new Map<string, string>();
  private translatedTranscript = "";
  private audioOutBytes = 0;
  // Cumulative input bytes ever sent; per-turn input is attributed by
  // snapshotting this counter at speech_started (minus the VAD prefix window)
  // and at speech_stopped — so in-flight and prefix audio are counted.
  private totalInBytes = 0;
  private turnInStartBytes = 0;
  private turnInBytes = 0;
  // FIFO of committed user input item ids awaiting a response. Responses are
  // created in order after each committed user turn, so the oldest pending
  // item is the one the current response answers — a stable correlation the
  // evidence tooling uses instead of guessing by event order.
  private pendingUserItems: string[] = [];

  constructor(config: RealtimeTranslationConfig) {
    this.config = config;
    this.voice = config.voice || DEFAULT_VOICE;
    this.instructions = buildInterpreterInstructions(config.languages, {
      inputLang: config.sourceLangHint,
      outputLang: config.outputLanguage,
    });
  }

  onEvent(cb: (ev: TranslationEvent) => void): void {
    this.listeners.push(cb);
  }

  private emit(ev: TranslationEvent) {
    if (ev.type === "closed") {
      if (this.closedEmitted) return;
      this.closedEmitted = true;
    }
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (e) {
        log(`[Translator] listener error: ${(e as Error).message}`, "translator");
      }
    }
  }

  async connect(): Promise<void> {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.model)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}`,
    };
    // Older preview models still require the beta header; GA models do not.
    if (this.model.includes("preview")) headers["OpenAI-Beta"] = "realtime=v1";

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      this.ws = ws;
      const connectTimeout = setTimeout(() => {
        reject(new Error("OpenAI Realtime connect timeout (10s)"));
        try { ws.terminate(); } catch {}
      }, 10_000);
      ws.on("open", () => {
        clearTimeout(connectTimeout);
        this.connected = true;
        this.sendSessionUpdate();
        resolve();
      });
      ws.on("message", (data: Buffer) => {
        let msg: any;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        this.handleMessage(msg);
      });
      ws.on("error", (err: Error) => {
        clearTimeout(connectTimeout);
        log(`[Translator] OpenAI WS error: ${err.message}`, "translator");
        this.emit({ type: "error", message: err.message, fatal: !this.connected });
        if (!this.connected) reject(err);
      });
      ws.on("close", (code, reason) => {
        clearTimeout(connectTimeout);
        this.connected = false;
        log(`[Translator] OpenAI WS closed (${code} ${reason?.toString?.() || ""})`, "translator");
        this.emit({ type: "closed" });
      });
    });
  }

  private sendSessionUpdate() {
    // GA session shape. If the server rejects it we surface the error event
    // honestly — no silent downgrade.
    this.sendJson({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: this.instructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: this.config.inputFormat.sampleRateHz },
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
          output: {
            format: { type: "audio/pcm", rate: this.config.outputFormat.sampleRateHz },
            voice: this.voice,
          },
        },
      },
    });
  }

  private sendJson(obj: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendAudio(chunk: Buffer): void {
    if (!this.connected) return;
    this.totalInBytes += chunk.length;
    this.sendJson({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
  }

  private bytesToMs(bytes: number, rateHz: number): number {
    return Math.round((bytes / 2 / rateHz) * 1000); // pcm16 mono = 2 bytes/sample
  }

  private handleMessage(msg: any) {
    const t = msg.type as string;
    switch (t) {
      case "session.created":
        break;
      case "session.updated":
        this.emit({
          type: "ready",
          provider: "openai-realtime",
          model: this.model,
          voice: this.voice,
          instructions: this.instructions,
        });
        break;
      case "input_audio_buffer.speech_started": {
        const ts = Date.now();
        this.speechStartTs = ts;
        this.speechEndTs = undefined;
        this.firstAudioTs = undefined;
        // Attribute from the VAD prefix window (300ms) before speech_started.
        const prefixBytes = Math.round((300 / 1000) * this.config.inputFormat.sampleRateHz) * 2;
        this.turnInStartBytes = Math.max(0, this.totalInBytes - prefixBytes);
        this.emit({ type: "speech_started", ts });
        break;
      }
      case "input_audio_buffer.speech_stopped": {
        const ts = Date.now();
        this.speechEndTs = ts;
        this.turnInBytes = Math.max(0, this.totalInBytes - this.turnInStartBytes);
        this.emit({ type: "speech_stopped", ts });
        break;
      }
      case "input_audio_buffer.committed":
        // The user turn became a conversation item — queue it for response
        // attribution (see pendingUserItems).
        if (msg.item_id) this.pendingUserItems.push(msg.item_id);
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (msg.transcript) {
          this.sourceTranscript = msg.transcript;
          if (msg.item_id) this.transcriptsByItem.set(msg.item_id, msg.transcript);
          this.emit({ type: "source_transcript", text: msg.transcript, itemId: msg.item_id });
        }
        break;
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (msg.delta) {
          if (!this.firstAudioTs) this.firstAudioTs = Date.now();
          this.audioOutBytes += Buffer.byteLength(msg.delta, "base64");
          this.emit({ type: "translated_audio", base64: msg.delta });
        }
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (msg.delta) {
          this.translatedTranscript += msg.delta;
          this.emit({ type: "translated_transcript_delta", text: msg.delta });
        }
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (msg.transcript) {
          this.translatedTranscript = msg.transcript;
          this.emit({ type: "translated_transcript_done", text: msg.transcript });
        }
        break;
      case "response.done": {
        const st = msg.response?.status;
        const details = msg.response?.status_details || {};
        const cancelled = st === "cancelled";
        // Attribute this response to the oldest pending user item (FIFO).
        // Cancelled responses consume their item too — the interrupting
        // utterance gets its own response later. An empty queue leaves the
        // attribution honestly undefined (e.g. a truly unsolicited response).
        const sourceItemId = this.pendingUserItems.shift();
        if (st && st !== "completed") {
          log(
            `[Translator] response.done status=${st} details=${JSON.stringify(details)}`,
            "translator",
          );
          if (cancelled) {
            // Structured forensic event — the stand records playback state
            // and classifies it (VALID_BARGE_IN / FALSE_PREMATURE_CANCEL /
            // PLAYBACK_FEEDBACK / UNKNOWN). Not an error.
            this.emit({
              type: "response_cancelled",
              ts: Date.now(),
              reason: String(details.reason || "unknown"),
              sourceItemId,
            });
          } else {
            this.emit({
              type: "error",
              message: `response ${st}: ${JSON.stringify(details)}`,
              fatal: false,
            });
          }
        }
        const usage = msg.response?.usage;
        const metrics: TranslationTurnMetrics = {
          turnIndex: this.turnIndex++,
          speechStartTs: this.speechStartTs,
          speechEndTs: this.speechEndTs,
          firstTranslatedAudioTs: this.firstAudioTs,
          latencyMs:
            this.speechEndTs && this.firstAudioTs ? this.firstAudioTs - this.speechEndTs : undefined,
          // Attributed turns read strictly by item id; if the transcription
          // has not arrived yet this is honestly undefined (the client
          // reconciles late transcripts via sourceItemId). Only unattributed
          // responses fall back to the mutable latest-transcript field.
          sourceTranscript: sourceItemId
            ? this.transcriptsByItem.get(sourceItemId)
            : this.sourceTranscript || undefined,
          translatedTranscript: this.translatedTranscript || undefined,
          provider: "openai-realtime",
          model: this.model,
          voice: this.voice,
          audioInMs: this.turnInBytes
            ? this.bytesToMs(this.turnInBytes, this.config.inputFormat.sampleRateHz)
            : undefined,
          audioOutMs: this.audioOutBytes
            ? this.bytesToMs(this.audioOutBytes, this.config.outputFormat.sampleRateHz)
            : undefined,
          usage: usage || undefined,
          estimatedCostUsd: estimateTurnCostUsd(this.model, usage),
          cancelled: cancelled || undefined,
          cancelReason: cancelled ? String(details.reason || "unknown") : undefined,
          sourceItemId,
        };
        // Reset per-turn accumulators.
        this.sourceTranscript = "";
        this.translatedTranscript = "";
        this.audioOutBytes = 0;
        this.turnInBytes = 0;
        this.emit({ type: "turn_completed", metrics });
        break;
      }
      case "conversation.item.input_audio_transcription.failed":
        this.emit({
          type: "error",
          message: `input transcription failed: ${JSON.stringify(msg.error || {})}`,
          fatal: false,
        });
        break;
      case "error":
        log(`[Translator] OpenAI error: ${JSON.stringify(msg.error)}`, "translator");
        this.emit({ type: "error", message: JSON.stringify(msg.error || {}), fatal: false });
        break;
      default:
        if (process.env.TRANSLATOR_SPIKE_DEBUG) {
          log(`[Translator] event ${t}: ${JSON.stringify(msg).slice(0, 300)}`, "translator");
        }
        break;
    }
  }

  async stop(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "client stop");
    }
    this.connected = false;
  }

  cancel(): void {
    if (this.ws) {
      try { this.ws.terminate(); } catch {}
    }
    this.connected = false;
    this.emit({ type: "closed" });
  }
}

export const openaiRealtimeTranslationProvider: RealtimeTranslationProvider = {
  name: "openai-realtime",
  async startSession(config: RealtimeTranslationConfig): Promise<RealtimeTranslationSession> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set — cannot start translation session");
    }
    const session = new OpenAIRealtimeTranslationSession(config);
    await session.connect();
    return session;
  },
};
