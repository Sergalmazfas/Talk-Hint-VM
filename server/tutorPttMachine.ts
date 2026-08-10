// Push-to-talk state machine for the Tutor UI (v2).
// Pure function, shared verbatim with the browser page: tutorAvatarPage.ts
// embeds `pttNext.toString()` so the page and the tests run the SAME logic.
// Keep the body plain JS (no TS-only syntax inside) for that reason.
//
// States: LOADING → READY ⇄ RECORDING → PROCESSING → SPEAKING → READY,
// plus ERROR (retriable), ENDING and MEMORY (review) terminals.
// Invariants enforced here (spec §4/§5, tested):
//   - mic can only start from READY (no capture before press, none while
//     Emma thinks/speaks — no barge-in);
//   - a release only finalizes an utterance from RECORDING (double release
//     or release in any other state is a no-op → no duplicate sends);
//   - exactly one visible state at a time.

export type PttState =
  | "LOADING"
  | "READY"
  | "RECORDING"
  | "PROCESSING"
  | "SPEAKING"
  | "ERROR"
  | "ENDING"
  | "MEMORY";

export type PttEvent =
  | "ready" // session.ready / avatar loaded
  | "pressDown" // user pressed the mic
  | "release" // user released the mic
  | "tutorSpeaking" // first tutor audio chunk arrived
  | "turnCompleted" // engine finished the turn
  | "error" // connection/engine failure
  | "retry" // user tapped retry
  | "end" // user tapped "finish practice"
  | "memoryReview"; // call memory arrived for confirmation

export function pttNext(state: PttState, event: PttEvent): PttState {
  if (event === "error") return state === "ENDING" || state === "MEMORY" ? state : "ERROR";
  if (event === "end") return state === "MEMORY" ? state : "ENDING";
  if (event === "memoryReview") return "MEMORY";
  switch (state) {
    case "LOADING":
      return event === "ready" ? "READY" : state;
    case "READY":
      return event === "pressDown" ? "RECORDING" : state;
    case "RECORDING":
      if (event === "release") return "PROCESSING";
      // Defensive: if tutor audio arrives while the user still holds the mic
      // (server-side race), capture must stop immediately — no barge-in.
      if (event === "tutorSpeaking") return "SPEAKING";
      return state;
    case "PROCESSING":
      if (event === "tutorSpeaking") return "SPEAKING";
      if (event === "turnCompleted") return "READY";
      return state;
    case "SPEAKING":
      if (event === "turnCompleted") return "READY";
      if (event === "tutorSpeaking") return state;
      return state;
    case "ERROR":
      return event === "retry" ? "LOADING" : state;
    default:
      return state; // ENDING / MEMORY are terminal for the mic
  }
}

// Whether microphone capture is allowed to be active in a given state.
export function micAllowed(state: PttState): boolean {
  return state === "RECORDING";
}
