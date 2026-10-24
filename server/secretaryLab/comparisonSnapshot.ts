import type { ComparisonMode, ComparisonRun } from "../../shared/secretaryLabComparison";
import type { LabReport } from "./service";
import type { RetellReport } from "./retell";

/** Free text may echo provider errors or user-pasted credentials. No URLs are
 * needed for an offline comparison; exclude ALL URLs, not just known hosts.
 * Structured admission/callback/provider objects are never traversed. */
export function comparisonText(value: unknown, max = 4000): string {
  return (typeof value === "string" ? value : "")
    .replace(/(?:https?|wss?):\/\/[^\s<>"'`]+/gi, "[URL removed]")
    .replace(/\/retell-engine-stream\/[^\s<>"'`]+/gi, "[capability removed]")
    .replace(/\bBearer\s+[^\s"',;}]+/gi, "Bearer [removed]")
    .replace(/((?:access[_ -]?token|talkhint_engine_ticket|capability|api[_ -]?key|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1[removed]")
    .replace(/\b[a-f0-9]{64}\b/gi, "[opaque credential removed]")
    .slice(0, max);
}
const time = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Explicit projection, never serialize a Session/Entry, call admission, provider
 * reply, arbitrary engine context or unknown tool arguments/results. */
export function comparisonSnapshot(mode: ComparisonMode, report: LabReport | RetellReport): ComparisonRun {
  const gpt = mode === "gpt" ? report as LabReport : undefined;
  const retell = mode !== "gpt" ? report as RetellReport : undefined;
  const snapshot: ComparisonRun = {
    mode, id: report.id,
    runtime: gpt ? `TalkHint / ${gpt.transport} / ${gpt.voiceProvider}` :
      mode === "retell-engine" ? "Retell voice / TalkHint text Engine" : "Retell managed runtime",
    model: comparisonText(retell?.engine?.model ?? report.model, 160),
    voice: comparisonText(report.voice, 160),
    instruction: comparisonText(report.instruction),
    status: report.status,
    createdAt: report.createdAt,
    endedAt: report.endedAt,
    verification: gpt ? (gpt.modelVerified ? "model_verified_by_runtime" : "configuration_only") :
      "agent_configuration_verified_at_admission; audibility_not_measured",
    reason: comparisonText(report.reason, 300),
    turns: report.turns.slice(0, 300).map(t => ({
      id: comparisonText(t.id, 100), role: t.role, text: comparisonText(t.text), atMs: time(t.atMs),
      ...("translation" in t && t.translation ? { translation: comparisonText(t.translation) } : {}),
      ...("interrupted" in t ? { interrupted: t.interrupted === true } : {}),
    })),
    events: report.events.slice(0, 300).map(e => ({
      type: comparisonText(e.type, 100), atMs: time(e.atMs), detail: comparisonText(e.detail),
    })),
    metrics: {
      guestTurns: time(report.metrics.guestTurns), secretaryTurns: time(report.metrics.secretaryTurns),
      ...(gpt ? { firstAudioMs: time(gpt.metrics.firstAudioMs), lastTurnToAudioMs: time(gpt.metrics.lastTurnToAudioMs) } : {}),
    },
    ...(retell ? {
      monitorStatus: retell.monitorStatus,
      promptHash: /^[a-f0-9]{64}$/i.test(retell.promptHash) ? retell.promptHash : undefined,
      observations: retell.observations.slice(0, 100).map(o => ({
        atMs: time(o.atMs), outcome: o.outcome, note: comparisonText(o.note, 1000),
      })),
    } : {}),
  };
  const engine = retell?.engine;
  if (engine) {
    snapshot.engine = {
      provider: comparisonText(engine.provider, 160), model: comparisonText(engine.model, 160),
      testOnly: engine.testOnly === true, connected: engine.connected === true,
      // A fixture identifier is enough to recover authorized test context;
      // never copy a future real calendar/notification object into this store.
      context: { id: comparisonText(engine.context.id, 100), testOnly: true },
      actions: engine.actions.slice(0, 50)
        .filter(a => ["save_test_message", "prepare_test_booking"].includes(a.name))
        .map(a => ({
          id: comparisonText(a.id, 100), name: a.name, status: a.status,
          args: Object.fromEntries((a.name === "save_test_message" ? ["sender", "message"] : ["startsAt", "note"])
            .filter(key => typeof a.args?.[key] === "string")
            .map(key => [key, comparisonText(a.args[key], 2000)])),
          result: {
            ok: a.result?.ok === true, testOnly: a.result?.testOnly === true,
            id: comparisonText(a.result?.id, 100), status: comparisonText(a.result?.status, 100),
            delivered: a.result?.delivered === true, calendarWritten: a.result?.calendarWritten === true,
          },
        })),
      events: engine.events.slice(0, 200).map(e => ({ type: comparisonText(e.type, 100), at: comparisonText(e.at, 100) })),
    };
  }
  return snapshot;
}
