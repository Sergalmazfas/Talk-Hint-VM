/** Documentation only: canonical P.OPS, no worker, scheduler or provider imports. */
import assert from "node:assert/strict";
import type { ProjectModelState } from "../../../shared/projectModel";
import type { WorkNode, OperatingData } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { readHypothesis, applyHypothesisCommand } from "../hypotheses";

export const opsPacketId = "DOC-POPS-WORK-PACKAGE";
export const opsFormId = "DOC-POPS-DAILY-REPORT";
const marker = "[POPS-ONCALL-V1]";
const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const aid = (key: string) => `oncall-action-${key}`;
const out = (id: string) => `${id}-out`;
const common = {
  source: "Поручение владельца: описать дежурного всей системы, входящие документы, ежедневный короткий отчёт и JSON для ручного прохода.",
  guard: "Только разрешённое чтение и описание. Новое расписание/рассылка не запущены. Нельзя менять production, телефонию, доступы, цены или данные, принимать собственную QA, выдавать предложение за согласование.",
  acceptance: "Версия, период, окружение, источник и доказательство обязательны. Проверить комплектность и соответствие ожидаемому событию; неизвестное не равно нулю/успеху.",
  returns: "Вернуть поставщику конкретное отсутствующее поле/доказательство, записать статус и адресата. Нет ответа — ожидает, не принято; не блокировать весь отчёт одним отсутствующим входом.",
  response: "Для аварии — без намеренной отсрочки после обнаружения; гарантированный срок доставки не утверждён. Период ежедневного отчёта согласован, час/граница суток ждут решения владельца.",
};
interface Spec { key: string; name: string; work: string; input: string; result: string; trigger: string; resources: string[] }
const specs: Spec[] = [
  { key: "scope", name: "Получить перечень систем, процессов и ожидаемых событий",
    input: "Паспорта/roadmap и границы десяти направлений от HEAD.07, продукта и руководителей",
    work: "Составить версионную карту: режим/подсистема/платформа/окружение, владелец, действие, ожидаемое событие и его доказательство. Отдельно Hint, Катя, Translator, Prepare, History, Copilot, web/iOS, лаборатории и crew; планируемое не считать запущенным.",
    result: "Карта охвата: наблюдается / нет источника / запланировано / выключено / неприменимо",
    trigger: "Начало дежурства; изменение паспорта, релиза, процесса или владельца", resources: ["model", "documents"] },
  { key: "documents", name: "Получить и зарегистрировать проверочную документацию",
    input: "Актуальные главы паспорта, требования, схемы, инструкции, тесты, changelog, план выпуска/отката, договорённые критерии и ограничения",
    work: "Получить от владельцев документов версии и ссылки; сопоставить текущую сборку и окружение. Юридические правила — от P.LEGAL, финметодика — от HEAD.08, технические runbook — от HEAD.07. Не заменять документ пересказом чата.",
    result: "Реестр документов: версия, владелец, назначение проверки, актуальность и недостающий вход",
    trigger: "Новая версия документа/релиза; начало отчётного периода", resources: ["documents", "model"] },
  { key: "inputs", name: "Проверить достаточность входов и запросить недостающее",
    input: "Карта охвата и реестр документов; статусы и ресурсы от ответственных",
    work: "Сверить требуемый комплект с полученным; адресовать запрос конкретному поставщику с полем, целью и ожидаемым подтверждением. Получение и ответ фиксировать только фактически. Обязательный недоступный ресурс — blocked, остальное проверять без него.",
    result: "Матрица достаточности и адресные запросы с реальным статусом ответа",
    trigger: "Приём входа; обнаружение пропуска или противоречия", resources: ["model", "documents"] },
  { key: "observe", name: "Проверять план-факт событий и междолжностных передач",
    input: "Версионная карта ожидаемых шагов; разрешённые журналы и поступившие факты",
    work: "Сопоставить ожидалось → началось → завершилось → передано → принято/возвращено. Смотреть отмены, повторы, сбои, зависания и отсутствие события. Отделить ручное действие от кода и AI. Intentional pause не авария; отсутствие доступа не зелёный статус.",
    result: "Реестр наблюдений с последним подтверждённым шагом, источником и границами покрытия",
    trigger: "Событие процесса и контрольный опрос; частоты разных систем требуют проверки", resources: ["events", "model"] },
  { key: "quality", name: "Проверить основания качества, тестов и лабораторных результатов",
    input: "Результаты QA/лабораторий и перечень обязательных проверок от техники",
    work: "Сверить сборку, режим, набор тестов и реальные артефакты; отличать unit, synthetic, Simulator, устройство и production. Проверить наличие verdict независимого QA, не пересматривать его вместо QA. Наличие кода/стенда не доказывает работающую функцию.",
    result: "Проверка происхождения доказательств, непройденные проверки и вопросы ответственным",
    trigger: "Новый результат теста/лаборатории/релиза; ежедневный срез", resources: ["tests", "documents"] },
  { key: "alert", name: "Зафиксировать сбой и немедленно уведомить владельца",
    input: "Подтверждённая ошибка, задержка или отсутствие ожидаемого события",
    work: "Дать инциденту устойчивый ID, записать факт отдельно от причины-гипотезы, последний шаг, затронутый процесс и адресата. Отправить короткое self-mail через разрешённый канал. До отправки сохранить состояние; после — provider ID/SENT. Не повторять неопределённую отправку вслепую.",
    result: "Карточка инцидента и подтверждение отправки либо unknown/needs_review",
    trigger: "Сразу после обнаружения; задержка — по явно записанному техническому порогу, не произвольному SLA", resources: ["events", "mail", "model"] },
  { key: "route", name: "Передать инцидент ответственному и отслеживать ответ",
    input: "Карточка инцидента, карта ответственности и известные ограничения",
    work: "Передать технический сбой главному инженеру через существующее ENG.CHIEF.8; продуктовую проблему продукту через существующий поток, ресурсную — владельцу ресурса. Контролировать получение, решение и статус, без имитации ответа. Выход за полномочия эскалировать владельцу.",
    result: "Передача с принимающим действием, фактическим ответом либо ожиданием",
    trigger: "Новый инцидент; изменение состояния/ответственного", resources: ["model", "events"] },
  { key: "recovery", name: "Проверить восстановление по фактическим доказательствам",
    input: "Ответ инженера и результат проверки QA через ENG.REG.6",
    work: "Запросить доказательство восстановления того же звена/сборки, проверить новый успешный переход и отсутствие неопределённой доставки. Нет новых ошибок — не доказательство исправления. Не закрывать случай по обещанию. Если доказательства нет, оставить неизвестно/ожидает и вернуть вопрос.",
    result: "Подтверждённое восстановление либо сохранённый открытый разрыв",
    trigger: "Поступил ответ об исправлении; новое успешное событие", resources: ["events", "tests", "model"] },
  { key: "daily", name: "Собрать план-факт дня и короткий отчёт всей системы",
    input: "Наблюдения дежурства и существующие ежедневные статусы T01–T10",
    work: "Закрыть согласованный период; по всем системам показать, что ожидалось/отработало/не сработало/не проверено. Отделить фактическую работу продукта от описанных обязанностей без исполнителя. Свести инциденты, изменения/нововведения, тесты, пробелы ресурсов и предложения. Не подменять этим экономику и бизнес-сводку координатора.",
    result: "Короткий ежедневный обзор с деталями по ссылкам и явной матрицей охвата",
    trigger: "Ежедневно; час отправки и граница суток пока не утверждены", resources: ["model", "events", "documents", "tests"] },
  { key: "send", name: "Отправить ежедневный отчёт и подтвердить транспорт",
    input: "Версия короткого отчёта, разрешённый адрес владельца и канал доставки",
    work: "Сохранить отчёт до отправки; отправить владельцу, техническую копию HEAD.07 и вклад в T07 по разрешённому маршруту. Отсутствующий статус отметить, а не ждать бесконечного согласования. Сохранить ID и SENT; это не прочтение и не приёмка. Повтор при потерянном ответе запрещён.",
    result: "Сохранённая версия и подтверждение транспорта либо журнал ошибки",
    trigger: "Отчёт сформирован; запуск рассылки только после ручного прохода и отдельной активации", resources: ["mail", "model"] },
  { key: "feedback", name: "Получить замечания к отчёту и вернуть исправленную версию",
    input: "Реальное решение HEAD.07 или владельца, конкретные замечания",
    work: "Зарегистрировать фактически поступившие замечания, запросить уточнение, исправить новую версию с было/стало и причиной. Не переписывать историю и не считать молчание утверждением. Спорный вывод вернуть поставщику доказательства.",
    result: "Версионная правка и замкнутая обратная связь либо ожидающий запрос",
    trigger: "Получена приёмка/возврат/уточнение отчёта", resources: ["model", "documents"] },
  { key: "period", name: "Передать недельный и месячный вклад в общую отчётность",
    input: "Ежедневные обзоры, инциденты и ответы за сопоставимый период",
    work: "Свести повторы, время незавершённых звеньев, подтверждённые восстановления, изменения и предложения. Передать HEAD.07 в существующие T07.REPORT.WEEK/MONTH, затем координатору по прежней цепочке. Не суммировать одни и те же события повторно.",
    result: "Недельный/месячный вклад с версиями, источниками и ожидаемой приёмкой",
    trigger: "Закрытие недели/месяца; точные границы периодов ждут решения", resources: ["model", "documents"] },
  { key: "self", name: "Проверять работоспособность самого контроля и его ресурсов",
    input: "Heartbeat, актуальность checkedAt, доступность БД/почты и внешнего наблюдателя",
    work: "Отличить checked, paused, stale, blocked, unknown. Проверить сам канал сигнализации и независимость от наблюдаемого сервера. Если сервер/БД/почта недоступны, не обещать письмо через тот же отказавший узел. Запросить внешний контроль и другой канал; не подключать услуги автоматически.",
    result: "Статус работоспособности дежурства и адресные разрывы оснащения",
    trigger: "Начало дежурства; опрос; сбой источника или уведомления", resources: ["events", "mail", "external"] },
];
const resourceNames = {
  model: "Общая модель, реестр действий и история решений",
  documents: "Версионные паспорта, runbook, схемы, процедуры и критерии",
  events: "Разрешённые метрики, журналы и ожидаемые события всех систем",
  tests: "Результаты QA, лабораторий, сборок и тестов с происхождением",
  mail: "Защищённый Gmail self-mail и подтверждения транспорта",
  external: "Независимый внешний контроль сервера и резервный канал",
};
const form = {
  format: "talkhint.ops.daily-report", version: 1, status: "На ручном проходе, не утверждено",
  header: { periodStart: null, periodEnd: null, timezone: null, environment: null, author: "P.OPS",
    sourceRevision: null, buildVersions: [], deliveryHour: null },
  shortReport: {
    systemSummary: "Работало / сбой / задержка / выключено / нет данных / не проверено",
    planFact: "Ожидалось → фактически выполнено → принято; знаменатель и покрытие",
    incidents: "ID, факт, причина подтверждена/гипотеза, ответственный, последний шаг, мера и доказательство",
    changes: "Что выпущено/проверено; новое на рассмотрении отдельно",
    missingAndNext: "Недостающий вход/ресурс, поставщик, следующий проверяемый шаг",
  },
  detailRows: { system: null, mode: null, platform: null, environment: null, build: null,
    expectedActionId: null, resultClient: null, expected: null, actual: null, delta: null,
    acceptance: null, status: null, evidenceUrl: null, observedAt: null, supplier: null,
    cause: null, causeStatus: "unknown", measure: null, responsible: null, due: null, effectCheck: null },
  delivery: { savedVersion: null, providerId: null, sentConfirmed: null, ownerRead: null, acceptedBy: null },
  rules: ["Короткая часть — пять блоков, детали по ссылкам.", "Нет данных = null/причина, не 0.",
    "Незапущенная роль не отчитывается как работающий отдел.", "SENT ≠ прочтение ≠ приёмка.", "Все даты/часовые границы требуют явного выбора."],
};

