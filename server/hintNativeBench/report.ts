import type { Provider } from "./contracts";
import type { replay } from "./replay";
import type { NativeLedger } from "./ledger";

export type Attempt = {
  provider: Provider; model: string; fixtureId: string; corpusHash: string; panelHash: string;
  measurement: Awaited<ReturnType<typeof replay>>; quality: number | null; entryIds: string[];
};
export function percentile(values: number[], q: number) {
  if (!values.length) return null;
  if (values.some(v => !Number.isFinite(v) || v < 0)) throw Error("INVALID_LATENCY");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
}
/** Timing never absorbs clock/API failures; money never discards their attempts. */
export function comparison(attempts: Attempt[], panelIds: string[], corpusHash: string, panelHash: string,
  state: ReturnType<NativeLedger["snapshot"]>) {
  if (attempts.some(a => a.corpusHash !== corpusHash || a.panelHash !== panelHash || !panelIds.includes(a.fixtureId)))
    throw Error("UNMATCHED_COMPARISON_INPUTS");
  const keys = attempts.map(a => `${a.provider}:${a.fixtureId}`);
  if (new Set(keys).size !== keys.length) throw Error("DUPLICATE_ATTEMPT_NO_OVERWRITE");
  const referenced = new Set<string>();
  const rows = (["openai", "gemini"] as const).map(provider => {
    const own = attempts.filter(a => a.provider === provider), good = own.filter(a => a.measurement.valid);
    if (new Set(own.map(a => a.model)).size > 1) throw Error("MODEL_SUBSTITUTION_IN_SERIES");
    const first = good.flatMap(a => a.measurement.latencyMs), full = good.flatMap(a => a.measurement.fullLatencyMs);
    const eligible = good.reduce((s, a) => s + a.measurement.eligible, 0);
    const missing = good.reduce((s, a) => s + a.measurement.missing, 0);
    const entries = own.flatMap(a => a.entryIds.map(id => {
      const e = state.entries.find(e => e.id === id);
      if (!e || referenced.has(id)) throw Error("COST_PROVENANCE_MISSING_OR_DUPLICATE");
      referenced.add(id); return e;
    }));
    const qualities = good.filter(a => a.quality !== null).map(a => a.quality!);
    return {
      provider, model: own[0]?.model ?? null, status: own.length ? "ATTEMPTED" : "NOT_RUN_PREPARATION_ONLY",
      attempts: own.length, validCalls: good.length, failedCalls: own.length - good.length,
      p50FirstWordMs: percentile(first, .5), p95FirstWordMs: percentile(first, .95),
      p50FullHintMs: percentile(full, .5), p95FullHintMs: percentile(full, .95),
      eligibleTurnCoverage: eligible ? (eligible - missing) / eligible : null,
      recordingCoverage: panelIds.length ? good.length / panelIds.length : null,
      quality: qualities.length ? qualities.reduce((s, q) => s + q, 0) / qualities.length : null,
      qualityCalls: qualities.length, missing,
      heldCostMicroUsd: own.length ? entries.reduce((s, e) => s + (e.status === "spent" ? e.charged : e.reserve), 0) : null,
      unknownReservations: entries.filter(e => e.status !== "spent").length,
      errors: own.filter(a => !a.measurement.valid).map(a => ({ fixtureId: a.fixtureId, error: a.measurement.error })),
    };
  });
  const commonValidIds = panelIds.filter(id => (["openai", "gemini"] as const).every(p =>
    attempts.some(a => a.provider === p && a.fixtureId === id && a.measurement.valid)));
  return {
    rows, commonValidIds, pairedComplete: commonValidIds.length === panelIds.length && panelIds.length > 0,
    heldMicroUsd: state.entries.reduce((s, e) => s + (e.status === "spent" ? e.charged : e.reserve), 0),
    diagnosticAndControlMicroUsd: state.entries.filter(e => !referenced.has(e.id))
      .reduce((s, e) => s + (e.status === "spent" ? e.charged : e.reserve), 0),
    ledger: state, costBasis: "usage estimate + full unknown reserves; not an invoice",
  };
}
