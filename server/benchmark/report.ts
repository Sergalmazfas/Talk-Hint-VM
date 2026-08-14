// Final report generator: EARS WINNER / BRAIN WINNER / BOTTLENECK /
// RECOMMENDED PIPELINE. Honest by construction: winners are only declared
// from real measured data; missing data is stated, never papered over.

import type { AvailabilityResult, BrainTurnResult, ContinuityMetrics } from "./types";
import type { BrainScorecardEntry } from "./brainHarness";

export interface ReportInput {
  earsAvailability: AvailabilityResult[];
  brainAvailability: AvailabilityResult[];
  earsHadRealAudio: boolean;
  earsNotes: string[];
  brainScorecard: { candidates: BrainScorecardEntry[] } | null;
  brainTurnResults: BrainTurnResult[];
  brainContinuity: Record<string, ContinuityMetrics>;
  judgeModel: string | null;
  promptVersion: string;
  fixtureTitle: string;
}

function fmtMs(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)}ms`;
}

function detPassRate(turns: BrainTurnResult[], candidateId: string): number | null {
  const mine = turns.filter((t) => t.candidateId === candidateId && t.deterministic);
  if (mine.length === 0) return null;
  const passed = mine.filter((t) => {
    const d = t.deterministic!;
    return d.schemaValid && d.strategyValid && d.nonRepetition &&
      d.sideTopicHandled !== false && d.mentionsCriticalEntityWhenExpected !== false;
  }).length;
  return passed / mine.length;
}

export function generateReport(inp: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# LIVE Ears & Brain Benchmark — Run Report`);
  lines.push(`Fixture: ${inp.fixtureTitle} · Prompt: ${inp.promptVersion} · Judge: ${inp.judgeModel ?? "none"} · ${new Date().toISOString()}`);
  lines.push("");

  lines.push(`## Candidate availability (real API checks)`);
  for (const a of [...inp.earsAvailability, ...inp.brainAvailability]) {
    lines.push(`- ${a.candidateId}: **${a.status}** — ${a.detail}`);
  }
  lines.push("");

  lines.push(`## EARS WINNER`);
  if (!inp.earsHadRealAudio) {
    lines.push(`**No winner can be declared.** No real audio fixtures exist yet (TalkHint has never recorded call audio). ` +
      `Availability of every STT candidate was verified with real API calls (see above), but accuracy/latency comparison requires real dual-channel call audio. ` +
      `Next step: enable the opt-in recording toggle (BENCHMARK_CALL_RECORDING=1) for a few benchmark calls, or upload audio fixtures in the admin UI.`);
  } else {
    lines.push(`See EARS scorecard in the run results.`);
  }
  for (const n of inp.earsNotes) lines.push(`- note: ${n}`);
  lines.push("");

  lines.push(`## BRAIN WINNER`);
  const entries = inp.brainScorecard?.candidates ?? [];
  const usable = entries.filter((e) => e.successfulHints > 0);
  type Ranked = BrainScorecardEntry & { judgeOverall: number | null; detRate: number | null; selfJudged: boolean };
  const ranked: Ranked[] = usable.map((e) => ({
    ...e,
    judgeOverall: e.judgeAverages?.overall_live_copilot_quality ?? null,
    detRate: detPassRate(inp.brainTurnResults, e.candidateId),
    selfJudged: inp.judgeModel != null && e.model === inp.judgeModel,
  })).sort((a, b) =>
    (b.judgeOverall ?? 0) - (a.judgeOverall ?? 0) ||
    (b.detRate ?? 0) - (a.detRate ?? 0) ||
    (a.avgReadyMs ?? Infinity) - (b.avgReadyMs ?? Infinity));

  if (ranked.length === 0) {
    lines.push(`No BRAIN candidate produced usable results.`);
  } else {
    const w = ranked[0];
    lines.push(`**${w.candidateId}** (${w.model}) — judge overall ${w.judgeOverall ?? "—"}/10${w.selfJudged ? " (self-judged!)" : ""}, ` +
      `deterministic pass rate ${w.detRate != null ? Math.round(w.detRate * 100) + "%" : "—"}, ` +
      `avg ready ${fmtMs(w.avgReadyMs)}, cost/10-min call ${w.estCostPer10MinCall != null ? "$" + w.estCostPer10MinCall.toFixed(4) : `unknown (${w.costNote})`}.`);
    lines.push("");
    lines.push(`| Candidate | Judge avg | Det. pass | First token | Ready avg | ≤1000ms | Missed hints | Cost/10min |`);
    lines.push(`|---|---|---|---|---|---|---|---|`);
    for (const r of ranked) {
      const cont = inp.brainContinuity[r.candidateId];
      const b1000 = r.deadlineBuckets?.["<=1000"];
      lines.push(`| ${r.candidateId}${r.selfJudged ? " (self-judged)" : ""} | ${r.judgeOverall ?? "—"} | ${r.detRate != null ? Math.round(r.detRate * 100) + "%" : "—"} | ${fmtMs(r.avgFirstTokenMs)} | ${fmtMs(r.avgReadyMs)} | ${b1000 ? b1000.pct + "%" : "—"} | ${cont ? `${cont.hintsMissed} (max ${cont.maxConsecutiveMissedHints} in a row)` : "—"} | ${r.estCostPer10MinCall != null ? "$" + r.estCostPer10MinCall.toFixed(4) : "unknown"} |`);
    }
  }
  lines.push("");

  lines.push(`## BOTTLENECK`);
  if (!inp.earsHadRealAudio) {
    const readys = ranked.map((r) => r.avgReadyMs).filter((v): v is number => v != null);
    const brainBest = readys.length ? Math.min(...readys) : null;
    lines.push(`With no EARS timing data, only the BRAIN half of the pipeline is measured: best candidate averages ${fmtMs(brainBest)} from Guest-turn end to suggestion ready (client render ≈ +75ms, estimated). ` +
      `In production, total hint delay = STT end-of-turn detection + this. The unmeasured EARS EOT stage (production Flux eot_timeout up to 3000ms on silence) is very likely the larger share — measure it once real audio fixtures exist.`);
  } else {
    lines.push(`Compare EARS final/EOT latencies with BRAIN latencies in the scorecards.`);
  }
  lines.push("");

  lines.push(`## RECOMMENDED PIPELINE`);
  lines.push(`- EARS: keep production Deepgram Flux (flux-general-en) unchanged — no measured evidence justifies a change yet.`);
  if (ranked.length > 0) {
    const baseline = ranked.find((r) => r.candidateId === "current-production");
    const best = ranked[0];
    if (best.candidateId !== "current-production" && baseline && (best.judgeOverall ?? 0) > (baseline.judgeOverall ?? 0)) {
      lines.push(`- BRAIN: **${best.candidateId}** scored above current production on this corpus (${best.judgeOverall} vs ${baseline.judgeOverall ?? "—"}). Recommendation only — production stays unchanged; no auto-switching exists.`);
    } else {
      lines.push(`- BRAIN: no candidate demonstrably beat current production on this corpus — keep the current production model.`);
    }
  }
  lines.push(`- Re-run this benchmark after collecting real dual-channel audio fixtures to complete the EARS half.`);
  return lines.join("\n");
}
