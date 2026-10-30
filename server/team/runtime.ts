import type { TeamView, TeamMember } from "../../shared/team";
import type { TeamContext } from "./repository";
import { labActionReports, secretaryActionReport } from "./actionReports";
import { portraitManifest } from "./portraits";
import type { TeamActionReport } from "../../shared/teamActionReport";

export interface RuntimeChecks {
  watchdog?: { state: string; checkedAt: string | null; activeIncidents?: number };
  now?: number;
  secretaryPrompt?: { text: string; version: string; source: string; model: string;
    traits: (string | null)[]; motto: string | null; name: string | null };
}
const time = (value: unknown) => {
  const n = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
const reportsForJobs = (c: TeamContext) => c.jobs.flatMap(job => {
  if (Array.isArray(job.report?.action_reports)) return job.report.action_reports as TeamActionReport[];
  const saved = Array.isArray(job.journal) ? job.journal.filter((event: any) =>
    typeof event.phase === "string" && event.phase.startsWith("product:decision_prepared:")).at(-1) : null;
  return labActionReports(job.report, time(saved?.at ?? job.updated_at) ?? "").map(r => ({
    ...r, source: r.source + (saved ? ";journal:product:decision_prepared (результат уже сохранён)" :
      ";updated_at: дата сохранённой строки, точное время работы модели не сохранено"),
  }));
});
function dailyActionReports(c: TeamContext): TeamActionReport[] {
  return c.controls.filter(control => typeof control.key === "string" && control.key.startsWith("hint-daily:")).flatMap(control =>
    Object.entries<any>(control.watchdog?.reports ?? {}).flatMap(([day, entry]) => {
      const at = time(entry.at);
      if (!at) return [];
      const completed = entry.status === "sent_confirmed";
      return [{ id: `daily:${day}`, at, role: "P.OPS", assigned: `Подготовить и отправить утреннюю сводку за ${day}`,
        outcome: completed ? "completed" as const : "not_completed" as const,
        succeeded: completed ? ["Gmail подтвердил отправку; это не доказательство чтения владельцем."] : [],
        failed: completed ? [] : [`Доставка не подтверждена: ${entry.status ?? "неизвестно"}. ${entry.errorCode ?? ""}`],
        needsOwner: [], source: `call_lab_controls:${control.key}:reports:${day}` }];
    }));
}
const sortReports = (reports: TeamActionReport[]) => Array.from(new Map(reports.map(r => [r.id, r])).values())
  .sort((a, b) => b.at.localeCompare(a.at));

/** Read-only overlays. Never rename graph nodes, assign agents, enable workers or dial. */
export function withTeamRuntime(view: TeamView, c: TeamContext, checks: RuntimeChecks = {}): TeamView {
  const now = checks.now ?? Date.now();
  const labReports = reportsForJobs(c);
  const tasks = c.secretaryTasks ?? [];
  const secretaryReports = tasks.flatMap(task => {
    const saved = c.jobs.find(j => j.call_sid === task.call_sid)?.report?.action_reports;
    if (Array.isArray(saved)) return saved.filter((r: TeamActionReport) => r.role === "SECRETARY");
    const r = secretaryActionReport({ call_sid: task.call_sid, user_id: c.owner,
      ended_at: task.call_ended_at, metadata: task.call_metadata }, task);
    return r ? [r] : [];
  });
  const allReports = sortReports([...labReports, ...secretaryReports, ...dailyActionReports(c)]);
  const members = view.members.map(member => {
    const actionReports = allReports.filter(r => r.role === member.code);
    const last = actionReports[0];
    const result: TeamMember = { ...member, actionReports, lastActionAt: last?.at ?? null,
      runtimeSource: last?.source ?? null };
    if (["P.LAB", "P.LG.QA"].includes(member.code) && last) {
      result.status = "autonomous";
      result.statusEvidence = `Результат зафиксирован ${last.at}; итог поручения: ${last.outcome}. Источник: ${last.source}. Это не приёмка владельца.`;
      result.lastWork = `${last.assigned} · ${last.outcome}`;
    }
    if (member.code === "P.OPS") {
      const at = time(checks.watchdog?.checkedAt);
      const fresh = at && Date.parse(at) <= now && now - Date.parse(at) < 60_000;
      if (fresh && ["checked", "attention"].includes(checks.watchdog?.state ?? "")) {
        result.status = "autonomous"; result.lastActionAt = at;
        result.runtimeSource = "hintWatchdogStatus.checkedAt";
        result.statusEvidence = `Дежурный выполнил проверку ${at}. Активных инцидентов: ${checks.watchdog?.activeIncidents ?? "неизвестно"}.`;
      } else {
        result.status = "unresolved";
        result.statusEvidence = "Свежий цикл дежурного не подтверждён. Включённый флаг — не факт выполненной проверки.";
      }
    }
    return result;
  });
  const currentTask = tasks.find(t => t.voice_provider === "retell" && t.call_sid && t.dial_started_at);
  if (currentTask) {
    const base = members.find(m => m.mode === "secretary" && m.status === "planned");
    const p = checks.secretaryPrompt;
    const reports = sortReports(secretaryReports);
    const enabled = c.secretaryDefault === "retell" && !!p;
    members.push({
      ...(base ?? emptyMember("employee-katya")), id: "employee-katya", kind: "employee",
      name: p?.name ?? "Катя", title: "Телефонный секретарь", code: "SECRETARY",
      department: "Работают на клиентов", mode: "secretary",
      status: enabled ? "autonomous" : "unresolved",
      statusEvidence: enabled ? `Выбран Retell + TalkHint Engine; последняя сохранённая попытка ${time(currentTask.dial_started_at)}. Это не доказательство успешного поручения или проверки линии.` :
        "Текущий выбор Retell или действующий промпт не подтверждён; сведения последнего звонка не доказывают включение сейчас.",
      portrait: portraitManifest.katya.url, nameStatus: null,
      traits: p?.traits ?? [null, null, null], motto: p?.motto ?? null,
      duties: [{ id: "secretary-phone", title: "Вести разрешённый владельцем телефонный разговор",
        detail: "Лимит 10 минут; press_digits — только навигация по услышанному меню, не личные данные. Не больше 5 цифр без нового меню." }],
      relations: [{ kind: "Подчиняется", id: "owner", name: view.owner.name }],
      tools: ["Retell + TalkHint Engine", "press_digits", "request_menu_help", "confirm_menu_reached", "prepare_call_end"],
      prohibitions: ["Платежи, номера карт, PIN, пароли и обязательства запрещены.",
        "Нельзя объявлять цель достигнутой или меню принявшим цифры без подтверждения."],
      model: p?.model ?? null, prompt: { text: p?.text ?? null, version: p?.version ?? null,
        status: enabled ? "включён" : "не подтверждён", acceptedBy: null },
      metrics: { plan: "Телефонный лимит: 10 минут", fact: null },
      lastWork: reports[0]?.assigned ?? null, lastActionAt: time(currentTask.dial_started_at),
      runtimeSource: p?.source ?? `secretary_tasks:${currentTask.id}`,
      actionReports: reports, lessons: [], history: [],
    });
  }
  const feed = [...view.feed, ...allReports.map(r => ({
    id: `action:${r.id}`, at: r.at, source: "journal" as const, role: r.role,
    title: `${r.role} · ${r.outcome === "completed" ? "выполнено" : r.outcome === "partial" ? "частично" : "не выполнено"}`,
    detail: `${r.assigned}\nПолучилось: ${r.succeeded.join(" ") || "не подтверждено"}\nНе получилось: ${r.failed.join(" ") || "не зафиксировано"}\nОт владельца: ${r.needsOwner.join(" ") || "решение не запрошено"}\nИсточник: ${r.source}`,
  }))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
  return { ...view, members, feed };
}

export function emptyMember(id: string): TeamMember {
  return { id, name: "", title: "", code: "", department: "", mode: null, status: "unresolved",
    statusEvidence: "", portrait: null, nameStatus: null, traits: [null, null, null], motto: null,
    duties: [], relations: [], tools: [], prohibitions: [], model: null,
    prompt: { text: null, version: null, status: null, acceptedBy: null },
    metrics: { plan: null, fact: null }, lastWork: null, lessons: [], history: [] };
}
