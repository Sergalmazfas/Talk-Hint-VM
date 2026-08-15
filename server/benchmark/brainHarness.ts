// BRAIN benchmark harness — runs each AVAILABLE candidate sequentially over the
// eligible envelopes of a fixture, measuring engineering + quality metrics and
// computing continuity metrics + a scorecard. ZERO imports from the production
// call path.
//
// Continuity invariant: a per-turn error (timeout / API error / malformed JSON)
// is recorded and the run CONTINUES to the next turn. One bad turn never aborts
// a candidate's chain.

import type {
  AvailabilityResult,
  BrainCandidate,
  BrainEnvelopeInput,
  BrainTurnResult,
  ContinuityMetrics,
  ReferenceTurn,
  Strategy,
} from "./types";
import {
  buildEnvelopeInputs,
  buildSystemPrompt,
  type FixtureLike,
} from "./brainEnvelope";
import {
  ENVELOPE_JSON_SCHEMA,
  chatStream,
  parseEnvelope,
  type FetchLike,
} from "./openaiClient";
import { runDeterministicChecks, hintRejectedByNextOwnerTurn } from "./brainChecks";
import { judgeTurnAggregated, pickJudgeModel, pickSecondJudgeModel } from "./judge";

const TURN_TIMEOUT_MS = 15_000;
// Constant estimate for WS delivery + client render overhead when real delivery
// data is unavailable. Marked "estimated" in scorecards.
export const CLIENT_RENDER_ESTIMATE_MS = 75;

// Public pricing table (USD per 1M tokens) for models with KNOWN public pricing.
// Unknown models => null cost + note. NEVER invent pricing.
export const PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  "gpt-4.1-mini": { inPerM: 0.4, outPerM: 1.6 },
  "gpt-4.1": { inPerM: 2.0, outPerM: 8.0 },
  "gpt-4.1-nano": { inPerM: 0.1, outPerM: 0.4 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  "gpt-4o": { inPerM: 2.5, outPerM: 10.0 },
};

// Estimated tokens per 10-minute live call (rough envelope traffic model): a
// 10-min call ~= 30 eligible turns; we scale measured avg per-turn usage.
const TURNS_PER_10MIN_CALL = 30;

const DEADLINE_BUCKETS_MS = [500, 1000, 1500, 2000];

export interface RunBrainOpts {
  fixture: FixtureLike;
  candidates: BrainCandidate[];
  availability: AvailabilityResult[];
  judgeEnabled?: boolean;
  onProgress?: (msg: string) => void;
  // Injectable for tests (no network).
  fetchImpl?: FetchLike;
  nowMs?: () => number;
}

export interface BrainScorecardEntry {
  candidateId: string;
  model: string;
  turns: number;
  successfulHints: number;
  errors: number;
  schemaInvalid: number;
  avgFirstTokenMs: number | null;
  avgFullOutputMs: number | null;
  avgReadyMs: number | null;
  deadlineBuckets: Record<string, { count: number; pct: number }>; // key = "<=500" etc
  clientRenderEstimateMs: number;
  clientRenderEstimated: true;
  avgTokensIn: number | null;
  avgTokensOut: number | null;
  estCostPer10MinCall: number | null;
  costNote: string | null;
  judgeAverages: Record<string, number> | null;
  // Per-dimension mean of the per-turn multi-sample stds — how much the judge
  // "плавает" on this candidate. null when no judged turns / no sample stds.
  judgeStds: Record<string, number> | null;
  // Second-judge cross-check averages for a self-judged candidate. null when
  // not applicable or the second judge failed (fail-closed, never substituted).
  crossJudgeModel: string | null;
  crossJudgeAverages: Record<string, number> | null;
}

export interface RunBrainResult {
  turnResults: BrainTurnResult[];
  continuity: Record<string, ContinuityMetrics>;
  scorecard: { candidates: BrainScorecardEntry[] };
  judgeModel: string | null;
  secondJudgeModel: string | null;
  notes: string[];
}

