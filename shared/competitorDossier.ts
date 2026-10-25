import type { ResearchEvidence } from "./competitorResearch";
import type { CompetitorSnapshot } from "./projectCompetitors";

export const dossierSections = ["Предложение", "Цены", "Покрытие", "Техническая часть", "Финансирование", "Масштаб бизнеса"] as const;
export const avatarFields = {
  presence: "Живой персонаж-собеседник в чате",
  appearance: "Человек / другой образ",
  rendering: "Статичный / анимированный / 3D",
  customization: "Выбор и настройка персонажа",
  voice_link: "Связь персонажа с голосом",
  speech_lipsync: "Синхронизация губ с речью в чате",
} as const;
export const scaleFields = {
  downloads: "Загрузки", registered: "Зарегистрированные пользователи",
  active: "Активные пользователи", paying: "Платящие пользователи", revenue: "Выручка",
} as const;
export interface DossierFact {
  value: string | null;
  evidence: ResearchEvidence;
}
export interface AdditionalDossierFact extends DossierFact { id: string; title: string }
export interface CompetitorDossier {
  offerFacts: AdditionalDossierFact[];
  avatar: Partial<Record<keyof typeof avatarFields, DossierFact>>;
  pricingNotes: AdditionalDossierFact[];
  coverageFacts: AdditionalDossierFact[];
  technical: {
    id: string;
    layer: "telephony" | "stt" | "llm" | "translation" | "tts" | "technology";
    scope: "live_call" | "file_tool" | "chat" | "platform";
    tool: string;
    provider: string | null;
    evidence: ResearchEvidence;
  }[];
  funding: {
    id: string; round: string; investors: string; announcedAt: string | null;
    amount: number | null; currency: string | null; evidence: ResearchEvidence;
  }[];
  scale: Partial<Record<keyof typeof scaleFields, DossierFact>>;
  revenueKind: "unknown" | "official" | "scenario";
  revenueAssumptions: string;
}
export function emptyCompetitorDossier(): CompetitorDossier {
  return { offerFacts: [], avatar: {}, pricingNotes: [], coverageFacts: [], technical: [], funding: [], scale: {}, revenueKind: "unknown", revenueAssumptions: "" };
}
export function dossierFor(snapshot: CompetitorSnapshot): CompetitorDossier {
  return snapshot.dossier ? structuredClone(snapshot.dossier) : emptyCompetitorDossier();
}
