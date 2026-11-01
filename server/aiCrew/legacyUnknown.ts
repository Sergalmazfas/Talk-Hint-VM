import { log, type CrewState } from "./domain";
import { HINT_AGENTS } from "./hintPilot";

// One explicit owner decision, NOT a general reconcile/settle capability.
export const LEGACY_TASK_ID = "efa4e3d5-e5cf-4177-b10f-4943e71775f1";
export const LEGACY_AMOUNT = 36716;
export const LEGACY_UNKNOWN_OUTCOME = "не выполнено: прерван аварийным OFF";

export function hasLegacyWriteoff(s: CrewState) {
  const g = s.testGrant, task = s.tasks.find(t => t.id === LEGACY_TASK_ID);
  const run = s.runs.find(r => r.taskId === LEGACY_TASK_ID && r.legacyUnknownWriteoff);
  const receipt = run?.legacyUnknownWriteoff;
  return !!g && !!task?.closed && task.hintPilot?.status === "not_completed" &&
    run?.status === "discarded" && run.reserved === 0 && run.cost === LEGACY_AMOUNT &&
    receipt?.seriesId === g.id && receipt.amountMicroUsd === LEGACY_AMOUNT &&
    receipt.providerOutcome === "unknown" && receipt.reason === "owner_emergency_off" &&
    g.spent >= LEGACY_AMOUNT && !!run.day && (s.budget[run.day]?.spent ?? -1) >= LEGACY_AMOUNT &&
    s.journal.some(e => {
      const d = e.detail as any;
      return e.kind === "legacy_unknown_written_off" && e.actor === "replit-test" &&
        d?.taskId === LEGACY_TASK_ID && d?.runId === run.id && d?.seriesId === g.id &&
        d?.amountMicroUsd === LEGACY_AMOUNT && d?.providerOutcome === "unknown";
    });
}

/** Caller holds CrewStore lock and checks the unexpired crew-test grant.
 * All validation precedes writes. No request, provider result or owner acceptance. */
export function writeOffLegacyUnknown(s: CrewState, at: string) {
  const g = s.testGrant, task = s.tasks.find(t => t.id === LEGACY_TASK_ID);
  const runs = s.runs.filter(r => r.taskId === LEGACY_TASK_ID), run = runs[0];
  if (s.control.enabled || s.runs.some(r => r.status === "running")) throw Error("WRITEOFF_REQUIRES_OFF_IDLE");
  if (!g || !task || task.closed || task.phase !== "analysis" || task.testSeriesId ||
      task.hintPilot?.candidate !== "latency" || task.hintPilot.status !== "author" ||
      task.hintPilot.proposalId || task.hintPilot.reviewId || s.documents.some(d => d.taskId === task.id) ||
      runs.length !== 1 || run.testSeriesId || run.agentId !== HINT_AGENTS[0].agentId ||
      run.status !== "unknown" || run.legacyUnknownWriteoff || run.cost !== undefined || run.usage !== undefined ||
      s.journal.some(e => e.kind === "legacy_unknown_written_off"))
    throw Error("LEGACY_UNKNOWN_NOT_WRITABLE");
  const b = run.day ? s.budget[run.day] : undefined;
  if (run.reserved !== LEGACY_AMOUNT || !b || !Number.isSafeInteger(b.reserved) || b.reserved < LEGACY_AMOUNT ||
      !Number.isSafeInteger(b.spent) || b.spent < 0 || !Number.isSafeInteger(b.spent + LEGACY_AMOUNT) ||
      g.spent + g.reserved + LEGACY_AMOUNT > g.limit)
    throw Error("LEGACY_UNKNOWN_BUDGET_MISMATCH");
  b.reserved -= LEGACY_AMOUNT; b.spent += LEGACY_AMOUNT;
  g.spent += LEGACY_AMOUNT; // Same expense against the lifetime series ceiling, not a second charge.
  run.reserved = 0; run.cost = LEGACY_AMOUNT; run.status = "discarded"; run.completedAt = at;
  run.legacyUnknownWriteoff = { at, actor: "replit-test", seriesId: g.id,
    amountMicroUsd: LEGACY_AMOUNT, providerOutcome: "unknown", reason: "owner_emergency_off" };
  task.closed = true; task.phase = "outcome"; task.hintPilot.status = "not_completed";
  task.steps.push({ phase: "outcome", holder: "replit-test", actor: "replit-test",
    updatedAt: at, note: LEGACY_UNKNOWN_OUTCOME, actual: LEGACY_UNKNOWN_OUTCOME, met: false });
  log(s, "replit-test", "legacy_unknown_written_off", { taskId: task.id, runId: run.id, seriesId: g.id,
    amountMicroUsd: LEGACY_AMOUNT, originalReservedMicroUsd: LEGACY_AMOUNT,
    providerOutcome: "unknown", accounting: "owner-approved writeoff, not provider invoice",
    outcome: LEGACY_UNKNOWN_OUTCOME, ownerAcceptance: false, agentsStarted: false }, at);
}
