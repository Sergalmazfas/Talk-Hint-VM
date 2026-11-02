import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { applyOwnerCommand, log, type CrewState, type Task } from "./domain";
import type { HintEvidence } from "./hintEvidence";
import { closeStalledHintPilot, STALLED_PILOT_OUTCOME } from "./hintPilot";
import { hasLegacyWriteoff, writeOffLegacyUnknown } from "./legacyUnknown";
import { isSupersededChargedUnknown, supersedeApprovedFailure } from "./failedPilot";

export const TEST_ACTOR = "replit-test";
export const SERIES_LIMIT = 5_000_000;
export const testActions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), candidate: z.literal("latency") }).strict(),
  z.object({ action: z.literal("enable"), taskId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("start"), taskId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("close_stalled"), taskId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("writeoff_legacy_unknown") }).strict(),
  z.object({ action: z.literal("off") }).strict(),
]);
export const keyHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function checkTestKey(provided: unknown, expected: string | undefined) {
  return typeof provided === "string" && provided.length >= 43 && provided.length <= 256 &&
    !!expected && expected.length >= 43 && expected.length <= 256 &&
    timingSafeEqual(Buffer.from(keyHash(provided), "hex"), Buffer.from(keyHash(expected), "hex"));
}
export function validGrant(s: CrewState, now: number) {
  const g = s.testGrant;
  return !!g && !g.revokedAt && Number.isFinite(Date.parse(g.expiresAt)) && now < Date.parse(g.expiresAt) &&
    g.limit === SERIES_LIMIT && Number.isSafeInteger(g.spent) && g.spent >= 0 &&
    Number.isSafeInteger(g.reserved) && g.reserved >= 0;
}
/** Called under the same durable row lock as commands. No grant reset/renew tool. */
export function authorizeTest(s: CrewState, hash: string, at: string) {
  if (!s.testGrant) {
    s.testGrant = { id: randomUUID(), keyHash: hash, createdAt: at,
      expiresAt: new Date(Date.parse(at) + 7 * 86400000).toISOString(),
      limit: SERIES_LIMIT, spent: 0, reserved: 0 };
    log(s, TEST_ACTOR, "crew_test_granted", { seriesId: s.testGrant.id,
      expiresAt: s.testGrant.expiresAt, limitMicroUsd: SERIES_LIMIT }, at);
  }
  if (!validGrant(s, Date.parse(at)) || s.testGrant.keyHash !== hash) throw Error("CREW_TEST_DENIED");
  s.testGrant.lastUsedAt = at;
}
export function stopTest(s: CrewState, at: string, reason: string) {
  if (s.control.testSeriesId) {
    s.control = { ...s.control, enabled: false, epoch: s.control.epoch + 1 };
    log(s, TEST_ACTOR, "crew_test_off", { reason }, at);
  }
}
export function revokeTest(s: CrewState, actor: string, at: string) {
  if (s.testGrant) s.testGrant.revokedAt ??= at;
  // Durable tombstone prevents first-use regrant even if no key has been used.
  else s.testGrant = { id: randomUUID(), keyHash: "", createdAt: at, expiresAt: at,
    revokedAt: at, limit: SERIES_LIMIT, spent: 0, reserved: 0 };
  stopTest(s, at, "owner_revoked");
  log(s, actor, "crew_test_revoked", { seriesId: s.testGrant.id }, at);
}
export function testTask(s: CrewState, id: string): Task {
  const task = s.tasks.find(t => t.id === id && t.testSeriesId === s.testGrant?.id &&
    t.hintPilot?.ownerId === TEST_ACTOR);
  if (!task) throw Error("CREW_TEST_TASK_SCOPE");
  return task;
}
export function applyTestAction(s: CrewState, raw: unknown, at: string, models: string[], evidence?: HintEvidence) {
  if (!validGrant(s, Date.parse(at))) throw Error("CREW_TEST_DENIED");
  const a = testActions.parse(raw), g = s.testGrant!;
  if (a.action === "off") { stopTest(s, at, "requested"); return; }
  if (a.action === "writeoff_legacy_unknown") {
    writeOffLegacyUnknown(s, at);
    return;
  }
  const blocked = (state: CrewState) => state.runs.some(r => r.status === "running" ||
    (r.status === "unknown" && !isSupersededChargedUnknown(state, r)));
  if (a.action === "prepare") {
    // All-or-nothing even for direct callers; failed evidence/models validation
    // must not close the old task. No publication/startup side effect.
    const draft = structuredClone(s);
    supersedeApprovedFailure(draft, at);
    if (g.spent + g.reserved >= g.limit || blocked(draft) ||
        s.control.enabled) throw Error("CREW_TEST_NOT_SAFE");
    // Do not reset a different owner's limit. Only our own prior OFF can prepare again.
    // The exact, owner-approved writeoff also permits OFF/0 preparation.
    // Never reset expenses or other reservations.
    if (s.control.testSeriesId === g.id || hasLegacyWriteoff(s))
      draft.control = { ...draft.control, dailyLimitMicroUsd: 0 };
    applyOwnerCommand(draft, { kind: "hint_pilot_prepare", candidate: a.candidate, ratesConfirmed: true },
      TEST_ACTOR, at, models, evidence);
    draft.tasks.at(-1)!.testSeriesId = g.id;
    Object.assign(s, draft);
  } else {
    // Explicit approved legacy cleanup only; never adopt its ownership or
    // paid results. The same existing helper enforces OFF/no execution/reserve.
    if (a.action === "close_stalled") {
      const task = s.tasks.find(t => t.id === a.taskId && t.hintPilot?.candidate === "latency");
      if (!task) throw Error("CREW_TEST_TASK_SCOPE");
      const closed = closeStalledHintPilot(s, task, TEST_ACTOR, at, true);
      log(s, TEST_ACTOR, "hint_pilot_closed_stalled", { taskId: task.id,
        outcome: STALLED_PILOT_OUTCOME, ...closed, costMicroUsd: 0 }, at);
      return;
    }
    const task = testTask(s, a.taskId);
    if (a.action === "enable") {
      if (s.control.enabled || task.closed || task.hintPilot?.status !== "prepared" ||
          g.spent + g.reserved >= g.limit || blocked(s))
        throw Error("CREW_TEST_NOT_SAFE");
      // The delegated global ON cannot execute unrelated queues/schedules.
      s.control = { ...s.control, enabled: true, dailyLimitMicroUsd: SERIES_LIMIT,
        epoch: s.control.epoch + 1, testSeriesId: g.id };
      log(s, TEST_ACTOR, "crew_test_enabled", { taskId: task.id, seriesId: g.id }, at);
    } else {
      if (a.action === "start" && (!s.control.enabled || s.control.testSeriesId !== g.id))
        throw Error("CREW_TEST_CONTROL_SCOPE");
      applyOwnerCommand(s, { kind: "hint_pilot_start",
        taskId: task.id, ownerApproved: true }, TEST_ACTOR, at);
    }
  }
}
/** Provider errors charge the full reservation permanently, never release/retry. */
export function unknownTestRun(s: CrewState, runId: string, at: string) {
  const r = s.runs.find(r => r.id === runId);
  if (!r || r.status !== "running") return;
  r.status = "unknown";
  if (r.testSeriesId && r.testSeriesId === s.testGrant?.id) {
    s.testGrant.reserved -= r.reserved!;
    s.testGrant.spent += r.reserved!;
    stopTest(s, at, "unknown_charged_no_retry");
    log(s, TEST_ACTOR, "crew_test_unknown_charged", { runId, chargedMicroUsd: r.reserved }, at);
  }
}
export function enforceTestSafety(s: CrewState, at: string) {
  if (!s.testGrant) return;
  if (s.control.enabled && s.control.testSeriesId && !validGrant(s, Date.parse(at)))
    stopTest(s, at, "expired_or_revoked");
  for (const r of s.runs) {
    const task = s.tasks.find(t => t.id === r.taskId);
    if (task?.testSeriesId !== s.testGrant.id) continue;
    if (["queued", "running"].includes(r.status) &&
        (r.status === "running" || s.control.enabled) &&
        Date.parse(at) - Date.parse(r.startedAt ?? r.at) >= 5 * 60000) {
      unknownTestRun(s, r.id, at);
      stopTest(s, at, "watchdog_five_minutes");
    }
  }
}
