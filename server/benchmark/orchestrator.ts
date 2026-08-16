// Run lifecycle for the LIVE Ears & Brain Benchmark. Each run is persisted to
// benchmark_runs (history: before/after comparisons). Runs execute in the
// background; the API returns the run id immediately and the UI polls.
//
// Continuity invariant enforced at every level: one failing candidate / turn
// / stage must never abort the rest of the run.

import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import { benchmarkRuns, benchmarkFixtures, type BenchmarkRun, type BenchmarkFixture } from "@shared/schema";
import { EARS_CANDIDATES, BRAIN_CANDIDATES } from "./candidates";
import type { AvailabilityResult } from "./types";
import { corpusHash } from "./seed";

type RunType = "ears" | "brain" | "availability" | "replay" | "goal_return";

async function createRun(runType: RunType, fixtures: BenchmarkFixture[], config: Record<string, unknown>, promptVersion = "v1"): Promise<BenchmarkRun> {
  const [row] = await db.insert(benchmarkRuns).values({
    runType,
    status: "running",
    corpusHash: corpusHash(fixtures),
    fixtureIds: fixtures.map((f) => f.id),
    config,
    promptVersion,
  }).returning();
  return row;
}

async function finishRun(id: string, patch: Partial<typeof benchmarkRuns.$inferInsert>) {
  await db.update(benchmarkRuns).set({ ...patch, finishedAt: new Date() }).where(eq(benchmarkRuns.id, id));
}

export async function getRun(id: string): Promise<BenchmarkRun | undefined> {
  const rows = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, id));
  return rows[0];
}

export async function listRuns(limit = 50): Promise<BenchmarkRun[]> {
  return db.select().from(benchmarkRuns).orderBy(desc(benchmarkRuns.startedAt)).limit(limit);
}

export async function listFixtures(): Promise<BenchmarkFixture[]> {
  const rows = await db.select().from(benchmarkFixtures);
  // Never ship multi-MB audio payloads in list responses.
  return rows.map((r) => ({ ...r, audioBase64: r.audioBase64 ? `<${Math.round(r.audioBase64.length / 1024)}KB audio attached>` : null }));
}

export async function getFixture(id: string): Promise<BenchmarkFixture | undefined> {
  const rows = await db.select().from(benchmarkFixtures).where(eq(benchmarkFixtures.id, id));
  return rows[0];
}

// ---------------------------------------------------------------------------
// Availability run (also embedded in ears/brain runs)
// ---------------------------------------------------------------------------

export async function runAvailabilityCheck(): Promise<{ runId: string }> {
  const run = await createRun("availability", [], { ears: EARS_CANDIDATES.map(c => c.id), brain: BRAIN_CANDIDATES.map(c => c.id) });
  void (async () => {
    try {
      const [{ checkEarsAvailability }, { checkBrainAvailability }] = await Promise.all([
        import("./earsAvailability"),
        import("./brainAvailability"),
      ]);
      const [ears, brain] = await Promise.all([
        checkEarsAvailability().catch((e: any): AvailabilityResult[] => [{ candidateId: "__ears_check__", status: "UNAVAILABLE", checkedAt: new Date().toISOString(), detail: String(e?.message ?? e) }]),
        checkBrainAvailability().catch((e: any): AvailabilityResult[] => [{ candidateId: "__brain_check__", status: "UNAVAILABLE", checkedAt: new Date().toISOString(), detail: String(e?.message ?? e) }]),
      ]);
      await finishRun(run.id, { status: "completed", availability: { ears, brain } });
    } catch (e: any) {
      await finishRun(run.id, { status: "failed", error: String(e?.message ?? e) });
    }
  })();
  return { runId: run.id };
}

// ---------------------------------------------------------------------------
// EARS run
// ---------------------------------------------------------------------------

/** Honest human-verification status per fixture for the report header. */
function summarizeVerification(fixtures: BenchmarkFixture[]): string[] {
  return fixtures.map((f) => {
    const turns = (f.referenceTurns as any[]) ?? [];
    const owners = turns.filter((t) => t?.role === "owner");
    const verified = owners.filter((t) => t?.verified === true).length;
    return `${f.title}: ${verified}/${owners.length} owner turns human-verified`;
  });
}

