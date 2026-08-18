// Run #2 forensic — hard 1→1 invariant detectors in the adapter and the
// pure forensic analyzer (5 suspicions from the user's spec + first break).
// No network: the adapter is driven via handleMessage, the analyzer via a
// synthetic event log shaped like Run #2's self-conversation failure.
import { describe, it, expect } from "vitest";
import {
  OpenAIRealtimeTranslationSession,
  MICROTURN_MIN_AUDIO_MS,
} from "../translation/openaiRealtimeTranslator";
import type { TranslationEvent } from "../translation/provider";
import { analyzeForensicLog, type ForensicLogEntry } from "../translation/forensics";
import { createMicGate, MIC_GATE_TAIL_MS } from "../translation/spike";

function makeSession() {
  const session = new OpenAIRealtimeTranslationSession({
    languages: ["ru", "en"],
    sourceLangHint: "auto",
    outputLanguage: "en",
    inputFormat: { encoding: "pcm16", sampleRateHz: 24000 },
    outputFormat: { encoding: "pcm16", sampleRateHz: 24000 },
  });
  const events: TranslationEvent[] = [];
  session.onEvent((ev) => events.push(ev));
  const feed = (msg: any) => (session as any).handleMessage(msg);
  return { events, feed };
}

const violations = (events: TranslationEvent[]) =>
  events.filter((e) => e.type === "invariant_violation") as any[];

describe("adapter hard 1→1 invariants (live detectors)", () => {
  it("a clean turn (commit → one response → done) raises no violation", () => {
    const { events, feed } = makeSession();
    feed({ type: "input_audio_buffer.speech_started" });
    feed({ type: "input_audio_buffer.speech_stopped" });
    feed({ type: "input_audio_buffer.committed", item_id: "item_1" });
    feed({ type: "response.created", response: { id: "resp_1" } });
    feed({ type: "response.output_audio_transcript.done", transcript: "Hello.", response_id: "resp_1" });
    feed({ type: "response.done", response: { id: "resp_1", status: "completed", usage: {} } });
    expect(violations(events)).toHaveLength(0);
    // Forensic log events are emitted for the stand.
    expect(events.some((e) => e.type === "input_committed" && (e as any).itemId === "item_1")).toBe(true);
    const rc = events.find((e) => e.type === "response_created") as any;
    expect(rc.responseId).toBe("resp_1");
    expect(rc.sourceItemId).toBe("item_1");
  });

  it("RESPONSE_WITHOUT_SOURCE_TURN: a response with no committed turn pending is flagged", () => {
    const { events, feed } = makeSession();
    feed({ type: "response.created", response: { id: "resp_ghost" } });
    const v = violations(events);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("RESPONSE_WITHOUT_SOURCE_TURN");
    expect(v[0].responseId).toBe("resp_ghost");
  });

  it("MULTIPLE_RESPONSES_FOR_TURN: a second response for one committed turn is flagged", () => {
    const { events, feed } = makeSession();
    feed({ type: "input_audio_buffer.committed", item_id: "item_1" });
    feed({ type: "response.created", response: { id: "resp_1" } });
    feed({ type: "response.created", response: { id: "resp_2" } });
    const v = violations(events);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("MULTIPLE_RESPONSES_FOR_TURN");
    expect(v[0].itemId).toBe("item_1");
    expect(v[0].responseId).toBe("resp_2");
  });

  it("OUTPUT_AFTER_RESPONSE_DONE: output for a cancelled/finished response is flagged once", () => {
    const { events, feed } = makeSession();
    feed({ type: "input_audio_buffer.committed", item_id: "item_1" });
    feed({ type: "response.created", response: { id: "resp_1" } });
    feed({ type: "response.done", response: { id: "resp_1", status: "cancelled", status_details: { reason: "turn_detected" } } });
    // The "dead" response keeps talking:
    feed({ type: "response.output_audio.delta", delta: "QUJD", response_id: "resp_1" });
    feed({ type: "response.output_audio_transcript.delta", delta: "still talking", response_id: "resp_1" });
    const v = violations(events);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("OUTPUT_AFTER_RESPONSE_DONE");
    expect(v[0].responseId).toBe("resp_1");
    // The audio itself is still passed through honestly.
    expect(events.some((e) => e.type === "translated_audio")).toBe(true);
  });

  it("OUTPUT_AFTER_RESPONSE_DONE: a TERMINAL transcript.done arriving after response.done is flagged too", () => {
    const { events, feed } = makeSession();
    feed({ type: "input_audio_buffer.committed", item_id: "item_1" });
    feed({ type: "response.created", response: { id: "resp_1" } });
    feed({ type: "response.done", response: { id: "resp_1", status: "cancelled", status_details: { reason: "turn_detected" } } });
    feed({ type: "response.output_audio_transcript.done", transcript: "late final text", response_id: "resp_1" });
    const v = violations(events);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("OUTPUT_AFTER_RESPONSE_DONE");
    expect(v[0].responseId).toBe("resp_1");
  });

  it("normal barge-in (cancel then a fresh turn with its own response) stays violation-free", () => {
    const { events, feed } = makeSession();
    feed({ type: "input_audio_buffer.committed", item_id: "item_1" });
    feed({ type: "response.created", response: { id: "resp_1" } });
    feed({ type: "response.done", response: { id: "resp_1", status: "cancelled", status_details: { reason: "turn_detected" } } });
    feed({ type: "input_audio_buffer.committed", item_id: "item_2" });
    feed({ type: "response.created", response: { id: "resp_2" } });
    feed({ type: "response.done", response: { id: "resp_2", status: "completed", usage: {} } });
    expect(violations(events)).toHaveLength(0);
    const cancelled = events.find((e) => e.type === "response_cancelled") as any;
    expect(cancelled.responseId).toBe("resp_1");
  });
});

