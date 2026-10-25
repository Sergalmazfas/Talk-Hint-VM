/** Approved public research only. Imported by tests and explicit Dev updates, never on startup. */
import { emptyCompetitorSnapshot, type CompetitorSnapshot, type CompetitorPlan } from "../../shared/projectCompetitors";
import { emptyCompetitorResearch, type ResearchEvidence } from "../../shared/competitorResearch";
import { avatarFields, scaleFields, emptyCompetitorDossier, type AdditionalDossierFact } from "../../shared/competitorDossier";
export const checkedDate = "2026-10-25";
export const originalResearchDate = "2026-10-24";
export const claim = (source: string, note: string): ResearchEvidence => ({
  status: "official_claim", sourceUrls: [source], checkedAt: checkedDate, note,
});
export const unknown = (note = "Не подтверждено", source?: string): ResearchEvidence => ({
  status: "unknown", sourceUrls: source ? [source] : [], checkedAt: source ? checkedDate : null, note,
});
export const suppliedFact = (id: string, title: string, value: string, source: string, note = "Официальное заявление, не живой тест"): AdditionalDossierFact =>
  ({ id, title, value, evidence: claim(source, note) });
export function baseCompetitor(name: string, developer: string, website: string, appStore: string): CompetitorSnapshot {
  const dossier = emptyCompetitorDossier();
  for (const key of Object.keys(avatarFields) as Array<keyof typeof avatarFields>)
    dossier.avatar[key] = { value: null, evidence: unknown("Не подтверждено. Иконка, декоративный круг, демовидео и липсинк переведённого видео не доказывают живого аватара собеседника.", website) };
  for (const key of Object.keys(scaleFields) as Array<keyof typeof scaleFields>)
    dossier.scale[key] = { value: null, evidence: unknown("Проверенное значение не получено. Загрузки, регистрации, активные и платящие — разные метрики; выручка из загрузок и цены не вычисляется.", website) };
  return {
    ...emptyCompetitorSnapshot(), name, developer, website, appStore, checkedAt: checkedDate, verification: "manual",
    audience: "Люди, которым нужна многоязычная поддержка личного и рабочего общения; точная аудитория и спрос не измерены.",
    research: emptyCompetitorResearch(), dossier,
    sources: [website, appStore].flatMap(url => [
      { url, checkedAt: originalResearchDate, note: "Исходные сведения переданы пользователем из исследовательской сессии 24.10.2026." },
      { url, checkedAt: checkedDate, note: "Повторно прочитан официальный публичный источник. Это проверка заявления/прайса, не живой тест продукта." },
    ]),
    limitations: "Исходная исследовательская сессия — 24.10.2026. Публичные источники повторно прочитаны 25.10.2026. Наличие IAP не доказывает доступность всех покупок каждому пользователю или полный состав подписки. Живые звонки, покупки и работа функций нами не проверялись. Аватар чата, инвестиции, платящие пользователи, выручка и присутствие клиентов в городах не подтверждены.",
  };
}
export function pricePlan(id: string, name: string, price: number, period: CompetitorPlan["period"],
  source: string, purchaseChannel: string, units?: { unit: "coins" | "credits" | "tokens"; amount: number }): CompetitorPlan {
  return {
    id, name, kind: period === "one_time" ? "credit_pack" : "subscription", currency: "USD",
    region: purchaseChannel === "US App Store" ? "US App Store" : "Сайт; географическая доступность покупки не подтверждена",
    period, price, sourceUrl: source, purchaseChannel,
    ...(units ? { includedUnits: units } : {}),
    includedNumbers: "Количество и состав не подтверждены",
    includedMinutes: "Количество не подтверждено; нет доказанного перевода единиц в минуты",
    includedCredits: units ? `${units.amount} ${units.unit}; единицы не приравниваются друг к другу` : "Не подтверждено",
    includedSms: "Количество не подтверждено", overages: "Точная доплата и единый денежный тариф не подтверждены",
    limitations: "Проверить доступность и полные условия покупки в приложении; не считать неизвестные объёмы нулевыми",
    evidence: claim(source, "Цена и наименование покупки опубликованы в данном канале; это не доказательство состава всех функций"),
  };
}
export function unknownLiveTechnology(source: string) {
  return (["telephony", "stt", "llm", "translation", "tts"] as const).map(layer => ({
    id: `live-${layer}`, layer, scope: "live_call" as const, tool: "Живой телефонный звонок", provider: null,
    evidence: unknown("Конкретный провайдер / модель живого звонка не подтверждены. Упоминания других инструментов нельзя переносить на live-звонок.", source),
  }));
}
