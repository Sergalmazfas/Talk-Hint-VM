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

// Copilot-chain dimensions: the judge walks the SAME causal chain a live
// copilot must execute on every turn. Each link gets its own 1-10 score plus a
// short per-dimension explanation ("отдельные колонки + explanation").
// overall_live_copilot_quality is kept for winner ranking / history compat.
export const JUDGE_DIMENSIONS = [
  "understood_current_turn", // понял, что Guest только что сказал/спросил
  "goal_memory", // помнит исходную цель звонка
  "tried_memory", // помнит, что уже пробовали (previous hints + их результат)
  "avoids_rejected_strategy", // не повторяет отвергнутую стратегию
  "next_move_quality", // выбирает правильный следующий ход (в т.ч. молчание)
  "reply_naturalness_en", // короткая, естественная разговорная EN-реплика
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
        JUDGE_DIMENSIONS.map((d) => [
          d,
          {
            type: "object",
            additionalProperties: false,
            required: ["score", "explanation"],
            properties: {
              score: { type: "integer", minimum: 1, maximum: 10 },
              explanation: { type: "string" },
            },
          },
        ]),
      ),
      rationale: { type: "string" },
    },
  },
} as const;

const JUDGE_SYSTEM = [
  "You are an expert evaluator of a real-time call copilot for THE OWNER of a phone call.",
  "The question is NOT who wrote the prettiest sentence — it is whether, AT THIS MOMENT of the",
  "call, this hint would actually help the Owner continue the call toward the goal.",
  "Walk the copilot chain and score each link 1 (broken) to 10 (excellent) as an integer, with a",
  "short (<=160 chars) explanation per link:",
  "  understood_current_turn — did it correctly read what the Guest just said/asked?",
  "  goal_memory — does the hint keep the original call goal in mind?",
  "  tried_memory — does it account for what was already tried (previousHintsShown) and its outcome?",
  "  avoids_rejected_strategy — does it avoid restating an approach the Owner already rejected/ignored (previousHintsRejected)?",
  "  next_move_quality — is this the right next move now (including choosing silence via should_suggest=false)?",
  "  reply_naturalness_en — is the suggested reply short, natural, conversational American English the Owner could say verbatim?",
  "  overall_live_copilot_quality — overall: would this hint help continue the call right now?",
  "Be strict and calibrated. When should_suggest=false, judge whether silence was the right move;",
  "reply_naturalness_en then scores the DECISION quality, not absent text (10 if silence was clearly right).",
  "Also give one short overall rationale (<=280 chars). Return JSON only.",
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

  // Fail-closed validation: EVERY dimension must be either the current
  // {score:int, explanation:string} object or an explicit legacy bare integer.
  // A missing or malformed dimension means the judge response is unusable —
  // return null (recorded as a judge failure) rather than fabricating 1s.
  const scores = {} as JudgeScores["scores"];
  const explanations = {} as JudgeScores["explanations"];
  for (const d of JUDGE_DIMENSIONS) {
    const v = parsed[d];
    if (v && typeof v === "object") {
      if (!Number.isFinite(v.score) || typeof v.explanation !== "string") return null;
      (scores as any)[d] = clampScore(v.score);
      (explanations as any)[d] = v.explanation.slice(0, 300);
    } else if (Number.isFinite(v)) {
      // Legacy bare-int compatibility (older stored responses).
      (scores as any)[d] = clampScore(v);
      (explanations as any)[d] = "";
    } else {
      return null;
    }
  }

  return {
    judgeModel,
    selfJudged: judgeModel === candidateModel,
    scores,
    explanations,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 500) : "",
  };
}
