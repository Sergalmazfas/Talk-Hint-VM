import { differenceBenchmarkSteps } from "../../shared/projectModel";
import { packageElement, packageSources, axes } from "./packageContent";
const findings = {
  talkhint: {
    marketing: "Реклама/маркетинг/Crew — видение; сквозной готовой команды в TalkHint не установлено.",
    editing: "Целевая гипотеза: монтаж снятого владельцем видео, НЕ генерация новых сцен. Не реализовано как готовая цепочка.",
    ads: "Целевая гипотеза: отдельно согласовать рекламу/бюджет и управлять Facebook/Instagram. Не подключено и не запускается.",
    attribution: "Гипотеза связи расходов/обращений/оплаченных записей/повторов. Фактических данных и доказанной окупаемости нет.",
    conversation: "Есть отдельные Secretary-поручения голосом/текстом. Единое управление всей практикой и рекламной Crew — видение, не готовность.",
    convenience: "Не измерено. Цель — удобство при сохранении контроля владельца, не минимум его участия.",
    netIncome: "Не измерено. Ни рост дохода после расходов, ни гарантия продаж не доказаны.",
  },
  massagebook: {
    marketing: "Официально описаны каталог/сайт/запись, email/Autopilot, возвраты, документы и платежи; не просто запись.",
    editing: "В изученных материалах монтаж исходного видео не установлен. Это НЕ доказательство отсутствия функции.",
    ads: "Описаны Book Now и инструкция самостоятельной работы с рекламой/Meta Ads Manager. Встроенное разговорное ведение рекламы не установлено.",
    attribution: "Полная связь расходов с оплаченной записью/повторами через единый разговор не установлена; отчёты/маркетинг не означают причинную атрибуцию.",
    conversation: "Управление всей цепочкой контента/рекламы/практики одним разговором не установлено. AI отсутствующим не объявляется.",
    convenience: "Не измерено. Документальные описания и рекламные обещания не заменяют одинаковые задания владельцу.",
    netIncome: "Не измерено. Нужны фактические расходы, поступления/повторы и сравнимый baseline.",
  },
  clinicsense: {
    marketing: "Официально описаны свободные окна, возвраты, отзывы/рекомендации, формы/SOAP, счета/Square/отчёты; не просто запись.",
    editing: "В изученных официальных материалах монтаж исходного видео не установлен; отсутствие не доказано.",
    ads: "Book Now и обучающий материал Ads Manager описаны. Это не свидетельство встроенного управления рекламой/бюджетом.",
    attribution: "Есть финансовые инструменты; единая цепочка расходов/оплаченных записей/повторов через разговор не установлена.",
    conversation: "Полная рекламная/контентная цепочка через единое разговорное управление не установлена. Не означает отсутствия AI.",
    convenience: "Не измерено, рейтинга нет. Нужны одинаковые задачи с исправлениями и согласованиями.",
    netIncome: "Не измерено, прирост прибыли не доказан. Маркетинговые обещания не независимый эксперимент.",
  },
} as const;
export const differenceAssessments = (subjects: Record<"massagebook" | "clinicsense", string>) => Object.entries(findings).flatMap(([key, values]) =>
  (Object.keys(differenceBenchmarkSteps) as Array<keyof typeof differenceBenchmarkSteps>).map(step => ({
    id: `DIFF-${key.toUpperCase()}-${step.toUpperCase()}`,
    input: packageElement(`${key} · ${differenceBenchmarkSteps[step]}`, "Рынок и конкуренты", values[step], {
      benchmarkType: "assessment", benchmarkSubject: key === "talkhint" ? key : subjects[key as keyof typeof subjects], benchmarkSuite: "difference", benchmarkStep: step,
      proofStatus: step === "marketing" && key !== "talkhint" ? "Подтверждено описаниями" : key === "talkhint" ? "Гипотеза / не измерено" : "Не установлено / не измерено",
      source: key === "talkhint" ? "Согласованное видение владельца и существующий Secretary; не готовность полной Crew."
        : packageSources.filter(s => s.key === key && !s.url.endsWith("/pricing")).map(s => s.url).join("\n"),
      metrics: axes, practicalTest: "Не проводился", limitations: "Не найдено в документации ≠ функции нет. Не сравнивать идею TalkHint с измеренной работой конкурента. Рейтингов/координат/доходов нет.",
    }, step === "marketing" && key !== "talkhint" ? "confirmed" : "question"),
  })));
