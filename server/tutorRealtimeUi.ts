// ---------------------------------------------------------------------------
// Pure classifier for Tutor Engine realtime events that the /tutor page
// renders BEYOND the push-to-talk machine (task 154). Shared with the page
// via ${fn.toString()} interpolation — exactly like pttNext — so the same
// source is unit-tested server-side and executed in the browser.
//
// CONTRACT (verified live against tutor-realtime/1.0, 2026-08-13):
//   tutor.hint            {hint: string}                        — suggested USER reply.
//   tutor.correction      {correction:{user_said,better,explanation,translation,category}}
//   tutor.text.final      {text: string}                        — authoritative Emma text.
//   turn.state            {state: LISTENING|TRANSCRIBING|THINKING|SPEAKING|TURN_COMPLETE}
//   transcript.normalized {text: string}                        — terminology-normalized user text.
//
// SAFETY INVARIANTS (spec §1):
//   - A hint is what the LEARNER may say next. classify NEVER maps it to
//     anything speech- or TTS-related: the only action kind it can produce
//     is "hint", which the page renders as a dismissible card.
//   - Unknown/malformed events return null — never throw (spec §14H).
// ---------------------------------------------------------------------------

export type TutorUiAction =
  | { kind: "hint"; text: string; translation: string | null }
  | {
      kind: "correction";
      userSaid: string;
      better: string;
      explanation: string;
      translation: string | null;
      category: string;
    }
  | { kind: "finalText"; text: string }
  // turn.started: consumed ONLY for the simulation opening turn (contract §3
  // — engine-initiated turn right after WS auth, opening:true). It never
  // drives the PTT machine; the page only uses it to gate the mic button.
  | { kind: "turnStarted"; opening: boolean }
  | { kind: "turnState"; state: "listening" | "transcribing" | "thinking" | "speaking" | null }
  | { kind: "normalized"; text: string };

// NOTE: plain-JS body (no TS-only syntax) — it is stringified into the page.
export function classifyEngineEvent(msg: any): TutorUiAction | null {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return null;
  // The engine renamed tutor.hint → tutor.suggested_reply (payload
  // {text, translation}); we accept both so older engine builds keep working.
  if (msg.type === "tutor.hint" || msg.type === "tutor.suggested_reply") {
    const text = typeof msg.hint === "string" ? msg.hint : typeof msg.text === "string" ? msg.text : "";
    if (!text.trim()) return null;
    const translation = typeof msg.translation === "string" && msg.translation.trim() ? msg.translation : null;
    return { kind: "hint", text: text, translation: translation };
  }
  if (msg.type === "tutor.correction") {
    const c = msg.correction && typeof msg.correction === "object" ? msg.correction : {};
    const better = typeof c.better === "string" ? c.better : "";
    if (!better.trim()) return null;
    return {
      kind: "correction",
      userSaid: typeof c.user_said === "string" ? c.user_said : "",
      better: better,
      explanation: typeof c.explanation === "string" ? c.explanation : "",
      translation: typeof c.translation === "string" && c.translation ? c.translation : null,
      category: typeof c.category === "string" ? c.category : "",
    };
  }
  if (msg.type === "tutor.text.final") {
    return typeof msg.text === "string" && msg.text.trim() ? { kind: "finalText", text: msg.text } : null;
  }
  if (msg.type === "turn.started") {
    return { kind: "turnStarted", opening: msg.opening === true };
  }
  if (msg.type === "turn.state") {
    const map: any = { LISTENING: "listening", TRANSCRIBING: "transcribing", THINKING: "thinking", SPEAKING: "speaking" };
    return { kind: "turnState", state: map[msg.state] || null };
  }
  if (msg.type === "transcript.normalized") {
    return typeof msg.text === "string" && msg.text.trim() ? { kind: "normalized", text: msg.text } : null;
  }
  return null; // unknown event types are ignored by design — never fatal
}
