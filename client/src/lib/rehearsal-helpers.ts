import { callPlanSchema, type CallPlan } from "@shared/callPlan";
import type { RehearsalResult, RehearsalVersion } from "@shared/rehearsal";

/** Parse canonical JSON as-is: structured arrays stay structured, never split on punctuation. */
export function parsePastedRehearsalPlan(json: string): CallPlan {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Проверьте синтаксис JSON плана.");
  }
  const parsed = callPlanSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new Error(`Неполный или неверный CallPlan${field}: ${issue?.message || "проверьте обязательные поля."}`);
  }
  return parsed.data;
}

export function isRehearsalCallEnded(status: string): boolean {
  return status === "ended" || status === "completed" || status === "failed";
}

/** A server end is not the end of report polling while the review is still running. */
export function shouldContinueRehearsalPolling(result: RehearsalResult): boolean {
  if (!isRehearsalCallEnded(result.status)) return true;
  return result.rehearsal.review.status === "running" || result.rehearsal.review.status === "not_started";
}

/** Only a confirmed call end with an unstarted review warrants the one analysis request. */
export function shouldAnalyseRehearsal(result: RehearsalResult): boolean {
  return isRehearsalCallEnded(result.status) && result.rehearsal.review.status === "not_started";
}

export function sameRehearsalSceneSnapshot(left: RehearsalResult, right: RehearsalResult): boolean {
  return left.rehearsal.scene.id === right.rehearsal.scene.id &&
    left.rehearsal.scene.hash === right.rehearsal.scene.hash;
}

export function selectRehearsalVersion(versions: RehearsalVersion[], index: number): RehearsalVersion | null {
  return index >= 0 && index < versions.length ? versions[index] : null;
}

export function canStartRehearsalVersion(version: RehearsalVersion | null | undefined): boolean {
  // An explicitly labelled code snapshot may be rehearsed; it is NOT proof
  // that the same code is published. Never switch to another selected profile.
  return !!version?.available;
}

export function rehearsalVersionReason(version: RehearsalVersion): string {
  const notes: string[] = [];
  if (!version.available) notes.push(version.reason || "Эта версия недоступна.");
  else if (version.reason) notes.push(version.reason);
  if (version.source === "production-profile-code" && !version.productionVerified) {
    notes.push("Источник — production-profile-code, но productionVerified=false; опубликованная production-версия не подтверждена.");
  }
  return notes.join(" ");
}

/** Export the saved immutable report object, including both actual scene/version snapshots. */
export function serializeRehearsalResult(result: RehearsalResult): string {
  return JSON.stringify(result, null, 2);
}
