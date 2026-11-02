import { log, type CrewState, type Run } from "./domain";

// Owner approved a NEW Sonnet→Opus pilot after fixing the request, NOT a retry.
export const FAILED_PILOT_TASK = "1f21a46d-a564-47d1-8989-16dab6702f36";
export const FAILED_PILOT_RUN = "fecfac6c-08ab-4da6-9513-8ee0e997b69f";
const amount = 36716;
export function isSupersededChargedUnknown(s: CrewState, run: Run) {
  const g = s.testGrant, task = s.tasks.find(t => t.id === FAILED_PILOT_TASK);
  return !!g && run.id === FAILED_PILOT_RUN && run.taskId === FAILED_PILOT_TASK &&
    run.status === "unknown" && run.testSeriesId === g.id && task?.testSeriesId === g.id &&
    task.closed === true && task.phase === "outcome" && task.hintPilot?.status === "not_completed" &&
    run.reserved === amount && run.cost === undefined && run.usage === undefined && g.spent >= amount &&
    !!run.day && (s.budget[run.day]?.reserved ?? -1) >= amount &&
    s.journal.some(e => e.kind === "crew_test_unknown_charged" && e.actor === "replit-test" &&
      (e.detail as any)?.runId === run.id && (e.detail as any)?.chargedMicroUsd === amount) &&
    s.journal.some(e => e.kind === "failed_pilot_superseded" && e.actor === "replit-test" &&
      (e.detail as any)?.runId === run.id && (e.detail as any)?.seriesId === g.id);
}
/** Only during explicit prepare; caller uses a draft/locked transaction.
 * Original run, daily reservation, series cost, and failed evidence stay intact. */
export function supersedeApprovedFailure(s: CrewState, at: string) {
  const task = s.tasks.find(t => t.id === FAILED_PILOT_TASK);
  if (!task || task.closed) return;
  const run = s.runs.find(r => r.id === FAILED_PILOT_RUN);
  if (s.control.enabled || s.runs.some(r => r.status === "running") ||
      !run || task.phase !== "analysis" || task.hintPilot?.status !== "author" ||
      task.hintPilot.proposalId || task.hintPilot.reviewId ||
      s.documents.some(d => d.taskId === task.id) ||
      s.runs.filter(r => r.taskId === task.id).length !== 1)
    throw Error("FAILED_PILOT_NOT_SUPERSEDABLE");
  // One owner-authorized direct diagnostic already happened outside the agent
  // loop. Its local reserve is conservatively carried into the shared ceiling
  // once, NOT called again or presented as an Anthropic invoice.
  const g = s.testGrant;
  if (!g || g.spent < amount || g.spent + g.reserved + amount > g.limit ||
      s.journal.some(e => e.kind === "sonnet_direct_diagnostic_accounted"))
    throw Error("DIRECT_DIAGNOSTIC_ACCOUNTING_MISMATCH");
  g.spent += amount;
  const day = s.budget["2026-11-02"] ??= { spent: 0, reserved: 0 };
  if (!Number.isSafeInteger(day.spent) || day.spent < 0 ||
      !Number.isSafeInteger(day.spent + amount)) throw Error("DIRECT_DIAGNOSTIC_BUDGET_INVALID");
  day.spent += amount;
  log(s, "replit-test", "sonnet_direct_diagnostic_accounted", {
    diagnosticId: "4ab2efc4-61cc-4d0d-bb9b-5e56d7f746b5", seriesId: g.id,
    modelId: "claude-sonnet-5-5", httpStatus: 400, requestId: "req_011CgdDPeNYNYaSdE2yfUBtF",
    reserveChargedMicroUsd: amount, actualUsageUnverified: true,
    accounting: "conservative separate diagnostic allowance, not provider invoice",
    requestHash: "e688390c305894f9740186484b63d2e62c23a1276261cdcd56308927f05a0f4b",
    originalAt: "2026-11-02T01:13:45.286Z", requestsAlreadyMade: 1, newRequests: 0,
  }, at);
  task.closed = true; task.phase = "outcome"; task.hintPilot.status = "not_completed";
  task.steps.push({ phase: "outcome", holder: "replit-test", actor: "replit-test", updatedAt: at,
    actual: "не выполнено: неизвестный исход; новый пилот после исправления запроса",
    note: "Решение владельца: новая задача Sonnet → Opus, без повтора старого unknown", met: false });
  log(s, "replit-test", "failed_pilot_superseded", { taskId: task.id, runId: run.id,
    seriesId: s.testGrant?.id, reservationRetained: true, chargesUnchanged: true, retried: false }, at);
  if (!isSupersededChargedUnknown(s, run)) throw Error("FAILED_PILOT_CHARGE_NOT_VERIFIED");
}
