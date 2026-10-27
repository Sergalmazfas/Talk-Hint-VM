/** Explicit Dev documentation preparation. No provider, queue, mail or telephony imports. */
import assert from "node:assert/strict";
import type { ProjectModelState } from "../../../shared/projectModel";
import type { WorkNode, WorkMetric, OperatingData } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { productBookDocumentId, productBookText, readProductBook } from "../../../shared/productBook";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";

export const labRoleId = "laboratory-engineer-role";
export const labPacketId = "DOC-PLAB-WORK-PACKAGE";
export const labFormId = "DOC-PLAB-CALL-LETTER";
export const labMarker = "[PLAB-EVENT-LOOP]";
const resourceIds = ["lab-resource-materials", "lab-resource-runtime", "lab-resource-benchmark", "lab-resource-mail",
  "lab-resource-private-store", "lab-resource-qa"];
const rule = "По событию без намеренной отсрочки. Неизвестное = null/причина, не 0. Нет ответа ≠ приёмка. Нет реального исполнителя: автоматизация не включена.";
const guard = "Только разрешённые звонки владельца, read-only источник. Разрешение владельца не заменяет основание обработки/записи собеседника: неизвестно → запрос P.LEGAL, не копирование. Никаких чужих данных, звонков, публикаций, покупок или изменения телефонии. Сырые материалы и email не сохранять в публичной модели. P.LAB не принимает собственную оценку.";
const aid = (suffix: string) => `lab-action-${suffix}`;
const rid = (suffix: string) => `lab-result-${suffix}`;
const metric = (id: string, name: string, formula: string, unit = "доля"): WorkMetric => ({
  id, name, formula, unit, plan: null, fact: null, numerator: null, denominator: null,
  scope: "Когорта звонков владельца; режим/язык/сборка/окружение/период и дата среза обязательны",
  evidence: "Нет фактического прохода; источник и статус данных обязателен. Нулевой знаменатель = неприменимо.",
});
const legacyAndProductMetrics = () => [
  metric("test_calls_done", "Охват поступления", "Карточки приёма / разрешённые звонки source manifest"),
  metric("review_on_time", "Завершение разборов по событиям", "Разборы с независимой приёмкой / разрешённые звонки когорты на дату среза"),
  metric("quality_report_on_time", "Сводки качества", "Принятые блоки качества / закрытые периоды; день/неделя/месяц отдельно"),
  metric("corpus_growth", "Рост проверенного корпуса", "Число новых разрешённых и принятых фикстур/reference за месяц", "записи"),
  metric("scouting_on_time", "Обзор технологий", "Месяцы с принятым обзором связок / закрытые месяцы наблюдения; вход от будущего P.TECH"),
  metric("candidates_accepted", "Допуск кандидатов", "Допущенные кандидаты / рассмотренные кандидаты; ожидание отдельно"),
  metric("run_lead_time", "Длительность цепочки", "Медиана/p95 elapsed_ms; активная обработка, ожидание и возраст незавершённых отдельно", "мс"),
  metric("reproducible_runs", "Воспроизводимые прогоны", "Воспроизводимые завершённые / все начатые прогоны; сбои отдельно"),
  metric("regressions_found", "Известные регрессии до выпуска", "Число найденных регрессий и проверок; все неизвестные регрессии не знаменатель", "регрессии"),
  metric("proposals_accepted", "Приёмка предложений", "Принятые предложения дизайна / реально рассмотренные; ожидание отдельно"),
  metric("report_on_time", "Вклад в T07", "Принятые разделы / закрытые периоды; каждый тип отдельно"),
  metric("owner_calls_letter_sent", "Письма по звонкам", "Звонки с подтверждённым приёмом письма провайдером / разрешённые звонки source manifest"),
  metric("missed_hints_per_call", "Подтверждённые пропуски", "Подтверждённые пропуски / полностью оценённые Hint-звонки по рубрике", "пропуски/звонок"),
  metric("hint_latency", "Задержка до подсказки", "p50/p95 final→sent и final→ACK отдельно; покрытие timestamps/выборки обязательно", "мс"),
  metric("hint_wer", "Ошибки распознавания", "(S+D+I)/N по разрешённому проверенному reference; без него неизвестно"),
  metric("hint_usefulness", "Полезность подсказок", "Полезные / оценённые по версии рубрики; AI-оценка и отзыв владельца отдельно"),
  metric("minute_price", "Полная цена минуты", "Подтверждённые затраты STT/LLM/voice/телефония/инфраструктура / минуты; неизвестные части отдельно", "валюта/мин"),
];
interface Step {
  key: string; code: string; name: string; role: string; receiver: string; next: string;
  input: string; supplier: string; work: string; output: string; accept: string; trigger?: string;
  resources?: number[]; kpi: WorkMetric;
}
/** A one-time content migration specification, not a second live catalogue. Export reads saved nodes. */
const specs: Step[] = [
  { key: "method", code: "LAB.METHOD", name: "Проверить метод Ears на существующих результатах",
    role: labRoleId, receiver: "lg-qa-role", next: "intake", supplier: "head-engineering",
    input: "Существующие benchmark runs/config, разрешённый reference и методика",
    work: "Сначала запросить доступные старые результаты. Сверить corpus/hash, язык, скорость replay, конфигурацию, единицы и WER=(S+D+I)/N. Владелец оспаривает WER 0.74 как ошибку измерения; это гипотеза до проверки, не дефект Deepgram. Новые API-прогоны не выполнять.",
    output: "Протокол сопоставимости/разрывов метода", accept: "QA независимо сверяет вычисления и данные; reference отсутствует → WER неизвестен, не придуман",
    trigger: "Первый ручной проход JSON или изменение метода", resources: [1, 2],
    kpi: metric("method_checked", "Проверенный метод", "Методы с независимым протоколом / проверяемые методы") },
  { key: "intake", code: "LAB.1", name: "Принять материалы звонка и определить лабораторию",
    role: labRoleId, receiver: "lg-technical-role", next: "analyze", supplier: "head-engineering",
    input: "Событие завершения звонка, owner binding, фактический режим, разрешённые материалы",
    work: "Проверить владельца на сервере, call_id/event_id и artifact_version, дубли, происхождение/разрешение. Hint направить в Hint, Translator в Translator, Катю в Secretary; неизвестный режим → запрос технике, не fallback Hint. Составить опись транскрипта, hint events/ACK, времён, config/prompt/model, сборки и отсутствующего.",
    output: "Карточка приёма и адресные запросы; ссылки на приватные материалы",
    accept: "Техника проверяет фактический источник/режим и комплектность либо возвращает точный вопрос; нет чужого owner",
    kpi: metric("test_calls_done", "Охват поступления звонков", "Уникальные разрешённые звонки с карточкой приёма / все разрешённые звонки source manifest") },
  { key: "request", code: "LAB.INPUT.REQUEST", name: "Запросить недостающие материалы у техники",
    role: labRoleId, receiver: "lg-technical-role", next: "supply", supplier: rid("intake"),
    input: "Опись отсутствующих/неразрешённых полей",
    work: "Указать call_id, режим, поле, причину, версию и необходимого технического поставщика. Владелец не становится сборщиком логов. Нет ответа — ожидает/blocked, не принято.",
    output: "Адресный запрос технике", accept: "Понятно, какие данные нужны и зачем; запрос без достаточной привязки возвращается",
    kpi: metric("addressed_requests", "Адресные запросы", "Запросы с поставщиком и точным полем / все запросы") },
  { key: "supply", code: "LAB.INPUT.RECEIVE", name: "Принять запрос лаборатории и вернуть технический ответ",
    role: "lg-technical-role", receiver: labRoleId, next: "intake", supplier: rid("request"),
    input: "Запрос LAB.INPUT.REQUEST",
    work: "Принять достаточность запроса, запросить доступное у backend/mobile/channels/Engine. Вернуть фактическую версию материала или причину отсутствия/запрета. Не утверждать доступ к внешнему Engine без проверки.",
    output: "Ответ поставщика или обоснованный блокер", accept: "P.LAB сверяет комплект и происхождение; нет выдуманного ответа и пересылки чужих данных",
    kpi: metric("requests_answered", "Ответы на запросы", "Запросы с реальным ответом / зарегистрированные запросы") },
  { key: "analyze", code: "LAB.2", name: "Разобрать звонок по рубрике",
    role: labRoleId, receiver: "lg-qa-role", next: "qa", supplier: rid("intake"),
    input: "Разрешённые материалы, версия рубрики/оценщика; эталон при наличии",
    work: "Составить краткий итог и по каждой доступной Hint-подсказке: верная/бесполезная/ошибочная/выдумка/дубль. Полезность — AI-оценка, не отзыв человека. Пропуски оценивать только по достаточной полной истории и рубрике. WER без эталона неизвестен. final→sent и sent→ACK различать; стt final не физический конец речи. Для режимов без Hint его метрики неприменимы.",
    output: "Версионированный разбор с ограничениями и вопросами",
    accept: "QA имеет исходные разрешённые данные, рубрику/версию и может проверить каждое существенное утверждение",
    kpi: metric("review_on_time", "Завершённые разборы по событиям", "Звонки когорты с независимой приёмкой разбора / все разрешённые звонки когорты на дату среза") },
  { key: "qa", code: "LAB.QA", name: "Независимо проверить разбор и вернуть решение",
    role: "lg-qa-role", receiver: "head-engineering", next: "letter", supplier: rid("analyze"),
    input: "Разбор P.LAB, исходные материалы, рубрика/оценщик, результат стенда либо причина отсутствия",
    work: "Отдельным проходом проверить оценки, расчёты, пропуски и доказательства. Принять или вернуть конкретные расхождения P.LAB; не повторять самооценку автора как независимую проверку. До реального прохода QA = не проверено.",
    output: "Независимый протокол QA с verdict/замечаниями",
    accept: "HEAD.07 контролирует независимость, достаточность и доказательства; передача протокола автору не позволяет автору отменить QA",
    resources: [0, 1, 4, 5], kpi: metric("first_pass_acceptance", "Приёмка с первого раза", "Разборы, принятые QA с первого раза / реально рассмотренные QA разборы") },
  { key: "run", code: "LAB.8", name: "Сохранить результат разрешённого прогона либо его отсутствие",
    role: labRoleId, receiver: "lg-qa-role", next: "qa", supplier: rid("analyze"),
    input: "Карточка разбора и разрешённая фикстура; доступ к соответствующему стенду",
    work: "В первом пилоте прогон необязателен: указать «не выполнен» и причину. В дальнейшем только воспроизводимый corpus/hash/config/prompt/code, run_id и события. Не подменять звонок другим режимом; не выполнять прогон до ручной приёмки JSON.",
    output: "Протокол стенда или явный статус не выполнен", accept: "Есть доказательство, что действительно запускалось; отсутствие не записано как успешный прогон", resources: [0, 1, 2],
    kpi: metric("reproducible_runs", "Воспроизводимость прогонов", "Прогоны с полным воспроизводимым протоколом / все начатые прогоны") },
  { key: "letter", code: "LAB.MAIL.PREPARE", name: "Подготовить письмо по результату звонка",
    role: labRoleId, receiver: "operations-role", next: "send", supplier: rid("qa"),
    input: "Разбор, протокол QA либо явное отсутствие, результат стенда/причина",
    work: "Заполнить утверждаемую форму из DOC-PLAB-CALL-LETTER. Нет QA → тема/шапка «не проверено QA»; нет стенда → не выполнен. Не задерживать обратную связь до сводки. При поступлении QA сформировать явную новую версию. Состав личных данных/цитат — по разрешённым условиям.",
    output: "Версия информационного письма", accept: "Нет выдуманных нулей, ложной QA/доставки, непроверенных цитат или секретных ссылок",
    kpi: metric("letters_complete", "Комплектность письма", "Письма со всеми применимыми блоками/ограничениями / подготовленные письма") },
  { key: "send", code: "LAB.MAIL.SEND", name: "Принять письмо и отправить владельцу",
    role: "operations-role", receiver: labRoleId, next: "reconcile", supplier: rid("letter"),
    input: "Версия письма и подтверждённый адрес из защищённой настройки",
    work: "Проверить адрес/разрешённый состав. После допуска использовать серверный SendGrid HTTP через outbox, сохранить provider ID/статус/ошибку. Неизвестный исход сверить до повтора. Пример отправки в write-health alerter не доказывает готовый почтовый ресурс.",
    output: "Транспортное подтверждение либо ошибка/неопределённость", accept: "Принято провайдером не равно доставлено или прочитано; доставку/bounce подтверждать событием",
    resources: [1, 3, 4], kpi: metric("owner_calls_letter_sent", "Звонки с отправленным письмом", "Уникальные разрешённые звонки с подтверждённым приёмом письма провайдером / все разрешённые звонки когорты") },
  { key: "reconcile", code: "LAB.MAIL.RECONCILE", name: "Получить статус почты и передать в отчётность",
    role: labRoleId, receiver: "head-engineering", next: "period", supplier: rid("send"),
    input: "Транспортный статус, call_id/report_version",
    work: "Принять реальный статус, связать с карточкой звонка, запросить P.OPS при сбое. Сохранить failed/unknown/accepted/delivered/bounced раздельно. Владелец получает письмо, не обязан принимать каждый разбор.",
    output: "Карточка результата/отправки и блокеры", accept: "Результат связан с режимом/версией/доказательством; отсутствие ответа владельца не принято",
    kpi: metric("mail_status_known", "Известный транспортный исход", "Отправки с подтверждённым статусом / попытки отправки") },
  { key: "period", code: "LAB.REPORT", name: "Собрать дневной/недельный/месячный вклад T07",
    role: labRoleId, receiver: "head-engineering", next: "period-receive", supplier: rid("reconcile"),
    input: "Принятые разборы, статусы писем/QA, блокеры/решения и исходные числители",
    work: "Свести план-факт, показатели, ошибки, предложения и изменения; день/неделя/месяц — периоды, не дедлайны звонка. Семь блоков: качество, стенд, сделанное, технологии, конкуренты, дизайн, решения. Нет входа — адресный запрос, не выдуманная новость. Не усреднять p95 или проценты недель.",
    output: "Версия вклада лаборатории в T07", accept: "HEAD.07 принимает содержание или возвращает; координатор принимает комплектность далее по существующей цепочке",
    trigger: "Новый результат или закрытие отчётного периода",
    kpi: metric("report_on_time", "Принятые сводки", "Периоды с принятым вкладом T07 / закрытые отчётные периоды по каждому типу") },
  { key: "period-receive", code: "LAB.REPORT.RECEIVE", name: "Принять вклад лаборатории и передать T07",
    role: "head-engineering", receiver: "product-work-coordinator", next: "product", supplier: rid("period"),
    input: "Версия сводки лаборатории",
    work: "Проверить доказательства и содержание, принять или вернуть замечания P.LAB; передать в существующие T07.REPORT.WEEK/MONTH и координатору. Результат не принят автоматически. Общий отчёт компании принимает владелец, не все отделы по отдельности.",
    output: "Приёмка/возврат вклада и ссылка на T07", accept: "Координатор получает комплект либо возвращает конкретные поля; не самоприёмка HEAD.07",
    kpi: metric("report_receipt", "Получение вклада", "Сводки с реальным ответом получателя / переданные сводки") },
  { key: "product", code: "LAB.PRODUCT", name: "Передать доказательный вопрос продукту",
    role: labRoleId, receiver: "product-manager-specialist", next: "product-receive", supplier: rid("analyze"),
    input: "Принятый разбор или явная неполнота для продуктового вопроса",
    work: "Передать проблему/пользу клиенту, доказательства, ограничения и предложение следующей проверки. Не вести паспорта конкурентов вместо продукта, не объявлять фичу принятой или выпущенной.",
    output: "Пакет для рассмотрения продуктом", accept: "Продукт проверяет достаточность, возвращает вопрос или фиксирует решение",
    kpi: metric("product_feedback", "Обратная связь продукта", "Передачи с реальным ответом продукта / передачи продукту") },
  { key: "product-receive", code: "LAB.PRODUCT.RECEIVE", name: "Принять материал лаборатории и вернуть решение",
    role: "product-manager-specialist", receiver: labRoleId, next: "intake", supplier: rid("product"),
    input: "Передача LAB.PRODUCT", work: "Сохранить подтверждение получения, достаточность/адресный возврат и реальное решение по существующему PRD.1.6. Если исполнитель не подключён, оставить передачу ожидающей. Не имитировать решение другой роли.",
    output: "Решение/возврат продукта", accept: "Лаборатория подтверждает получение решения; HEAD.06 контролирует содержание решения",
    kpi: metric("decisions_recorded", "Прослеживаемость решений", "Реальные решения со связями/версией/ответом / рассмотренные передачи") },
];

