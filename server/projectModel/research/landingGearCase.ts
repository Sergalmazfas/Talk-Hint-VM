import { isDeepStrictEqual } from "node:util";
import type { ProjectModelState } from "../../../shared/projectModel";
import type { WorkNode, WorkKind, WorkLink } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { landingGearCaseDocument, landingGearCaseId, landingGearDocumentTitle } from "./landingGearCaseContent";

/** One owner-authorized Dev import; no executor and no parallel case store. */
export function prepareLandingGearCase(root: ProjectModelState, actor: string): ProjectModelState {
  const hypothesis = "new-country";
  const before = readHypothesis(root, hypothesis);
  const previous = before.operatingModel?.revisions.at(-1);
  if (!previous) throw new Error("Existing operating model required");
  const existingCase = previous.data.nodes.find(n => n.id === landingGearCaseId);
  const existingDocument = before.documents.find(d => d.title === landingGearDocumentTitle);
  if (existingCase) {
    if (!existingDocument || !existingCase.referenceIds.includes(existingDocument.id))
      throw new Error("Existing case is incomplete; manual reconciliation required");
    if (existingDocument.text !== landingGearCaseDocument)
      throw new Error("Existing case document differs; preserve owner edits");
    return root;
  }
  const data = structuredClone(previous.data);
  const byCode = (code: string) => {
    const n = data.nodes.find(n => n.code === code);
    if (!n) throw new Error(`Required existing process missing: ${code}`);
    return n;
  };
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw new Error(`Required existing object missing: ${id}`);
    return n;
  };
  const support = byCode("SUP.1"), product = byCode("PRD.1"), design = byCode("PRD.2"), benchmark = byCode("MKT.2");
  const owner = get("owner"), supportHead = get(support.roleId!), productHead = get(product.roleId!);
  const development = data.nodes.find(n => n.kind === "process" && n.id === "development");
  if (!development?.roleId || !development.parentId) throw new Error("Existing development process required");
  const technicalHead = get(development.roleId);
  const analyst = get("qualification-role");

  let next = applyHypothesisCommand(root, hypothesis, {
    type: "saveDocument", ...(existingDocument ? { id: existingDocument.id } : {}),
    title: landingGearDocumentTitle, text: landingGearCaseDocument,
    url: `/admin/project-model?hypothesis=${hypothesis}&view=overview&work=${landingGearCaseId}#operating-model`,
    elementIds: [],
  }, actor);
  const document = readHypothesis(next, hypothesis).documents.find(d => d.title === landingGearDocumentTitle)!;
  const add = (id: string, code: string, name: string, kind: WorkKind, parent: string | null, fields: Partial<WorkNode> = {}) => {
    if (data.nodes.some(n => n.id === id || n.code === code)) throw new Error(`Case identity collision: ${code}`);
    const node: WorkNode = { ...emptyWorkNode(id, code, name, kind, parent), detailState: "described",
      referenceIds: [document.id], constraints: "Только подготовка Dev. Внешние действия и AI-исполнители не запускаются.", ...fields };
    data.nodes.push(node); return node;
  };
  const link = (from: string, to: string, kind: WorkLink["kind"], reason: string) => {
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `lg:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  const technical = add("lg-technical-role", "P.LG.TECH", "Технический специалист по соответствию реальному приложению", "role", development.parentId, {
    managerId: technicalHead.id, description: "Предложенная специализированная роль. Паспорт, доступные знания и пробелы — раздел 4 документа; исполнитель не подключён.",
    purpose: "Проверять соответствие предложения фактическим server/Swift/MCP маршрутам, данным и полномочиям.",
    procedure: "Проверить дату, окружение и версию источника; отделить код, runtime и предложение. Фиксировать недоступное.",
    rules: "Не изменяет production, телефонию, ключи, Engine или Swift. Не выдаёт документацию за живую проверку.",
    questions: "Нет полного журнала ремонта, доступа к Mac и подтверждённой deployed-конфигурации.",
  });
  const qa = add("lg-qa-role", "P.LG.QA", "QA исходного сценария и смены цели", "role", development.parentId, {
    managerId: technicalHead.id, description: "Предложенная специализированная роль. Протокол раздела 7 подготовлен; исполнитель не подключён.",
    purpose: "Сопоставить исходный случай, требования, доказательства и результат; не подменять прослушивание mock-тестами.",
  });
  const resource = add("lg-case-materials", "RES.LG", "Разрешённые материалы случая и первичные источники", "resource", null, {
    resourceState: "required", description: "Есть поручение пользователя, код, документы и публичные страницы. Нет полных журналов ремонта, фото и подтверждённой географии.",
    rules: "Никаких ключей, чужих карточек и фонового сбора. Пробел не считается отсутствием события.",
  });
  const caseNode = add(landingGearCaseId, "CASE.LG.20261025", "Landing gear: от обращения до результата — для обсуждения", "process", support.id, {
    roleId: supportHead.id, clientId: owner.id, recipientId: productHead.id, acceptorId: owner.id,
    description: "Статус: для обсуждения; доказательства неполны. Ответственный за ведение — существующий руководитель поддержки (предложено). Продуктовое решение — менеджер продукта. Реестр E01–E08 и контактов, G1→G2, проблемы, связи и полный документ доступны по основанию ниже.",
    purpose: "Решить потребность водителя, не потеряв цель, адресата и контекст между каналами; сейчас подготовить обсуждение, не внедрять.",
    procedure: "LG.1–LG.9: саппорт → продукт → бенчмаркинг и техническая оценка → варианты → QA → приёмка → обратная связь.",
    rules: "Сообщение о повторном обращении не доказанный дефект. Kansas City/I-70 и Indiana/I-64 не подтверждённая география.",
    success: "Документ принят/возвращён/отложен с причиной. Закрытие инцидента отдельно требует фактов и проверки исходного сценария.",
    questions: "Нужны task/call IDs ремонта, время смены цели и подтверждений, организация/мобильный мастера, разрешённые журналы.",
    storage: "Общая owner-scoped модель new-country, документы и история версий.",
    delivery: "Чтение и скачивание связанного документа v1 «для обсуждения»; внешняя отправка не выполнялась.",
    resourceIds: [resource.id],
  });
  const stages = [
    { num: 1, name: "Принять случай и потребность", parent: support.id, role: supportHead.id, input: caseNode.id,
      work: "Сохранить E01–E08, контакты-кандидаты, G1/G2, источники и пробелы.", output: "Паспорт случая и реестр свидетельств", to: productHead.id,
      acceptance: "Пользовательские сообщения отделены от доказанных событий; нет выдуманных ID и географии.", state: "Выполнено вручную Replit для обсуждения." },
    { num: 2, name: "Сопоставить доказательства и последовательность", parent: support.id, role: supportHead.id, input: "lg-result-1",
      work: "Сопоставить goal revision, подтверждения, task/call IDs, callback и время. Техспециалист помогает только по необходимости.", output: "Проверенная временная шкала либо явные пробелы", to: productHead.id,
      acceptance: "Причины не выводятся без журналов; NextGear не склеен с RightWay.", state: "Подготовлено; журналы ремонта ожидаются." },
    { num: 3, name: "Сформулировать продуктовую проблему", parent: product.id, role: productHead.id, input: "lg-result-1",
      work: "Разделить повторный контакт, потерю цели/канала, IVR, передачу владельцу и итог.", output: "Проблема и границы решения", to: benchmark.id,
      acceptance: "Потребность не подменена заранее выбранной функцией; неизвестное LG.2 сохранено.", state: "Выполнено вручную Replit." },
    { num: 4, name: "Бенчмаркинг по первичным источникам", parent: benchmark.id, role: analyst.id, input: "lg-result-3",
      work: "Применить существующий паспорт аналитика; сравнить S1–S9 без покупок и реальных звонков.", output: "Матрица подходов с источниками и неизвестным", to: productHead.id,
      acceptance: "SMS не равен MMS; свой IVR не равен прохождению чужого; заявление не равно тесту.", state: "Документальное исследование выполнено вручную Replit; AI-аналитик не запускался." },
    { num: 5, name: "Техническая оценка фактической архитектуры", parent: development.id, role: technical.id, input: "lg-result-3",
      work: "Прочитать доступный код/документы по Retell, Engine, MCP, iOS, номерам, контактам, SMS/MMS, данным и правам.", output: "Готовность по коду, ограничения и отсутствующие знания", to: productHead.id,
      acceptance: "Есть пути источников и границы проверки; нет заявления о production/iPhone готовности.", state: "Статическое чтение выполнено вручную Replit." },
    { num: 6, name: "Подготовить продуктовые варианты и MVP", parent: design.id, role: productHead.id, input: "lg-result-4",
      work: "Свести проблему, исследование и техоценку в P1–P8. Разделить MVP/следующий этап и запросить решение.", output: "Варианты, приоритеты и критерии", to: qa.id,
      acceptance: "Каждый вариант связан с E/S-основанием и техническим ограничением. Внедрение не разрешено.", state: "Подготовлено вручную Replit; выбор ожидает Сергея." },
    { num: 7, name: "Подготовить проверку исходного сценария", parent: development.id, role: qa.id, input: "lg-result-6",
      work: "Составить протокол раздела 7; отметить недоступные журналы и будущие живые проверки.", output: "QA-протокол и список блокеров", to: productHead.id,
      acceptance: "Есть G1→G2, номера/география, read-only результат, права и отсутствие дублей; телефонный прогон не имитируется.", state: "Протокол подготовлен; проверка нового поведения не выполнялась." },
    { num: 8, name: "Принять, вернуть или отложить документ", parent: product.id, role: productHead.id, input: "lg-result-7",
      work: "Представить единый документ Сергею. Зафиксировать решение с причиной и границами дальнейшего разрешения.", output: "Решение по документу и следующий шаг", to: supportHead.id,
      acceptance: "Явное решение Сергея; нет автоматического разрешения на реализацию/звонки.", state: "Ожидает обсуждения; решение не принято." },
    { num: 9, name: "Замкнуть обратную связь и закрыть случай", parent: support.id, role: supportHead.id, input: "lg-result-8",
      work: "Сообщить фактический исход и ограничения, согласовать проверку; отличить приёмку документа от закрытия инцидента.", output: "Ответ пользователю и согласованный статус случая", to: owner.id,
      acceptance: "Пользователь понимает, что проверено, что исправлено и что осталось; причина без доказательств не названа.", state: "Подготовлено; внешняя отправка и закрытие не выполнялись." },
  ];
  for (const s of stages) {
    const action = add(`lg-action-${s.num}`, `LG.${s.num}`, s.name, "action", s.parent, {
      roleId: s.role, executorId: null, clientId: s.to, recipientId: s.to,
      acceptorId: s.num === 8 ? owner.id : s.to,
      nextId: s.num === 9 ? caseNode.id : `lg-action-${s.num + 1}`,
      purpose: s.output, description: `Статус работы: ${s.state} Автоматический исполнитель не подключён.`,
      inputs: [{ name: "Разрешённые материалы и результат предыдущего этапа", sourceId: s.input, freshness: "25.10.2026; при новом свидетельстве пересмотреть вывод" }],
      procedure: s.work, success: s.acceptance, resourceIds: [resource.id], rules: "Подтверждение структуры не означает согласование продуктового решения.",
      storage: "Общая модель new-country и её версии; единый документ случая.",
      delivery: "Передача по связанным результатам, без рассылки.", schedule: { days: [], hours: "", timezone: "", trigger: "После приёмки входа; внешнее расписание не включено", deadline: "Не согласован" },
      referenceIds: [document.id, caseNode.id, ...(s.num === 4 ? ["analyst-preparation"] : [])],
      exceptions: "Вернуть конкретные замечания поставщику результата; конфликт полномочий эскалировать Сергею.",
    });
    const result = add(`lg-result-${s.num}`, `LG.${s.num}.R`, s.output, "result", action.id, {
      description: s.state, clientId: s.to, recipientId: s.to, acceptorId: action.acceptorId,
      nextId: action.nextId, storage: "Разделы единого документа и версия модели", delivery: "Переход к получателю и документу из той же модели.",
      inputs: [{ name: "Исходное действие", sourceId: action.id, freshness: "Текущая версия случая" }],
      success: s.acceptance,
    });
    link(caseNode.id, action.id, "requires", "Этап единого случая, не новая иерархия подчинения");
    link(action.id, result.id, "produces", s.output);
    link(result.id, s.to, "handoff", "Клиент результата; не второй руководитель");
    link(result.id, action.acceptorId!, "acceptance", s.acceptance);
    link(result.id, action.id, "return", "При недостаточном качестве вернуть конкретные пункты");
    link(action.id, owner.id, "escalation", "Конфликт полномочий или недоступные доказательства; без автоматической стратегии");
    if (s.num > 1) link(action.id, s.input, "depends_on", "Нужен вход; неполнота должна быть явно сохранена");
  }
  link("lg-action-6", "lg-result-5", "depends_on", "Продуктовое решение требует технической оценки");
  link("lg-action-8", "lg-result-2", "depends_on", "Неизвестные факты должны быть учтены до решения; недостаток не скрывать");
  link("lg-result-4", design.id, "handoff", "MKT.2 даёт основания PRD.2, не принимает продуктовое решение");
  link("lg-result-3", byCode("MKT.1").id, "feedback", "При повторяемости запроса предложить отдельную проверку потребности, не запускать автоматически");
  link("lg-result-3", byCode("B2C.1").id, "feedback", "Личный кейс водителя: вопрос о повторяемости и пользе, не доказанный рынок");
  const report = add("lg-discussion-report", "REP.LG.1", "Единый документ landing gear — v1 — для обсуждения", "report", caseNode.id, {
    roleId: productHead.id, clientId: owner.id, recipientId: owner.id, acceptorId: owner.id,
    description: "Подготовлен вручную Replit, не CrewAI. Полный текст и скачивание — по связанному документу. Приёмка Сергеем ожидается.",
    referenceIds: [document.id, ...stages.map(s => `lg-action-${s.num}`)], storage: "Одна запись documents в new-country, история общей модели.",
    inputs: stages.map(s => ({ name: `LG.${s.num}: ${s.output}`, sourceId: `lg-result-${s.num}`, freshness: "Пересмотреть при изменении исходного результата" })),
    delivery: "Скачать из карточки случая/отчёта. Внешняя отправка и фоновая доставка отключены.",
    schedule: { days: [], hours: "", timezone: "", trigger: "После ручного согласованного прохода; новая редакция только с явным изменением", deadline: "" },
    success: "Все разделы содержательны; факты, заявления и предложения различимы; принято/возвращено/отложено с причиной.",
  });
  link(caseNode.id, report.id, "produces", "Один итоговый документ всех относящихся ролей");
  link(report.id, owner.id, "acceptance", "Обсуждение: принять / вернуть / отложить, без автоматического внедрения");
  link(report.id, "lg-action-6", "return", "Вернуть продукту конкретные замечания");
  link("lg-result-9", support.id, "feedback", "Саппорт закрывает обратную связь и контролирует статус случая");
  next = applyHypothesisCommand(next, hypothesis, { type: "saveOperatingModel", baseVersion: previous.version, data }, actor);
  const after = readHypothesis(next, hypothesis);
  if (!isDeepStrictEqual(previous.data.nodes, after.operatingModel!.revisions.at(-1)!.data.nodes.slice(0, previous.data.nodes.length)) ||
    !isDeepStrictEqual(before.operatingModel!.revisions, after.operatingModel!.revisions.slice(0, -1)))
    throw new Error("Existing organisation/history changed");
  return next;
}
