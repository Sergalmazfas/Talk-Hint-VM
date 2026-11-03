import { log, type CrewState } from "./domain";
import { FAILED_PILOT_RUN, FAILED_PILOT_TASK, isSupersededChargedUnknown } from "./failedPilot";
import { HINT_AGENTS, pilotReviewComplete } from "./hintPilot";

// One owner decision. No caller-supplied task, run, amount or outcome.
export const COMPLETED_HINT_TASK = "52931a27-4077-463e-9564-1e8f13ed83f8";
const SERIES = "56a644e1-7ceb-4463-a3ef-4d112928ac1d";
const AMOUNT = 36716;
export type HintSeriesCompletion = {
  at: string; actor: "replit-test"; seriesId: string; taskId: string; runId: string;
  amountMicroUsd: number; proposalId: string; reviewId: string;
  verdict: "not_confirmed"; ownerAcceptance: false; providerOutcome: "unknown";
};

/** Validate everything before mutating. Caller holds the durable row lock/CAS.
 * Unknown was ALREADY charged to the lifetime series; transfer only the daily
 * reserve to daily spent, never charge the grant twice or retry the provider. */
export function finalizeHintSeries(s: CrewState, at: string) {
  if (s.hintSeriesCompletion) throw Error("HINT_SERIES_ALREADY_FINALIZED");
  const g = s.testGrant;
  if (s.control.enabled || s.secretarySettings?.enabled ||
      s.runs.some(r => r.status === "queued" || r.status === "running") || s.schedules.length)
    throw Error("HINT_SERIES_REQUIRES_OFF_IDLE");
  if (!g || g.id !== SERIES || s.control.testSeriesId !== SERIES || g.reserved !== 0 ||
      !Number.isSafeInteger(g.spent) || g.spent < AMOUNT || g.spent > g.limit)
    throw Error("HINT_SERIES_SCOPE_MISMATCH");
  const task = s.tasks.find(t => t.id === COMPLETED_HINT_TASK), p = task?.hintPilot;
  const runs = s.runs.filter(r => r.taskId === COMPLETED_HINT_TASK);
  if (!task || s.tasks.filter(t => t.id === COMPLETED_HINT_TASK).length !== 1 ||
      task.closed || task.phase !== "analysis" || task.testSeriesId !== SERIES ||
      p?.ownerId !== "replit-test" || p.verdict !== "not_confirmed" || !pilotReviewComplete(s, task) ||
      runs.length !== 2 || runs.some(r => r.status !== "done" || r.testSeriesId !== SERIES ||
        !Number.isSafeInteger(r.cost) || r.cost! < 0) ||
      new Set(runs.map(r => r.agentId)).size !== 2 ||
      !HINT_AGENTS.every(a => runs.some(r => r.agentId === a.agentId)) ||
      s.tasks.some(t => !t.closed && t.id !== task.id))
    throw Error("HINT_SERIES_COMPLETED_PILOT_MISMATCH");
  for (const id of [p.proposalId, p.reviewId]) {
    const d = s.documents.find(d => d.id === id);
    const r = runs.find(r => r.id === d?.runId);
    if (!d || !r || d.agentId !== r.agentId || d.taskId !== task.id || d.status !== "proposed" || !d.text.trim())
      throw Error("HINT_SERIES_DOCUMENT_MISMATCH");
  }
  const run = s.runs.find(r => r.id === FAILED_PILOT_RUN);
  const b = run?.day ? s.budget[run.day] : undefined;
  if (!run || s.runs.filter(r => r.id === FAILED_PILOT_RUN).length !== 1 ||
      run.taskId !== FAILED_PILOT_TASK || !isSupersededChargedUnknown(s, run) ||
      s.runs.filter(r => r.status === "unknown").length !== 1 || !b ||
      !Number.isSafeInteger(b.spent) || b.spent < 0 || !Number.isSafeInteger(b.spent + AMOUNT) ||
      b.reserved !== AMOUNT || Object.values(s.budget).some(x =>
        !Number.isSafeInteger(x.spent) || x.spent < 0 || !Number.isSafeInteger(x.reserved) || x.reserved < 0) ||
      Object.values(s.budget).reduce((n, x) => n + x.reserved, 0) !== AMOUNT)
    throw Error("HINT_SERIES_UNKNOWN_ACCOUNTING_MISMATCH");

  const receipt: HintSeriesCompletion = { at, actor: "replit-test", seriesId: SERIES,
    taskId: task.id, runId: run.id, amountMicroUsd: AMOUNT, proposalId: p.proposalId!,
    reviewId: p.reviewId!, verdict: "not_confirmed", ownerAcceptance: false, providerOutcome: "unknown" };
  b.reserved -= AMOUNT; b.spent += AMOUNT;
  run.reserved = 0; run.cost = AMOUNT; // status stays unknown: accounting is not provider success.
  task.closed = true; task.phase = "outcome";
  task.steps.push({ phase: "outcome", holder: "replit-test", actor: "replit-test", updatedAt: at,
    note: "Пилот выполнен: разбор Паши + вердикт Фомы «не подтверждено». Без приёмки владельцем.",
    actual: `Разбор: ${p.proposalId}; проверка: ${p.reviewId}; не подтверждено. Приёмка владельцем не выполнялась.` });
  s.hintSeriesCompletion = receipt;
  delete s.control.testSeriesId;
  s.control.epoch++; // Invalidate any stale local work; stays OFF, limit untouched.
  log(s, "replit-test", "hint_series_finalized", { ...receipt, grantSpentUnchanged: true,
    dailyReserveTransferred: AMOUNT, agentsStarted: false, retried: false, enabled: false }, at);
}