function completeResources(packet: any, data: OperatingData) {
  packet.version = 2;
  const known = new Set(packet.resourceRequirements.map((r: any) => r.id));
  const required = new Set<string>(packet.actions.flatMap((a: any) => a.resources));
  for (const id of Array.from(required)) {
    if (known.has(id)) continue;
    const n = data.nodes.find(n => n.id === id);
    assert.ok(n, `Unknown resource ${id}`);
    packet.resourceRequirements.push({ id, name: n.name, systemState: n.resourceState,
      supplier: n.inputs.map(i => i.sourceId).filter(Boolean).join(",") || "head-engineering",
      issuedToRole: false, readiness: "Ресурс описан в общей модели; выдача исполнителю P.OPS не подтверждена",
      verification: "Разрешённое контрольное чтение/запись с доказательством", limits: null, cost: null });
  }
  packet.commonProcedure.workload = { operationsPerPeriod: null, minutesPerOperation: null, hours: null,
    formula: "операции × минуты / 60", basis: "Нагрузка не измерена" };
  packet.relatedForms = [{ documentId: "DOC-PLAB-CALL-LETTER",
    read: "MCP get_document({documentId}); прежняя форма LAB.MAIL.SEND, не замена ежедневному отчёту" }];
}

export function prepareOncallRole(root: ProjectModelState, now: string): ProjectModelState {
  const state = readHypothesis(root, "new-country");
  const existing = state.documents.find(d => d.id === opsPacketId);
  if (existing) {
    const packet = JSON.parse(existing.text);
    if (packet.version >= 2) return root;
    completeResources(packet, state.operatingModel!.revisions.at(-1)!.data);
    packet.metadata.sourceRevision = state.revision + 2;
    packet.metadata.snapshotAt = now;
    assert.ok(JSON.stringify(packet).length <= 50000);
    const roadmap = state.documents.find(d => d.id === roadmapId)!;
    let next = applyHypothesisCommand(root, "new-country", { type: "saveDocument", id: roadmap.id,
      title: roadmap.title, text: roadmap.text + `\n${now}: рабочий JSON P.OPS v2 — дополнены все прежние ресурсы выпуска/почты и неизвестная нагрузка; прежняя v1 в истории. Ручной проход не выполнен.`,
      url: roadmap.url, elementIds: roadmap.elementIds }, "Replit: полнота ресурсообеспечения P.OPS");
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: existing.id,
      title: "P.OPS — дежурный всей системы — рабочий JSON v2 — на ручном проходе",
      text: JSON.stringify(packet), url: existing.url, elementIds: existing.elementIds }, "Replit: все ресурсы действий включены; не выданы исполнителю");
    return next;
  }
  const original = state.operatingModel!.revisions.at(-1)!;
  const data: OperatingData = structuredClone(original.data);
  const node = (id: string) => { const n = data.nodes.find(n => n.id === id); assert.ok(n, id); return n; };
  const ops = data.nodes.filter(n => n.kind === "role" && n.code === "P.OPS");
  assert.equal(ops.length, 1, "Reuse one existing P.OPS");
  const role = ops[0], head = node("head-engineering"), parent = role.parentId;
  const documents = ["DOC-TALKHINT-TECHNICAL-PASSPORT", "DOC-TALKHINT-PRODUCT-PASSPORT"]
    .filter(id => state.documents.some(d => d.id === id));
  const dailySources = data.nodes.filter(n => n.kind === "action" && /^T\d\d\.REPORT\.DAY$/.test(n.code));
  assert.equal(dailySources.length, 10, "Existing ten-direction daily chain required");
  const link = (from: string, to: string, kind: "requires" | "produces" | "handoff" | "return" | "accountable_to", reason: string) => {
    const id = `oncall:${kind}:${from}:${to}`;
    if (!data.links.some(l => l.id === id)) data.links.push({ id, from, to, kind, reason });
  };
  for (const [key, name] of Object.entries(resourceNames)) {
    const n = emptyWorkNode(`oncall-resource-${key}`, `OPS.RES.${key.toUpperCase()}`, name, "resource", parent);
    Object.assign(n, { resourceState: "required", recipientId: role.id, clientId: role.id,
      acceptorId: head.id, description: "Не выдано P.OPS как исполнителю; доступ Replit Agent не означает доступ должности.",
      inputs: [{ name: "Выдать разрешённый read-only ресурс и подтвердить контрольным чтением",
        sourceId: key === "model" ? "head-team" : head.id, freshness: "Версия, владелец, окружение, права, факт успешного чтения" }],
      success: "Выданный доступ и результат контрольного чтения/записи, не одно название API",
      referenceIds: documents });
    assert.ok(!data.nodes.some(x => x.id === n.id)); data.nodes.push(n);
  }
  for (const spec of specs) {
    // Existing operational monitoring action is expanded, not cloned.
    const id = spec.key === "observe" ? "management-action-operations" : aid(spec.key);
    const n = spec.key === "observe" ? node(id) : emptyWorkNode(id, `OPS.${spec.key.toUpperCase()}`, spec.name, "action", parent);
    const oldInputs = n.inputs, oldProcedure = n.procedure;
    const oldParties = { clientId: n.clientId, recipientId: n.recipientId, acceptorId: n.acceptorId };
    Object.assign(n, { detailState: "described", purpose: spec.result, roleId: role.id, clientId: head.id,
      recipientId: head.id, acceptorId: head.id, executorId: null,
      procedure: (oldProcedure ? oldProcedure + "\nДополнение дежурства: " : "") + spec.work,
      inputs: [...oldInputs, { name: spec.input, sourceId: head.id, freshness: common.acceptance }],
      resourceIds: Array.from(new Set([...n.resourceIds, ...spec.resources.map(k => `oncall-resource-${k}`)])),
      schedule: { days: [], hours: "", timezone: "", deadline: "", trigger: spec.trigger },
      constraints: [n.constraints, common.guard].filter(Boolean).join("\n"), rules: common.acceptance,
      success: spec.result + ". " + common.acceptance, exceptions: common.returns,
      delivery: "Реальная передача/ответ фиксируются отдельно; пока описание и ручной проход.",
      storage: "Существующая модель и приватные доказательства; без сырого содержимого звонков и секретов.",
      register: { availability: "Планируется событийное дежурство; конкретный исполнитель не назначен",
        period: spec.trigger, operationsPerPeriod: null, minutesPerOperation: null, estimateBasis: "Нагрузка не измерена",
        approval: "discussion", source: common.source, proposalReason: "Согласовано описание должности, не её полная приёмка/автозапуск" },
      referenceIds: Array.from(new Set([...n.referenceIds, opsPacketId, opsFormId, ...documents])),
      reporting: { required: true, formName: "Журнал дежурства / короткий ежедневный отчёт",
        templateDocumentId: opsFormId, templateVersion: "1", formStatus: "discussion", approvalEvidence: "",
        storage: "Общая модель — безопасная версия; реальные журналы/адреса — приватно" },
    });
    if (spec.key === "observe") Object.assign(n, oldParties); // existing product handoff remains intact
    if (["alert", "send"].includes(spec.key)) Object.assign(n, { clientId: "owner", recipientId: "owner" });
    if (spec.key !== "observe") data.nodes.push(n);
    const result = emptyWorkNode(out(id), n.code + ".OUT", spec.result, spec.key === "daily" ? "report" : "result", id);
    Object.assign(result, { roleId: role.id, clientId: n.clientId, recipientId: n.recipientId, acceptorId: n.acceptorId,
      purpose: spec.result, description: "Ожидаемый результат; реальная работа/приёмка не выполнены",
      referenceIds: [opsPacketId, opsFormId] });
    data.nodes.push(result); link(id, result.id, "produces", "Проверяемый выход, не факт выполнения");
  }
  const stepIds = specs.map(s => s.key === "observe" ? "management-action-operations" : aid(s.key));
  for (let i = 0; i < stepIds.length; i++) {
    const n = node(stepIds[i]);
    // Preserve old ENG.REG.8 next step; add explicit linkage without replacing history.
    if (n.id !== "management-action-operations") n.nextId = stepIds[(i + 1) % stepIds.length];
    link(out(n.id), stepIds[(i + 1) % stepIds.length], "handoff", "Следующая проверка по применимости; не автоматический цикл");
  }
  const receive = emptyWorkNode(aid("receive-daily"), "OPS.DAILY.RECEIVE", "Принять ежедневный отчёт дежурного либо вернуть замечания", "action", head.parentId);
  Object.assign(receive, { roleId: head.id, clientId: role.id, recipientId: role.id, acceptorId: "owner",
    nextId: aid("feedback"), inputs: [{ name: "Короткий отчёт, версия и доказательства", sourceId: out(aid("daily")), freshness: common.acceptance }],
    procedure: "HEAD.07 содержательно проверяет покрытие, факты и открытые разрывы; принимает или возвращает конкретные замечания. Проверка последующая: не блокировать короткое информационное письмо владельцу.",
    purpose: "Независимая техническая приёмка / возврат", success: common.acceptance, exceptions: common.returns,
    schedule: { days: [], hours: "", timezone: "", deadline: "", trigger: "Поступил ежедневный отчёт дежурного" },
    resourceIds: ["oncall-resource-model", "oncall-resource-documents"], referenceIds: [opsPacketId, opsFormId],
    reporting: node(aid("daily")).reporting });
  data.nodes.push(receive);
  const response = emptyWorkNode(out(receive.id), "OPS.DAILY.DECISION", "Решение по отчёту дежурного", "result", receive.id);
  Object.assign(response, { recipientId: role.id, clientId: role.id, description: "Ожидается реальное решение; не принято автоматически" });
  data.nodes.push(response);
  link(receive.id, response.id, "produces", "Реальная приёмка или возврат");
  link(out(aid("daily")), receive.id, "handoff", "Парное принимающее действие");
  link(response.id, aid("feedback"), "handoff", "Замечания возвращаются автору");
  const connect = (from: string, to: string, reason: string) => {
    node(to).inputs.push({ name: reason, sourceId: from, freshness: common.acceptance });
    link(from, to, "handoff", reason);
  };
  connect(out(aid("route")), "engineering-chief-incident", "Принять от дежурного инцидент, проверить достаточность/вернуть конкретный вопрос; реального ответа пока нет");
  connect(out(aid("recovery")), "management-action-qa", "Принять запрос подтверждения восстановления; вернуть результат проверки или причину недоступности");
  connect(out(aid("daily")), "management-action-report-engineering-day", "Получить операционный вклад P.OPS для существующего T07, без двойного счёта");
  for (const n of dailySources) {
    n.inputs.push({ name: "При изменении процесса передать дежурному актуальные документы/ожидаемые события; ответить на адресный запрос",
      sourceId: out(aid("inputs")), freshness: "По применимости, не ждать все отделы для одного отчёта" });
    n.procedure += "\nДежурному P.OPS передать разрешённые версии инструкций, ожидаемые события, план-факт и пробелы доступа; дополнить в ответ на конкретный запрос. Это описание передачи, не факт полученного ответа.";
    link(n.id, aid("scope"), "handoff", "Существующий руководитель поставляет свою часть документации и фактов");
    link(out(aid("inputs")), n.id, "return", "Адресный запрос поставщику, не выдуманный ответ");
  }
  Object.assign(role, { detailState: "described", clientId: head.id, recipientId: "owner", acceptorId: head.id,
    purpose: "Дежурный системы: проверять исполнение ожидаемых событий и передач, сразу сообщать о сбоях и ежедневно давать короткую картину работы всей системы.",
    procedure: "Обязанности — фильтр всех существующих действий P.OPS, включая выпуск и транспорт LAB.MAIL.SEND; новые действия дежурства их дополняют.",
    description: "Расширение существующей P.OPS, не новая должность и не назначенный AI. Общесистемное дежурство описано; реализация имеет отдельные границы.",
    constraints: common.guard, success: "Ручной проход владельца по JSON с доказательствами входов/выходов и дальнейшая явная приёмка.",
    questions: "Не утверждены час отчёта/границы суток, состав всех источников, доступы исполнителя, внешний контроль и принимающие ответы.",
    referenceIds: Array.from(new Set([...role.referenceIds, opsPacketId, opsFormId])),
    resourceIds: Array.from(new Set([...role.resourceIds, ...Object.keys(resourceNames).map(k => `oncall-resource-${k}`)])),
  });
  link(role.id, head.id, "accountable_to", "Технический контроль; верхняя граница — владелец без бесконечной цепочки");
  // References must exist before model validation. All commands are committed atomically.
  let next = applyHypothesisCommand(root, "new-country", { type: "createDocument", id: opsPacketId,
    title: "P.OPS — подготовка рабочего пакета", text: '{"status":"preparing_inside_transaction"}',
    url: "", elementIds: [] }, common.source);
  next = applyHypothesisCommand(next, "new-country", { type: "createDocument", id: opsFormId,
    title: "P.OPS — короткий ежедневный отчёт дежурного — форма v1 — на ручном проходе", text: JSON.stringify(form), url: "", elementIds: [] }, common.source);
  next = applyHypothesisCommand(next, "new-country", { type: "saveOperatingModel", baseVersion: original.version, data },
    common.source + " Статус: для ручного прохода, не утверждение всех полей.");
  const roadmap = state.documents.find(d => d.id === roadmapId); assert.ok(roadmap);
  next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: roadmap.id, title: roadmap.title,
    text: roadmap.text + `\n\n${marker}\n${now}: P.OPS дополнена дежурством всей системы, прежние выпуск/LAB.MAIL.SEND сохранены. Сейчас — описание действий, документов и передачи дневного плана-факта; JSON ${opsPacketId} v2 для ручного прохода владельца. Проверяемый выход этапа: каждый вход имеет поставщика, действие — ресурс/результат/получателя/контроль, неизвестное обозначено, владелец записал фактический протокол и решение. Далее — исправить выявленные разрывы и только после отдельной приёмки подключать общесистемное исполнение. Реализованный код watchdog ограничен Hint владельца, не доказывает контроль всей компании. Ежедневная рассылка не запущена; час/границы суток/источники и доступы открыты. Старая общая сводка координатора и T01–T10 сохранены.`,
    url: roadmap.url, elementIds: roadmap.elementIds }, common.source);
  const actions = data.nodes.filter(n => n.kind === "action" && n.roleId === role.id);
  const packet = {
    format: "talkhint.ops.work-package", version: 1,
    metadata: { sourceRevision: readHypothesis(next, "new-country").revision + 1, operatingVersion: original.version + 1,
      snapshotAt: now, roleId: role.id, roleCode: role.code, status: "На ручном проходе владельцем", ownerAcceptance: null },
    authorization: { descriptionRequestedByOwner: true, allDetailsApproved: false, executorAssigned: false,
      automaticExecutionEnabledByThisPackage: false, dailyScheduleEnabled: false },
    role: { id: role.id, code: role.code, name: role.name, purpose: role.purpose, manager: head.id,
      internalClients: ["owner", head.id, "product-work-coordinator", "product-manager-specialist"],
      externalClient: "Пользователь TalkHint получает пользу через надёжную услугу; прямой доступ ко всем клиентским данным не выдан",
      permissions: common.guard, resourcesIssued: false },
    commonProcedure: { acceptance: common.acceptance, returns: common.returns, responseTime: common.response,
      work: "Выполнить вручную по одному действию, сохранить результат/доказательство, запросить вход при нехватке и не имитировать поставщика/приёмку." },
    actions: actions.map(n => ({ id: n.id, code: n.code, name: n.name, purpose: n.purpose, inputs: n.inputs,
      procedure: n.procedure, trigger: n.schedule.trigger, timezone: n.schedule.timezone || null,
      deadline: n.schedule.deadline || null, resources: n.resourceIds, results: data.links.filter(l => l.from === n.id && l.kind === "produces").map(l => l.to),
      client: n.clientId, recipient: n.recipientId, acceptor: n.acceptorId, controller: head.id,
      executor: n.executorId, acceptance: n.success, returns: n.exceptions, nextAction: n.nextId,
      reportForm: n.reporting?.templateDocumentId ?? null, approval: n.register?.approval ?? "discussion" })),
    resourceRequirements: Object.entries(resourceNames).map(([key, name]) => ({ id: `oncall-resource-${key}`, name,
      supplier: key === "model" ? "head-team" : head.id, issuedToRole: false,
      readiness: key === "external" ? "Не подключён" : "Есть отдельные средства проекта; полный доступ и покрытие P.OPS не проверены",
      verification: key === "mail" ? "Одна согласованная тестовая отправка с provider ID/SENT; не повторять при потере ответа" :
        "Контрольное разрешённое чтение нужного окружения и фактический результат, не настройка",
      access: "Read-only и минимально необходимый состав; секреты не в JSON", limits: null, cost: null })),
    documentationInputs: dailySources.map(n => ({ supplier: n.roleId, supplierActionId: n.id,
      destinationActionId: aid("documents"), required: "Актуальные документы своей области, ожидаемые события/получатели, критерии, реальный план-факт и ограничения",
      received: false, response: null })),
    receivingActions: [receive, node("engineering-chief-incident"), node("management-action-qa"),
      node("management-action-report-engineering-day")].map(n => ({ id: n.id, code: n.code, role: n.roleId,
        inputSources: n.inputs.map(i => i.sourceId), procedure: n.procedure, acceptance: n.success, returns: n.exceptions })),
    currentImplementation: { recordedAt: now, evidenceKind: "Код Dev и тесты, не наблюдение общесистемного production",
      hintOnly: "server/callLab/watchdog.ts: owner Hint после активации; 15-секундный опрос; отдельный lock; durable dedup; mail uncertainty без resend",
      otherModesAndCompany: "Не подключены к этому watchdog",
      dailyReport: "В этом пакете описана форма и действия; генератор/расписание ежедневной сводки не запускались",
      qa: "Watchdog не принимает QA; HEAD.07 контролирует техническое содержание, Сергей принимает описание после прохода",
      limitations: "Внутренний дежурный не гарантирует письмо при падении сервера/БД/Gmail; неизвестное не зелёное",
      evidencePaths: ["docs/hint-lab-watchdog.md", "server/callLab/watchdog.test.ts", "server/callLab/callLab.pg.test.ts"] },
    metrics: [
      { name: "Покрытие контроля", formula: "Проверенные за период ожидаемые события / все события утверждённой карты", numerator: null, denominator: null, target: null },
      { name: "План-факт завершения", formula: "Подтверждённые завершения и приёмки / ожидаемые за тот же период", numerator: null, denominator: null, target: null },
      { name: "Сигналы владельцу", formula: "Инциденты с подтверждением SENT / обнаруженные инциденты, требующие уведомления", numerator: null, denominator: null, target: null },
      { name: "Открытые разрывы", formula: "Количество незакрытых инцидентов и недостающих входов отдельно; возраст/поставщик обязательны", fact: null, target: null },
    ],
    dailyReportForm: form, periodicReporting: "Вклад P.OPS → существующие T07 day/week/month → координатор → общий отчёт. Не второй общий каталог.",
    openDecisions: ["Час отчёта, часовой пояс и границы суток", "Полная карта процессов и источников по T01–T10",
      "Права и фактическая выдача ресурсов P.OPS", "Доказанный независимый канал при падении сервера/почты",
      "Сроки ответов и приёмки, уровни инцидентов; нормативы KPI не утверждены", "Ручной проход и решение владельца",
      "Прежний ENG.REG.7 содержит самоприёмку P.OPS: требуется отдельная сверка готовности выпуска с HEAD.07/владельцем, эта старая обязанность не объявлена готовой"],
    trialProtocol: actions.map(n => ({ actionId: n.id, status: "не выполнено", evidence: null, result: null,
      missingInputOrResource: null, requestSupplier: null, recipientResponse: null, acceptance: null })),
    manualPass: { performedBy: null, performedAt: null, verdict: null, findings: [],
      rule: "Сергей проходит JSON, отмечает выполнено/blocked/неприменимо с доказательством; данные других ролей и их приёмку не сочинять." },
  };
  completeResources(packet, data);
  const text = JSON.stringify(packet);
  assert.ok(text.length <= 50000, `Packet too large: ${text.length}`);
  next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: opsPacketId,
    title: "P.OPS — дежурный всей системы — рабочий JSON v2 — на ручном проходе", text, url: "", elementIds: [] }, common.source);
  assert.equal(JSON.parse(readHypothesis(next, "new-country").documents.find(d => d.id === opsPacketId)!.text).metadata.sourceRevision,
    readHypothesis(next, "new-country").revision);
  assert.equal(data.nodes.filter(n => n.kind === "role").length, original.data.nodes.filter(n => n.kind === "role").length);
  assert.deepEqual(readHypothesis(next, "new-country").elements, state.elements);
  return next;
}
