// Suggestion delivery-ack routing (speech→hint latency chain, device stage).
//
// A /ui client that renders a suggestion sends {type:"suggestion_ack",
// utteranceId, callSid}. This registry maps a live call to its owner and its
// LiveLatencyRecorder so the ack can be attributed — with its OWN ownership
// snapshot, deliberately independent of websocket.ts's callOwners map: the
// close handler clears callOwners immediately, while acks must keep landing
// through the post-close grace window until the metadata snapshot is taken.
//
// Fail-closed everywhere: unknown call, unregistered call, wrong user, or a
// malformed utteranceId all ignore the ack — a forged or stale ack must never
// pollute latency data, and a missing ack is reported honestly as
// "not delivered", never fabricated.

import type { LiveLatencyRecorder } from "./candidatePipeline";

// How long after stream close suggestion_acks are still accepted before the
// latency metadata is snapshotted — covers the "hint rendered as the call
// ended" race without holding call state open indefinitely.
export const SUGGESTION_ACK_GRACE_MS = 1500;

const registry = new Map<string, { userId: string; recorder: LiveLatencyRecorder }>();

/** Exposes a call's latency recorder for suggestion_ack routing. */
export function registerLatencyRecorder(callSid: string, userId: string, recorder: LiveLatencyRecorder): void {
  registry.set(callSid, { userId, recorder });
}

/** Stops routing suggestion_acks to a call (after the post-close ACK grace window). */
export function unregisterLatencyRecorder(callSid: string): void {
  registry.delete(callSid);
}

/**
 * Routes a suggestion_ack to the owning call's recorder. Returns true only
 * when the ack was applied. Ownership is checked against the registration
 * snapshot, so acks keep working during the post-close grace window even
 * after websocket.ts's callOwners entry is cleared.
 */
export function recordSuggestionAck(
  userId: string | undefined,
  callSid: unknown,
  utteranceId: unknown
): boolean {
  if (!userId || typeof callSid !== "string" || typeof utteranceId !== "number" || !Number.isFinite(utteranceId)) {
    return false;
  }
  const entry = registry.get(callSid);
  if (!entry || entry.userId !== userId) return false;
  entry.recorder.delivered(utteranceId);
  return true;
}