export async function startEarsRun(
  fixtureIds: string[],
  opts?: { candidateIds?: string[] }
): Promise<{ runId: string }> {
  const fixtures = (await Promise.all(fixtureIds.map(getFixture))).filter((f): f is BenchmarkFixture => !!f);
  // Optional candidate subset (e.g. realtime-only shortlist runs). Unknown ids
  // are rejected loudly — a silent no-op subset would fake an empty run.
  let candidates = EARS_CANDIDATES;
  if (opts?.candidateIds && opts.candidateIds.length > 0) {
    const unknown = opts.candidateIds.filter((id) => !EARS_CANDIDATES.some((c) => c.id === id));
    if (unknown.length > 0) throw new Error(`unknown EARS candidate ids: ${unknown.join(", ")}`);
    candidates = EARS_CANDIDATES.filter((c) => opts.candidateIds!.includes(c.id));
  }
  const run = await createRun("ears", fixtures, { candidates });
  void (async () => {
    try {
      const { checkEarsAvailability } = await import("./earsAvailability");
      const { runEarsBenchmark } = await import("./earsHarness");
      const availability = await checkEarsAvailability();
      const result = await runEarsBenchmark({ fixtures, candidates, availability });
      let report: string | null = null;
      try {
        const { generateEarsReport } = await import("./report");
        report = generateEarsReport({
          availability,
          scorecard: result.scorecard,
          notes: result.notes,
          fixtureTitles: fixtures.map((f) => f.title),
          realtimeIds: candidates.filter((c) => c.kind === "realtime" && !c.referenceOnly).map((c) => c.id),
          humanVerification: summarizeVerification(fixtures),
        });
      } catch (e: any) {
        report = `EARS report generation failed: ${String(e?.message ?? e)}`;
      }
      await finishRun(run.id, {
        status: "completed",
        availability: { ears: availability },
        results: { turnResults: result.turnResults, notes: result.notes },
        scorecard: result.scorecard,
        report,
      });
    } catch (e: any) {
      await finishRun(run.id, { status: "failed", error: String(e?.stack ?? e) });
    }
  })();
  return { runId: run.id };
}

// ---------------------------------------------------------------------------
// GOAL-RETURN analysis run (Task #227) — offline per-call analysis of whether
// the conversation stays on the goal, digresses when justified and returns.
// Each call in the batch is independent (continuity invariant: one failed
// judgement never aborts the rest).
// ---------------------------------------------------------------------------

export interface GoalReturnRunCall {
  title: string;
  goal: string;
  goalSource: string; // "frozen fixture <id>" | "operator-supplied" | ...
  transcript: string; // persisted "Speaker: text" format
  hintStats?: { hintsSent: number; hintsDropped: number } | null;
  // Explicit delivered-hint records; hint-level evaluation runs ONLY on these.
  hints?: { text: string; utteranceId?: number }[] | null;
}

