/** Internal TalkHint planning data. Never injected into phone-agent instructions. */
export const modelSections = [
  "Обзор", "Бизнес-модель", "Рынок и конкуренты", "Экономика", "Процессы и Crew",
  "Правила и процедуры", "Модели клиентов", "Продукт и дизайн", "Задания Replit", "История решений",
] as const;
export const contentStatuses = { proposal: "Предложение", hypothesis: "Гипотеза", confirmed: "Подтверждено", question: "Открытый вопрос" } as const;
export const implementationStatuses = { not_started: "Не начато", planned: "Запланировано", in_progress: "В работе", implemented: "Реализовано", verified: "Проверено" } as const;
export const elementKinds = ["context", "need", "capability", "process", "action", "sub_action", "output", "role", "rule", "procedure", "requirement", "research", "financial", "hypothesis"] as const;
export const detailFields = {
  purpose: "Назначение", buyer: "Покупатель", user: "Пользователь", beneficiary: "Получатель пользы",
  problem: "Проблема", solution: "Решение / продукт", whyNow: "Почему сейчас", segment: "Сегмент",
  alternatives: "Конкуренты и альтернативы", differentiation: "Отличие", acquisition: "Привлечение и продажи",
  businessModel: "Бизнес-модель", team: "Команда", economics: "Экономика / сценарий, не фактический отчёт",
  hypothesis: "Гипотеза и способ проверки", trigger: "Триггер", client: "Клиент и потребность",
  accountable: "Ответственный за результат", executor: "Исполнитель", executorType: "Тип: человек / AI / система / смешанный",
  inputs: "Входные данные и источники", resources: "Ресурсы", tools: "Инструменты / API", rules: "Правила",
  procedure: "Процедура", aiAllowed: "Разрешённое поведение AI", humanHandoff: "Передача человеку",
  output: "Результат", recipient: "Следующий получатель", nextStep: "Следующий шаг",
  success: "Успех", failure: "Ошибка", unknown: "Неизвестное", metrics: "Показатели / критерии успеха",
  source: "Источник / URL", sourceDate: "Дата источника", region: "Регион", comparability: "Сопоставимость",
  acceptance: "Критерии приёмки", evidence: "Основание / результаты проверок",
} as const;
export interface ElementInput {
  title: string;
  section: typeof modelSections[number];
  scope: "talkhint" | "salon_example";
  kind: typeof elementKinds[number];
  description: string;
  contentStatus: keyof typeof contentStatuses;
  implementationStatus: keyof typeof implementationStatuses;
  details: Partial<Record<keyof typeof detailFields, string>>;
}
export interface ModelElement extends ElementInput {
  id: string; version: number; updatedAt: string; needsReview: boolean;
}
export interface ModelRelation { id: string; from: string; to: string; label: string }
export interface ModelDocument { id: string; title: string; text: string; url: string; elementIds: string[]; updatedAt: string }
export interface ModelProposal {
  id: string; targetId: string; baseVersion: number; source: string; rationale: string;
  relatedIds: string[]; change: ElementInput;
  status: "pending" | "clarification" | "approved"; clarification: string; createdAt: string;
}
export interface ModelDecision {
  id: string; at: string; actor: string; action: string; reason: string; elementIds: string[];
  proposalId?: string; before?: ModelElement; after?: ModelElement;
  documentBefore?: ModelDocument; documentAfter?: ModelDocument;
  relationBefore?: ModelRelation; relationAfter?: ModelRelation;
  proposalBefore?: ModelProposal; proposalAfter?: ModelProposal;
}
export interface ModelTaskDraft {
  id: string; title: string; elementIds: string[]; acceptance: string; text: string; createdAt: string;
  references: { id: string; version: number }[];
}
export interface ProjectModelState {
  schema: 1; revision: number; elements: ModelElement[]; relations: ModelRelation[];
  documents: ModelDocument[]; proposals: ModelProposal[]; decisions: ModelDecision[]; taskDrafts: ModelTaskDraft[];
}
export type ModelCommand =
  | { type: "saveElement"; id?: string; element: ElementInput }
  | { type: "saveProposal"; id?: string; targetId: string; source: string; rationale: string; relatedIds: string[]; change: ElementInput }
  | { type: "approveProposal"; id: string }
  | { type: "clarifyProposal"; id: string; note: string }
  | { type: "saveRelation"; id?: string; from: string; to: string; label: string }
  | { type: "removeRelation"; id: string }
  | { type: "saveDocument"; id?: string; title: string; text: string; url: string; elementIds: string[] }
  | { type: "reviewElement"; id: string; reason: string }
  | { type: "prepareTask"; title: string; elementIds: string[]; acceptance: string };
