// Run #2 forensic — hard 1→1 invariant detectors in the adapter and the
// pure forensic analyzer (5 suspicions from the user's spec + first break).
// No network: the adapter is driven via handleMessage, the analyzer via a
// synthetic event log shaped like Run #2's self-conversation failure.
import { describe, it, expect } from "vitest";
import { OpenAIRealtimeTranslationSession } from "../translation/openaiRealtimeTranslator";
import type { TranslationEvent } from "../translation/provider";
import { analyzeForensicLog, type ForensicLogEntry } from "../translation/forensics";

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
