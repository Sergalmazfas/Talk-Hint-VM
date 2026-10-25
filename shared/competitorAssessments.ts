import type { CompetitorSnapshot } from "./projectCompetitors";

export const assessmentCategories = { design: "Дизайн", usability: "Удобство использования", support: "Поддержка" } as const;
export type AssessmentCategory = keyof typeof assessmentCategories;
export const assessmentParameters = {
  design: { readability: "Читаемость и контраст", buttons: "Кнопки и расположение", hierarchy: "Иерархия и перегруженность", consistency: "Единообразие", avatar: "Аватар, анимация, губы и польза для общения" },
  usability: { contact: "Найти контакт", language: "Выбрать язык", call: "Начать звонок", assignment: "Дать поручение AI-секретарю", confirmation: "Понять настройки перед подтверждением", outcome: "Получить итог и транскрипцию", history: "Найти историю", billing: "Тариф, списания и отмена подписки" },
  support: { response: "Первый ответ", human: "Бот / сотрудник", resolution: "Решение проблемы", usefulness: "Полезность ответа", repeats: "Повторные обращения" },
} as const;
export const supportFields = {
  channels: "Каналы связи", hours: "Часы работы", languages: "Языки поддержки",
  responseTimes: "Заявленные сроки ответа", knowledgeBase: "Наличие базы знаний", humanAgent: "Живой сотрудник",
  helpdesk: "Сервис чата / обработки обращений", knowledgePlatform: "Платформа базы знаний", crm: "Внутренняя CRM",
} as const;
export const supportEvidenceLabels = {
  official_claim: "Официально заявлено",
  observed_signal: "Технический признак — не полное подтверждение",
  hypothesis: "Предположение",
  unknown: "Не установлено",
} as const;
export interface SupportFact {
  value: string | null;
  status: keyof typeof supportEvidenceLabels;
  sourceUrls: string[];
  checkedAt: string | null;
  note: string;
}
export type SupportResearch = Partial<Record<keyof typeof supportFields, SupportFact>>;
export interface ReviewParameter {
  key: string; score: number | null;
  applicability: "not_tested" | "applicable" | "not_applicable" | "absent";
  steps: number | null;
  observations: string; impression: string; statuses: string; issues: string; result: string;
}
export interface SupportExperience {
  issue: string; channel: string; contactedAt: string | null; firstResponseAt: string | null;
  responder: "unknown" | "bot" | "human"; resolvedAt: string | null;
  outcome: "unknown" | "unresolved" | "partial" | "resolved";
  resolution: string; usefulness: string; repeatContacts: number | null;
}
export interface CompetitorReviewInput {
  category: AssessmentCategory;
  author: string; testedAt: string; platform: string; appVersion: string;
  score: number | null; rationale: string; observations: string; impression: string;
  likes: string; problems: string; examples: string;
  parameters: ReviewParameter[];
  materials: { title: string; url: string }[];
  supportExperience?: SupportExperience;
}
export interface CompetitorReview extends CompetitorReviewInput {
  id: string; recordedBy: string; savedAt: string;
}
export type CompetitorAssessments = Partial<Record<AssessmentCategory, CompetitorReview[]>>;
export interface AddCompetitorReviewCommand {
  type: "addCompetitorReview"; id: string; baseVersion: number; requestId: string; review: CompetitorReviewInput;
}
export interface SaveCompetitorSupportCommand {
  type: "saveCompetitorSupport"; id: string; baseVersion: number; support: SupportResearch;
}
export function latestAssessment(snapshot: CompetitorSnapshot, category: AssessmentCategory) {
  return snapshot.assessments?.[category]?.at(-1);
}
export function assessmentScore(review: CompetitorReview | undefined, category: AssessmentCategory) {
  return review?.score == null ? category === "support" ? "Не проверено" : "Не оценено" : `${review.score} / 10`;
}
export function newReview(category: AssessmentCategory): CompetitorReviewInput {
  return {
    category, author: "", testedAt: new Date().toISOString().slice(0, 10), platform: "", appVersion: "",
    score: null, rationale: "", observations: "", impression: "", likes: "", problems: "", examples: "",
    parameters: Object.keys(assessmentParameters[category]).map(key => ({
      key, score: null, applicability: "not_tested", steps: null, observations: "", impression: "", statuses: "", issues: "", result: "",
    })), materials: [],
    ...(category === "support" ? { supportExperience: {
      issue: "", channel: "", contactedAt: null, firstResponseAt: null, responder: "unknown",
      resolvedAt: null, outcome: "unknown", resolution: "", usefulness: "", repeatContacts: null,
    } as SupportExperience } : {}),
  };
}
export function assessmentHref(id: string, category: AssessmentCategory) {
  return `/admin/project-model?view=benchmark&hypothesis=new-country&competitor=${encodeURIComponent(id)}&review=${category}#reviews`;
}
