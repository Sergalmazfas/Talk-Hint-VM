/** Planning only. No executor, scheduler or external integration is enabled. */
export const workKinds = ["context", "need", "capability", "process", "action", "result", "client", "role", "department", "crew", "resource", "report"] as const;
export const workLinks = ["requires", "produces", "handoff", "depends_on", "accountable_to", "acceptance", "return", "escalation"] as const;
export type WorkKind = typeof workKinds[number];
export interface WorkNode {
  id: string; code: string; name: string; kind: WorkKind; parentId: string | null;
  status: "agreed" | "proposal"; description: string; purpose: string;
  clientId: string | null; roleId: string | null; executorId: string | null;
  recipientId: string | null; acceptorId: string | null; nextId: string | null;
  resourceIds: string[];
  inputs: { name: string; sourceId: string | null; freshness: string }[];
  schedule: { days: number[]; hours: string; timezone: string; trigger: string; deadline: string };
  procedure: string; rules: string; constraints: string; success: string;
  storage: string; delivery: string; exceptions: string; questions: string;
  resourceState: "required" | "approved" | "connected" | null;
  referenceIds: string[];
}
export interface WorkLink { id: string; from: string; to: string; kind: typeof workLinks[number]; reason: string }
export interface OperatingData {
  nodes: WorkNode[]; links: WorkLink[];
  stageReports: { pass: 1 | 2 | 3; described: string; boundary: string; dependencies: string; gaps: string; next: string }[];
}
export interface OperatingRevision { version: number; at: string; actor: string; data: OperatingData }
export interface OperatingModel { revisions: OperatingRevision[] }
export interface SaveOperatingCommand { type: "saveOperatingModel"; baseVersion: number; data: OperatingData }
export const kindLabels: Record<WorkKind, string> = {
  context: "Контекст / миссия", need: "Потребность", capability: "Способность",
  process: "Процесс", action: "Действие", result: "Результат", client: "Клиент результата",
  role: "Должность", department: "Отдел", crew: "Исполнитель / Crew", resource: "Ресурс / API", report: "Отчёт",
};
export const linkLabels: Record<typeof workLinks[number], string> = {
  requires: "Требует", produces: "Производит", handoff: "Передача результата", depends_on: "Зависимость",
  accountable_to: "Подотчётность", acceptance: "Приёмка", return: "Возврат", escalation: "Эскалация",
};
export function workGaps(data: OperatingData) {
  return data.nodes.flatMap(n => {
    const issues: string[] = [];
    if (n.kind === "action") {
      if (!n.clientId) issues.push("Нет клиента результата");
      if (!n.roleId) issues.push("Нет ответственной должности");
      if (!n.executorId) issues.push("Нет исполнителя");
      if (!n.procedure.trim()) issues.push("Нет процедуры");
      if (!n.resourceIds.length) issues.push("Ресурсы не определены");
      if (!n.nextId) issues.push("Нет следующего шага");
      if (!n.acceptorId) issues.push("Нет принимающего");
      if (!data.links.some(l => l.from === n.id && l.kind === "produces")) issues.push("Не указан выход действия");
      if (!n.schedule.trigger && !n.schedule.days.length && !n.schedule.deadline) issues.push("Не определены триггер и сроки");
    }
    if (["result", "report"].includes(n.kind) && !n.recipientId) issues.push("Выход без потребителя");
    if (n.kind === "report") {
      if (!n.clientId) issues.push("У отчёта нет клиента");
      if (!n.executorId) issues.push("У отчёта нет автора");
      if (!n.purpose) issues.push("Не определено назначение отчёта");
      if (!n.delivery) issues.push("Не определена доставка отчёта");
    }
    n.inputs.forEach(i => { if (!i.sourceId) issues.push(`Вход без источника: ${i.name}`); if (!i.freshness) issues.push(`Нет актуальности: ${i.name}`); });
    if (n.kind === "resource" && n.resourceState !== "connected") issues.push("Ресурс не подключён");
    return issues.map(message => ({ id: n.id, message }));
  });
}
