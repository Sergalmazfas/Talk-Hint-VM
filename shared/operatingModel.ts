/** Planning only. No executor, scheduler or external integration is enabled. */
export const workKinds = ["context", "need", "capability", "process", "action", "result", "client", "role", "department", "crew", "resource", "report"] as const;
export const workLinks = ["requires", "produces", "handoff", "depends_on", "accountable_to", "acceptance", "return", "escalation", "feedback", "finance_event"] as const;
export type WorkKind = typeof workKinds[number];
export interface WorkNode {
  /** Containment is not line management. Manager is a single immediate superior. */
  managerId?: string | null;
  level?: "strategy" | "direction" | "operation";
  detailState?: "outlined" | "described";
  workNature?: "deterministic" | "probabilistic" | "mixed" | "unspecified";
  marketEffect?: string;
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
  /** Links to the existing model documents; a form's approval is independent of work acceptance. */
  reporting?: {
    required: boolean; formName: string; templateDocumentId: string | null;
    templateVersion: string; storage: string;
    formStatus: "required" | "draft" | "discussion" | "approved";
    approvalEvidence: string;
  };
  /** Design estimates only; absence/null is unknown, never zero or measured utilisation. */
  register?: {
    availability: string; period: string;
    operationsPerPeriod: number | null; minutesPerOperation: number | null;
    estimateBasis: string;
    approval: "draft" | "discussion" | "approved";
    source: string; proposalReason: string;
  };
}
export interface WorkLink { id: string; from: string; to: string; kind: typeof workLinks[number]; reason: string }
export interface OperatingData {
  companyStructureVersion?: 1;
  customerPath?: { id: string; name: string; processId: string; b2bProcessId?: string; b2c: string; b2b: string; condition: string }[];
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
  feedback: "Основание для пересмотра", finance_event: "Финансовое событие",
};
export function companyCoverage(data: OperatingData) {
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const stages = data.customerPath ?? [];
  const issues: string[] = [];
  if (data.companyStructureVersion) {
    if (data.nodes.filter(n => n.level === "direction").length !== 10) issues.push("Не представлены все десять направлений");
    for (const n of data.nodes.filter(n => n.kind === "role")) {
      if (!n.managerId) issues.push(`Нет непосредственного руководителя: ${n.code}`);
    }
    for (const stage of stages) {
      if (!byId.has(stage.processId)) issues.push(`Нет процесса этапа: ${stage.name}`);
      if (!stage.b2c || !stage.b2b) issues.push(`Не описаны B2C/B2B: ${stage.name}`);
    }
    if (stages.length !== 9) issues.push("Путь клиента должен включать девять крупных этапов");
    for (let i = 1; i < stages.length; i++) {
      const previous = stages[i].id === "leave" ? stages.find(s => s.id === "help") : stages[i - 1];
      if (previous && !data.links.some(l => l.kind === "handoff" && l.from === previous.processId && l.to === stages[i].processId))
        issues.push(`Нет передачи: ${previous.name} → ${stages[i].name}`);
    }
    for (const s of stages) {
      if (s.b2bProcessId && !byId.has(s.b2bProcessId)) issues.push(`Нет отдельного B2B-процесса: ${s.name}`);
    }
    for (const n of data.nodes.filter(n => n.level === "direction")) {
      if (!n.clientId || !n.roleId || !n.inputs.length || !n.purpose) issues.push(`Неполная карточка направления: ${n.code}`);
      if (!data.links.some(l => l.from === n.id && l.kind === "produces")) issues.push(`Нет выхода направления: ${n.code}`);
    }
  }
  return issues;
}
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
