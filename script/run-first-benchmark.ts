// First full LIVE Ears & Brain Benchmark run (Run #1).
// Executes availability checks for ALL candidates (real API calls), then the
// full BRAIN benchmark on the Gold Call frozen transcript, persists both as
// benchmark_runs history rows, and writes the final report to docs/.
// Usage: npx tsx script/run-first-benchmark.ts

import fs from "fs";
import { eq } from "drizzle-orm";
import { db, dbReady } from "../server/db";
import { benchmarkRuns } from "@shared/schema";
import { ensureGoldCallFixture, corpusHash } from "../server/benchmark/seed";
import { EARS_CANDIDATES, BRAIN_CANDIDATES } from "../server/benchmark/candidates";
import { checkEarsAvailability } from "../server/benchmark/earsAvailability";
import { checkBrainAvailability } from "../server/benchmark/brainAvailability";
import { runBrainBenchmark } from "../server/benchmark/brainHarness";
import { PROMPT_VERSION } from "../server/benchmark/brainEnvelope";
import { generateReport } from "../server/benchmark/report";

async function main() {
  await dbReady;
  const fixture = await ensureGoldCallFixture();
  console.log("[1/4] Gold Call fixture:", fixture.id, fixture.title);

  console.log("[2/4] Availability checks (real API calls)...");
  const [ears, brain] = await Promise.all([checkEarsAvailability(), checkBrainAvailability()]);
  for (const a of [...ears, ...brain]) console.log(`  ${a.status.padEnd(11)} ${a.candidateId} — ${a.detail.slice(0, 140)}`);

  const [availRun] = await db.insert(benchmarkRuns).values({
    runType: "availability", status: "completed",
    config: { ears: EARS_CANDIDATES.map(c => c.id), brain: BRAIN_CANDIDATES.map(c => c.id) },
    availability: { ears, brain }, finishedAt: new Date(),
  }).returning();
  console.log("  availability run saved:", availRun.id);

  console.log("[3/4] BRAIN benchmark on Gold Call (judge enabled)...");
  const [run] = await db.insert(benchmarkRuns).values({
    runType: "brain", status: "running",
    corpusHash: corpusHash([fixture]),
    fixtureIds: [fixture.id],
    config: { candidates: BRAIN_CANDIDATES, judgeEnabled: true, trigger: "first-full-run-script" },
    promptVersion: PROMPT_VERSION,
  }).returning();

  try {
    const result = await runBrainBenchmark({
      fixture: fixture as any,
      candidates: BRAIN_CANDIDATES,
      availability: brain,
      judgeEnabled: true,
      onProgress: (m) => console.log("   ", m),
    });

    const report = generateReport({
      earsAvailability: ears,
      brainAvailability: brain,
      earsHadRealAudio: false,
      earsNotes: ["EARS accuracy run skipped: no real audio fixtures yet (TalkHint has never recorded call audio; recording toggle is opt-in and OFF)."],
      brainScorecard: result.scorecard,
      brainTurnResults: result.turnResults,
      brainContinuity: result.continuity,
      judgeModel: result.judgeModel,
      promptVersion: PROMPT_VERSION,
      fixtureTitle: fixture.title,
    });

    await db.update(benchmarkRuns).set({
      status: "completed",
      availability: { ears, brain },
      results: { turnResults: result.turnResults, continuity: result.continuity, judgeModel: result.judgeModel, notes: result.notes },
      scorecard: result.scorecard,
      report,
      finishedAt: new Date(),
    }).where(eq(benchmarkRuns.id, run.id));

    fs.writeFileSync("docs/benchmark-run-1-report.md", report);
    console.log("[4/4] DONE. Run id:", run.id);
    console.log("\n" + report);
  } catch (e: any) {
    await db.update(benchmarkRuns).set({ status: "failed", error: String(e?.stack ?? e), finishedAt: new Date() }).where(eq(benchmarkRuns.id, run.id));
    throw e;
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