export const labForm = {
  version: 1, status: "На ручной проверке; формат передан владельцем, заполненный результат не принят",
  subject: "[Лаборатория · {режим}] {дата} · {языки} · {статус QA}",
  header: ["call_id", "mode", "ended_at", "duration_ms", "languages", "ios_build", "environment",
    "stt_model/config", "brain_model/prompt_version", "voice/engine_if_applicable", "rubric_version", "judge_version",
    "analysis_status", "qa_status", "report_version"],
  sections: [
    "Итог одной строкой", "Распознавание: ошибки/источник; WER только по эталону",
    "Подсказки: показано/верные/бесполезные/ошибочные/выдумка/пропуски/дубли",
    "Задержки p50/p95 по звеньям, знаменатель и наблюдаемые исходные времена",
    "Сбои: обрывы/потерянные реплики/повторы или неизвестно",
    "Прогон: выполнен с доказательствами / не выполнен с причиной",
    "Предложения: эффект/гипотеза/проверка/нужное решение",
    "Чего не хватило: поле/поставщик/запрос/статус"],
  rules: ["Числа примера не факты; null не 0", "Hint-метрики для другого режима могут быть неприменимы",
    "Если QA нет, тема и шапка НЕ ПРОВЕРЕНО QA", "Новые данные → новая версия, не переписывать прошлое",
    "Email и личные материалы — только защищённые настройки/хранилище", "Нельзя считать письмо отправленным без доказательства транспорта"],
  periodForm: {
    header: ["период/Denver", "режимы", "версия/ответственный/принимающий", "дата данных"],
    core: ["план результата", "план действий", "сделано", "факт результата", "отклонение",
      "подтверждённая причина или гипотеза", "мера/ответственный", "следующий шаг", "ответы/возвраты"],
    labBlocks: ["качество", "стенд", "сделанное", "технологии", "конкуренты", "дизайн", "решения"],
    aggregation: "Пересчёт из исходных числителей/знаменателей; не сумма долей или среднее p95. Дневная → недельная → месячная без дублей.",
  },
};

