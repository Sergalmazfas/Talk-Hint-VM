// Behavioral tests for the gpt-realtime-translate adapter (task #286).
// No network: the segmenter and session are exercised via their pure/event
// entry points (createSpeechSegmenter, handleMessage, finalizePendingTurn).
import { describe, it, expect } from "vitest";
import {
  createSpeechSegmenter,
  pcm16Rms,
  SEGMENTER_DEFAULTS,
  OpenAIRealtimeTranslateSession,
  TRANSLATE_CAPABILITIES,
  TRANSLATE_USD_PER_AUDIO_MINUTE,
} from "../translation/openaiRealtimeTranslateAdapter";
import { sanitizeSpikeControls, SPIKE_PROVIDERS, gatedFrameAction } from "../translation/spike";
import type { TranslationEvent } from "../translation/provider";

function pcmFrame(amp: number, ms = 40, rate = 24000): Buffer {
  const n = Math.round((ms / 1000) * rate);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(amp * 32767), i * 2);
  return buf;
}

describe("pcm16Rms", () => {
  it("is 0 for silence and ~amp for a constant signal", () => {
    expect(pcm16Rms(pcmFrame(0))).toBe(0);
    expect(pcm16Rms(pcmFrame(0.5))).toBeCloseTo(0.5, 2);
    expect(pcm16Rms(Buffer.alloc(0))).toBe(0);
  });
});

describe("createSpeechSegmenter", () => {
  const mk = () => createSpeechSegmenter({ openRms: 0.02, hangoverMs: 600 });

  it("opens on a voiced frame and closes after the hangover, backdating end to last voiced frame", () => {
    const seg = mk();
    let t = 1000;
    const open = seg.feed({ rms: 0.1, ts: t, durationMs: 40 });
    expect(open).toEqual({ transition: "speech_start", ts: 1000 });
    t += 40;
    expect(seg.feed({ rms: 0.1, ts: t, durationMs: 40 })).toBeNull();
    const lastVoicedEnd = t + 40; // 1080
    // silence begins
    for (t = 1080; t < 1080 + 560; t += 40) {
      expect(seg.feed({ rms: 0, ts: t, durationMs: 40 })).toBeNull();
    }
    const end = seg.feed({ rms: 0, ts: 1080 + 600, durationMs: 40 });
    expect(end).toEqual({ transition: "speech_end", startTs: 1000, endTs: lastVoicedEnd });
    expect(seg.active).toBe(false);
  });

  it("brief sub-hangover pauses do NOT split a segment (hesitation case)", () => {
    const seg = mk();
    seg.feed({ rms: 0.1, ts: 0, durationMs: 40 });
    // 400 ms pause — shorter than the 600 ms hangover
    for (let t = 40; t < 440; t += 40) expect(seg.feed({ rms: 0, ts: t, durationMs: 40 })).toBeNull();
    // speech resumes: still the SAME segment, no new speech_start
    expect(seg.feed({ rms: 0.1, ts: 440, durationMs: 40 })).toBeNull();
    expect(seg.active).toBe(true);
  });

  it("flush closes an open segment exactly once", () => {
    const seg = mk();
    seg.feed({ rms: 0.1, ts: 100, durationMs: 40 });
    expect(seg.flush(500)).toEqual({ startTs: 100, endTs: 140 });
    expect(seg.flush(600)).toBeNull();
  });

  it("pure silence never opens a segment", () => {
    const seg = mk();
    for (let t = 0; t < 4000; t += 40) expect(seg.feed({ rms: 0.001, ts: t, durationMs: 40 })).toBeNull();
    expect(seg.flush(4000)).toBeNull();
  });
});

