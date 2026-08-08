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
