import { createHash } from "node:crypto";
import type { TeamActionReport } from "../../shared/teamActionReport";

const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const iso = (v: unknown) => {
  const n = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
const id = (call: string, role: string) => createHash("sha256").update(`${call}:${role}:action-report:v1`).digest("hex");

/** Deterministic projection of already saved facts. Never initiates a call. */
export function secretaryActionReport(call: any, task: any): TeamActionReport | null {
  if (!task || !call || !task.call_sid || task.call_sid !== call.call_sid ||
      String(task.user_id) !== String(call.user_id)) return null;
  const at = iso(task.stream_ended_at ?? call.ended_at ?? task.updated_at);
  if (!at) return null;
  const events = Array.isArray(call.metadata?.secretaryIvr?.events) ? call.metadata.secretaryIvr.events : [];
  const succeeded: string[] = [];
  const failed: string[] = [];
  const connected = task.dial_started_at && (["connected", "completed"].includes(task.provider_status) ||
    (Array.isArray(task.transcript_turns) && task.transcript_turns.some((t: any) => t.role === "guest")));
  succeeded.push(connected ? "Соединение подтверждено сохранённой речью или статусом линии." :
    "Попытка звонка сохранена; соединение с нужным отделом не подтверждено.");
  for (const e of events.slice(-200)) {
    if (e.kind === "press") succeeded.push(`Меню: ${text(e.heard) ?? "не сохранено"} → нажала ${text(e.digits) ?? "неизвестно"} → ${text(e.result) ?? "результат неизвестен"}. Отправка не доказывает принятие меню.`);
    if (e.kind === "reached") succeeded.push(`Зафиксировано подтверждение отдела: ${text(e.heard) ?? "текст не сохранён"}.`);
    if (e.kind === "help") failed.push(`Потребовалась помощь в меню: ${text(e.heard) ?? "пункты не сохранены"}.`);
  }
  if (!events.length) failed.push("Меню и нажатия не сохранены; это не доказывает, что меню не было.");
  if (!events.some((e: any) => e.kind === "reached"))
    failed.push("Попадание в нужный отдел не подтверждено.");
  // A task summary/outcome may itself be generated; it is not independent proof.
  const verified = Array.isArray(task.verified_facts) ? task.verified_facts : [];
  const confirmedGoal = verified.some((f: any) => f?.kind === "goal_achieved" &&
    f.verification === "owner_confirmed" && text(f.evidence));
  if (!confirmedGoal) failed.push("Выполнение исходного поручения независимо не подтверждено.");
  const endReason = text(call.metadata?.secretary?.endReason) ?? text(call.metadata?.retellPhone?.disconnection_reason);
  failed.push(`Причина конца звонка: ${endReason ?? "не установлена; статус completed сам по себе её не объясняет"}.`);
  return { id: id(call.call_sid, "SECRETARY"), at, role: "SECRETARY",
    assigned: text(task.instruction) ?? "Задача не сохранена",
    outcome: confirmedGoal ? "completed" : connected || events.some((e: any) => e.kind === "press") ? "partial" : "not_completed",
    succeeded, failed, needsOwner: [], source: `secretary_tasks:${task.id};calls:${call.call_sid};secretaryIvr.events` };
}

export function labActionReports(report: any, at: string): TeamActionReport[] {
  if (report?.mode !== "hint" || !text(report.call_id) || !iso(at)) return [];
  const failed = report.execution === "analysis_not_completed";
  const analysis = !!report.analysis && !failed;
  const result: TeamActionReport[] = [{
    id: id(report.call_id, "P.LAB"), at: iso(at)!, role: "P.LAB",
    assigned: "Разобрать сохранённые материалы звонка Hint",
    outcome: analysis ? "completed" : "not_completed",
    succeeded: analysis ? ["Разбор сохранён. Успешность разбора и приёмка владельца — отдельные проверки."] : [],
    failed: failed ? (report.analysis?.limitations ?? ["Разбор не завершён"]).filter((s: unknown) => typeof s === "string") :
      analysis ? [] : ["Нет подтверждения завершённого разбора."],
    needsOwner: [], source: `call_lab_jobs:${report.call_id}:report`,
  }];
  if (["QA: принято", "QA: расхождения не устранены"].includes(report.qa_status)) result.push({
    id: id(report.call_id, "P.LG.QA"), at: iso(at)!, role: "P.LG.QA",
    assigned: "Проверить разбор Hint", outcome: "completed",
    succeeded: [`Проверка завершилась с вердиктом «${report.qa_status}». Это не приёмка владельца.`],
    failed: (report.qa_issues ?? []).filter((s: unknown) => typeof s === "string"),
    needsOwner: [], source: `call_lab_jobs:${report.call_id}:report.qa_status`,
  });
  return result;
}

export function reportDelivery(reports: TeamActionReport[], urgent = false) {
  if (urgent || reports.some(r => r.needsOwner.length)) return "immediate";
  return reports.some(r => r.outcome !== "completed" || r.failed.length > 0) ? "daily" : "per_call";
}

export function actionReportText(r: TeamActionReport) {
  const outcomes = { completed: "выполнено", partial: "частично", not_completed: "не выполнено" };
  return [
    `${r.role} · ${outcomes[r.outcome]}`, `Поручено: ${r.assigned}`,
    `Получилось: ${r.succeeded.join(" ") || "не подтверждено"}`,
    `Не получилось и почему: ${r.failed.join(" ") || "не зафиксировано"}`,
    `От владельца: ${r.needsOwner.join(" ") || "решение сейчас не запрошено"}`,
  ].join("\n");
}