describe("OpenAIRealtimeTranslateSession event mapping (no network)", () => {
  const config = {
    languages: ["ru", "en"] as [string, string],
    outputLanguage: "en",
    inputFormat: { encoding: "pcm16" as const, sampleRateHz: 24000 },
    outputFormat: { encoding: "pcm16" as const, sampleRateHz: 24000 },
  };

  function collect(s: OpenAIRealtimeTranslateSession): TranslationEvent[] {
    const evs: TranslationEvent[] = [];
    s.onEvent((e) => evs.push(e));
    return evs;
  }

  it("maps output audio + transcript deltas onto provider events", () => {
    const s = new OpenAIRealtimeTranslateSession(config);
    const evs = collect(s);
    const b64 = Buffer.alloc(9600).toString("base64"); // 200 ms of 24k pcm16
    s.handleMessage({ type: "session.output_audio.delta", delta: b64 });
    s.handleMessage({ type: "session.output_transcript.delta", delta: "Hel" });
    s.handleMessage({ type: "session.output_transcript.delta", delta: "lo" });
    expect(evs[0]).toMatchObject({ type: "translated_audio", base64: b64 });
    expect(evs[1]).toMatchObject({ type: "translated_transcript_delta", text: "Hel" });
    expect(evs[2]).toMatchObject({ type: "translated_transcript_delta", text: "lo" });
  });

  it("finalizePendingTurn emits transcripts + duration-based cost metrics", () => {
    const s = new OpenAIRealtimeTranslateSession(config) as any;
    const evs = collect(s);
    const t0 = Date.now();
    s.pending = { speechStartTs: t0, speechEndTs: t0 + 3000, audioInBytes: 24000 * 2 * 3 };
    s.handleMessage({ type: "session.input_transcript.delta", delta: "привет " });
    s.handleMessage({ type: "session.input_transcript.delta", delta: "мир" });
    s.handleMessage({ type: "session.output_transcript.delta", delta: "hello world" });
    s.handleMessage({ type: "session.output_audio.delta", delta: Buffer.alloc(9600).toString("base64") });
    s.finalizePendingTurn(t0 + 4000);
    const done = evs.find((e) => e.type === "turn_completed") as any;
    expect(done).toBeTruthy();
    expect(done.metrics.provider).toBe("openai-realtime-translate");
    expect(done.metrics.sourceTranscript).toBe("привет мир");
    expect(done.metrics.translatedTranscript).toBe("hello world");
    expect(done.metrics.audioInMs).toBe(3000);
    expect(done.metrics.audioOutMs).toBe(200);
    // latency = first output audio after speech end
    expect(done.metrics.firstTranslatedAudioTs).toBeGreaterThanOrEqual(t0);
    expect(done.metrics.latencyMs).toBeGreaterThanOrEqual(0);
    // duration-based pricing: 3 s of input audio
    expect(done.metrics.estimatedCostUsd).toBeCloseTo((3000 / 60000) * TRANSLATE_USD_PER_AUDIO_MINUTE, 8);
    // source_transcript surfaces the accumulated whisper text exactly once
    expect(evs.filter((e) => e.type === "source_transcript")).toHaveLength(1);
  });

  it("finalizePendingTurn is idempotent — one segment can never emit two turns", () => {
    const s = new OpenAIRealtimeTranslateSession(config) as any;
    const evs = collect(s);
    const t0 = Date.now();
    s.pending = { speechStartTs: t0, speechEndTs: t0 + 1000, audioInBytes: 48000 };
    s.finalizePendingTurn(t0 + 2000);
    s.finalizePendingTurn(t0 + 3000);
    expect(evs.filter((e) => e.type === "turn_completed")).toHaveLength(1);
  });

  it("output audio before speech end never backdates latency (no firstTranslatedAudioTs w/o speechEnd)", () => {
    const s = new OpenAIRealtimeTranslateSession(config) as any;
    collect(s);
    const t0 = Date.now();
    s.pending = { speechStartTs: t0, audioInBytes: 0 }; // still speaking
    s.handleMessage({ type: "session.output_audio.delta", delta: Buffer.alloc(9600).toString("base64") });
    expect(s.pending.firstTranslatedAudioTs).toBeUndefined();
  });

  it("provider error events are surfaced non-fatally", () => {
    const s = new OpenAIRealtimeTranslateSession(config);
    const evs = collect(s);
    s.handleMessage({ type: "error", error: { message: "boom" } });
    expect(evs[0]).toMatchObject({ type: "error", fatal: false });
  });
});

describe("capabilities + stand controls (task #286)", () => {
  it("declares the verified contract facts (no voice, no prompt, whisper companion)", () => {
    expect(TRANSLATE_CAPABILITIES.voiceSelection).toBe(false);
    expect(TRANSLATE_CAPABILITIES.customPrompt).toBe(false);
    expect(TRANSLATE_CAPABILITIES.sourceTranscriptBuiltIn).toBe(false);
    expect(TRANSLATE_CAPABILITIES.sourceTranscriptCompanion).toBe("gpt-realtime-whisper");
    expect(TRANSLATE_CAPABILITIES.turnLifecycle).toBe(false);
    expect(TRANSLATE_CAPABILITIES.cancellation).toBe(false);
  });

  it("mic gate NEVER creates timing gaps for the continuous-input provider", () => {
    // gpt-realtime-translate requires an unbroken 24 kHz stream including
    // silence. A gated frame must be replaced by zeroed silence, not dropped.
    expect(gatedFrameAction({ send: false, continuousInput: true })).toBe("silence");
    expect(gatedFrameAction({ send: true, continuousInput: true })).toBe("send");
    // the conversational provider keeps the original drop behavior
    expect(gatedFrameAction({ send: false, continuousInput: false })).toBe("drop");
    expect(gatedFrameAction({ send: true, continuousInput: false })).toBe("send");
    // Simulate a gated playback interval: every frame yields an action that
    // transmits SOMETHING for the continuous provider — zero omitted frames.
    const actions = Array.from({ length: 50 }, (_, i) =>
      gatedFrameAction({ send: i % 3 === 0, continuousInput: true }),
    );
    expect(actions.filter((a) => a === "drop")).toHaveLength(0);
  });

  it("continuous-input capability is declared so the stand can substitute silence", () => {
    expect(SPIKE_PROVIDERS["openai-realtime-translate"].capabilities.turnLifecycle).toBe(false);
    expect(SPIKE_PROVIDERS["openai-realtime"].capabilities.turnLifecycle).toBe(true);
  });

  it("sanitizeSpikeControls: provider allowlist fail-closes to the current adapter", () => {
    expect(sanitizeSpikeControls({ provider: "openai-realtime-translate" }).provider).toBe(
      "openai-realtime-translate",
    );
    expect(sanitizeSpikeControls({ provider: "evil" }).provider).toBe("openai-realtime");
    expect(sanitizeSpikeControls({}).provider).toBe("openai-realtime");
    expect(Object.keys(SPIKE_PROVIDERS).sort()).toEqual([
      "openai-realtime",
      "openai-realtime-translate",
    ]);
  });
});
