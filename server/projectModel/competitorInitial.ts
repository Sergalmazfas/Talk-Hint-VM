/** Explicit, user-authorized research snapshot; never run as startup seeding. */
import {
  competitorScenarios, type CompetitorDirectory, type CompetitorPlan, type CompetitorSnapshot,
} from "../../shared/projectCompetitors";
const website = "https://www.aiphone.ai/";
const appStore = "https://apps.apple.com/us/app/ai-phone-call-voice-translator/id6465173251";
const unknown = "Не подтверждено; требуется проверка в приложении";
const plan = (id: string, name: string, price: number, period: CompetitorPlan["period"], kind: CompetitorPlan["kind"] = "subscription"): CompetitorPlan => ({
  id, name, price, period, kind, currency: "USD", region: "US App Store",
  includedNumbers: unknown, includedMinutes: unknown, includedCredits: unknown, includedSms: unknown,
  overages: "Региональные ставки, доплаты и списания за перевод не подтверждены",
  limitations: "Наличие в перечне In-App Purchases не доказывает доступность каждому пользователю или состав предложения.",
  sourceUrl: appStore,
});
export const initialAIPhoneSnapshot: CompetitorSnapshot = {
  name: "AI Phone", developer: "Second Phone Number Inc",
  audience: "Люди, которым нужен перевод телефонных и видеозвонков; язык общения как барьер.",
  website, appStore, checkedAt: "2026-10-24", verification: "provided",
  offer: {
    features: "Официально заявлены перевод телефонных и видеозвонков, субтитры, транскрипция и итог разговора.",
    languages: "Точный перечень языков и ограничения требуют отдельной проверки.",
    regions: "Цены из US App Store; доступность функций и номеров по регионам не установлена.",
    numbers: "Есть покупки планов AI Phone Number; количество, типы и география номеров в планах не подтверждены.",
    channels: "Телефонные и видеозвонки заявлены официально. Состав SMS, почты и календаря не подтверждён.",
  },
  plans: [
    plan("number-weekly", "AI Phone Number Weekly Plan", 8.99, "week"),
    plan("number-monthly", "AI Phone Number Monthly Plan", 14.99, "month"),
    plan("number-annual", "AI Phone Number Annual Plan", 59.99, "year"),
    plan("credit-mini", "Mini Credit Package", 5.99, "one_time", "credit_pack"),
    plan("credit-medium", "Medium Credit Package", 12.99, "one_time", "credit_pack"),
    plan("credit-large", "Large Credit Package", 29.99, "one_time", "credit_pack"),
    plan("credit-huge", "Huge Credit Package", 69.99, "one_time", "credit_pack"),
  ],
  scenarios: Object.keys(competitorScenarios).map(scenario => ({
    scenario: scenario as keyof typeof competitorScenarios,
    status: scenario === "translation" ? "official_claim" : "unknown",
    note: scenario === "translation"
      ? "Заявлен перевод телефонных и видеозвонков; живая сравнительная проверка не проводилась."
      : scenario === "incoming"
        ? "Перевод звонка не доказывает автономный приём обращения AI-секретарём."
        : "Подтверждённых сведений по этому сценарию в предоставленных источниках нет.",
    sourceUrls: scenario === "translation" ? [website, appStore] : [],
  })),
  sources: [
    { url: website, checkedAt: "2026-10-24", note: "Официальные заявления о возможностях; результат проверки передан пользователем. Повторная проверка агентом в этом поручении не выполнена." },
    { url: appStore, checkedAt: "2026-10-24", note: "US App Store: разработчик и перечень In-App Purchases, переданные пользователем. Не доказательство состава тарифов или доступности всех покупок каждому." },
  ],
  limitations: "Количество кредитов, минут, номеров и SMS в пакетах, региональные поминутные ставки и списания за перевод не подтверждены. Не считать неизвестное нулём; не переводить кредиты в минуты без официального правила. Отзывы не используются как официальный тариф. Снимок от 24.10.2026 предоставлен пользователем, не является автоматической актуализацией.",
};
export const initialTalkHintBaseline: CompetitorDirectory["talkhint"] = {
  checkedAt: "2026-10-25",
  note: "Сверка существующих путей кода, не живое сравнение сервисов и не обещание доступности всем пользователям. Целевая новая концепция шире работающих маршрутов.",
  scenarios: [
    { scenario: "translation", status: "code_present", note: "Есть аудиослой перевода: server/translation/openaiRealtimeTranslator.ts и регрессионные тесты server/__tests__/translatorRelay.test.ts. Языки, регионы и качество в этом сравнении не проверены.", sourceUrls: [] },
    { scenario: "secretary_outgoing", status: "code_present", note: "Есть создание поручения с подтверждением и Retell: server/secretary/routes.ts, confirmation.ts, retellPhone.ts. Реальные звонки этим поручением не выполнялись.", sourceUrls: [] },
    { scenario: "incoming", status: "code_present", note: "Ограниченный Work-маршрут: server/incomingSecretary/routes.ts, livePhone.ts. Требуются разрешения и активация; личный входящий Secretary не подтверждён.", sourceUrls: [] },
    { scenario: "sms", status: "planned", note: "Сценарий новой концепции. Полноценный пользовательский канал SMS этим аудитом не подтверждён; наличие служебных SMS не равно готовности сценария.", sourceUrls: [] },
    { scenario: "email", status: "planned", note: "Почта входит в целевую концепцию; сквозной сценарий чтения и отправки писем этим аудитом не подтверждён.", sourceUrls: [] },
    { scenario: "calendar", status: "code_present", note: "Есть ограниченный Dev-коннектор календаря владельца для Work (server/incomingSecretary/calendarRoutes.ts). Это не per-user OAuth и не доказательство полной записи в календарь.", sourceUrls: [] },
  ],
};
