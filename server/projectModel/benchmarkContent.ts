import { benchmarkSteps, type ElementInput } from "../../shared/projectModel";
import { type MaterialElement } from "./materialContent";
import { sourceUrls, researchDate, recheckedAt } from "./materialSources";

type Subject = "talkhint" | "jobber" | "housecall-pro" | "zenmaid";
type Step = keyof typeof benchmarkSteps;
type Finding = [string, string, string];
const C = "Подтверждено", U = "Не установлено", H = "Гипотеза", T = "Нужен практический тест";
const findings: Record<Subject, Record<Step, Finding>> = {
  talkhint: {
    incoming: [C, "В коде есть отдельная серверная входящая OpenAI Secretary ветка и рабочие профили.", "Это не подтверждение готовности выпуска, legal gates или поведения на всех реальных номерах."],
    intake: [C, "В коде есть intake заявки, транскрипт и обработка неполного результата.", "Новый benchmark не испытывал качество сбора и исправлений. Это не постоянная CRM."],
    quote: [U, "Готовый универсальный расчёт стоимости услуг для Crew не установлен.", "Секретарь не должен выдумывать цены; только разрешённые сведения карточки."],
    approval: [C, "Исходящие поручения имеют review/confirm; новое клиентское TEST не должно звонить.", "Это не общий approval engine для финансов, маркетинга и всех будущих ролей."],
    booking: [U, "Персональный Calendar OAuth/freebusy реализован; полный write/reschedule/cancel нельзя считать готовым.", "Нельзя обещать бронь до фактического успешного бронирования. Здесь записи не создавались."],
    execution: [C, "В коде есть статусы задачи Secretary, история, транскрипт и итог.", "Производственный статус выполнения услуги клиентского бизнеса не реализован этим бенчмаркингом."],
    payment: [U, "Сквозной счёт/оплата за услугу клиентского бизнеса не установлен.", "Подписка TalkHint/Stripe не равна клиентскому invoicing и bookkeeping."],
    repeat: [H, "Повторные заказы через управляющего — продуктовая гипотеза.", "Нет подтверждённого сквозного автоматического сценария; CRM-продукт не создавать."],
    voice: [C, "Secretary поддерживает голосовую подготовку/обсуждение поручения; выбранная OpenAI ветка сохранена.", "Не общий голосовой CEO с управлением всеми бизнес-объектами."],
    marketing: [H, "Маркетинговая роль предусмотрена целевым видением владельца.", "Готовые автономные кампании/отправки не заявлены и здесь не запускались."],
    analytics: [H, "Бизнес-аналитик, финансы и налоги — целевое видение.", "История звонков не полный управленческий/бухгалтерский отчёт. Обещаний tax automation нет."],
    coordination: [H, "Управляющий координирует Crew с одобрением владельца — согласованный замысел.", "Полномочия и межролевая передача ещё требуют процедур/реализации и теста."],
  },
  jobber: {
    incoming: [C, "Receptionist заявляет 24/7 calls/text и ответы.", "DPN, план, доплаты и настройка разрешений; телефонный тест не проводился."],
    intake: [C, "Receptionist отвечает на запросы; requests — часть workflow.", "Качество уточнений и исправлений, язык и перенос в job требуют испытания."],
    quote: [C, "Quotes входят в workflow; Voice может создать и изменить расчёт.", "Admin, Voice mobile, Beta; новые записи не через Chat по статье."],
    approval: [T, "Клиентское approval quote описано; admin Voice может выполнять действия.", "Не смешивать согласие клиента с обязательным одобрением владельца каждого AI-действия."],
    booking: [C, "Online booking и Receptionist booking описаны; расписание/jobs/visits связаны.", "Доступность и разрешения задаёт бизнес; конфликты/перенос/ошибки не испытывались."],
    execution: [C, "Jobs/visits, назначение команды, заметки и complete visit описаны.", "Часть Voice действий — admin/Beta; фактическую сквозность не проверяли."],
    payment: [C, "Invoices, payment collection, card/ACH; Voice может создать/отправить счёт.", "Платёжные комиссии и доступность по странам/плану; денег не проводили."],
    repeat: [C, "Recurring jobs/visits и re-engagement marketing описаны.", "Не доказано самостоятельное превращение обращения в оплаченный повтор без ручных решений."],
    voice: [C, "AI Voice mobile: расчёты, счета, расписание, заметки и действия.", "Admin/Beta; маркетинговый контент только Chat. Не уникальное преимущество TalkHint."],
    marketing: [C, "AI Chat пишет контент и стратегии, есть Marketing Suite.", "Chat не Voice для marketing content; отправки/согласования/доплаты проверять отдельно."],
    analytics: [C, "AI анализирует clients/quotes/jobs/invoices/employees; есть reports/QuickBooks.", "Совет не независимое доказательство точности; не полный AI-налоговый управляющий."],
    coordination: [U, "Есть AI действия, автоматизации и контроль Receptionist.", "Единый автономный CEO, общий план и межагентные передачи не установлены; не утверждать их отсутствие."],
  },
  "housecall-pro": {
    incoming: [C, "CSR AI заявляет 24/7 ответы на звонки.", "Телефонный CSR AI paid отдельно; реальное качество не испытывалось."],
    intake: [C, "CSR AI обрабатывает обращения и booking.", "Chat/text coming soon против FAQ included CSR chat: доступность не установлена."],
    quote: [C, "Estimates/quotes есть в основном workflow.", "Самостоятельное создание расчёта AI по звонку и границы разрешений не установлены."],
    approval: [T, "Обычные пользовательские действия и предложения описаны.", "Обязательный owner approval каждого AI-шага и отмена ошибочного действия требуют теста."],
    booking: [C, "CSR booking и schedule/dispatch описаны.", "Двойные записи, перенос, отказ провайдера и настройки полномочий не испытывались."],
    execution: [C, "Jobs, schedule/dispatch, операционные статусы и reports представлены.", "Не считать названием AI Team доказательство автономного исполнения работ."],
    payment: [C, "Estimates, invoices и payments входят в продукт.", "AI-инициация платежа, consent и полная комиссия требуют отдельной проверки."],
    repeat: [T, "В продукте есть маркетинговые инструменты и booking.", "Полный сценарий оплаченного повторного заказа по данным этих источников не установлен."],
    voice: [U, "Подтверждён телефонный CSR, но это не то же, что голосовые поручения владельца.", "Voice CEO-интерфейс с общим управлением не установлен; отсутствие не доказано."],
    marketing: [C, "Marketing AI пишет emails, campaigns, service descriptions.", "Автономная отправка, согласования и фактический эффект не проверены."],
    analytics: [C, "Analyst AI отвечает по данным/выручке/работам; Coach — рост/цены/найм.", "Не независимый аудит финансов; рекламный рост выручки не доказательство причинного эффекта."],
    coordination: [U, "На странице названы CSR, Analyst, Coach и Marketing.", "Общая автономная Crew/CEO, передача контекста и контроль результатов не подтверждены названием AI Team."],
  },
  zenmaid: {
    incoming: [U, "AI-телефонный приём на двух проверенных pricing/help страницах не установлен.", "Не найдено ≠ отсутствует. Проверить актуальный продукт и интеграции."],
    intake: [T, "Scheduling и booking forms описаны.", "Разговорный intake, исправления и AI-уточнения не установлены."],
    quote: [U, "Онлайн-платежи/счета описаны; разговорный расчёт не установлен.", "Не делать вывод об отсутствии quotes/оценок без расширенной документации/теста."],
    approval: [U, "Базовое управление доступно Owner и платным профилям.", "Обязательные approvals для AI-действий и схема прав не исследованы."],
    booking: [C, "Scheduling, calendar/dispatch/map и booking forms по планам.", "Starter до 40 appointments; Pro/Max unlimited. Конфликты/отмена не испытывались."],
    execution: [C, "Cleaner mobile, checklists, GPS/доступность по планам.", "Зависит от Pro/Max; не считать фактом автономный контроль исполнения AI."],
    payment: [C, "Invoices и онлайн-платежи через Stripe/Square описаны.", "Комиссии, approvals и автоматическая цепочка не испытаны."],
    repeat: [C, "Spotfinder для новых recurring customers указан на Pro.", "Гарантия дополнительных оплаченных заказов отсутствует; сквозной тест нужен."],
    voice: [U, "AI voice/chat для поручений владельца по этим страницам не установлен.", "Это не доказательство отсутствия AI; запросить документы/проверить интерфейс."],
    marketing: [C, "SMS/email templates; Mailchimp/Zapier в Pro Max.", "Это не доказательство автономного AI-маркетинга; SMS оплачиваются отдельно."],
    analytics: [C, "Reports/payroll указаны по планам, export на Pro Max.", "QuickBooks coming soon; payroll ≠ полный бухгалтерский/налоговый учёт."],
    coordination: [U, "Операции команды описаны; межагентные передачи не установлены.", "Не выводить отсутствие AI или Crew из неполной pricing-документации."],
  },
};
function evidenceSource(subject: Subject, step: Step) {
  if (subject === "talkhint") return "Код: server/incomingSecretary/{livePhone,runtime,policy,ownerCalendar}.ts; server/secretary/. Фактические возможности не означают готовность выпуска; закрытые/живые проверки не выполнялись.";
  if (subject === "jobber") return sourceUrls(...(step === "incoming" || step === "intake" || step === "booking"
    ? ["jobber-reception", "jobber-faq"] : step === "voice" || step === "marketing" || step === "analytics" || step === "coordination"
      ? ["jobber-ai", "jobber-faq"] : ["jobber-workflow", "jobber-ai", "jobber-faq"]));
  if (subject === "housecall-pro") return sourceUrls("hcp-main", "hcp-ai", "hcp-pricing");
  return sourceUrls("zen-pricing", "zen-cost");
}
export const benchmarkElements: MaterialElement[] = Object.entries(findings).flatMap(([rawSubject, rows]) => {
  const subject = rawSubject as Subject;
  return Object.entries(rows).map(([rawStep, [proofStatus, description, limitations]]) => {
    const step = rawStep as Step;
    const approved = proofStatus === C;
    const input: ElementInput = {
      title: `${subject} · ${benchmarkSteps[step]}`, section: "Рынок и конкуренты", scope: "talkhint", kind: "research",
      description, contentStatus: approved ? "confirmed" : proofStatus === H ? "hypothesis" : "question", implementationStatus: "not_started",
      details: { benchmarkType: "assessment", benchmarkSubject: subject, benchmarkStep: step, proofStatus, limitations,
        practicalTest: "Не проводился — ни один из четырёх продуктов не испытан практически в этом бенчмаркинге.",
        unknown: approved ? "Практическая применимость, качество/ошибки, текущий план и end-to-end результат требуют проверки." : limitations,
        source: evidenceSource(subject, step), researchDate, sourceDate: "23.10.2026 — дата исходных материалов владельца", recheckedAt,
        provenance: subject === "talkhint" ? "Код и ранее проверенная реализация отдельно от целевого видения. Новый benchmark: только документальное сопоставление." : "Официальная документация поставщика, повторно прочитана 24.10.2026; не независимый опыт.",
        solution: subject === "talkhint" ? "Целевое видение: AI-управляющий с Crew, единый чат и согласование владельцем. Эта строка не означает, что видение уже реализовано." : "",
      },
    };
    return { id: `BM-${subject.toUpperCase()}-${step.toUpperCase()}`, input, approved };
  });
});
export const benchmarkRequirements: MaterialElement[] = [
  { id: "REQ-BENCH-FLOW", approved: true, input: requirement("Проверить одинаковый сквозной workflow", "Входящий → запрос → расчёт → owner approval → запись → статус → счёт/оплата → повтор.",
    "На синтетических данных пройти каждый шаг в Jobber/Housecall Pro/ZenMaid и доступных ветках TalkHint; записать план, ограничения, ручные действия, результат/ошибку, восстановление. Реальные звонки, платежи и внешние отправки требуют отдельного разрешения.") },
  { id: "REQ-BENCH-AI", approved: true, input: requirement("Проверить Voice / AI / согласования и передачу", "Проверить Jobber Beta/admin, HCP chat/text и Crew, ZenMaid AI; не путать CSR с Voice владельца.",
    "Для каждого продукта сохранить фактические права, точный запрос, исправления, approve/reject, передачу контекста/результата; отмечать независимые роли без handoff. Непроверенное не объявлять отсутствующим.") },
  { id: "REQ-BENCH-TCO", approved: true, input: requirement("Рассчитать сопоставимый полный TCO", "Одинаковые пользователи, объём работ/записей, calls/SMS, срок оплаты и платежи.",
    "Зафиксировать количество профилей, включённые лимиты, add-ons, overages, carrier/processing, налоги, промо и цену после акции; не рекламное «от». Пока исходный workload не выбран — TCO неизвестен.") },
  { id: "REQ-MARKET-VERIFY", approved: true, input: requirement("Сверить первичный рынок и метод SAM/SOM", "Census CBP/NES и Florida HealthSource; раздельно employer/nonemployer, NAICS, округа и год.",
    "Сверить 970/817, 718/694/623 и 686/43833, объяснить разные категории, не суммировать лицензии/работников/покупателей. SAM через сегменты/функции; 12-month SOM из funnel/retention/onboarding, без произвольного числа.") },
];
function requirement(title: string, description: string, acceptance: string): ElementInput {
  return { title, description, section: "Задания Replit", scope: "talkhint", kind: "requirement",
    contentStatus: "confirmed", implementationStatus: "planned",
    details: { acceptance, practicalTest: "Не проводился; задание только подготовлено, не запущено.", proofStatus: "Нужен практический тест",
      source: "Согласованное поручение владельца о конкурентном бенчмаркинге", provenance: "Требование подтверждено как объём проверки, не как результат/готовность функции." } };
}
