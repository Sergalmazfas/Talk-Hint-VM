// Wait-state helpers.
//
// When the guest says "let me check" / "one moment", the live-hint pipeline
// enters a wait state: it shows a single "Sure, I'll wait." ACK and then
// blocks steering hints until the guest actually delivers an answer.
//
// Prod regression (call 2026-08-08 13:55–14:00): while "checking", the agent
// kept asking REAL questions ("Just to confirm, you're trying to activate
// your eSIM…", "Are you using an iPhone…") and every hint was blocked with
// reason=wait_state. A question or a request for action from the guest must
// break the wait state — the user needs a hint to answer it.

// Interrogative / action-request detection for guest utterances.
// Deliberately conservative: it must NOT match pure hold phrases like
// "Thank you. I'll wait." or "Let me check on that for you."
const QUESTION_PATTERNS: RegExp[] = [
  // Explicit question mark anywhere (STT adds them for rising intonation).
  /\?/,
  // Confirmation openers: "Just to confirm, you're trying to..." / "So you're saying..."
  /\b(just to (confirm|verify|clarify|double[- ]check)|to confirm|let me confirm|can you confirm|so you'?re (saying|telling me))\b/i,
  // Direct questions to the user: "Are you using an iPhone", "Do you have...",
  // "Did you receive...", "Have you tried...", "Is it showing...", "Was there..."
  /\b(are|do|does|did|have|has|is|was|were|will|would|could|can|should) you(r)?\b/i,
  // WH-questions aimed at the user, at the start of a sentence/clause so a
  // hold phrase like "let me see what I can do for you" does NOT match:
  // "What phone do you have", "Which model...", "How did you..."
  /(^|[.!?]\s*)(what|which|when|where|why|how|who)\b.{0,60}\byou(r)?\b/i,
  // Requests for the user to act or provide info:
  // "Please provide...", "Can you tell me...", "I need you to...", "Go ahead and..."
  /\b(please (provide|tell|give|share|confirm|read|send|check)|tell me|give me|i('?ll)? need (you to|your)|can you (tell|give|send|read|provide|share|try|go)|could you (tell|give|send|read|provide|share|try|go)|go ahead and)\b/i,
];

/**
 * True when a guest utterance asks the user a question or requests an action —
 * such an utterance must lift the wait state so a hint can be generated.
 */
export function isQuestionOrActionRequest(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return QUESTION_PATTERNS.some((p) => p.test(t));
}

// Shared wait-state patterns — single source of truth for LIVE (websocket.ts)
// and TRAINING (training.ts) modes so the two can never drift apart.
// Union of the patterns both modes historically used.
export const WAIT_PATTERNS =
  /\b(let me check|one moment|hold on|just a (second|moment|sec)|give me a (second|moment|sec|minute)|looking into|checking|i'?ll look|let me see|let me look|please hold|bear with me|i need to check|i'?ll find out|let me find|looking it up|one minute|just a minute)\b/i;

export const EXIT_WAIT_PATTERNS =
  /\b(found it|here'?s|the answer|i found|that would be|it'?s|costs?|price is|\$\d|percent|per hour|starting at|minimum|maximum|we have|we offer|we can|available|not available|unfortunately|actually|yes,? we|no,? we|the (only|next|first|earliest|available)|i can offer|we can offer|how about|at \d|am|pm|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export type WaitStateEvent =
  | "entered"
  | "still_waiting"
  | "exited_answer"
  | "exited_question"
  | null;

/**
 * Pure wait-state transition for a guest utterance.
 *
 * Order matters and mirrors LIVE mode:
 * 1. If already waiting and the guest delivers real content → exit.
 * 2. If the utterance is a hold phrase → enter (or stay in) wait state.
 * 3. If (still) waiting and the utterance asks a question / requests an
 *    action → exit, so a hint can be generated. Checked LAST so that
 *    "let me check — are you on an iPhone?" still lifts the wait state.
 */
export function resolveWaitState(
  waiting: boolean,
  guestText: string,
): { waiting: boolean; event: WaitStateEvent } {
  const text = guestText || "";
  let event: WaitStateEvent = null;
  let nowWaiting = waiting;

  if (nowWaiting && EXIT_WAIT_PATTERNS.test(text)) {
    nowWaiting = false;
    event = "exited_answer";
  } else if (WAIT_PATTERNS.test(text)) {
    event = nowWaiting ? "still_waiting" : "entered";
    nowWaiting = true;
  }

  if (nowWaiting && isQuestionOrActionRequest(text)) {
    nowWaiting = false;
    event = "exited_question";
  }

  return { waiting: nowWaiting, event };
}