export async function startGoalReturnRun(callsIn: GoalReturnRunCall[]): Promise<{ runId: string }> {
  if (callsIn.length === 0) throw new Error("no calls supplied");
  for (const c of callsIn) {
    if (!c.goal?.trim()) throw new Error(`call "${c.title}": goal required (goals are not persisted on production calls — supply one and record its source)`);
    if (!c.transcript?.trim()) throw new Error(`call "${c.title}": transcript required`);
  }
  const run = await createRun("goal_return", [], { calls: callsIn.map(({ transcript, ...rest }) => ({ ...rest, transcriptChars: transcript.length })) });
  void (async () => {
    try {
      const { checkBrainAvailability } = await import("./brainAvailability");
      const { pickJudgeModel } = await import("./judge");
      const { BRAIN_CANDIDATES } = await import("./candidates");
      const {
        parseTranscriptTurns, judgeGoalReturn, computeGoalReturnMetrics,
        judgeDeliveredHints, computeHintMetrics, generateGoalReturnReport,
      } = await import("./goalReturn");

      const availability = await checkBrainAvailability();
      const judgeModel = pickJudgeModel(BRAIN_CANDIDATES, availability);
      if (!judgeModel) {
        // Fail-closed: no available judge => the run fails loudly.
        await finishRun(run.id, { status: "failed", availability: { brain: availability }, error: "no judge model available — goal-return analysis cannot run" });
        return;
      }

      const reportInputs = [] as any[];
      for (const c of callsIn) {
        const turns = parseTranscriptTurns(c.transcript);
        const notes: string[] = [];
        let judgement = null;
        let metrics = null;
        let hintJudgement = null;
        let hintMetrics = null;
        if (turns.length === 0) {
          notes.push("transcript parsed to zero turns — not scoreable");
        } else {
          judgement = await judgeGoalReturn(judgeModel, c.goal, turns).catch((e: any) => {
            notes.push(`judge error: ${String(e?.message ?? e)}`);
            return null;
          });
          if (judgement) metrics = computeGoalReturnMetrics(turns, judgement.labels);
          else if (notes.length === 0) notes.push("judge returned no valid labeling (fail-closed)");
          // Hint-level evaluation ONLY over explicit hint records.
          if (Array.isArray(c.hints) && c.hints.length > 0) {
            hintJudgement = await judgeDeliveredHints(judgeModel, c.goal, turns, c.hints).catch((e: any) => {
              notes.push(`hint judge error: ${String(e?.message ?? e)}`);
              return null;
            });
            if (hintJudgement) hintMetrics = computeHintMetrics(c.hints, hintJudgement.labels);
            else notes.push("hint judge returned no valid labeling — hints unscored (fail-closed)");
          }
        }
        reportInputs.push({
          title: c.title, goal: c.goal, goalSource: c.goalSource, judgement, metrics, turns,
          hintStats: c.hintStats ?? null, hints: c.hints ?? null, hintJudgement, hintMetrics, notes,
        });
      }

      const report = generateGoalReturnReport(reportInputs);
      await finishRun(run.id, {
        status: "completed",
        availability: { brain: availability },
        results: {
          judgeModel,
          calls: reportInputs.map((r) => ({
            title: r.title, goal: r.goal, goalSource: r.goalSource,
            labels: r.judgement?.labels ?? null, rationale: r.judgement?.rationale ?? null,
            turns: r.turns ?? null,
            metrics: r.metrics, hintStats: r.hintStats,
            hints: r.hints, hintLabels: r.hintJudgement?.labels ?? null,
            hintRationale: r.hintJudgement?.rationale ?? null, hintMetrics: r.hintMetrics,
            notes: r.notes,
          })),
        },
        scorecard: { calls: reportInputs.map((r) => ({ title: r.title, ...(r.metrics ?? { unscored: true }) })) },
        report,
      });
    } catch (e: any) {
      await finishRun(run.id, { status: "failed", error: String(e?.stack ?? e) });
    }
  })();
  return { runId: run.id };
}

// ---------------------------------------------------------------------------
// BRAIN run
// ---------------------------------------------------------------------------

export async function startBrainRun(fixtureId: string, opts?: { judgeEnabled?: boolean }): Promise<{ runId: string }> {
  const fixture = await getFixture(fixtureId);
  if (!fixture) throw new Error("fixture not found");
  const { PROMPT_VERSION } = await import("./brainEnvelope");
  const run = await createRun("brain", [fixture], { candidates: BRAIN_CANDIDATES, judgeEnabled: opts?.judgeEnabled !== false }, PROMPT_VERSION);
  void (async () => {
    try {
      const { checkBrainAvailability } = await import("./brainAvailability");
      const { runBrainBenchmark } = await import("./brainHarness");
      const availability = await checkBrainAvailability();
      const result = await runBrainBenchmark({
        fixture: fixture as any,
        candidates: BRAIN_CANDIDATES,
        availability,
        judgeEnabled: opts?.judgeEnabled !== false,
      });
      const { generateReport } = await import("./report");
      let report: string | null = null;
      try {
        report = generateReport({
          earsAvailability: [],
          brainAvailability: availability,
          earsHadRealAudio: false,
          earsNotes: [],
          brainScorecard: result.scorecard,
          brainTurnResults: result.turnResults,
          brainContinuity: result.continuity,
          judgeModel: result.judgeModel,
          secondJudgeModel: result.secondJudgeModel,
          promptVersion: PROMPT_VERSION,
          fixtureTitle: fixture.title,
        });
      } catch (e: any) {
        report = `Report generation failed: ${String(e?.message ?? e)}`;
      }
      await finishRun(run.id, {
        status: "completed",
        availability: { brain: availability },
        results: { turnResults: result.turnResults, continuity: result.continuity, judgeModel: result.judgeModel, secondJudgeModel: result.secondJudgeModel, notes: result.notes },
        scorecard: result.scorecard,
        report,
      });
    } catch (e: any) {
      await finishRun(run.id, { status: "failed", error: String(e?.stack ?? e) });
    }
  })();
  return { runId: run.id };
}
