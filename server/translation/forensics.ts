// Run #2 forensic analyzer — "self-conversation / session feedback loop".
//
// Input: the FULL ordered event log recorded by the /translator-spike stand
// (server-relayed provider events enriched client-side with playback state,
// plus client-only entries: mic_audio, playback_start/playback_end).
//
// Output: a verdict for each of the 5 suspicions from the user's spec, plus
// the FIRST turn where the hard rule "one committed source turn → at most one
// translation response" broke, with the causal chain of surrounding events.
//
// Pure function — no network, no state — so tests can replay a Run #2-shaped
// sequence and the stand's /translator-spike/analyze endpoint can run it on a
// live export. Fail-closed: absence of the needed evidence yields
// INCONCLUSIVE, never a silent PASS.

export interface ForensicLogEntry {
  /** Monotonic sequence number assigned by the stand at record time. */
  seq: number;
  /** Client wall-clock ms at record time. */
  ts: number;
  /** Event type (provider event types + mic_audio/playback_start/playback_end). */
  type: string;
  /** Was translated audio audibly playing when this event was recorded? */
  playbackActive?: boolean;
  /** speech_started only: playback was still audible when VAD opened a turn. */
  playbackActiveAtSpeechStart?: boolean;
  itemId?: string;
  responseId?: string;
  sourceItemId?: string;
  text?: string;
  reason?: string;
  code?: string;
  detail?: string;
  [k: string]: unknown;
}

export type SuspicionVerdict = "PROVEN" | "DISPROVEN" | "INCONCLUSIVE";

export interface SuspicionResult {
  verdict: SuspicionVerdict;
  /** seq numbers of the log entries that prove/refute it. */
  evidenceSeqs: number[];
  explanation: string;
}

export interface OneToOneBreak {
  seq: number;
  kind:
    | "RESPONSE_WITHOUT_SOURCE_TURN"
    | "MULTIPLE_RESPONSES_FOR_TURN"
    | "PLAYBACK_FEEDBACK_TURN"
    | "OUTPUT_AFTER_RESPONSE_DONE";
  itemId?: string;
  responseId?: string;
  /** Human-readable causal chain reconstructed from surrounding events. */
  chain: string[];
}

export interface ForensicAnalyzeOptions {
  /** True when ANY entries were dropped/omitted before analysis. */
  truncated?: boolean;
  /** How many entries are known to be missing (when known). */
  droppedEntries?: number;
}

export interface ForensicReport {
  totalEntries: number;
  /** True when the log is known-incomplete; all verdicts are INCONCLUSIVE. */
  truncated: boolean;
  droppedEntries?: number;
  truncationNote?: string;
  committedSourceTurns: number;
  responsesCreated: number;
  /**
   * Count of `suppressed_microturn` events in the log: turns whose response
   * was cancelled before any audio was produced (audio too short or empty
   * transcript arrived while the response was still active).
   */
  suppressedMicroturns: number;
  /** seq numbers of all suppressed_microturn events (for scorecard linking). */
  suppressedMicroturnSeqs: number[];
  suspicions: {
    playbackRecapture: SuspicionResult;
    cancelledResponseContinuedOutput: SuspicionResult;
    multipleResponsesPerTurn: SuspicionResult;
    inputBufferNotClearedAfterCancel: SuspicionResult;
    noiseMicroturnsCommittedMultilingual: SuspicionResult;
  };
  /** First event where the 1 source turn → 1 response rule broke; null = held. */
  firstOneToOneBreak: OneToOneBreak | null;
}

// Script detection for the "hallucinated multilingual microturns" suspicion:
// Run #2 was ru/en/es — any CJK / kana / hangul in a committed transcript is
// outside every configured language.
const NON_LATIN_CYRILLIC_SCRIPTS =
  /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