// ---------------------------------------------------------------------------
// Micro-turn suppression gate (Run #3 forensic: "hallucinated phrases on noise")
// ---------------------------------------------------------------------------

/**
 * Simulate sending audio bytes to the session without a real WebSocket.
 * Sets totalInBytes directly (the private accumulator) so the adapter
 * computes the right audioMs at commit time.
 */
function simulateAudioBytes(session: OpenAIRealtimeTranslationSession, bytes: number) {
  (session as any).totalInBytes = ((session as any).totalInBytes ?? 0) + bytes;
}

/** PCM16 bytes for a given duration at 24 kHz. */
function pcmBytes(ms: number, rateHz = 24000): number {
  return Math.round((ms / 1000) * rateHz * 2);
}

/** Make a fresh session (no network). */
function makeMicroturnSession() {
  const session = new OpenAIRealtimeTranslationSession({
    languages: ["ru", "en"],
    sourceLangHint: "auto",
    outputLanguage: "en",
    inputFormat: { encoding: "pcm16", sampleRateHz: 24000 },
    outputFormat: { encoding: "pcm16", sampleRateHz: 24000 },
  });
  const evts: TranslationEvent[] = [];
  session.onEvent((ev) => evts.push(ev));
  const inject = (msg: any) => (session as any).handleMessage(msg);
  return { session, evts, inject };
}

/**
 * Drive enough audio through totalInBytes so speech_started→speech_stopped
 * captures exactly `ms` of turn audio (after the 300ms VAD prefix window is
 * subtracted). With totalInBytes=0 at speech_started the prefix contributes
 * nothing, so turnInBytes = totalInBytes_at_speech_stopped.
 */
function setTurnAudio(session: OpenAIRealtimeTranslationSession, ms: number) {
  (session as any).totalInBytes = 0; // ensure no prior audio credited to prefix
  (session as any).handleMessage({ type: "input_audio_buffer.speech_started" });
  (session as any).totalInBytes = pcmBytes(ms);
  (session as any).handleMessage({ type: "input_audio_buffer.speech_stopped" });
}

