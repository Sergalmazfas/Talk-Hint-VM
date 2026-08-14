// LLM-as-judge for a single BRAIN turn output. Structured outputs, all 10
// dimensions as ints 1-10 + short rationale. Bounded timeout. Judge failure
// => returns null with a note (never blocks the benchmark).
// ZERO imports from the production call path.

import { JUDGE_PREFERENCE } from "./candidates";
import type {
  AvailabilityResult,
  BrainCandidate,
  BrainEnvelopeInput,
  BrainEnvelopeOutput,
  JudgeScores,
} from "./types";
import type { FixtureLike } from "./brainEnvelope";
import { chatOnce, type FetchLike } from "./openaiClient";

const JUDGE_TIMEOUT_MS = 15_000;

const JUDGE_DIMENSIONS = [
  "goal_awareness",
  "current_turn_relevance",
  "conversation_intelligence",
  "usefulness",
  "language_naturalness",
  "non_repetition",
  "strategy_progression",
  "restraint",
  "multi_turn_coherence",
  "overall_live_copilot_quality",
] as const;

const JUDGE_SCHEMA = {
  name: "judge_scores",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [...JUDGE_DIMENSIONS, "rationale"],
    properties: {
      ...Object.fromEntries(
        JUDGE_DIMENSIONS.map((d) => [d, { type: "integer", minimum: 1, maximum: 10 }]),
      ),
      rationale: { type: "string" },
    },
  },
} as const;

const JUDGE_SYSTEM = [
  "You are an expert evaluator of a real-time call copilot for THE OWNER of a phone call.",
  "Given the copilot's input envelope, its output, and the call context, score the output on",
  "each dimension from 1 (terrible) to 10 (excellent) as an integer. Be strict and calibrated.",
  "Dimensions: goal_awareness, current_turn_relevance, conversation_intelligence, usefulness,",
  "language_naturalness, non_repetition, strategy_progression, restraint, multi_turn_coherence,",
  "overall_live_copilot_quality. Also give one short rationale (<=280 chars).",
  "Return JSON only.",
].join("\n");

/**
 * Pick a judge model: first entry of JUDGE_PREFERENCE that maps to an AVAILABLE
 * candidate model. Returns the model string, or null if none available.
 */
export function pickJudgeModel(
  candidates: BrainCandidate[],
  availability: AvailabilityResult[],
): string | null {
  const availableIds = new Set(
    availability.filter((a) => a.status === "AVAILABLE").map((a) => a.candidateId),
  );
  const availableModels = new Set(
    candidates.filter((c) => availableIds.has(c.id)).map((c) => c.model),
  );
  for (const pref of JUDGE_PREFERENCE) {
    if (availableModels.has(pref)) return pref;
  }
  return null;
}

function clampScore(v: any): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, n));
}

export interface JudgeDeps {
  fetchImpl?: FetchLike;
  nowMs?: () => number;
}

export async function judgeTurn(
  judgeModel: string,
  candidateModel: string,
  envelopeInput: BrainEnvelopeInput,
  output: BrainEnvelopeOutput,
  fixture: FixtureLike,
  deps: JudgeDeps = {},
): Promise<JudgeScores | null> {
  const nowMs = deps.nowMs || (() => Date.now());
  const user = [
    `ORIGINAL GOAL: ${fixture.goal}`,
    `CONFIRMED FACTS: ${envelopeInput.confirmedFacts.join(" | ")}`,
    `CALL STATE: ${envelopeInput.currentCallState}`,
    `LAST OWNER TURN: ${envelopeInput.lastOwnerTurn?.text ?? "(none)"}`,
    `CURRENT GUEST TURN: ${envelopeInput.currentGuestTurn.text}`,
    `PREVIOUS HINTS SHOWN: ${envelopeInput.previousHintsShown.join(" | ") || "(none)"}`,
    `PREVIOUS HINTS REJECTED: ${envelopeInput.previousHintsRejected.join(" | ") || "(none)"}`,
    "",
    `COPILOT OUTPUT: ${JSON.stringify(output)}`,
  ].join("\n");

  const res = await chatOnce({
    model: judgeModel,
    system: JUDGE_SYSTEM,
    user,
    maxTokens: 400,
    responseFormat: { type: "json_schema", json_schema: JUDGE_SCHEMA },
    timeoutMs: JUDGE_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
    nowMs,
  });

  if (!res.ok) return null;
  let parsed: any;
  try {
    const match = res.content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const scores = Object.fromEntries(
    JUDGE_DIMENSIONS.map((d) => [d, clampScore(parsed[d])]),
  ) as JudgeScores["scores"];

  return {
    judgeModel,
    selfJudged: judgeModel === candidateModel,
    scores,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 500) : "",
  };
}
