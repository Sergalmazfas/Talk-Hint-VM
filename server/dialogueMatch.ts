import type { DialogueEntry, DialogueLibrary } from "@shared/schema";

// Pure, dependency-free text + dialogue-library matching helpers. Extracted from
// the per-connection websocket handler so the runtime "library-first" behavior
// (which library is chosen for the active goal, and whether an utterance hits a
// ready-made line) is unit-testable in isolation.

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// Jaccard word-overlap similarity in [0,1].
export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;

  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");
  const setB = new Set(wordsB);
  const intersection = wordsA.filter((w) => setB.has(w)).length;
  const allWords = new Set(wordsA.concat(wordsB));
  const union = allWords.size;
  return intersection / union;
}

// A guest utterance must reach this similarity to a saved trigger/variant to be
// answered from the library (below it we fall through to the live GPT path).
export const DIALOGUE_MATCH_THRESHOLD = 0.6;
// A saved goalText must reach this similarity to the active goal to be treated as
// a confident goal match.
export const DIALOGUE_GOAL_SELECT_THRESHOLD = 0.35;

// Libraries are saved per GOAL, so first pick the ONE library that matches the
// active goal, then match the utterance inside it. Selection prefers the goal
// whose free-text goalText best matches the user's active goal (currentGoal); if
// nothing confidently matches, it falls back within the detected goalType.
// Returns null when the user has no matching library.
export function selectActiveLibrary(
  libraries: DialogueLibrary[],
  goalText: string,
  goalType: string,
): DialogueLibrary | null {
  if (!libraries.length) return null;
  const activeGoal = (goalText || "").trim();

  // 1) Strongest signal: the active goal's free text vs each library's saved
  // goalText. A confident match here wins outright, so with several similar
  // goals (e.g. two CDL interviews) we pick the one that actually matches.
  if (activeGoal) {
    let best: DialogueLibrary | null = null;
    let bestScore = 0;
    for (const lib of libraries) {
      if (!lib.goalText) continue;
      const score = textSimilarity(activeGoal, lib.goalText);
      if (score > bestScore) {
        bestScore = score;
        best = lib;
      }
    }
    if (best && bestScore >= DIALOGUE_GOAL_SELECT_THRESHOLD) return best;
  }

  // 2) No confident goal-text match. Narrow to libraries of the detected
  // domain (goalType).
  const sameType = libraries.filter((lib) => lib.goalType === goalType);
  if (sameType.length === 0) return null;
  if (sameType.length === 1) return sameType[0];

  // 3) Several libraries share this domain. If we have an active goal, still
  // prefer the BEST goal-text match among them (even below the confident
  // threshold) rather than blindly taking the first — a best-effort guess is
  // safer than picking an arbitrary same-type library.
  if (activeGoal) {
    let domBest = sameType[0];
    let domScore = -1;
    for (const lib of sameType) {
      const score = lib.goalText ? textSimilarity(activeGoal, lib.goalText) : 0;
      if (score > domScore) {
        domScore = score;
        domBest = lib;
      }
    }
    return domBest;
  }

  // 4) No active goal to disambiguate multiple same-domain libraries — we
  // cannot reliably tell them apart, so take the first.
  return sameType[0];
}

// Grounding gate for the library fast path. Library lines are pre-authored and
// bypass the live LLM (and therefore LIVE_GROUNDING_RULES), so a canned answer
// must never be served for a question only the Owner can answer from direct
// observation — device type, whether something works NOW, what they see/did.
// Such turns fall through to the grounded LLM path instead.
const OWNER_ONLY_QUESTION = new RegExp(
  [
    // Real-world state checks: "Is it working now?", "Does it work?"
    "\\b(is|are)\\s+(it|that|this|everything|your\\s+\\w+)\\s+(working|connected|fixed|resolved|back|showing|on|off)\\b",
    "\\bworking\\s+now\\b",
    "\\bdo(es)?\\s+(it|that|this)\\s+work\\b",
    // Personal device / setup / possessions: "Are you using an iPhone or
    // Android?", "Is your Mint plan showing?"
    "\\bare\\s+you\\s+(using|on|seeing)\\b",
    "\\b(is|was|does|do)\\s+your\\b",
    "\\bhave\\s+you\\s+(tried|checked|done|received|got(ten)?|restarted|rebooted|updated|installed|answered)\\b",
    "\\bwh(at|en|ere)\\s+did\\s+you\\b(?!\\s+get\\s+my\\b)",
    "\\bwhich\\s+(phone|device|model|one)\\b",
    "\\biphone\\s+or\\s+android\\b",
    "\\bwhat\\s+(phone|device|kind\\s+of\\s+phone)\\b",
    // What the owner sees / did / has: "Do you see...", "Did you get..."
    "\\bdo\\s+you\\s+(see|have|notice|remember)\\b",
    // "(?!\\s+my\\b)" keeps guest objections like "Where did you get my
    // number?" (a canned-rebuttal moment) out of the owner-only gate.
    "\\bdid\\s+you\\s+(get|receive|try|do|see|find|tap|press|restart|reboot)\\b(?!\\s+my\\b)",
    "\\bcan\\s+you\\s+(see|confirm\\s+what)\\b",
    "\\bwhat\\s+do(es)?\\s+(it|the\\s+screen|your\\s+\\w+)\\s+(say|show)\\b",
  ].join("|"),
  "i",
);