function isMeaningfulText(t: string | undefined): boolean {
  if (!t) return false;
  // Count letter/number characters without ES2018 unicode property escapes
  // (repo tsconfig targets ES5): non-space, non-punctuation approximation.
  const stripped = t.replace(/[\s.,!?;:'"«»()\-—–…]/g, "");
  return stripped.length >= 3;
}

export function analyzeForensicLog(
  entries: ForensicLogEntry[],
  opts?: ForensicAnalyzeOptions,
): ForensicReport {
  const bySeq = entries.slice().sort((a, b) => a.seq - b.seq);
  // Fail-closed on incomplete evidence: a truncated log may have lost the
  // ACTUAL first break or the events that would prove/disprove a suspicion.
  // No verdict and no first-break claim may be made from partial evidence.
  const truncated = !!opts?.truncated || (opts?.droppedEntries ?? 0) > 0;
  if (truncated) {
    const note =
      `event log is incomplete (${opts?.droppedEntries ?? "unknown number of"} entries dropped) — ` +
      `all verdicts are INCONCLUSIVE and no first 1→1 break can be claimed from partial evidence`;
    const inc = (what: string): SuspicionResult => ({
      verdict: "INCONCLUSIVE",
      evidenceSeqs: [],
      explanation: `${what}: ${note}`,
    });
    const suppressedEntries = bySeq.filter((e) => e.type === "suppressed_microturn");
    return {
      totalEntries: bySeq.length,
      truncated: true,
      droppedEntries: opts?.droppedEntries,
      truncationNote: note,
      committedSourceTurns: bySeq.filter((e) => e.type === "input_committed").length,
      responsesCreated: bySeq.filter((e) => e.type === "response_created").length,
      suppressedMicroturns: suppressedEntries.length,
      suppressedMicroturnSeqs: suppressedEntries.map((e) => e.seq),
      suspicions: {
        playbackRecapture: inc("playback recapture"),
        cancelledResponseContinuedOutput: inc("cancelled response continued output"),
        multipleResponsesPerTurn: inc("multiple responses per turn"),
        inputBufferNotClearedAfterCancel: inc("input buffer not cleared"),
        noiseMicroturnsCommittedMultilingual: inc("noise microturns"),
      },
      firstOneToOneBreak: null,
    };
  }

  // ---- index basic streams -------------------------------------------------
  const committed = bySeq.filter((e) => e.type === "input_committed");
  const responsesCreated = bySeq.filter((e) => e.type === "response_created");
  const speechStarts = bySeq.filter((e) => e.type === "speech_started");
  const transcriptsByItem = new Map<string, ForensicLogEntry>();
  for (const e of bySeq) {
    if (e.type === "source_transcript" && e.itemId) transcriptsByItem.set(e.itemId, e);
  }
  const translationTexts: { seq: number; text: string }[] = [];
  for (const e of bySeq) {
    if (e.type === "translated_transcript_done" && typeof e.text === "string") {
      translationTexts.push({ seq: e.seq, text: e.text });
    }
  }

  // For each committed item, find the nearest preceding speech_started —
  // that is the VAD window that produced this turn.
  const speechStartForCommit = (commit: ForensicLogEntry) => {
    let best: ForensicLogEntry | undefined;
    for (const s of speechStarts) {
      if (s.seq < commit.seq && (!best || s.seq > best.seq)) best = s;
    }
    return best;
  };

  // ---- Suspicion 1: playback re-captured by microphone ----------------------
  // Proof shape: a source turn whose VAD window opened WHILE translated audio
  // was audibly playing, and whose transcript matches (prefix/substring) a
  // recent translation text — i.e. the mic heard our own TTS.
  const s1Evidence: number[] = [];
  let s1Explanation = "";
  for (const c of committed) {
    const s = c.itemId ? speechStartForCommit(c) : undefined;
    const startedDuringPlayback = !!(s && (s.playbackActiveAtSpeechStart ?? s.playbackActive));
    if (!startedDuringPlayback) continue;
    const tr = c.itemId ? transcriptsByItem.get(c.itemId) : undefined;
    const echoOfOwnOutput =
      !!tr?.text &&
      translationTexts.some(
        (t) =>
          t.seq < tr.seq &&
          (t.text.toLowerCase().includes(String(tr.text).toLowerCase().slice(0, 24)) ||
            String(tr.text).toLowerCase().includes(t.text.toLowerCase().slice(0, 24))),
      );
    s1Evidence.push(s!.seq, c.seq);
    if (tr) s1Evidence.push(tr.seq);
    if (echoOfOwnOutput) {
      s1Explanation = `source turn ${c.itemId} opened while playback was active AND its transcript matches our own prior translation output — mic re-captured TTS playback`;
      break;
    }
    s1Explanation = `source turn ${c.itemId} opened while translated audio was still playing (transcript match not confirmed)`;
  }
  const playbackRecapture: SuspicionResult = s1Evidence.length
    ? {
        verdict: s1Explanation.includes("re-captured") ? "PROVEN" : "INCONCLUSIVE",
        evidenceSeqs: dedupe(s1Evidence),
        explanation: s1Explanation,
      }
    : speechStarts.length
      ? {
          verdict: "DISPROVEN",
          evidenceSeqs: speechStarts.map((s) => s.seq),
          explanation: "no committed source turn opened while translated audio was playing",
        }
      : { verdict: "INCONCLUSIVE", evidenceSeqs: [], explanation: "no speech_started events in log" };

  // ---- Suspicion 2: cancelled response remained active / kept producing -----
  const s2Violations = bySeq.filter(
    (e) => e.type === "invariant_violation" && e.code === "OUTPUT_AFTER_RESPONSE_DONE",
  );
  const anyResponseDone = bySeq.some(
    (e) => e.type === "turn_completed" || e.type === "response_cancelled",
  );
  // Fail-closed: a DISPROVEN requires the output events to actually carry
  // response ids — an uncorrelated log must never be exported as clean.
  const outputEvents = bySeq.filter(
    (e) =>
      e.type === "translated_audio" ||
      e.type === "translated_transcript_delta" ||
      e.type === "translated_transcript_done",
  );
  const uncorrelatedOutput = outputEvents.filter((e) => !e.responseId);
  const cancelledResponseContinuedOutput: SuspicionResult = s2Violations.length
    ? {
        verdict: "PROVEN",
        evidenceSeqs: s2Violations.map((e) => e.seq),
        explanation: "output events arrived for already-finished/cancelled response ids",
      }
    : !anyResponseDone
      ? { verdict: "INCONCLUSIVE", evidenceSeqs: [], explanation: "no finished responses in log" }
      : uncorrelatedOutput.length
        ? {
            verdict: "INCONCLUSIVE",
            evidenceSeqs: uncorrelatedOutput.slice(0, 20).map((e) => e.seq),
            explanation:
              "some output events carry no response id — post-done output cannot be ruled out (fail-closed)",
          }
        : {
            verdict: "DISPROVEN",
            evidenceSeqs: [],
            explanation:
              "every output event carried the id of a still-open response; no post-done output detected",
          };

  // ---- Suspicion 3: one source turn generated multiple responses ------------
  const s3Violations = bySeq.filter(
    (e) =>
      e.type === "invariant_violation" &&
      (e.code === "MULTIPLE_RESPONSES_FOR_TURN" || e.code === "RESPONSE_WITHOUT_SOURCE_TURN"),
  );
  // Fail-closed 1→1 validation, independent of adapter-emitted violations:
  // every response must be attributed to a committed item, and no item may
  // carry more than one response. Missing attribution ⇒ INCONCLUSIVE, never
  // a clean verdict.
  const committedIds = new Set(committed.map((c) => String(c.itemId)));
  const unattributed = responsesCreated.filter(
    (r) => !r.sourceItemId || !committedIds.has(String(r.sourceItemId)),
  );
  const responseCountByItem = new Map<string, number>();
  for (const r of responsesCreated) {
    if (r.sourceItemId) {
      const k = String(r.sourceItemId);
      responseCountByItem.set(k, (responseCountByItem.get(k) || 0) + 1);
    }
  }
  const overOne: number[] = [];
  responseCountByItem.forEach((n, itemId) => {
    if (n > 1) {
      for (const r of responsesCreated) {
        if (String(r.sourceItemId) === itemId) overOne.push(r.seq);
      }
    }
  });
  const multipleResponsesPerTurn: SuspicionResult =
    s3Violations.length || overOne.length
      ? {
          verdict: "PROVEN",
          evidenceSeqs: dedupe([...s3Violations.map((e) => e.seq), ...overOne]),
          explanation:
            "responses were created either without any committed source turn or repeatedly for the same turn",
        }
      : !responsesCreated.length
        ? { verdict: "INCONCLUSIVE", evidenceSeqs: [], explanation: "no response_created events in log" }
        : unattributed.length || responsesCreated.length > committed.length
          ? {
              verdict: "INCONCLUSIVE",
              evidenceSeqs: unattributed.slice(0, 20).map((e) => e.seq),
              explanation:
                "response↔source attribution is incomplete (responses without a matching committed item) — 1→1 cannot be confirmed (fail-closed)",
            }
          : {
              verdict: "DISPROVEN",
              evidenceSeqs: responsesCreated.map((e) => e.seq),
              explanation: `${responsesCreated.length} responses for ${committed.length} committed turns, all attributed 1→1`,
            };

  // ---- Suspicion 4: input buffer not cleared after cancellation -------------
  // Proof shape: after a response_cancelled, a turn is COMMITTED without any
  // new speech_started in between (stale buffered audio became a turn).
  const s4Evidence: number[] = [];
  const cancels = bySeq.filter((e) => e.type === "response_cancelled");
  for (const cx of cancels) {
    const nextCommit = committed.find((c) => c.seq > cx.seq);
    if (!nextCommit) continue;
    const freshSpeech = speechStarts.some((s) => s.seq > cx.seq && s.seq < nextCommit.seq);
    // speech_started may legitimately precede the cancel (barge-in): accept a
    // speech_started after the PREVIOUS commit as fresh too.
    const prevCommit = [...committed].reverse().find((c) => c.seq < nextCommit.seq);
    const freshSincePrev = speechStarts.some(
      (s) => s.seq > (prevCommit?.seq ?? -1) && s.seq < nextCommit.seq,
    );
    if (!freshSpeech && !freshSincePrev) s4Evidence.push(cx.seq, nextCommit.seq);
  }
  const inputBufferNotClearedAfterCancel: SuspicionResult = s4Evidence.length
    ? {
        verdict: "PROVEN",
        evidenceSeqs: dedupe(s4Evidence),
        explanation:
          "a turn was committed after a cancellation without any new speech_started — stale input audio became a turn",
      }
    : cancels.length
      ? {
          verdict: "DISPROVEN",
          evidenceSeqs: cancels.map((e) => e.seq),
          explanation: "every post-cancellation commit was preceded by fresh speech_started",
        }
      : { verdict: "INCONCLUSIVE", evidenceSeqs: [], explanation: "no cancellations in log" };

  // ---- Suspicion 5: noise microturns committed as multilingual turns --------
  const s5Evidence: number[] = [];
  transcriptsByItem.forEach((tr, itemId) => {
    const text = String(tr.text || "");
    const foreignScript = NON_LATIN_CYRILLIC_SCRIPTS.test(text);
    const commit = committed.find((c) => c.itemId === itemId);
    if (foreignScript || (!isMeaningfulText(text) && commit)) {
      s5Evidence.push(tr.seq);
      if (commit) s5Evidence.push(commit.seq);
    }
  });
  const noiseMicroturnsCommittedMultilingual: SuspicionResult = s5Evidence.length
    ? {
        verdict: "PROVEN",
        evidenceSeqs: dedupe(s5Evidence),
        explanation:
          "committed turns transcribed in scripts outside the configured languages (or non-meaningful noise) — STT hallucination on noise/fragment audio",
      }
    : transcriptsByItem.size
      ? {
          verdict: "DISPROVEN",
          evidenceSeqs: [],
          explanation: "all committed transcripts are meaningful and in configured-language scripts",
        }
      : { verdict: "INCONCLUSIVE", evidenceSeqs: [], explanation: "no source transcripts in log" };

  // ---- First 1→1 break -------------------------------------------------------
  let firstBreak: OneToOneBreak | null = null;
  const consider = (b: OneToOneBreak) => {
    if (!firstBreak || b.seq < firstBreak.seq) firstBreak = b;
  };
  for (const v of bySeq) {
    if (v.type !== "invariant_violation") continue;
    if (
      v.code === "RESPONSE_WITHOUT_SOURCE_TURN" ||
      v.code === "MULTIPLE_RESPONSES_FOR_TURN" ||
      v.code === "OUTPUT_AFTER_RESPONSE_DONE"
    ) {
      consider({
        seq: v.seq,
        kind: v.code as OneToOneBreak["kind"],
        itemId: v.itemId,
        responseId: v.responseId,
        chain: buildChain(bySeq, v.seq),
      });
    }
  }
  // A feedback-born source turn ALSO breaks 1→1 ("no translation response may
  // create another source turn through playback feedback").
  for (const c of committed) {
    const s = speechStartForCommit(c);
    if (s && (s.playbackActiveAtSpeechStart ?? s.playbackActive)) {
      consider({
        seq: s.seq,
        kind: "PLAYBACK_FEEDBACK_TURN",
        itemId: c.itemId,
        chain: buildChain(bySeq, s.seq),
      });
    }
  }

  const suppressedEntries = bySeq.filter((e) => e.type === "suppressed_microturn");

  return {
    totalEntries: bySeq.length,
    truncated: false,
    committedSourceTurns: committed.length,
    responsesCreated: responsesCreated.length,
    suppressedMicroturns: suppressedEntries.length,
    suppressedMicroturnSeqs: suppressedEntries.map((e) => e.seq),
    suspicions: {
      playbackRecapture,
      cancelledResponseContinuedOutput,
      multipleResponsesPerTurn,
      inputBufferNotClearedAfterCancel,
      noiseMicroturnsCommittedMultilingual,
    },
    firstOneToOneBreak: firstBreak,
  };
}

function dedupe(ns: number[]): number[] {
  return Array.from(new Set(ns)).sort((a, b) => a - b);
}

function buildChain(bySeq: ForensicLogEntry[], aroundSeq: number): string[] {
  // The causal chain = the 6 entries before and 3 after the break point,
  // rendered compactly (type + ids + text snippets + playback state).
  const idx = bySeq.findIndex((e) => e.seq === aroundSeq);
  const from = Math.max(0, idx - 6);
  const to = Math.min(bySeq.length, idx + 4);
  return bySeq.slice(from, to).map((e) => {
    const bits = [`#${e.seq}`, e.type];
    if (e.itemId) bits.push(`item=${e.itemId}`);
    if (e.responseId) bits.push(`resp=${e.responseId}`);
    if (e.code) bits.push(`code=${e.code}`);
    if (typeof e.text === "string" && e.text) bits.push(`«${e.text.slice(0, 60)}»`);
    if (e.reason) bits.push(`reason=${e.reason}`);
    if (e.playbackActiveAtSpeechStart != null)
      bits.push(`playback@speechStart=${e.playbackActiveAtSpeechStart}`);
    else if (e.playbackActive != null) bits.push(`playback=${e.playbackActive}`);
    return bits.join(" ");
  });
}