function avg(nums: Array<number | null>): number | null {
  const vals = nums.filter((n): n is number => typeof n === "number");
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

// Find the next reference OWNER turn strictly after the given transcript index.
function nextOwnerTurn(turns: ReferenceTurn[], afterIdx: number): ReferenceTurn | null {
  for (let i = afterIdx + 1; i < turns.length; i++) {
    if (turns[i].role === "owner") return turns[i];
  }
  return null;
}

function nextRefTurn(turns: ReferenceTurn[], afterIdx: number): ReferenceTurn | undefined {
  return turns[afterIdx + 1];
}

export async function runBrainBenchmark(opts: RunBrainOpts): Promise<RunBrainResult> {
  const nowMs = opts.nowMs || (() => Date.now());
  const progress = opts.onProgress || (() => {});
  const notes: string[] = [];
  const system = buildSystemPrompt();

  const envelopes = buildEnvelopeInputs(opts.fixture);
  const refTurns = opts.fixture.referenceTurns;

  const availableIds = new Set(
    opts.availability.filter((a) => a.status === "AVAILABLE").map((a) => a.candidateId),
  );

  const judgeModel = opts.judgeEnabled
    ? pickJudgeModel(opts.candidates, opts.availability)
    : null;
  if (opts.judgeEnabled && !judgeModel) {
    notes.push("judge enabled but no available candidate model to serve as judge; judge disabled");
  }
  // Second judge for cross-checking self-judged candidates. Fail-closed: when
  // no distinct second judge is available, the honest self-judged mark stays —
  // never substituted.
  const secondJudgeModel = judgeModel
    ? pickSecondJudgeModel(opts.candidates, opts.availability, judgeModel)
    : null;
  if (judgeModel && !secondJudgeModel) {
    notes.push(
      `no second judge available to cross-check self-judged candidates (primary judge: ${judgeModel}); honest self-judged marks stay`,
    );
  }

  const turnResults: BrainTurnResult[] = [];
  const continuity: Record<string, ContinuityMetrics> = {};
  const scorecardEntries: BrainScorecardEntry[] = [];

  for (const candidate of opts.candidates) {
    if (!availableIds.has(candidate.id)) {
      notes.push(`skipped ${candidate.id}: not AVAILABLE`);
      continuity[candidate.id] = emptyContinuity(envelopes.length);
      continue;
    }

    progress(`running candidate ${candidate.id} (${candidate.model}) over ${envelopes.length} turns`);

    const rejectedStrategies: Strategy[] = [];
    const shownHints: string[] = [];
    const rejectedHints: string[] = [];

    const cont: ContinuityMetrics = emptyContinuity(envelopes.length);
    let consecutiveMissed = 0;

    const candTurnResults: BrainTurnResult[] = [];
    // The EXACT envelope sent to the candidate for each turn (including its
    // candidate-specific previousHintsShown/Rejected history). The judge MUST
    // see this envelope — not the pre-built one with empty history — or the
    // tried_memory / avoids_rejected_strategy scores would be meaningless.
    const envByTurnIdx = new Map<number, BrainEnvelopeInput>();

    for (const env of envelopes) {
      const turnIdx = env.currentGuestTurn.idx;
      cont.hintsRequested++;

      // Envelope fairness: the frozen fields (originalGoal, confirmedFacts,
      // conversationSoFar, currentGuestTurn, lastOwnerTurn, currentCallState)
      // come straight from the precomputed, model-agnostic envelope and are
      // IDENTICAL across every candidate for this turn. Only previousHintsShown
      // / previousHintsRejected differ — BY SPEC they are each candidate's own
      // evolving history of what IT suggested and what the reference Owner did
      // (or did not) use.
      const envForCall: BrainEnvelopeInput = {
        ...env,
        previousHintsShown: [...shownHints],
        previousHintsRejected: [...rejectedHints],
      };
      envByTurnIdx.set(turnIdx, envForCall);

      const reasoningEffort =
        candidate.reasoningEffort === "none" || candidate.reasoningEffort === "low"
          ? candidate.reasoningEffort
          : undefined;

      const user = JSON.stringify(envForCall);

      // Continuity invariant: EVERY external interaction for this turn (the
      // streaming call AND parsing) is wrapped so ANY thrown error — including
      // reader/network exceptions that escape chatStream — records a
      // 'brain'-stage miss for this turn and CONTINUES to the next turn. One
      // bad turn (even an unexpected throw) never aborts the candidate's chain.
      const bumpMiss = () => (consecutiveMissed = trackMiss(cont, ++consecutiveMissed));

      try {
        const stream = await chatStream({
          model: candidate.model,
          system,
          user,
          maxTokens: 400,
          responseFormat: { type: "json_schema", json_schema: ENVELOPE_JSON_SCHEMA },
          reasoningEffort,
          timeoutMs: TURN_TIMEOUT_MS,
          fetchImpl: opts.fetchImpl,
          nowMs,
        });

        const base: BrainTurnResult = {
          turnIdx,
          candidateId: candidate.id,
          output: null,
          schemaValid: false,
          firstTokenMs: stream.firstTokenMs,
          fullOutputMs: stream.fullOutputMs,
          tokensIn: stream.tokensIn,
          tokensOut: stream.tokensOut,
          suggestionReadyAfterGuestEndMs: null,
        };

        if (!stream.ok) {
          // Timeout or API error — record miss (stage: brain) and CONTINUE.
          base.error = `HTTP ${stream.status} ${stream.errorText || ""}`.trim();
          candTurnResults.push(base);
          recordMiss(cont, turnIdx, "brain", base.error, bumpMiss);
          continue;
        }

        const output = parseEnvelope(stream.content);
        base.rawText = stream.content;

        if (!output) {
          // Malformed JSON — schemaValid false, continue.
          base.error = "malformed JSON (schema-invalid)";
          base.schemaValid = false;
          candTurnResults.push(base);
          recordMiss(cont, turnIdx, "brain", base.error, bumpMiss);
          continue;
        }

        // Success.
        base.output = output;
        base.schemaValid = true;
        base.suggestionReadyAfterGuestEndMs = stream.fullOutputMs;

        cont.hintsGenerated++;
        // In this harness (no real WS/render) generated == sent == rendered.
        cont.hintsWsSent++;
        cont.hintsClientRendered++;
        consecutiveMissed = 0;

        // Deterministic checks.
        base.deterministic = runDeterministicChecks(envForCall, output, {
          criticalEntities: opts.fixture.criticalEntities,
          rejectedStrategies,
          nextReferenceTurn: nextRefTurn(refTurns, turnIdx),
        });

        // Track shown hint + rejection status for future turns.
        if (output.should_suggest && output.suggested_reply) {
          const hint = output.suggested_reply;
          shownHints.push(hint);
          const owner = nextOwnerTurn(refTurns, turnIdx);
          if (owner) {
            const { rejected } = hintRejectedByNextOwnerTurn(hint, owner.text);
            if (rejected) {
              rejectedHints.push(hint);
              if (output.strategy && !rejectedStrategies.includes(output.strategy)) {
                rejectedStrategies.push(output.strategy);
              }
            }
          }
        }

        candTurnResults.push(base);
      } catch (e: any) {
        // Unexpected exception (reader error, transport throw, etc.). Record a
        // 'brain'-stage miss and CONTINUE — the continuity invariant holds.
        const errMsg = `unexpected turn error: ${String(e?.message || e)}`;
        candTurnResults.push({
          turnIdx,
          candidateId: candidate.id,
          output: null,
          schemaValid: false,
          error: errMsg,
          firstTokenMs: null,
          fullOutputMs: null,
          tokensIn: null,
          tokensOut: null,
          suggestionReadyAfterGuestEndMs: null,
        });
        recordMiss(cont, turnIdx, "brain", errMsg, bumpMiss);
        continue;
      }
    }

    // Judge pass (optional) — only successful outputs, bounded, failures noted.
    if (judgeModel) {
      for (const tr of candTurnResults) {
        if (!tr.output) continue;
        const env = envByTurnIdx.get(tr.turnIdx);
        if (!env) continue;
        // Judge failure (bounded timeout OR any thrown error) => judge:null and
        // a note; it must NEVER abort the turn loop.
        try {
          const js = await judgeTurnAggregated(
            judgeModel,
            candidate.model,
            env,
            tr.output,
            opts.fixture,
            { fetchImpl: opts.fetchImpl, nowMs },
          );
          if (js) {
            // Self-judged cross-check by the second judge (when one exists).
            if (js.selfJudged && secondJudgeModel) {
              const cross = await judgeTurnAggregated(
                secondJudgeModel,
                candidate.model,
                env,
                tr.output,
                opts.fixture,
                { fetchImpl: opts.fetchImpl, nowMs },
              );
              if (cross) {
                js.crossJudge = {
                  judgeModel: secondJudgeModel,
                  samples: cross.samples ?? 0,
                  scores: cross.scores,
                  scoreStds: cross.scoreStds ?? {},
                };
              } else {
                // Fail-closed: second judge failed — record null, never substitute.
                js.crossJudge = null;
                notes.push(
                  `second judge (${secondJudgeModel}) failed for self-judged ${candidate.id} turn ${tr.turnIdx}; honest self-judged mark stays`,
                );
              }
            }
            tr.judge = js;
          } else {
            tr.judge = null;
            notes.push(`judge failed for ${candidate.id} turn ${tr.turnIdx}`);
          }
        } catch (e: any) {
          tr.judge = null;
          notes.push(`judge threw for ${candidate.id} turn ${tr.turnIdx}: ${String(e?.message || e)}`);
        }
      }
    }

    turnResults.push(...candTurnResults);
    continuity[candidate.id] = cont;
    scorecardEntries.push(buildScorecardEntry(candidate, candTurnResults));
  }

  return {
    turnResults,
    continuity,
    scorecard: { candidates: scorecardEntries },
    judgeModel,
    secondJudgeModel,
    notes,
  };
}

function emptyContinuity(eligible: number): ContinuityMetrics {
  return {
    eligibleGuestTurns: eligible,
    hintsRequested: 0,
    hintsGenerated: 0,
    hintsWsSent: 0,
    hintsClientRendered: 0,
    hintsMissed: 0,
    maxConsecutiveMissedHints: 0,
    misses: [],
  };
}

function recordMiss(
  cont: ContinuityMetrics,
  turnIdx: number,
  stage: ContinuityMetrics["misses"][number]["stage"],
  reason: string,
  bumpConsecutive: () => void,
): void {
  cont.hintsMissed++;
  cont.misses.push({ turnIdx, stage, reason });
  bumpConsecutive();
}

function trackMiss(cont: ContinuityMetrics, consecutive: number): number {
  if (consecutive > cont.maxConsecutiveMissedHints) {
    cont.maxConsecutiveMissedHints = consecutive;
  }
  return consecutive;
}

function buildScorecardEntry(
  candidate: BrainCandidate,
  results: BrainTurnResult[],
): BrainScorecardEntry {
  const successful = results.filter((r) => r.schemaValid && r.output);
  const errors = results.filter((r) => r.error && !r.schemaValid && !r.output && r.rawText === undefined).length;
  const schemaInvalid = results.filter((r) => r.rawText !== undefined && !r.schemaValid).length;

  const readyMsList = successful
    .map((r) => r.suggestionReadyAfterGuestEndMs)
    .filter((n): n is number => typeof n === "number");

  const deadlineBuckets: Record<string, { count: number; pct: number }> = {};
  for (const d of DEADLINE_BUCKETS_MS) {
    const count = readyMsList.filter((ms) => ms + CLIENT_RENDER_ESTIMATE_MS <= d).length;
    const pct = readyMsList.length ? Math.round((count / readyMsList.length) * 1000) / 10 : 0;
    deadlineBuckets[`<=${d}`] = { count, pct };
  }

  // Cost estimate.
  const avgIn = avg(successful.map((r) => r.tokensIn));
  const avgOut = avg(successful.map((r) => r.tokensOut));
  let estCostPer10MinCall: number | null = null;
  let costNote: string | null = null;
  const pricing = PRICING[candidate.model];
  if (!pricing) {
    costNote = `no public pricing known for model "${candidate.model}"`;
  } else if (avgIn === null || avgOut === null) {
    costNote = "no token usage measured; cannot estimate cost";
  } else {
    const perTurn = (avgIn * pricing.inPerM + avgOut * pricing.outPerM) / 1_000_000;
    estCostPer10MinCall = Math.round(perTurn * TURNS_PER_10MIN_CALL * 1e6) / 1e6;
  }

  // Judge averages across successful judged turns.
  let judgeAverages: Record<string, number> | null = null;
  let judgeStds: Record<string, number> | null = null;
  let crossJudgeModel: string | null = null;
  let crossJudgeAverages: Record<string, number> | null = null;
  const judged = successful.filter((r) => r.judge);
  if (judged.length > 0) {
    const dims = Object.keys(judged[0].judge!.scores);
    judgeAverages = {};
    for (const dim of dims) {
      const vals = judged.map((r) => (r.judge!.scores as any)[dim] as number);
      judgeAverages[dim] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    }
    // Mean of per-turn multi-sample stds (judge spread / "плавание").
    const withStds = judged.filter((r) => r.judge!.scoreStds);
    if (withStds.length > 0) {
      judgeStds = {};
      for (const dim of dims) {
        const vals = withStds.map((r) => r.judge!.scoreStds![dim]).filter((v): v is number => typeof v === "number");
        if (vals.length > 0) {
          judgeStds[dim] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
        }
      }
    }
    // Second-judge cross-check averages (self-judged candidates only).
    const crossed = judged.filter((r) => r.judge!.crossJudge);
    if (crossed.length > 0) {
      crossJudgeModel = crossed[0].judge!.crossJudge!.judgeModel;
      crossJudgeAverages = {};
      for (const dim of dims) {
        const vals = crossed.map((r) => (r.judge!.crossJudge!.scores as any)[dim] as number);
        crossJudgeAverages[dim] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
      }
    }
  }

  return {
    candidateId: candidate.id,
    model: candidate.model,
    turns: results.length,
    successfulHints: successful.length,
    errors,
    schemaInvalid,
    avgFirstTokenMs: avg(successful.map((r) => r.firstTokenMs)),
    avgFullOutputMs: avg(successful.map((r) => r.fullOutputMs)),
    avgReadyMs: avg(readyMsList),
    deadlineBuckets,
    clientRenderEstimateMs: CLIENT_RENDER_ESTIMATE_MS,
    clientRenderEstimated: true,
    avgTokensIn: avgIn,
    avgTokensOut: avgOut,
    estCostPer10MinCall,
    costNote,
    judgeAverages,
    judgeStds,
    crossJudgeModel,
    crossJudgeAverages,
  };
}
