import type { ElementInput } from "../../shared/projectModel";
export const pilotDecisionDate = "2026-10-23";
export const pilotSource = "Явное решение владельца от 23 октября 2026, переданное текущим поручением: сузить пилот; прежних конкурентов/исследования не удалять. Это решение о проверке сегмента, не доказательство спроса или прибыли.";
export const pilotSegment = "Независимые лицензированные массажисты с собственной небольшой частной практикой в Южной Флориде (Miami-Dade, Broward, Palm Beach), без администратора.";
export const pilotValue = "Ты проводишь сеансы, TalkHint помогает вести частную практику — от обращения до повторной записи";
export const pilotSources = [
  { key: "massagebook", title: "MassageBook — официальный продукт", url: "https://pro.massagebook.com/", summary: "Запись, расписание, клиентские сведения, intake, SOAP, напоминания, оплаты и follow-up. Описаны solo и multi-practitioner. Это описание поставщика, не измеренный выигрыш." },
  { key: "massagebook", title: "MassageBook — Pricing (условия требуют отдельной проверки)", url: "https://pro.massagebook.com/pricing", summary: "Планы и ограничения зависят от состава практики и функций. Ценовой расчёт/TCO в этом обновлении не выполнен. Конкретную цену, доплаты, processing и условия проверить отдельно." },
  { key: "massagebook", title: "MassageBook — Marketing", url: "https://pro.massagebook.com/marketing/", summary: "Маркетинговые инструменты, email/follow-up, повторные обращения, directory/website и gift certificates описаны. Эффект и стоимость под пилот практически не измерены." },
  { key: "clinicsense", title: "ClinicSense — Massage Therapy", url: "https://clinicsense.com/professions/massage-therapy-software", summary: "Практика массажиста: онлайн-запись, SOAP-заметки, intake-формы, клиентские сведения и коммуникации. Не доказательство прибыльности или универсальной пригодности." },
  { key: "clinicsense", title: "ClinicSense — Scheduling", url: "https://clinicsense.com/features/online-booking-and-scheduling", summary: "Онлайн-запись, расписание, правила доступности, напоминания email/SMS. Переносы, конфликты, подключение и поведение после ошибок не испытывались." },
  { key: "clinicsense", title: "ClinicSense — Marketing & Communication", url: "https://clinicsense.com/features/marketing-and-communication", summary: "Email/newsletters, доступные окна, повторные обращения/retention и коммуникации. Маркетинговые заявления об эффекте не независимые результаты." },
  { key: "clinicsense", title: "ClinicSense — Finance Tools", url: "https://clinicsense.com/features/finance-tools", summary: "Финансовые отчёты, invoices и payments. Это не подтверждение AI-автономии, полного налогового учёта или проверенного TCO/интеграций для пилота." },
] as const;
export const pilotEvidence = {
  researchDate: pilotDecisionDate, sourceDate: "23.10.2026 — документальная проверка из материалов владельца",
  provenance: pilotSource, practicalTest: "Не проводился. Прочитанная документация не заменяет испытание.",
};
export function pilotElement(title: string, section: ElementInput["section"], description: string, details: ElementInput["details"], status: ElementInput["contentStatus"] = "hypothesis", kind: ElementInput["kind"] = "research"): ElementInput {
  return { title, section, scope: "talkhint", description, details: { ...pilotEvidence, ...details }, kind,
    contentStatus: status, implementationStatus: "not_started" };
}
export function pilotCompetitor(key: "massagebook" | "clinicsense"): ElementInput {
  const mb = key === "massagebook";
  return pilotElement(mb ? "MassageBook" : "ClinicSense", "Рынок и конкуренты",
    mb ? "Продукт управления массажной практикой, включая соло и несколько специалистов. Основной конкурент выбранного стартового сегмента."
      : "Продукт управления массажной/wellness-практикой с записью, SOAP, формами, напоминаниями и финансовыми инструментами. Основной конкурент стартового сегмента.",
    { benchmarkType: "competitor", benchmarkSubject: key, competitorPriority: "primary-starting-segment", prioritySegmentId: "TH-SEGMENT",
      decisionDate: pilotDecisionDate, region: "Сопоставляем с пилотом в Miami-Dade / Broward / Palm Beach",
      buyer: "Независимый массажист / владелец небольшой практики", segment: mb ? "Соло-практики и несколько специалистов" : "Массажная и wellness-практика; сравнение ведётся для независимого массажиста",
      solution: "Организация практики: расписание, клиентские данные, коммуникации и платежи",
      procedure: "Настройка практики → обращение → согласование/запись → напоминание/перенос → оплата → повторная запись; голос и отчёт владельцу проверяются отдельно",
      features: "Документацией описаны запись/расписание, intake-формы и SOAP-заметки; фактический состав зависит от плана",
      aiVoiceChat: "Текущие AI, голосовые поручения, chat и автономные роли не установлены этим набором источников. Отсутствие AI НЕ утверждается.",
      callsBooking: "Онлайн-запись и расписание подтверждены описаниями. Телефонный AI-приём и качество разговора требуют отдельной проверки.",
      marketing: mb ? "Маркетинг, follow-up и повторные обращения описаны; эффективность не измерена" : "Маркетинг/коммуникации и retention инструменты описаны; эффект не измерен",
      billing: "Оплаты/финансовые инструменты описаны; processing, полный workflow и реальные подключения для пилота не проверены",
      analytics: "Состав доступных отчётов и время владельца на управление требуют проверки; не объявлять это полным бухгалтерским/налоговым AI",
      pricing: "Текущие тарифы, ограничения, доплаты и полная стоимость требуют отдельной проверки. Цену «от» не выдавать за TCO.",
      comparison: "[Подтверждено документацией] У конкурента уже описаны операции массажной практики, формы/SOAP, напоминания, маркетинг и финансовые инструменты.\n[Гипотеза] TalkHint может требовать меньше настройки и времени владельца; это не доказанный выигрыш.\n[Не установлено] AI/голос, точные тарифы/лимиты/подключения, применимость полного сценария.\n[Нужен практический тест] Одинаковые 8 сценариев, время подключения/владельца, TCO и фактический результат. Полная Crew TalkHint — видение, не готовая функция.",
      proofStatus: "Операционные функции — подтверждено описаниями; AI/цены/ограничения — не установлено",
      source: pilotSources.filter(s => s.key === key).map(s => s.url).join("\n"),
      unknown: "Практических тестов нет. Неизвестны точные планы/лимиты, AI, интеграции, время подключения/владельца и TCO. Преимущество TalkHint не доказано.",
    }, "question");
}