describe("micro-turn suppression gate (Run #3: noise → hallucinated phrases)", () => {
  it("suppresses a response when captured audio is below MICROTURN_MIN_AUDIO_MS", () => {
    const { evts, inject } = makeMicroturnSession();

    // No audio sent → turnInBytes = 0 → audioMs = 0, which is below 700ms.
    inject({ type: "input_audio_buffer.speech_started" });
    inject({ type: "input_audio_buffer.speech_stopped" });
    inject({ type: "input_audio_buffer.committed", item_id: "item_noise" });
    inject({ type: "response.created", response: { id: "resp_noise" } });

    const suppressed = evts.filter((e) => e.type === "suppressed_microturn") as any[];
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].reason).toBe("audio_too_short");
    expect(suppressed[0].itemId).toBe("item_noise");
    expect(suppressed[0].responseId).toBe("resp_noise");
    expect(suppressed[0].audioMs).toBe(0);

    // No translated audio must be forwarded to the caller before suppression.
    expect(evts.filter((e) => e.type === "translated_audio")).toHaveLength(0);
  });

  it("audio deltas in-flight after suppression are discarded locally (post-cancel propagation)", () => {
    // Even if the provider delivers audio deltas before it processes response.cancel,
    // the adapter must NOT forward them to the caller.
    const { evts, inject } = makeMicroturnSession();

    inject({ type: "input_audio_buffer.speech_started" });
    inject({ type: "input_audio_buffer.speech_stopped" });
    inject({ type: "input_audio_buffer.committed", item_id: "item_noise" });
    inject({ type: "response.created", response: { id: "resp_noise" } });
    // Suppression already fired here. Now inject audio that arrived before the
    // provider acknowledged the cancel.
    inject({ type: "response.output_audio.delta", delta: "QUJD", response_id: "resp_noise" });
    inject({ type: "response.output_audio_transcript.delta", delta: "What about you?", response_id: "resp_noise" });
    inject({ type: "response.output_audio_transcript.done", transcript: "What about you?", response_id: "resp_noise" });

    // None of those must reach the caller.
    expect(evts.filter((e) => e.type === "translated_audio")).toHaveLength(0);
    expect(evts.filter((e) => e.type === "translated_transcript_delta")).toHaveLength(0);
    expect(evts.filter((e) => e.type === "translated_transcript_done")).toHaveLength(0);
  });

  it("does NOT suppress a response when audio is above MICROTURN_MIN_AUDIO_MS", () => {
    const { session, evts, inject } = makeMicroturnSession();
    // 800ms > 700ms threshold — must pass.
    setTurnAudio(session, 800);
    inject({ type: "input_audio_buffer.committed", item_id: "item_word" });
    inject({ type: "response.created", response: { id: "resp_word" } });

    expect(evts.filter((e) => e.type === "suppressed_microturn")).toHaveLength(0);
    expect(evts.filter((e) => e.type === "invariant_violation")).toHaveLength(0);
  });

  it("does NOT suppress at exactly MICROTURN_MIN_AUDIO_MS (strict less-than gate)", () => {
    // turnInBytes = pcmBytes(700) → audioMs = exactly 700ms → NOT < 700 → no suppress.
    const { session, evts, inject } = makeMicroturnSession();
    setTurnAudio(session, MICROTURN_MIN_AUDIO_MS); // exactly 700ms
    inject({ type: "input_audio_buffer.committed", item_id: "item_boundary" });
    inject({ type: "response.created", response: { id: "resp_boundary" } });

    expect(evts.filter((e) => e.type === "suppressed_microturn")).toHaveLength(0);
  });

  it("does NOT suppress short but meaningful phrases 'Да' or 'OK' via the transcript gate", () => {
    // False-positive guard: the transcript gate only fires on empty/whitespace.
    // Short real answers must NEVER be suppressed regardless of character count.
    for (const word of ["Да", "OK", "да", "ok"]) {
      const { session, evts, inject } = makeMicroturnSession();
      setTurnAudio(session, 800); // clear duration gate
      inject({ type: "input_audio_buffer.committed", item_id: "item_word" });
      inject({ type: "response.created", response: { id: "resp_word" } });
      inject({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "item_word",
        transcript: word,
      });
      expect(
        evts.filter((e) => e.type === "suppressed_microturn"),
        `"${word}" must not trigger suppression`,
      ).toHaveLength(0);
    }
  });

  it("suppresses via transcript gate when empty transcript arrives while response is active", () => {
    const { session, evts, inject } = makeMicroturnSession();
    // Clear duration gate with 1s of audio.
    setTurnAudio(session, 1000);
    inject({ type: "input_audio_buffer.committed", item_id: "item_breath" });
    inject({ type: "response.created", response: { id: "resp_breath" } });

    // Duration gate passed — no suppression yet.
    expect(evts.filter((e) => e.type === "suppressed_microturn")).toHaveLength(0);

    // Empty transcript arrives while response is still active.
    inject({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_breath",
      transcript: "",
    });

    const suppressed = evts.filter((e) => e.type === "suppressed_microturn") as any[];
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].reason).toBe("transcript_empty");
    expect(suppressed[0].itemId).toBe("item_breath");
    expect(suppressed[0].responseId).toBe("resp_breath");
  });

  it("whitespace-only transcript also triggers transcript gate suppression", () => {
    const { session, evts, inject } = makeMicroturnSession();
    setTurnAudio(session, 1000);
    inject({ type: "input_audio_buffer.committed", item_id: "item_ws" });
    inject({ type: "response.created", response: { id: "resp_ws" } });
    inject({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_ws",
      transcript: "   \n  ",
    });
    const suppressed = evts.filter((e) => e.type === "suppressed_microturn") as any[];
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].reason).toBe("transcript_empty");
  });

  it("does NOT suppress via transcript gate when transcript contains meaningful text", () => {
    const { session, evts, inject } = makeMicroturnSession();
    setTurnAudio(session, 1000);
    inject({ type: "input_audio_buffer.committed", item_id: "item_real" });
    inject({ type: "response.created", response: { id: "resp_real" } });
    inject({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_real",
      transcript: "Да, конечно.",
    });
    expect(evts.filter((e) => e.type === "suppressed_microturn")).toHaveLength(0);
  });

  it("suppression is idempotent: both gates firing for the same response emits one suppressed_microturn", () => {
    // Duration gate fires at response.created; then empty transcript arrives too.
    // Must emit exactly ONE suppressed_microturn for the response.
    const { evts, inject } = makeMicroturnSession();
    inject({ type: "input_audio_buffer.speech_started" });
    inject({ type: "input_audio_buffer.speech_stopped" });
    inject({ type: "input_audio_buffer.committed", item_id: "item_both" });
    inject({ type: "response.created", response: { id: "resp_both" } });
    // Duration gate already fired. Now transcript arrives empty too.
    inject({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_both",
      transcript: "",
    });
    expect(evts.filter((e) => e.type === "suppressed_microturn")).toHaveLength(1);
  });

  it("transcript gate only fires for the CURRENT response (head item) not a stale item", () => {
    const { session, evts, inject } = makeMicroturnSession();

    // Turn 1 — commits, gets a response, finishes.
    setTurnAudio(session, 1000);
    inject({ type: "input_audio_buffer.committed", item_id: "item_old" });
    inject({ type: "response.created", response: { id: "resp_old" } });
    inject({ type: "response.done", response: { id: "resp_old", status: "completed", usage: {} } });

    // Turn 2 — new turn active.
    setTurnAudio(session, 1000);
    inject({ type: "input_audio_buffer.committed", item_id: "item_new" });
    inject({ type: "response.created", response: { id: "resp_new" } });

    // Late empty transcript for the OLD item — must NOT trigger suppression
    // for the new active response.
    inject({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_old",
      transcript: "",
    });

    expect(evts.filter((e) => e.type === "suppressed_microturn")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Forensic analyzer — suppressed_microturn events appear in report counts
// ---------------------------------------------------------------------------

describe("forensic analyzer: suppressed_microturn events in report", () => {
  it("counts suppressed_microturn events in suppressedMicroturns field", () => {
    seq = 0;
    const log: ForensicLogEntry[] = [
      E("speech_started", { playbackActiveAtSpeechStart: false }),
      E("speech_stopped"),
      E("input_committed", { itemId: "item_1" }),
      E("response_created", { responseId: "resp_1", sourceItemId: "item_1" }),
      E("suppressed_microturn", { itemId: "item_1", responseId: "resp_1", reason: "audio_too_short", audioMs: 0 }),
      E("response_cancelled", { responseId: "resp_1", reason: "client" }),
    ];
    const r = analyzeForensicLog(log);
    expect(r.suppressedMicroturns).toBe(1);
    expect(r.suppressedMicroturnSeqs).toHaveLength(1);
  });

  it("returns suppressedMicroturns=0 on a clean log with no micro-turns", () => {
    seq = 0;
    const log: ForensicLogEntry[] = [
      E("speech_started", { playbackActiveAtSpeechStart: false }),
      E("speech_stopped"),
      E("input_committed", { itemId: "item_1" }),
      E("source_transcript", { itemId: "item_1", text: "Привет, как дела?" }),
      E("response_created", { responseId: "resp_1", sourceItemId: "item_1" }),
      E("translated_transcript_done", { responseId: "resp_1", text: "Hi, how are you?" }),
      E("turn_completed", { itemId: "item_1", responseId: "resp_1" }),
    ];
    const r = analyzeForensicLog(log);
    expect(r.suppressedMicroturns).toBe(0);
    expect(r.suppressedMicroturnSeqs).toHaveLength(0);
  });

  it("counts suppressed_microturn in truncated logs too (without claiming verdicts)", () => {
    seq = 0;
    const log: ForensicLogEntry[] = [
      E("suppressed_microturn", { itemId: "item_1", reason: "audio_too_short", audioMs: 0 }),
      E("suppressed_microturn", { itemId: "item_2", reason: "transcript_empty" }),
    ];
    const r = analyzeForensicLog(log, { truncated: true, droppedEntries: 5 });
    expect(r.truncated).toBe(true);
    expect(r.suppressedMicroturns).toBe(2);
    // Verdicts still INCONCLUSIVE (truncated).
    expect(r.suspicions.playbackRecapture.verdict).toBe("INCONCLUSIVE");
  });
});

// ---------------------------------------------------------------------------
// Forensic analyzer — Run #2-shaped replay. The log mirrors the reported
// failure: clean turn, then a translation whose playback re-opens VAD, ghost
// English continuations without source turns, and CJK noise microturns.
// ---------------------------------------------------------------------------

let seq = 0;
const E = (type: string, extra: Partial<ForensicLogEntry> = {}): ForensicLogEntry =>
  ({ seq: seq++, ts: 1000 + seq, type, ...extra }) as ForensicLogEntry;

function buildRun2Log(): ForensicLogEntry[] {
  seq = 0;
  return [
    // Turn 1 — clean 1→1.
    E("speech_started", { playbackActiveAtSpeechStart: false }),
    E("speech_stopped"),
    E("input_committed", { itemId: "item_1" }),
    E("source_transcript", { itemId: "item_1", text: "Сегодня мой друг рассказал мне страшную историю." }),
    E("response_created", { responseId: "resp_1", sourceItemId: "item_1" }),
    E("playback_start"),
    E("translated_transcript_done", { responseId: "resp_1", text: "Today my friend told me a scary story." }),
    E("turn_completed", { itemId: "item_1", responseId: "resp_1" }),
    E("playback_end"),
    // Turn 2 — source spoken, translation plays…
    E("speech_started", { playbackActiveAtSpeechStart: false }),
    E("speech_stopped"),
    E("input_committed", { itemId: "item_2" }),
    E("source_transcript", { itemId: "item_2", text: "После этого я не мог заснуть." }),
    E("response_created", { responseId: "resp_2", sourceItemId: "item_2" }),
    E("playback_start"),
    E("translated_transcript_done", { responseId: "resp_2", text: "After that, I couldn't sleep." }),
    E("turn_completed", { itemId: "item_2", responseId: "resp_2" }),
    // …and WHILE it is still playing, VAD opens a new "turn" — the mic hears
    // our own TTS. This is the first 1→1 break.
    E("speech_started", { playbackActiveAtSpeechStart: true }),
    E("speech_stopped"),
    E("input_committed", { itemId: "item_3" }),
    E("source_transcript", { itemId: "item_3", text: "I couldn't sleep." }), // echo of resp_2
    E("response_created", { responseId: "resp_3", sourceItemId: "item_3" }),
    E("translated_transcript_done", { responseId: "resp_3", text: "Hello." }),
    E("turn_completed", { itemId: "item_3", responseId: "resp_3" }),
    E("playback_end"),
    // Ghost continuation — a response with NO committed source turn.
    E("response_created", { responseId: "resp_4" }),
    E("invariant_violation", {
      code: "RESPONSE_WITHOUT_SOURCE_TURN",
      detail: "response created with no committed source turn pending",
      responseId: "resp_4",
    }),
    E("translated_transcript_done", { responseId: "resp_4", text: "I woke up at 3:30 in the morning." }),
    // Cancelled response keeps producing output.
    E("response_cancelled", { responseId: "resp_4", reason: "turn_detected" }),
    E("invariant_violation", { code: "OUTPUT_AFTER_RESPONSE_DONE", responseId: "resp_4" }),
    // Stale buffer: a commit right after a cancel with NO fresh speech_started.
    E("input_committed", { itemId: "item_4" }),
    // Noise microturn hallucinated as Japanese.
    E("source_transcript", { itemId: "item_4", text: "まぐれ、千に一人。" }),
  ];
}

describe("half-duplex mic gate (playback→mic feedback fix)", () => {
  it("blocks mic frames while playback is active and through the echo tail, then reopens", () => {
    const gate = createMicGate({ tailMs: MIC_GATE_TAIL_MS });
    // Before any playback: frames flow.
    expect(gate.feed({ playbackActive: false, msSinceLastPlaybackEnd: null, now: 1000 }).send).toBe(true);
    // Playback starts: gate closes with a transition event.
    const start = gate.feed({ playbackActive: true, msSinceLastPlaybackEnd: null, now: 2000 });
    expect(start.send).toBe(false);
    expect(start.transition).toBe("gate_start");
    // Still playing: gated, no duplicate transition.
    const mid = gate.feed({ playbackActive: true, msSinceLastPlaybackEnd: null, now: 2500 });
    expect(mid.send).toBe(false);
    expect(mid.transition).toBeNull();
    // Playback ended 100ms ago — inside the echo tail: still gated.
    expect(gate.feed({ playbackActive: false, msSinceLastPlaybackEnd: 100, now: 3100 }).send).toBe(false);
    // Tail elapsed: gate reopens and reports how long it was closed.
    const end = gate.feed({ playbackActive: false, msSinceLastPlaybackEnd: MIC_GATE_TAIL_MS, now: 3500 });
    expect(end.send).toBe(true);
    expect(end.transition).toBe("gate_end");
    expect(end.gatedMs).toBe(1500);
  });

  it("no leak window at playback end: scheduled-end (negative msSince) keeps gating before the end callback fires", () => {
    const gate = createMicGate({ tailMs: MIC_GATE_TAIL_MS });
    // Playback audibly active.
    expect(gate.feed({ playbackActive: true, msSinceLastPlaybackEnd: -400, now: 1000 }).send).toBe(false);
    // The audible flag already dropped (its 50ms margin) but scheduled end is
    // still 30ms in the future — the exact pre-onended boundary: must gate.
    expect(gate.feed({ playbackActive: false, msSinceLastPlaybackEnd: -30, now: 1370 }).send).toBe(false);
    // Scheduled end passed 10ms ago — echo tail: still gated.
    expect(gate.feed({ playbackActive: false, msSinceLastPlaybackEnd: 10, now: 1410 }).send).toBe(false);
    // Tail elapsed: reopen.
    expect(gate.feed({ playbackActive: false, msSinceLastPlaybackEnd: MIC_GATE_TAIL_MS + 1, now: 1800 }).send).toBe(true);
  });

  it("run-boundary close finalizes the open interval and the next run starts with a fresh gate_start", () => {
    const gate = createMicGate({ tailMs: MIC_GATE_TAIL_MS });
    // Gate opens mid-run.
    expect(gate.feed({ playbackActive: true, msSinceLastPlaybackEnd: -500, now: 5000 }).transition).toBe("gate_start");
    // Archive/control-change boundary force-closes it (as archiveCurrentRun does).
    const close = gate.feed({ playbackActive: false, msSinceLastPlaybackEnd: Number.MAX_SAFE_INTEGER, now: 5600 });
    expect(close.transition).toBe("gate_end");
    expect(close.gatedMs).toBe(600);
    // New run: no orphan gate_end; the next gating starts a paired interval.
    const next = gate.feed({ playbackActive: true, msSinceLastPlaybackEnd: -100, now: 9000 });
    expect(next.transition).toBe("gate_start");
    expect(next.send).toBe(false);
  });

  it("a gated interval never produces a committed source turn", () => {
    // The gate sits before the websocket send: only frames with send=true
    // reach the provider adapter. Pump a playback window through gate +
    // adapter and prove zero committed turns came from the gated interval.
    const gate = createMicGate({ tailMs: MIC_GATE_TAIL_MS });
    const session = new OpenAIRealtimeTranslationSession({
      languages: ["ru", "en"],
      sourceLangHint: "auto",
      outputLanguage: "en",
      inputFormat: { encoding: "pcm16", sampleRateHz: 24000 },
      outputFormat: { encoding: "pcm16", sampleRateHz: 24000 },
    });
    const events: TranslationEvent[] = [];
    session.onEvent((ev) => events.push(ev));
    const feedProvider = (msg: any) => (session as any).handleMessage(msg);

    let framesSent = 0;
    // 25 frames (1s) while our own translation is playing — the exact
    // feedback window from Run #2.
    for (let i = 0; i < 25; i++) {
      const g = gate.feed({ playbackActive: true, msSinceLastPlaybackEnd: null, now: 10000 + i * 40 });
      if (g.send) {
        framesSent++;
        // If audio HAD been sent, server VAD could open a feedback turn:
        feedProvider({ type: "input_audio_buffer.speech_started" });
        feedProvider({ type: "input_audio_buffer.committed", item_id: "feedback_item" });
      }
    }
    expect(framesSent).toBe(0);
    expect(events.filter((e) => e.type === "speech_started")).toHaveLength(0);
    expect(events.filter((e) => (e as any).type === "input_committed")).toHaveLength(0);
  });

  it("gate_start/gate_end entries pass through the analyzer without breaking a clean verdict", () => {
    let seq = 0;
    const e = (type: string, extra: Record<string, unknown> = {}): ForensicLogEntry =>
      ({ seq: seq++, ts: 1000 + seq, type, ...extra }) as ForensicLogEntry;
    const log: ForensicLogEntry[] = [
      e("speech_started", { playbackActive: false, playbackActiveAtSpeechStart: false }),
      e("speech_stopped"),
      e("input_committed", { itemId: "i1" }),
      e("source_transcript", { itemId: "i1", text: "Привет, как дела?" }),
      e("response_created", { responseId: "r1", sourceItemId: "i1" }),
      e("translated_transcript_done", { responseId: "r1", text: "Hi, how are you?" }),
      e("playback_start"),
      e("gate_start"),
      e("turn_completed", { responseId: "r1", sourceItemId: "i1" }),
      e("playback_end"),
      e("gate_end", { gatedMs: 1200 }),
    ];
    const report = analyzeForensicLog(log);
    expect(report.truncated).toBe(false);
    expect(report.firstOneToOneBreak).toBeNull();
    expect(report.suspicions.playbackRecapture.verdict).not.toBe("PROVEN");
  });
});

describe("forensic analyzer on a Run #2-shaped log", () => {
  const report = analyzeForensicLog(buildRun2Log());

  it("proves suspicion 1: playback re-captured by microphone", () => {
    const s = report.suspicions.playbackRecapture;
    expect(s.verdict).toBe("PROVEN");
    expect(s.explanation).toContain("re-captured");
    expect(s.evidenceSeqs.length).toBeGreaterThan(0);
  });

  it("proves suspicion 2: cancelled response continued producing output", () => {
    expect(report.suspicions.cancelledResponseContinuedOutput.verdict).toBe("PROVEN");
  });

  it("proves suspicion 3: responses without / beyond their source turn", () => {
    expect(report.suspicions.multipleResponsesPerTurn.verdict).toBe("PROVEN");
  });

  it("proves suspicion 4: input buffer not cleared after cancellation", () => {
    expect(report.suspicions.inputBufferNotClearedAfterCancel.verdict).toBe("PROVEN");
  });

  it("proves suspicion 5: noise microturns committed as multilingual turns", () => {
    expect(report.suspicions.noiseMicroturnsCommittedMultilingual.verdict).toBe("PROVEN");
  });

  it("pinpoints the FIRST 1→1 break: the feedback-born turn, not the later ghost response", () => {
    const b = report.firstOneToOneBreak!;
    expect(b).toBeTruthy();
    expect(b.kind).toBe("PLAYBACK_FEEDBACK_TURN");
    expect(b.itemId).toBe("item_3");
    // The causal chain includes the surrounding events for the report.
    expect(b.chain.join("\n")).toContain("speech_started");
    expect(b.chain.join("\n")).toContain("playback@speechStart=true");
  });
});

describe("forensic analyzer on a clean log (invariant holds)", () => {
  it("disproves all suspicions and reports no 1→1 break", () => {
    seq = 0;
    const clean: ForensicLogEntry[] = [
      E("speech_started", { playbackActiveAtSpeechStart: false }),
      E("speech_stopped"),
      E("input_committed", { itemId: "item_1" }),
      E("source_transcript", { itemId: "item_1", text: "Привет, как дела?" }),
      E("response_created", { responseId: "resp_1", sourceItemId: "item_1" }),
      E("playback_start"),
      E("translated_transcript_done", { responseId: "resp_1", text: "Hi, how are you?" }),
      E("turn_completed", { itemId: "item_1", responseId: "resp_1" }),
      E("playback_end"),
      // A legitimate barge-in: fresh speech BEFORE the commit.
      E("speech_started", { playbackActiveAtSpeechStart: false }),
      E("response_cancelled", { responseId: "resp_2", reason: "turn_detected" }),
      E("speech_stopped"),
      E("input_committed", { itemId: "item_2" }),
      E("source_transcript", { itemId: "item_2", text: "Подожди секунду." }),
      E("response_created", { responseId: "resp_3", sourceItemId: "item_2" }),
      E("translated_transcript_done", { responseId: "resp_3", text: "Wait a second." }),
      E("turn_completed", { itemId: "item_2", responseId: "resp_3" }),
    ];
    const r = analyzeForensicLog(clean);
    expect(r.suspicions.playbackRecapture.verdict).toBe("DISPROVEN");
    expect(r.suspicions.cancelledResponseContinuedOutput.verdict).toBe("DISPROVEN");
    expect(r.suspicions.multipleResponsesPerTurn.verdict).toBe("DISPROVEN");
    expect(r.suspicions.inputBufferNotClearedAfterCancel.verdict).toBe("DISPROVEN");
    expect(r.suspicions.noiseMicroturnsCommittedMultilingual.verdict).toBe("DISPROVEN");
    expect(r.firstOneToOneBreak).toBeNull();
  });

  it("fail-closed: incomplete response↔source attribution is INCONCLUSIVE, never DISPROVEN", () => {
    seq = 0;
    const log: ForensicLogEntry[] = [
      E("input_committed", { itemId: "item_1" }),
      // response_created lost its sourceItemId (malformed/incomplete log) —
      // no adapter violation was emitted either.
      E("response_created", { responseId: "resp_1" }),
      E("turn_completed", { itemId: "item_1", responseId: "resp_1" }),
    ];
    const r = analyzeForensicLog(log);
    expect(r.suspicions.multipleResponsesPerTurn.verdict).toBe("INCONCLUSIVE");
    expect(r.suspicions.multipleResponsesPerTurn.explanation).toContain("fail-closed");
  });

  it("fail-closed: output events without response ids block a clean post-done verdict", () => {
    seq = 0;
    const log: ForensicLogEntry[] = [
      E("input_committed", { itemId: "item_1" }),
      E("response_created", { responseId: "resp_1", sourceItemId: "item_1" }),
      E("translated_transcript_done", { text: "Hello." }), // no responseId
      E("turn_completed", { itemId: "item_1", responseId: "resp_1" }),
    ];
    const r = analyzeForensicLog(log);
    expect(r.suspicions.cancelledResponseContinuedOutput.verdict).toBe("INCONCLUSIVE");
  });

  it("counts >1 attributed response per item as PROVEN even without an adapter violation event", () => {
    seq = 0;
    const log: ForensicLogEntry[] = [
      E("input_committed", { itemId: "item_1" }),
      E("response_created", { responseId: "resp_1", sourceItemId: "item_1" }),
      E("response_created", { responseId: "resp_2", sourceItemId: "item_1" }),
    ];
    const r = analyzeForensicLog(log);
    expect(r.suspicions.multipleResponsesPerTurn.verdict).toBe("PROVEN");
  });

  it("an empty log is honestly INCONCLUSIVE, never a silent pass", () => {
    const r = analyzeForensicLog([]);
    expect(r.suspicions.playbackRecapture.verdict).toBe("INCONCLUSIVE");
    expect(r.suspicions.cancelledResponseContinuedOutput.verdict).toBe("INCONCLUSIVE");
    expect(r.suspicions.noiseMicroturnsCommittedMultilingual.verdict).toBe("INCONCLUSIVE");
  });
});

describe("truncated evidence fail-closes everything", () => {
  it("a truncated log yields only INCONCLUSIVE verdicts and NO first-break claim, even when the remaining entries look damning", () => {
    // Same log that proves all 5 suspicions when complete…
    const full = analyzeForensicLog(buildRun2Log());
    expect(full.truncated).toBe(false);
    expect(full.firstOneToOneBreak).not.toBeNull();
    // …but with dropped entries the actual FIRST break may be missing.
    const r = analyzeForensicLog(buildRun2Log(), { truncated: true, droppedEntries: 12 });
    expect(r.truncated).toBe(true);
    expect(r.droppedEntries).toBe(12);
    expect(r.firstOneToOneBreak).toBeNull();
    for (const s of Object.values(r.suspicions)) {
      expect(s.verdict).toBe("INCONCLUSIVE");
      expect(s.explanation).toContain("incomplete");
    }
  });

  it("droppedEntries > 0 alone marks the analysis truncated", () => {
    const r = analyzeForensicLog(buildRun2Log(), { droppedEntries: 1 });
    expect(r.truncated).toBe(true);
    expect(r.firstOneToOneBreak).toBeNull();
  });
});