export function buildLabPacket(state: ProjectModelState) {
  const data = state.operatingModel?.revisions.at(-1)?.data;
  assert.ok(data, "Operating model required");
  const role = data.nodes.find(n => n.code === "P.LAB");
  assert.ok(role, "P.LAB must already be saved");
  const actions = data.nodes.filter(n => n.id.startsWith("lab-action-"));
  const ids = new Set([role.id, ...actions.flatMap(n => [n.id, ...(data.links.filter(l => l.from === n.id && l.kind === "produces").map(l => l.to))]), ...resourceIds]);
  const form = state.documents.find(d => d.id === labFormId);
  assert.ok(form, "Saved form required");
  const byCode = (code: string) => {
    const n = data.nodes.find(n => n.code === code); assert.ok(n, `Existing recipient ${code}`); return n;
  };
  return {
    format: "talkhint.plab.work-package", version: 1,
    metadata: { sourceRevision: state.revision, operatingVersion: state.operatingModel!.revisions.at(-1)!.version,
      capturedAt: state.decisions.at(-1)?.at ?? null, roleId: role.id, documentId: labPacketId, timezone: "America/Denver",
      stage: "Описано для ручного прохода; не принято и не запущено",
      source: "Прямые уточнения владельца: событийная обработка, self-hosted CrewAI, существующий ключ; денежные потолки отменены" },
    gate: { jsonManualPass: "не выполнен", installationAllowed: false, workerStarted: false, mailEnabled: false,
      instruction: "Сначала вручную пройти этот JSON, сохранить реальные замечания/приёмку. До явной приёмки не устанавливать CrewAI и не включать почту." },
    sourceDocuments: state.documents.filter(d => [productBookDocumentId, "DOC-TALKHINT-CHAPTER-HINT"].includes(d.id))
      .map(d => ({ id: d.id, title: d.title, updatedAt: d.updatedAt,
        bookVersion: d.id === productBookDocumentId ? readProductBook(d)?.version : undefined,
        downloadPath: `/api/product-crew/documents/${d.id}/download` })),
    role: { ...role, metrics: undefined, metricIds: role.metrics?.map(m => m.id) },
    metricDefaultScope: role.metrics?.[0]?.scope,
    metricDefinitions: Array.from(new Map([...(role.metrics ?? []), ...actions.flatMap(n => n.metrics ?? [])]
      .map(m => [m.id, m] as const)).values()).map(({ evidence, scope, ...m }) => ({
        ...m, ...(scope !== role.metrics?.[0]?.scope ? { scope } : {}),
      })),
    metricRules: "Все показатели — определения для проверки, не принятые нормативы; plan/fact null. Четыре Hint-метрики ждут решения владельца. Для обзоров технологий/корпуса/дизайна нужны будущие смежные входы, первый звонок их не исполняет.",
    actionCommon: {
      rules: rule, constraints: guard,
      storage: "Описания в общей модели; реальные материалы приватно",
      failure: "Адресный запрос/возврат поставщику, blocked не успех",
      reporting: { documentId: labFormId, formStatus: "discussion", period: "день/неделя/месяц" },
      execution: "Ни один executor не назначен; все runtime стадии не выполнены",
    },
    actions: actions.map(n => ({
      id: n.id, code: n.code, name: n.name, roleId: n.roleId, clientId: n.clientId,
      recipientId: n.recipientId, acceptorId: n.acceptorId, nextId: n.nextId,
      controllerId: role.managerId, inputs: n.inputs, resourceIds: n.resourceIds,
      procedure: n.procedure, resultId: data.links.find(l => l.from === n.id && l.kind === "produces")?.to,
      acceptance: n.success, schedule: n.schedule, metricIds: n.metrics?.map(m => m.id),
      status: "описано; выполнение/проверка/приёмка не подтверждены",
    })),
    resources: data.nodes.filter(n => resourceIds.includes(n.id))
      .map(n => ({ id: n.id, code: n.code, name: n.name, ownerId: n.roleId,
        clientId: n.clientId, description: n.description, procedure: n.procedure, readyWhen: n.success,
        state: n.resourceState, proof: null, missing: n.questions })),
    results: data.nodes.filter(n => ids.has(n.id) && n.kind === "result")
      .map(n => ({ id: n.id, name: n.name, supplier: n.roleId, recipient: n.recipientId, status: "Схема результата; не выполнено" })),
    // Action fields already carry resources, controller and acceptor; don't duplicate every edge.
    links: data.links.filter(l => ids.has(l.from) && ids.has(l.to) && ["handoff", "return"].includes(l.kind))
      .map(l => ({ id: l.id, from: l.from, to: l.to, kind: l.kind, readiness: l.readiness })),
    recipients: ["HEAD.07", "P.LG.QA", "P.LG.TECH", "P.PRODUCT", "P.OPS", "P.COORD", "P.LEGAL"]
      .map(code => { const n = byCode(code); return { id: n.id, code, name: n.name, executorId: n.executorId }; }),
    form: JSON.parse(form.text),
    task: { status: "ручной проход, не реальный анализ звонка", firstMode: "hint",
      call: null, audience: "владелец TalkHint", geography: "Не задана; не выводить из timezone",
      steps: ["Проверить метод Ears по разрешённым старым результатам или открыть запрос", "Пройти приём и маршрутизацию",
        "Пройти разбор → QA/возврат → письмо → отчётность", "Записать для каждого шага факт/блокер и ответ получателя"],
      completion: "Каждый шаг имеет доказанный результат либо адресный блокер; владелец/ChatGPT явно принимает/возвращает JSON. Это не автоматический допуск реального контура." },
    routing: [
      { mode: "hint", target: "Hint", status: "код источника найден; ресурс worker не выдан",
        sources: ["server/candidatePipeline.ts: hintLatency/hintUsage", "server/websocket.ts: live pipeline", "ios/TalkHint/Calls/CallHintStream.swift"],
        limits: "entries ограничены первыми 200; summary не пересчитывать как полный набор из усечённых entries. Реальные звонки не читались. Наличие ACK текущей сборки не проверено." },
      { mode: "translator", target: "Translator", status: "источник зависит от сценария; постоянный экспорт требует проверки",
        sources: ["server/translation/spike.ts", "server/translation/forensics.ts"],
        limits: "Журнал браузерного spike не доказательство полной телеметрии каждого PSTN/iPhone звонка." },
      { mode: "secretary", target: "Secretary", status: "код локального Retell найден; удалённый Engine и источник каждого режима не опрашивались",
        sources: ["server/secretary/retellPhone.ts", "server/secretaryLab/comparisonStore.ts"],
        limits: "Secretary Lab comparison не равен production-звонку. Материалы с внешнего сервера не выданы." },
      { mode: "copilot", target: "Copilot", status: "в плане проверки данных", sources: ["server/translation/copilotBench.ts"],
        limits: "Copilot сохранён; сессионный стенд не архив всех реальных звонков." },
      { mode: "unknown", target: null, status: "blocked", sources: [], limits: "Адресный запрос технике; не fallback Hint" },
    ],
    retention: { sourceCopies: "7 дней", privateAnnotations: "90 дней",
      fixtureException: "Только отдельно разрешённая версия корпуса; срок/основание требуют явной фиксации, не бессрочное исключение",
      implementation: "Политика описана; удаление/копирование не включены. Исходные provider TTL этим не меняются." },
    futureRuntime: { framework: "Self-hosted open-source CrewAI с официального GitHub; версия/лицензия проверяются после приёмки JSON",
      cloudPlatform: false, model: "Уже подключённая модель/ключ проекта; ресурс worker не проверен, секреты не включены",
      passes: ["P.LAB analysis", "независимая QA", "подготовка письма; отправка через серверный транспорт"],
      modeContext: "Одна P.LAB, разные задания по фактическому режиму; роль не равна экземпляру агента",
      next: "После приёмки JSON — сборка, синтетическая проверка, diff; публикация и реальный звонок владельцем" },
    trialProtocol: actions.map(n => ({ actionId: n.id, status: "не выполнено", evidence: null,
      result: null, missingInputOrResource: null, supplier: n.inputs[0]?.sourceId ?? null,
      receiver: n.recipientId, response: null, verdict: null })),
  };
}

