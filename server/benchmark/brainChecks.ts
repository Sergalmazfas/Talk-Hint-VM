// Deterministic (non-LLM) quality checks for a single BRAIN turn output.
// Pure functions — no network. Used both by the harness and unit tests.
// ZERO imports from the production call path.

import type {
  BrainEnvelopeInput,
  BrainEnvelopeOutput,
  CriticalEntities,
  DeterministicChecks,
  ReferenceTurn,
  Strategy,
} from "./types";
import { STRATEGY_ENUM } from "./openaiClient";

export interface CheckContext {
  criticalEntities: CriticalEntities;
  // Strategies whose hints were previously shown then rejected for this candidate.
  rejectedStrategies: Strategy[];
  // The next reference turn after the current guest turn (may be undefined at
  // the end of the transcript). Used for restraint advisory.
  nextReferenceTurn?: ReferenceTurn;
}

// Requests where the guest asks for sensitive identity info. Keyword-based.
const SIDE_TOPIC_PATTERNS: Array<{ topic: string; ask: RegExp; answer: RegExp }> = [
  {
    topic: "ssn",
    ask: /social security|full social|\bssn\b/i,
    // A reply addressing SSN mentions the social or a digit sequence.
    answer: /social|\bssn\b|\d{3,}/i,
  },
  {
    topic: "dob",
    ask: /date of birth|\bdob\b|birthday/i,
    answer: /born|birth|\b(19|20)?\d{2}\b|january|february|march|april|may|june|july|august|september|october|november|december/i,
  },
  {
    topic: "name",
    ask: /(full|your) name|may i (please )?have your (full )?name/i,
    answer: /name|i'?m |my name|this is /i,
  },
  {
    topic: "account",
    ask: /account number/i,
    answer: /account|\d{3,}/i,
  },
];

const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;

// Extract $ amounts from text, normalized (strip spaces after $).
export function extractMoney(text: string): string[] {
  const matches = text.match(MONEY_RE) || [];
  return matches.map((m) => m.replace(/\$\s+/, "$"));
}

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
}

/**
 * Rejection rule (deterministic, documented): a shown hint is considered
 * REJECTED when the following reference OWNER turn shares fewer than 30% of the
 * hint's content words. i.e. the Owner clearly did not use the suggestion.
 * Returns the overlap ratio for transparency.
 */
export function hintRejectedByNextOwnerTurn(
  hintText: string,
  nextOwnerText: string,
): { rejected: boolean; overlap: number } {
  const hintWords = contentWords(hintText);
  if (hintWords.length === 0) return { rejected: false, overlap: 1 };
  const ownerSet = new Set(contentWords(nextOwnerText));
  const shared = hintWords.filter((w) => ownerSet.has(w)).length;
  const overlap = shared / hintWords.length;
  return { rejected: overlap < 0.3, overlap };
}

export function runDeterministicChecks(
  input: BrainEnvelopeInput,
  output: BrainEnvelopeOutput | null,
  ctx: CheckContext,
): DeterministicChecks {
  const notes: string[] = [];

  // schemaValid: output present and should_suggest boolean.
  const schemaValid = !!output && typeof output.should_suggest === "boolean";
  if (!schemaValid) {
    return {
      schemaValid: false,
      strategyValid: false,
      nonRepetition: true,
      sideTopicHandled: null,
      mentionsCriticalEntityWhenExpected: null,
      restraintRespected: null,
      notes: ["output missing or malformed"],
    };
  }

  const out = output as BrainEnvelopeOutput;
  const reply = out.suggested_reply || "";

  // strategyValid: if a strategy is set it must be in the enum.
  const strategyValid =
    out.strategy === undefined || (STRATEGY_ENUM as string[]).includes(out.strategy);
  if (!strategyValid) notes.push(`invalid strategy "${out.strategy}"`);

  // nonRepetition: did NOT reuse a previously rejected strategy.
  let nonRepetition = true;
  if (out.should_suggest && out.strategy && ctx.rejectedStrategies.includes(out.strategy)) {
    nonRepetition = false;
    notes.push(`repeated rejected strategy "${out.strategy}"`);
  }

  // sideTopicHandled: only applicable when the guest turn asks for sensitive info.
  const guestText = input.currentGuestTurn.text;
  const matchedTopic = SIDE_TOPIC_PATTERNS.find((p) => p.ask.test(guestText));
  let sideTopicHandled: boolean | null = null;
  if (matchedTopic) {
    if (out.should_suggest) {
      sideTopicHandled = matchedTopic.answer.test(reply);
      if (!sideTopicHandled) notes.push(`side-topic "${matchedTopic.topic}" not addressed in reply`);
    } else {
      // Guest asked a direct question but copilot chose silence — not handled.
      sideTopicHandled = false;
      notes.push(`side-topic "${matchedTopic.topic}" asked but should_suggest=false`);
    }
  }

  // mentionsCriticalEntityWhenExpected: any $ amount in the reply must be one of
  // the fixture's known money entities (catches hallucinated amounts).
  let mentionsCriticalEntityWhenExpected: boolean | null = null;
  const replyAmounts = extractMoney(reply);
  if (replyAmounts.length > 0) {
    const known = new Set(ctx.criticalEntities.money.map((m) => m.replace(/\s+/g, "")));
    const hallucinated = replyAmounts.filter((a) => !known.has(a.replace(/\s+/g, "")));
    mentionsCriticalEntityWhenExpected = hallucinated.length === 0;
    if (hallucinated.length > 0) {
      notes.push(`hallucinated money amount(s): ${hallucinated.join(", ")}`);
    }
  }

  // restraintRespected (ADVISORY, not a hard fail): if the guest turn does not
  // end with a question mark AND the next reference turn is also a guest turn,
  // the guest is mid-explanation — should_suggest=false is preferred.
  let restraintRespected: boolean | null = null;
  const guestMidExplanation =
    !/\?\s*$/.test(guestText.trim()) &&
    ctx.nextReferenceTurn !== undefined &&
    ctx.nextReferenceTurn.role === "guest";
  if (guestMidExplanation) {
    restraintRespected = out.should_suggest === false;
    if (!restraintRespected) {
      notes.push("advisory: guest mid-explanation, restraint (should_suggest=false) preferred");
    }
  }

  return {
    schemaValid: true,
    strategyValid,
    nonRepetition,
    sideTopicHandled,
    mentionsCriticalEntityWhenExpected,
    restraintRespected,
    notes,
  };
}
