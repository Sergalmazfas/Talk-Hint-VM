// ---------------------------------------------------------------------------
// Pure classifier for Tutor Engine realtime events that the /tutor page
// renders BEYOND the push-to-talk machine (task 154). Shared with the page
// via ${fn.toString()} interpolation — exactly like pttNext — so the same
// source is unit-tested server-side and executed in the browser.
//
// CONTRACT (Tutor Engine Public Contract v1 — tutor-engine 1.0.0,
// tutor-realtime/1.0; docs/tutor-engine-public-contract-v1.md §2/§4.1):
//   tutor.suggested_reply {text, translation, carryover}        — suggested USER reply.
//   tutor.hint            {hint: string, mode: string}          — TEACHING hint — a DISTINCT
//                                                                 stable event, NOT an alias.
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
  // tutor.hint — teaching hint (guidance ABOUT the learner's language).
  // A DISTINCT event from tutor.suggested_reply per contract v1 §2 —
  // rendered as its own card, never mixed with the suggested-reply shape.
  | { kind: "teachingHint"; text: string }
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
  // Contract v1 §2: tutor.suggested_reply {text, translation} (suggested USER
  // reply) and tutor.hint {hint, mode} (teaching hint) are TWO DISTINCT stable
  // events — neither is an alias of the other, and they are rendered
  // differently. Field validation is name-specific — no silent cross-shape
  // acceptance: each event requires its own documented payload field.
  if (msg.type === "tutor.suggested_reply") {
    // Required by contract §4.1: text (string), translation (string|null),
    // carryover (boolean). Fail closed: a frame missing/mistyping a REQUIRED
    // field is malformed → ignored, never partially rendered.
    const text = typeof msg.text === "string" ? msg.text : "";
    if (!text.trim()) return null;
    if (msg.translation !== null && typeof msg.translation !== "string") return null;
    if (typeof msg.carryover !== "boolean") return null;
    const translation = typeof msg.translation === "string" && msg.translation.trim() ? msg.translation : null;
    return { kind: "hint", text: text, translation: translation };
  }
  if (msg.type === "tutor.hint") {
    // Required by contract §4.1: hint (string), mode (string). Fail closed.
    const hint = typeof msg.hint === "string" ? msg.hint : "";
    if (!hint.trim()) return null;
    if (typeof msg.mode !== "string") return null;
    return { kind: "teachingHint", text: hint };
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
