// Farewell / closing-phrase detection for the live hint pipeline.
//
// A "farewell" turn still gets a translation, but no suggestion is generated —
// the conversation is wrapping up and there is nothing to steer.
//
// Bug this module fixes: the old single regex treated ANY utterance containing
// "thanks" / "thank you" as a farewell, so live operator lines like
// "Thanks. I'm just looking for your Mint Mobile account" silently lost their
// suggestion mid-call.
//
// Rules:
// 1. Never a farewell if the utterance asks a question or contains an
//    actionable keyword (scheduling, prices, requests) — same guard as before.
// 2. HARD farewells ("bye", "take care", "see you", "have a great day",
//    "talk to you", ...) mark the turn as farewell regardless of length.
// 3. SOFT politeness ("thanks", "thank you", "appreciate it") only counts as a
//    farewell when, after stripping the politeness and filler words, nothing
//    substantive remains — i.e. the utterance IS the closing line, not a
//    polite prefix before real content.

const QUESTION_OR_ACTION =
  /\?|\b(when|what time|which|how|can you|could you|would you|book|schedule|reschedule|change|cancel|available|price|cost)\b/i;

const HARD_FAREWELL =
  /\b(see you|talk to you|speak (to|with) you|catch you|bye|goodbye|good bye|take care|have a (good|great|nice)|see ya|until (then|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next))\b/i;

const SOFT_FAREWELL =
  /\b(thanks?( so much| a lot)?|thank you( so much| very much)?|appreciate it)\b/i;

// Politeness + conversational filler that carries no content. Used to decide
// whether a soft-politeness utterance is "just a closer".
const STRIP_TOKENS =
  /\b(thank you( so much| very much)?|thanks?( so much| a lot)?|appreciate it|ok(ay)?|alright|all right|well|so|yeah|yes|sure|again|really|very much|a lot)\b/gi;

export function isFarewellUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // Questions / actionable content are never farewells.
  if (QUESTION_OR_ACTION.test(t)) return false;

  if (HARD_FAREWELL.test(t)) return true;

  if (SOFT_FAREWELL.test(t)) {
    // Strip politeness + filler; if nothing substantive remains, it's a closer.
    const remainder = t
      .replace(STRIP_TOKENS, " ")
      .replace(/[^a-zA-Z\u00C0-\u024F\u0400-\u04FF']+/g, " ")
      .trim();
    return remainder.length === 0;
  }

  return false;
}
