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

type RunType = "ears" | "brain" | "availability" | "replay";

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
          promptVersion: PROMPT_VERSION,
          fixtureTitle: fixture.title,
        });
      } catch (e: any) {
        report = `Report generation failed: ${String(e?.message ?? e)}`;
      }
      await finishRun(run.id, {
        status: "completed",
        availability: { brain: availability },
        results: { turnResults: result.turnResults, continuity: result.continuity, judgeModel: result.judgeModel, notes: result.notes },
        scorecard: result.scorecard,
        report,
      });
    } catch (e: any) {
      await finishRun(run.id, { status: "failed", error: String(e?.stack ?? e) });
    }
  })();
  return { runId: run.id };
}
