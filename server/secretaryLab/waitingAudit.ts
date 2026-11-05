import type { WaitingEvent } from "./waitingPolicy";
import { WAITING_REVIEW_RULES } from "./waitingPolicy";

/** Deterministic evidence packet for Leva -> Toma, without running either agent.
 * A transport command is not proof that its TTS was played, or who spoke. */
export function waitingAudit(events: readonly WaitingEvent[]) {
  const rows: Array<{ type: string; durationMs: number; probes: number;
    outcome: string; interruptions: null; rules1to5: string }> = [];
  let start: WaitingEvent | undefined;
  let probes = 0;
  for (const e of events) {
    if (e.type === "started") { start = e; probes = 0; }
    if (e.type === "probe") probes++;
    if (e.type === "background" && start) start = { ...start, kind: "background" };
    if ((e.type === "returned" || e.type === "expired") && start) {
      rows.push({ type: e.kind, durationMs: e.atMs - start.atMs, probes,
        outcome: e.type, interruptions: null, rules1to5: "requires_transcript_and_audio_review" });
      start = undefined;
    }
  }
  if (start) rows.push({ type: start.kind, durationMs: events.at(-1)!.atMs - start.atMs,
    probes, outcome: "unfinished_duration_lower_bound", interruptions: null,
    rules1to5: "not_verified" });
  return { status: "proposed", rows, review: WAITING_REVIEW_RULES,
    expectedResult: "0 лишних проверок; 0 перебиваний во время ожидания",
    actualUnnecessaryChecks: null, actualInterruptions: null,
    limitation: "Counts are sent commands, not audible checks. No automatic success: Toma must verify transcript/audio." };
}
