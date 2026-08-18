// Provider-agnostic realtime voice translation boundary.
//
// Core code (and any future Translator screen / call integration) must depend
// ONLY on the types in this file — never on OpenAI-specific sessions, events
// or wire objects. OpenAI Realtime is just the first adapter behind this
// contract (see openaiRealtimeTranslator.ts).

/** PCM16 little-endian mono is the only encoding in the v1 contract. */
export interface AudioFormat {
  encoding: "pcm16";
  sampleRateHz: number;
}

export interface RealtimeTranslationConfig {
  /**
   * Bidirectional language pair (ISO 639-1), e.g. ["ru", "en"].
   * The provider auto-detects which side is being spoken and translates
   * into the other language.
   */
  languages: [string, string];
  /** "auto" (default) or a hint for the expected source language. */
  sourceLangHint?: "auto" | string;
  /** Provider-specific output voice id. Optional; provider picks a default. */
  voice?: string;
  inputFormat: AudioFormat;
  outputFormat: AudioFormat;
}

/** Per-turn metrics. Timestamps are epoch ms measured on OUR side. */
export interface TranslationTurnMetrics {
  turnIndex: number;
  speechStartTs?: number;
  speechEndTs?: number;
  firstTranslatedAudioTs?: number;
  /** speechEnd -> first translated audio, ms (the headline latency metric). */
  latencyMs?: number;
  sourceTranscript?: string;
  translatedTranscript?: string;
  provider: string;
  model: string;
  voice?: string;
  /** Approx audio durations, ms (derived from byte counts of PCM streams). */
  audioInMs?: number;
  audioOutMs?: number;
  /** Raw usage as reported by the provider (token counts etc). */
  usage?: Record<string, unknown>;
  /** Estimated cost in USD for this turn (undefined if not computable). */
  estimatedCostUsd?: number;
}

export type TranslationEvent =
  | { type: "ready"; provider: string; model: string; voice?: string; instructions: string }
  | { type: "speech_started"; ts: number }
  | { type: "speech_stopped"; ts: number }
  /** Translated audio chunk in the configured outputFormat, base64. */
  | { type: "translated_audio"; base64: string }
  | { type: "source_transcript"; text: string }
  | { type: "translated_transcript_delta"; text: string }
  | { type: "translated_transcript_done"; text: string }
  | { type: "turn_completed"; metrics: TranslationTurnMetrics }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "closed" };

export interface RealtimeTranslationSession {
  /** Streams raw input audio (config.inputFormat). Safe to call before ready. */
  sendAudio(chunk: Buffer): void;
  /** Graceful stop: flush and close. */
  stop(): Promise<void>;
  /** Immediate teardown (no flush). */
  cancel(): void;
  onEvent(cb: (ev: TranslationEvent) => void): void;
}

export interface RealtimeTranslationProvider {
  readonly name: string;
  startSession(config: RealtimeTranslationConfig): Promise<RealtimeTranslationSession>;
}