export function prepareLabRole(root: ProjectModelState, now: string): ProjectModelState {
  const state = readHypothesis(root, "new-country");
  if (state.documents.some(d => d.id === labPacketId)) {
    assert.ok(state.operatingModel?.revisions.at(-1)?.data.nodes.some(n => n.id === labRoleId && n.code === "P.LAB"), "Partial import requires review");
    return root;
  }
  const originalData = state.operatingModel!.revisions.at(-1)!;
  const data: OperatingData = structuredClone(originalData.data);
  const existingIds = new Set(data.nodes.map(n => n.id));
  const must = (id: string) => { const n = data.nodes.find(n => n.id === id); assert.ok(n, `Missing ${id}`); return n; };
  // Use actual current role identities rather than assuming aliases in a draft.
  const roleId = (code: string) => { const n = data.nodes.find(n => n.code === code && n.kind === "role"); assert.ok(n, code); return n.id; };
  const aliases: Record<string, string> = {
    "lg-qa-role": roleId("P.LG.QA"), "lg-technical-role": roleId("P.LG.TECH"),
    "operations-role": roleId("P.OPS"), "product-manager-specialist": roleId("P.PRODUCT"),
    "head-engineering": roleId("HEAD.07"), "product-work-coordinator": roleId("P.COORD"),
  };
  const resolve = (id: string) => aliases[id] ?? id;
  assert.ok(!data.nodes.some(n => n.code === "P.LAB"), "Existing P.LAB must be reconciled, not duplicated");
  const add = (n: WorkNode) => { assert.ok(!existingIds.has(n.id) && !data.nodes.some(x => x.id === n.id), `Collision ${n.id}`); data.nodes.push(n); return n; };
  const role = add(emptyWorkNode(labRoleId, "P.LAB", "Инженер лабораторий и анализа качества", "role", must(resolve("head-engineering")).parentId));
  Object.assign(role, { managerId: resolve("head-engineering"), detailState: "described", clientId: resolve("head-engineering"),
    purpose: "Давать технике/продукту проверяемую картину качества звонков владельца и возвращать владельцу понятный результат; конечная польза — надёжная помощь в разговоре.",
    procedure: "Обязанности собираются из связанных действий LAB: материалы → анализ → независимая QA → письмо → отчётность/продукт. Одна роль с контекстом режима.",
    rules: rule, constraints: guard, resourceIds, referenceIds: [labPacketId, labFormId, "DOC-TALKHINT-CHAPTER-HINT"],
    success: "Полный ручной проход JSON и явная приёмка; заполненные поля сами по себе не готовность работника.",
    metrics: legacyAndProductMetrics(),
    questions: "Исполнитель CrewAI не установлен; источник owner binding, данные, изоляция, модель worker и почта не выданы.",
  });
  const resources = [
    ["Разрешённые материалы звонков владельца", "P.LG.TECH", "Read-only owner-scoped доступ: транскрипт, hint events/ACK, config, build, timestamps. Dev/prod по сообщению владельца не изолированы; проверяемая граница обязательна до включения."],
    ["Self-hosted CrewAI и существующая модель", "P.OPS", "Будущий worker с GitHub без облачной CrewAI, существующий ключ модели. Установка только после ручной приёмки JSON. API ключи не включать в документы."],
    ["Стенд Hint Ears/Brain", "HEAD.07", "Существующие benchmark_runs/fixtures и /diagnostics; сначала разрешённое чтение старого результата. Наличие стенда не выдаёт доступ AI."],
    ["Почтовый канал владельцу", "P.OPS", "SendGrid HTTP: пример в server/writeHealthAlerter.ts. Настройка/доставка не проверены; подтверждённый адрес выдаётся только защищённой конфигурацией, не в публичном документе."],
    ["Приватное хранилище результатов и outbox", "P.OPS", "Owner-scoped результаты/журнал/dedup отдельно от публичной оргмодели; 7 дней копии материалов, 90 дней аннотации, корпус только по отдельному разрешению. Реализация/удаление не включены."],
    ["Независимый проход QA", "P.LG.QA", "Отдельный контекст/исполнитель от автора разбора, разрешённые данные и версия рубрики. Ни роль в схеме, ни тот же текст автора не доказательство реальной QA."],
  ];
  resources.forEach(([name, supplier, description], i) => {
    const n = add(emptyWorkNode(resourceIds[i], `RES.LAB.${i + 1}`, name, "resource", role.parentId));
    Object.assign(n, { roleId: resolve("head-engineering"), clientId: labRoleId,
      description, purpose: description, resourceState: "required",
      procedure: `Поставщик ${supplier}. Проверить разрешённое чтение/запись результата от имени worker; не путать доступ Replit с доступом агента.`,
      success: "Есть конкретное доказательство чтения/записи, права и адресный ответ принимающего",
      referenceIds: [labPacketId], questions: "Не выдано и не проверено для worker" });
  });
  for (const spec of specs) {
    const n = add(emptyWorkNode(aid(spec.key), spec.code, spec.name, "action", role.parentId));
    Object.assign(n, { roleId: resolve(spec.role), clientId: resolve(spec.receiver), recipientId: resolve(spec.receiver),
      acceptorId: resolve(spec.receiver), detailState: "described",
      nextId: aid(spec.next), purpose: spec.output, procedure: spec.work,
      inputs: [{ name: spec.input, sourceId: resolve(spec.supplier), freshness: "Фактические версия/режим/дата; отсутствие явно" }],
      resourceIds: (spec.resources ?? [0, 1, 4]).map(i => resourceIds[i]), rules: rule, constraints: guard,
      success: spec.accept, delivery: `Результат ${rid(spec.key)} → ${resolve(spec.receiver)}; зафиксировать ответ/возврат`,
      storage: "Описания в существующей модели; реальные материалы только приватно по разрешённому доступу",
      exceptions: "Вернуть конкретную причину/поле поставщику; blocked не равно принято, не подменять отсутствие данных успехом",
      metrics: [spec.kpi], referenceIds: [labPacketId, labFormId],
      schedule: { days: [], hours: "", timezone: "America/Denver", trigger: spec.trigger ?? "Событие поступления достаточного входа; неполнота → адресный запрос", deadline: "" },
      register: { availability: "Событийно; целевой runtime 24/7, не включён", period: "событие / отчётный период",
        operationsPerPeriod: null, minutesPerOperation: null, estimateBasis: "Нет измерений нагрузки", approval: "discussion",
        source: "Уточнения владельца; описание, не назначенный исполнитель", proposalReason: "JSON сначала, исполнение после приёмки" },
      reporting: { required: true, formName: "Письмо/протокол по звонку и вклад T07", templateDocumentId: labFormId,
        templateVersion: "1", storage: "Приватный результат; в общей модели безопасная ссылка/метаданные", formStatus: "discussion", approvalEvidence: "" },
    });
    const result = add(emptyWorkNode(rid(spec.key), `${spec.code}.RESULT`, spec.output, "result", n.id));
    Object.assign(result, { roleId: n.roleId, clientId: n.clientId, recipientId: n.recipientId,
      purpose: spec.output, delivery: n.delivery, description: "Схема будущего результата; реального результата/приёмки нет", referenceIds: [labPacketId] });
  }
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => {
    must(from); must(to);
    data.links.push({ id: `lab:${kind}:${from}:${to}`, from, to, kind, reason,
      readiness: { structure: "passed", resources: "unknown", trial: "unknown", evidence: "Узлы/адресаты существуют; ресурсы/реальный проход не проверены" } });
  };
  for (const spec of specs) {
    link(aid(spec.key), rid(spec.key), "produces", "Схема результата, не выполненная работа");
    link(rid(spec.key), aid(spec.next), "handoff", "Выход → следующий принимающий шаг");
    link(aid(spec.key), resolve(spec.receiver), "acceptance", spec.accept);
    link(aid(spec.key), resolve("head-engineering"), "accountable_to", "Техническое содержание/эскалация; не исполнитель каждого анализа");
    for (const r of must(aid(spec.key)).resourceIds) link(aid(spec.key), r, "requires", "Ресурс не выдан, исполнение не разрешено");
  }
  link(rid("intake"), aid("request"), "handoff", "Если материалов недостаточно");
  link(aid("qa"), aid("analyze"), "return", "QA возвращает конкретные замечания, не самооценка P.LAB");
  link(rid("analyze"), aid("run"), "handoff", "Необязательная ветвь стенда; иначе причина не выполнен");
  link(rid("analyze"), aid("product"), "handoff", "Параллельный продуктовый вопрос");
  const t07 = data.nodes.find(n => n.code === "T07.REPORT.WEEK")!;
  assert.ok(t07, "Existing T07 report required");
  link(rid("period-receive"), t07.id, "handoff", "В существующую отчётность, не новый каталог");
  // Create references inside the same atomic model update before schema validation.
  // The intermediate placeholder is never committed alone or presented as a work package.
  let next = applyHypothesisCommand(root, "new-country", { type: "createDocument", id: labPacketId,
    title: "P.LAB — подготовка выгрузки", text: '{"status":"Подготовка внутри атомарного обновления; не готовый пакет"}',
    url: "", elementIds: [] }, "Replit: идентичность канонической выгрузки");
  next = applyHypothesisCommand(next, "new-country", { type: "createDocument", id: labFormId,
    title: "P.LAB — форма письма и сводки — v1 — на ручной проверке", text: JSON.stringify(labForm),
    url: "", elementIds: [] }, "Replit: форма из переданных материалов; без реальной отправки");
  next = applyHypothesisCommand(next, "new-country", { type: "saveOperatingModel", baseVersion: originalData.version, data },
    "Replit: описание P.LAB, JSON перед запуском; без worker/провайдеров");
  const bookDoc = state.documents.find(d => d.id === productBookDocumentId), book = readProductBook(bookDoc);
  assert.ok(book && bookDoc, "Canonical book required");
  const text = productBookText({ ...book, version: book.version + 1, updatedAt: now,
    responsibilities: book.responsibilities + `\n\n${labMarker}\nP.LAB: единая лабораторная роль с контекстом режима. Паспорт/действия в общей структуре, JSON ${labPacketId}, форма ${labFormId}. Следующий шаг: ручной проход JSON; CrewAI/почта не включены. QA независима. Денежные потолки прежнего предложения отменены; дедлайнов исполнения нет.` });
  assert.ok(text.length <= 50000);
  next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: bookDoc.id,
    title: bookDoc.title.replace(/\bv\d+\b/, `v${book.version + 1}`), text, url: bookDoc.url, elementIds: bookDoc.elementIds },
    "Replit: связь книги с P.LAB; прежние главы сохранены");
  const roadmap = state.documents.find(d => d.id === "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d");
  if (roadmap) {
    const roadmapText = roadmap.text + `\n\n${labMarker}\nP.LAB: описание сохранено для ручного прохода; JSON ${labPacketId}. Дальше — явная приёмка JSON, затем self-hosted CrewAI с существующей моделью и письмом по режиму звонка. Worker и почта не запущены. Нет срока ожидания; день/неделя/месяц — периоды сводок.`;
    assert.ok(roadmapText.length <= 50000);
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: roadmap.id,
      title: roadmap.title, text: roadmapText, url: roadmap.url, elementIds: roadmap.elementIds }, "Replit: ближайший этап P.LAB в едином roadmap");
  }
  const beforePacket = readHypothesis(next, "new-country");
  const packet = buildLabPacket({ ...beforePacket, revision: beforePacket.revision + 1 });
  const packetText = JSON.stringify(packet);
  assert.ok(packetText.length <= 50000, `Packet ${packetText.length}: split explicitly; never truncate`);
  next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: labPacketId,
    title: "P.LAB — рабочий JSON — v1 — ожидает ручного прохода", text: packetText, url: "", elementIds: [] },
    "Replit: выгрузка из сохранённой структуры; проход не выполнен");
  const after = readHypothesis(next, "new-country");
  assert.equal(JSON.parse(after.documents.find(d => d.id === labPacketId)!.text).metadata.sourceRevision, after.revision);
  assert.deepEqual(after.elements, state.elements);
  assert.deepEqual(after.relations, state.relations);
  for (const n of originalData.data.nodes) assert.deepEqual(data.nodes.find(x => x.id === n.id), n);
  return next;
}
