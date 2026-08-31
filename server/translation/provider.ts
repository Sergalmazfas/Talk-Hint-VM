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
  /**
   * Directed mode: translate EVERY utterance into this language (ISO 639-1).
   * Mixed-language input must yield ONE utterance in this language.
   * When unset, the provider runs bidirectional pair mode over `languages`.
   */
  outputLanguage?: string;
  /** Immutable output modality for the lifetime of this session. Defaults to audio. */
  outputMode?: "audio" | "text";
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
  firstTranslatedTextTs?: number;
  /** speechEnd -> first translated audio, ms (the headline latency metric). */
  latencyMs?: number;
  /** speechEnd -> first translated text delta, ms. */
  textLatencyMs?: number;
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
  /** True when the provider cancelled this response (e.g. barge-in). */
  cancelled?: boolean;
  /** Provider-reported cancellation reason (e.g. "turn_detected"). */
  cancelReason?: string;
  /**
   * Stable correlation id of the user input item this response answered
   * (provider conversation item id). Lets evidence tooling match source
   * utterance → translation/cancellation without event-order guessing.
   */
  sourceItemId?: string;
  /** Provider response id for this turn (correlates output events). */
  responseId?: string;
}

/**
 * Hard 1→1 invariant violations detected live by the adapter (forensic Run #2):
 * - RESPONSE_WITHOUT_SOURCE_TURN: a response was created with NO committed
 *   source turn awaiting translation (self-conversation / unsolicited output).
 * - MULTIPLE_RESPONSES_FOR_TURN: more than one response was created for one
 *   committed source turn (breaks "one source utterance → one translation").
 * - OUTPUT_AFTER_RESPONSE_DONE: audio/text output arrived for a response that
 *   already finished or was cancelled (cancelled response kept talking).
 */
export type InvariantViolationCode =
  | "RESPONSE_WITHOUT_SOURCE_TURN"
  | "MULTIPLE_RESPONSES_FOR_TURN"
  | "OUTPUT_AFTER_RESPONSE_DONE";

export type TranslationEvent =
  | { type: "ready"; provider: string; model: string; voice?: string; instructions: string }
  | { type: "speech_started"; ts: number }
  | { type: "speech_stopped"; ts: number }
  /** A user input turn was committed as a conversation item (forensic log). */
  | { type: "input_committed"; ts: number; itemId: string }
  /** The provider started generating a response (forensic log). */
  | { type: "response_created"; ts: number; responseId?: string; sourceItemId?: string }
  /** Translated audio chunk in the configured outputFormat, base64. */
  | { type: "translated_audio"; base64: string; responseId?: string }
  | { type: "source_transcript"; text: string; itemId?: string }
  | { type: "translated_transcript_delta"; text: string; responseId?: string }
  | { type: "translated_transcript_done"; text: string; responseId?: string }
  | { type: "turn_completed"; metrics: TranslationTurnMetrics }
  /** A response was cancelled by the provider (forensic evidence, not fatal). */
  | { type: "response_cancelled"; ts: number; reason: string; sourceItemId?: string; responseId?: string }
  /** Hard 1→1 invariant broken — structured forensic evidence, never silent. */
  | {
      type: "invariant_violation";
      ts: number;
      code: InvariantViolationCode;
      detail: string;
      itemId?: string;
      responseId?: string;
    }
  /**
   * A committed source turn was detected as a micro-turn (noise / breath /
   * fragment) and the response was cancelled before any audio was produced.
   * Reason "audio_too_short": the captured audio was below the minimum
   * duration threshold (MICROTURN_MIN_AUDIO_MS). Reason "transcript_empty":
   * the input transcription arrived while the response was still in-flight
   * and contained no meaningful text.
   */
  | {
      type: "suppressed_microturn";
      ts: number;
      itemId?: string;
      responseId?: string;
      reason: "audio_too_short" | "transcript_empty";
      audioMs?: number;
    }
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
