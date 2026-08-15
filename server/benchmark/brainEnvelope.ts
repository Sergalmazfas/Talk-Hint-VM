// BRAIN envelope construction for the LIVE benchmark.
// Pure, deterministic logic: given a frozen fixture (reference transcript +
// confirmed facts + goal + critical entities) it produces one normalized
// BrainEnvelopeInput per ELIGIBLE guest turn. This module has ZERO imports
// from the production call path — it never touches the live wire format.

import type {
  BrainEnvelopeInput,
  CriticalEntities,
  ReferenceTurn,
  Strategy,
} from "./types";

// Bump this whenever the benchmark system prompt or envelope shape changes so
// runs stay comparable in benchmark_runs.promptVersion.
export const PROMPT_VERSION = "brain-v2"; // v2: generic call-state events + copilot-chain judge

// Shape of a fixture as consumed here. This is a structural subset of the
// benchmark_fixtures row (schema.ts) so both the DB fixture and the frozen
// GOLD_CALL constants satisfy it.
export interface FixtureLike {
  goal: string;
  referenceTurns: ReferenceTurn[];
  confirmedFacts: string[];
  criticalEntities: CriticalEntities;
}

/**
 * Eligibility rules for producing a BRAIN envelope on a guest turn:
 *  1. Only GUEST turns are eligible (the copilot advises the Owner on how to
 *     respond to what the Guest just said).
 *  2. Skip pure IVR menu turns at the start of the call: everything before the
 *     FIRST owner turn is treated as IVR/pre-conversation noise (greeting,
 *     "please enter the seven digit extension", hold music). The copilot only
 *     starts once the human conversation has begun (first owner utterance).
 *  3. After the first owner turn, every guest turn is eligible — even short
 *     back-channels — because in a live call the copilot must decide turn by
 *     turn whether to suggest (restraint is a model decision, not a filter).
 *
 * The heuristic is intentionally simple and deterministic: identical input
 * always yields identical envelopes, so all candidates see the same inputs.
 */
export function buildEnvelopeInputs(fixture: FixtureLike): BrainEnvelopeInput[] {
  const turns = fixture.referenceTurns;
  const firstOwnerIdx = turns.findIndex((t) => t.role === "owner");
  // No owner turn at all => the conversation never started; nothing eligible.
  if (firstOwnerIdx === -1) return [];

  const envelopes: BrainEnvelopeInput[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== "guest") continue;
    // Rule 2: skip IVR turns before the first owner turn.
    if (i < firstOwnerIdx) continue;

    const conversationSoFar = turns.slice(0, i + 1).map(cloneTurn);
    const lastOwnerTurn = findLastOwnerTurn(turns, i);
    const currentCallState = buildCallState(fixture, turns, i);

    // Envelope fairness: every frozen field below (originalGoal, confirmedFacts,
    // conversationSoFar, currentGuestTurn, lastOwnerTurn, currentCallState) is
    // derived ONLY from the reference transcript + fixture, so it is IDENTICAL
    // for every candidate on this turn. previousHintsShown/previousHintsRejected
    // are emitted EMPTY here and later populated per-candidate by the harness —
    // BY SPEC they are each candidate's own evolving hint history, the one part
    // of the envelope that legitimately differs between candidates.
    envelopes.push({
      originalGoal: fixture.goal,
      confirmedFacts: [...fixture.confirmedFacts],
      conversationSoFar,
      currentGuestTurn: cloneTurn(turn),
      lastOwnerTurn: lastOwnerTurn ? cloneTurn(lastOwnerTurn) : null,
      // History fields are populated per-candidate by the harness as hints are
      // shown/rejected; the envelope builder emits them empty (model-agnostic).
      previousHintsShown: [],
      previousHintsRejected: [],
      currentCallState,
    });
  }

  return envelopes;
}

function cloneTurn(t: ReferenceTurn): ReferenceTurn {
  return { idx: t.idx, role: t.role, text: t.text, tStartMs: t.tStartMs, tEndMs: t.tEndMs };
}

function findLastOwnerTurn(turns: ReferenceTurn[], beforeIdx: number): ReferenceTurn | null {
  for (let j = beforeIdx - 1; j >= 0; j--) {
    if (turns[j].role === "owner") return turns[j];
  }
  return null;
}

/**
 * Deterministic short state summary derived ONLY from confirmed facts + a
 * running log of model-agnostic events observed in the reference transcript up
 * to (and including) the current guest turn. It is precomputed from the
 * transcript alone, so it is byte-for-byte identical for every candidate.
 *
 * Events are surfaced by keyword scan over the transcript text (deterministic,
 * order-preserving, de-duplicated) — this is the "what has happened so far"
 * context a live copilot would carry.
 */