export function isOwnerOnlyQuestion(text: string): boolean {
  return OWNER_ONLY_QUESTION.test(text);
}

// Answer-side guard for pre-authored library lines. The question gate above is
// phrasing-limited, so independently of HOW the guest asked, never serve a
// canned answer that ASSERTS mutable real-world state or an unverifiable
// personal fact ("it's working now", "I'm using an iPhone", "I already
// restarted it"). Such entries exist in libraries generated before the
// grounding rules were added to the generator prompt; skipping them at serve
// time falls through to the grounded LLM path.
const ANSWER_ASSERTS_STATE = new RegExp(
  [
    // Asserted working/broken state
    "\\b(it|everything|phone|service|number|internet|connection)\\s*('?s|\\s+is|\\s+was)?\\s*(still\\s+)?(not\\s+)?work(s|ing)\\b",
    "\\bworking\\s+now\\b",
    "\\bstill\\s+(not\\s+working|broken|down)\\b",
    "\\b(problem|issue)\\s+(is\\s+)?(fixed|resolved|solved|gone)\\b",
    // Asserted device / personal setup
    "\\bi'?m\\s+(using|on)\\s+(an?\\s+)?(iphone|android|samsung|google\\s+pixel)\\b",
    "\\bi\\s+(have|use|got)\\s+(an?\\s+)?(iphone|android|samsung|google\\s+pixel)\\b",
    // Asserted completed actions / results
    "\\bi\\s+(already\\s+)?(restarted|rebooted|reset|updated|reinstalled|tried\\s+that|did\\s+that|checked\\s+that)\\b",
    "\\byes,?\\s+(it|everything)\\s+(works|is\\s+working)\\b",
    "\\bno,?\\s+(it|everything)\\s+(doesn'?t|isn'?t|is\\s+not|does\\s+not)\\s+work",
  ].join("|"),
  "i",
);

export function answerAssertsUnverifiableState(answer: string): boolean {
  return ANSWER_ASSERTS_STATE.test(answer);
}

// Library-first lookup: pick the active-goal library, then find the best
// ready-made line for the guest utterance (Jaccard vs trigger + variants).
// Returns the highest-scoring entry at/above threshold, or null on a miss so the
// caller falls through to the existing translateAndSuggest path.
export function matchDialogueLibrary(
  libraries: DialogueLibrary[],
  text: string,
  goalText: string,
  goalType: string,
): { entry: DialogueEntry; library: DialogueLibrary } | null {
  const library = selectActiveLibrary(libraries, goalText, goalType);
  const entries = library && Array.isArray(library.entries) ? (library.entries as DialogueEntry[]) : null;
  if (!library || !entries || entries.length === 0) return null;
  let best: DialogueEntry | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    if (!entry || !entry.answer) continue;
    // Never serve a canned line that asserts state/facts only the Owner can
    // verify — pre-grounding libraries may contain such answers.
    if (answerAssertsUnverifiableState(entry.answer)) continue;
    const candidates = [entry.trigger, ...(Array.isArray(entry.variants) ? entry.variants : [])];
    for (const cand of candidates) {
      if (!cand) continue;
      const score = textSimilarity(text, cand);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
  }
  return best && bestScore >= DIALOGUE_MATCH_THRESHOLD ? { entry: best, library } : null;
}
