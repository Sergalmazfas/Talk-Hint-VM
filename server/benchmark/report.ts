// Final report generator: EARS WINNER / BRAIN WINNER / BOTTLENECK /
// RECOMMENDED PIPELINE. Honest by construction: winners are only declared
// from real measured data; missing data is stated, never papered over.

import type { AvailabilityResult, BrainTurnResult, ContinuityMetrics } from "./types";
import type { BrainScorecardEntry } from "./brainHarness";
import type { EarsScorecardRow } from "./earsMetrics";

// ---------------------------------------------------------------------------
// EARS-only report: who actually HEARS the real phone call best.
// Owner accuracy is the headline metric — TalkHint exists because the Owner
// may speak with an accent, in short phrases, with mistakes; the Guest is
// usually a clear operator/IVR. Batch candidates are an accuracy ceiling and
// are never declared a LIVE winner. Nothing here auto-changes production.
// ---------------------------------------------------------------------------

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function bestBy(rows: EarsScorecardRow[], key: "ownerWer" | "guestWer" | "wer"): EarsScorecardRow | null {
  const usable = rows.filter((r) => r[key] != null);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => ((a[key] as number) <= (b[key] as number) ? a : b));
}

export function generateEarsReport(inp: {
  availability: AvailabilityResult[];
  scorecard: EarsScorecardRow[];
  notes: string[];
  fixtureTitles: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# LIVE EARS Benchmark — Run Report`);
  lines.push(`Fixtures: ${inp.fixtureTitles.join("; ") || "—"} · ${new Date().toISOString()}`);
  lines.push("");

  lines.push(`## Candidate availability (real API checks — unavailable is shown, never substituted)`);
  for (const a of inp.availability) lines.push(`- ${a.candidateId}: **${a.status}** — ${a.detail}`);
  lines.push("");

  // A row is scoreable when it has any channel-level samples (accuracy columns
  // are channel-level for everyone); per-turn availability (turnsScored) only
  // affects turn-boundary metrics, not eligibility here.
  const scoreable = (r: EarsScorecardRow) => (r.channelsScored ?? r.turnsScored) > 0;
  const live = inp.scorecard.filter((r) => !r.referenceOnly && scoreable(r));
  const ceiling = inp.scorecard.filter((r) => r.referenceOnly && scoreable(r));

  lines.push(`## Best STT for Owner speech (LIVE candidates only — headline metric)`);
  const bestOwner = bestBy(live, "ownerWer");
  lines.push(bestOwner
    ? `**${bestOwner.candidateId}** — Owner WER ${fmtPct(bestOwner.ownerWer)} (overall WER ${fmtPct(bestOwner.wer)}). ` +
      `Owner accuracy matters most: the Owner speaks with an accent, short phrases and mistakes — that is why TalkHint exists.`
    : `No LIVE candidate produced scoreable Owner turns — no conclusion can be drawn.`);
  lines.push("");

  lines.push(`## Best STT for Guest speech / overall call (LIVE candidates only)`);
  const bestGuest = bestBy(live, "guestWer");
  const bestOverall = bestBy(live, "wer");
  lines.push(bestGuest
    ? `Guest: **${bestGuest.candidateId}** — Guest WER ${fmtPct(bestGuest.guestWer)}.`
    : `Guest: no scoreable Guest turns.`);
  lines.push(bestOverall
    ? `Overall call: **${bestOverall.candidateId}** — WER ${fmtPct(bestOverall.wer)}.`
    : `Overall: no scoreable turns.`);
  lines.push("");

  lines.push(`## Accuracy ceiling (batch reference — NOT a LIVE candidate)`);
  if (ceiling.length === 0) {
    lines.push(`No batch reference results in this run.`);
  } else {
    for (const r of ceiling) {
      lines.push(`- ${r.candidateId}: WER ${fmtPct(r.wer)} (Owner ${fmtPct(r.ownerWer)}, Guest ${fmtPct(r.guestWer)}). ` +
        `Higher-latency batch transcription; shows how much accuracy is theoretically available, but cannot win a LIVE comparison.`);
    }
  }
  lines.push("");

  lines.push(`## Scorecard (single comparability rule for every candidate)`);
  lines.push(`WER / Owner WER / Guest WER / Semantic are CHANNEL-LEVEL (whole per-role stream scored as one document) for ALL candidates — Flux, nova-3, OpenAI realtime and batch are measured by the same method. Per-turn metrics (EOT, premature, false wait) exist only where the finals→turns mapping is provable WITHOUT the candidate's own text — reference turn boundaries (tEndMs) matched against provider-reported audio offsets; count, order, receipt time or text inference are never used. Otherwise per-turn metrics are unavailable, never inferred.`);
  lines.push(`| STT | LIVE? | WER | Owner WER | Guest WER | Semantic* | Numbers | Terms | Final p50 | Per-turn basis | Turns |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of inp.scorecard) {
    lines.push(`| ${r.candidateId} | ${r.referenceOnly ? "ceiling" : "LIVE"} | ${fmtPct(r.wer)} | ${fmtPct(r.ownerWer)} | ${fmtPct(r.guestWer)} | ${fmtPct(r.semantic)} | ${fmtPct(r.numbersMoney)} | ${fmtPct(r.terms)} | ${r.finalP50 != null ? Math.round(r.finalP50) + "ms" : "—"} | ${r.perTurnBasis ?? "—"} | ${r.turnsScored} |`);
  }
  lines.push(`*Semantic is a content-word proxy, not an embedding score. EOT/premature-EOT metrics are null until per-turn boundary ground truth exists — they are never fabricated.`);
  lines.push("");

  lines.push(`## Decision`);
  lines.push(`No candidate is auto-assigned as production winner. Production STT stays unchanged (Deepgram Flux flux-general-en) until a human decides otherwise.`);
  if (inp.notes.length) {
    lines.push("");
    lines.push(`## Notes`);
    for (const n of inp.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

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