export function buildCallState(
  fixture: FixtureLike,
  turns: ReferenceTurn[],
  currentIdx: number,
): string {
  const events: string[] = [];
  const seen = new Set<string>();
  const push = (e: string) => {
    if (!seen.has(e)) {
      seen.add(e);
      events.push(e);
    }
  };

  const window = turns.slice(0, currentIdx + 1);
  for (const t of window) {
    const lc = t.text.toLowerCase();
    // Generic service-call events (deterministic keyword scan; identical for
    // every candidate). Telecom / number-transfer family:
    if (/transfer (my|your|the) (existing )?(number|phone number)|port(ing)? (my|the|your) number|number transfer/.test(lc)) {
      push("call is about transferring/porting a phone number");
    }
    if (/\besim\b|e-sim/.test(lc)) push("eSIM was discussed");
    if (/activation code|activate (a )?sim|activate service/.test(lc)) push("SIM/service activation was discussed");
    if (/account number/.test(lc)) push("account number was requested or discussed");
    if (/transfer pin|port(ing)? pin|\bpin\b.*(transfer|port)/.test(lc)) push("transfer PIN was requested or discussed");
    if (/current carrier|old carrier|previous carrier/.test(lc)) push("the current/previous carrier was discussed");
    // Generic agent-interaction events:
    if (/(place|put) you on (a brief )?hold|one moment while i|please hold/.test(lc)) push("agent put the call on hold");
    if (/transfer (you|your call) to|connect you (to|with)/.test(lc)) push("agent offered to transfer the call");
    if (/verify (your|the) (identity|account)|for verification/.test(lc)) push("identity/account verification was requested");
    // Payment-plan family (Gold Call #1):
    if (/returned/.test(lc)) push("original scheduled payment was returned");
    if (/additional/.test(lc)) push("bank counts the extra payments as additional, not the missed one");
    if (/missed/.test(lc)) push("the scheduled plan payment was reported missed");
    if (/august (15|fifteen)|by tomorrow|plan will break|stay enrolled/.test(lc)) {
      push("deadline: pay by August 15 or the plan breaks");
    }
    if (/process the payment|i can (certainly )?process/.test(lc)) {
      push("agent offered to process the payment on this call");
    }
    if (/tenth of each month|10th/.test(lc)) push("automatic payment is taken on the 10th of each month");
    if (/three payments/.test(lc)) push("outcome would leave the user with three payments");
  }

  const factsPart = fixture.confirmedFacts.length
    ? `Confirmed: ${fixture.confirmedFacts.join(" | ")}`
    : "Confirmed: (none)";
  const eventsPart = events.length ? `So far: ${events.join("; ")}` : "So far: conversation just started";
  return `${factsPart}. ${eventsPart}.`;
}

// The exact set of strategy enum values, for the prompt + validation.
export const STRATEGY_VALUES: Strategy[] = [
  "answer",
  "clarify",
  "challenge",
  "confirm",
  "alternative",
  "escalate",
  "wait",
];

/**
 * The benchmark system prompt. Instructs the model to act as a real-time call
 * copilot for the OWNER (the person being helped) and to emit exactly the
 * BrainEnvelopeOutput JSON. Kept stable across candidates so quality — not
 * prompt drift — is what varies.
 */
export function buildSystemPrompt(): string {
  return [
    "You are TalkHint, a real-time call copilot. During a live phone call you help THE OWNER",
    "(the person we assist) talk to the GUEST (the other party on the line, often a company",
    "agent or IVR). You see the conversation as it happens and, at each guest turn, you decide",
    "whether to whisper a suggestion to the Owner and, if so, exactly what the Owner should say next.",
    "",
    "CORE BEHAVIOR:",
    "- Speak FOR the Owner: 'suggested_reply' is the literal sentence the Owner can say out loud.",
    "- Natural, conversational American English. Match the Owner's simple language level — short,",
    "  everyday words, no jargon, no corporate phrasing. It must sound like a real person talking.",
    "- Answer what the GUEST JUST asked (side-topic handling). If the guest asks for the SSN, date of",
    "  birth, name, or account number, the suggested reply must directly address THAT request, even if",
    "  it is a detour from the main goal. Handle the immediate turn first, then steer back toward the goal.",
    "- Do NOT repeat a strategy the Owner already tried and that was rejected/ignored. If a previous hint",
    "  was rejected (see previousHintsRejected), change your approach — escalate, offer an alternative,",
    "  or challenge — instead of restating the same failed line.",
    "- RESTRAINT: set should_suggest=false when the Owner should just listen (the guest is mid-explanation,",
    "  giving information, or no reply is needed yet). Silence is a valid, valuable choice. Do not fill",
    "  every turn with a suggestion.",
    "- The GOAL never turns assistance off. Even when the guest is unhelpful or the call drifts, keep the",
    "  Owner moving toward the original goal; assistance stays on for the whole call.",
    "",
    "GROUNDING:",
    "- Use originalGoal, confirmedFacts and currentCallState as the source of truth. Only reference money",
    "  amounts, dates, and numbers that actually appear in the confirmed facts / conversation. Never invent",
    "  amounts or figures.",
    "",
    "OUTPUT — return ONLY a JSON object with these fields:",
    "  should_suggest   (boolean, REQUIRED): whether to whisper a suggestion this turn.",
    "  suggested_reply  (string): the literal words the Owner should say. Omit/empty when should_suggest=false.",
    "  translation      (string, optional): the suggested reply in the Owner's own language if helpful.",
    "  current_topic    (string, optional): one short phrase naming what the guest turn is about.",
    "  goal_status      (string, optional): one short phrase on progress toward the goal.",
    `  strategy         (string, optional): one of ${STRATEGY_VALUES.map((s) => `"${s}"`).join(", ")}.`,
    "",
    "Return valid JSON only — no markdown, no commentary.",
  ].join("\n");
}
