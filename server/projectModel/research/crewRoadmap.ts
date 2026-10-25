import { isDeepStrictEqual } from "node:util";
import type { ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import type { WorkNode, WorkKind, WorkLink } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { landingGearCaseId, landingGearDocumentTitle } from "./landingGearCaseContent";
import { crewIntakeFindings, crewRoadmapDocument, crewRoadmapId, crewRoadmapTitle } from "./crewRoadmapContent";

/** Owner-authorized, additive preparation in the existing store, not a crew runner. */
export function prepareCrewRoadmap(root: ProjectModelState, actor: string): ProjectModelState {
  const hypothesis = "new-country", before = readHypothesis(root, hypothesis);
  const revision = before.operatingModel?.revisions.at(-1);
  if (!revision) throw new Error("Existing organisation required");
  const caseNodeBefore = revision.data.nodes.find(n => n.id === landingGearCaseId);
  const caseDoc = before.documents.find(d => d.title === landingGearDocumentTitle);
  if (!caseNodeBefore || !caseDoc) throw new Error("Existing landing gear case/document required; never create a duplicate");
  const existing = before.documents.find(d => d.title === crewRoadmapTitle);
  if (revision.data.nodes.some(n => n.id === crewRoadmapId)) {
    if (!existing || !crewIntakeFindings.every(f => before.elements.some(e => e.id === f.id)) ||
      !revision.data.nodes.find(n => n.id === crewRoadmapId)?.referenceIds.includes(existing.id))
      throw new Error("Incomplete existing roadmap; manual reconciliation required");
    return root; // Preserve later owner edits; no replay and no duplicate import.
  }
  if (existing) throw new Error("Existing roadmap document without its workflow; preserve and reconcile manually");
  const inventory = { modelVersion: revision.version, nodes: revision.data.nodes.length, links: revision.data.links.length,
    documents: before.documents.length, findings: before.elements.length, crews: revision.data.nodes.filter(n => n.kind === "crew").length };
  const documentText = crewRoadmapDocument(inventory);
  let next = root;
  const command = (c: ModelCommand) => { next = applyHypothesisCommand(next, hypothesis, c, actor); };
  for (const finding of crewIntakeFindings) {
    if (before.elements.some(e => e.id === finding.id)) throw new Error("Finding already exists; preserve and reconcile manually");
    command({ type: "createElement", id: finding.id, element: finding.input });
    for (const target of ["TH-PROBLEM", "TH-PRODUCT", "TH-CLIENT"]) {
      if (!before.elements.some(e => e.id === target)) throw new Error(`Required model material missing: ${target}`);
      command({ type: "saveRelation", from: finding.id, to: target,
        label: "Связь входящей информации с потребностью/продуктом; не подтверждение гипотезы" });
    }
  }
  command({ type: "saveDocument", title: crewRoadmapTitle,
    text: documentText, url: `/admin/project-model?hypothesis=new-country&view=overview&work=${crewRoadmapId}#operating-model`,
    elementIds: crewIntakeFindings.map(f => f.id) });
  const document = readHypothesis(next, hypothesis).documents.find(d => d.title === crewRoadmapTitle)!;
  const data = structuredClone(revision.data);
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw new Error(`Required existing role/process missing: ${id}`);
    return n;
  };
  const byCode = (code: string) => {
    const n = data.nodes.find(n => n.code === code);
    if (!n) throw new Error(`Required existing process missing: ${code}`);
    return n;
  };
  const support = byCode("SUP.1"), product = byCode("PRD.1"), design = byCode("PRD.2"), benchmark = byCode("MKT.2");
  const supportHead = get(support.roleId!), productHead = get(product.roleId!);
  const dev = get("development"), techHead = get(dev.roleId!);
  const tech = get("lg-technical-role"), qa = get("lg-qa-role"), analyst = get("qualification-role");
  const add = (id: string, code: string, name: string, kind: WorkKind, parent: string | null, extra: Partial<WorkNode> = {}) => {
    if (data.nodes.some(n => n.id === id || n.code === code)) throw new Error(`Identity collision ${code}`);
    const n: WorkNode = { ...emptyWorkNode(id, code, name, kind, parent), detailState: "described",
      referenceIds: [document.id, caseDoc.id], constraints: "Подготовка Dev; внешние действия/платные подключения/crew не запускаются.",
      ...extra };
    data.nodes.push(n); return n;
  };
  const link = (from: string, to: string, kind: WorkLink["kind"], reason: string) => {
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `rm:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  const channels = add("crew-channel-specialist", "P.CHANNELS", "Специалист по Twilio и каналам", "role", dev.parentId, {
    managerId: techHead.id, purpose: "Подтверждать номер/канал, ограничения SMS/MMS/DTMF/transfer и согласий, не менять их без разрешения.",
    description: "Предложенная специализированная роль; полный паспорт — раздел 5 roadmap. Исполнитель и доступ к аккаунту для этой роли не подключены.",
    rules: "Наличие API-возможности не означает подключённый инструмент; звонки/SMS/покупки и изменение аккаунта требуют отдельного разрешения.",
  });
  const developer = add("crew-product-developer", "P.DEV", "Разработчик согласованных изменений продукта", "role", dev.parentId, {
    managerId: techHead.id, purpose: "Реализовать утверждённую версию требования с проверками и совместимостью.",
    description: "Предложенная специализированная роль. Roadmap не является заданием внедрять P1–P8; AI-исполнитель не подключён.",
    rules: "Не подменяет продуктовый приоритет и не расширяет доступы/полномочия.",
  });
  for (const role of [supportHead, productHead, analyst, tech, channels, developer, qa])
    if (!role.referenceIds.includes(document.id)) role.referenceIds.push(document.id);
  const resource = add("crew-intake-materials", "RES.INTAKE", "Общая модель, разрешённые источники и история входящей информации", "resource", null, {
    resourceState: "required",
    description: "Хранилище и публичное чтение доступны Replit. Worker adapter, scope для роли и лимит не подключены. Доступ Replit не равен доступу crew.",
    referenceIds: [document.id, caseDoc.id, ...crewIntakeFindings.map(f => f.id)],
  });
  const roadmap = add(crewRoadmapId, "ROADMAP.CREW", "Единый roadmap: входящая информация → проверенный результат → запуск crew", "process", "mission", {
    roleId: productHead.id, clientId: "owner", recipientId: "owner", acceptorId: "owner",
    description: "Для обсуждения. Готовы: модель, кейс, документы, ручные находки. Отсутствует: рабочий CrewAI-worker с безопасными инструментами и execution profile. Первым: INFO-LG-QUO через MKT.2 до продуктового решения. Реальный crew-пилот не запущен.",
    purpose: "Один последовательный план работы над продуктом, не набор несвязанных поручений.",
    procedure: "0 инвентаризация → 1 приём → 2 роли → 3 оснащение; критерии 5 до запуска 4; затем фактическая приёмка 5 → расширение 6.",
    rules: "Не смешивать описание, ручную работу Replit, offline_fixture и реальный запуск crew. Один случай — один владелец, несколько связанных работ.",
    referenceIds: [document.id, caseDoc.id, landingGearCaseId, "analyst-preparation", ...crewIntakeFindings.map(f => f.id)],
    nextId: "crew-roadmap-phase-1", resourceIds: [resource.id],
    success: "Принятый рабочий цикл с прослеживаемыми входами, реальным исполнителем, readback, приёмкой и обратной связью.",
    questions: "Нужно согласовать runtime-профиль/модель/лимит одного MKT.2 worker; причины инцидента и iPhone ещё не проверены.",
    delivery: "Открытие полного сохранённого документа и скачивание Markdown из оснований.",
  });
  const phases = [
    ["Инвентаризация", productHead.id, "Выполнена вручную Replit; код/Dev-модель/публичные страницы, не runtime crew", "Принять границы одного случая и список блокеров", "Снимок существующих процессов, данных, инструментов и отсутствующего", "Документ содержит доказательства и пробелы, готовность не преувеличена"],
    ["Единый приём и ответственность", supportHead.id, "Шесть находок сохранены; ручной цикл подготовлен; автоматической общей очереди нет", "Взять INFO-LG-QUO для ограниченного MKT.2 цикла и явного решения", "Запись с источником/датой/типом/клиентом, связями и ответственным", "Нет дубля случая; нет перехода сообщения в факт; версионный readback"],
    ["Роли, действия и клиенты результатов", productHead.id, "Паспорта семи ролей подготовлены, полномочия исполнения не утверждены", "Согласовать минимальных участников пилота без запуска всех ролей", "Действия, получатели, приёмка, подотчётность", "Один непосредственный руководитель; каждый результат имеет клиента"],
    ["Знания, инструменты, доступы и инструкции", tech.id, "Описаны; рабочего worker и его безопасных адаптеров нет", "Выбрать execution profile/модель/лимит и реализовать одного worker к общей модели", "Версионированный runtime-профиль и проверенные узкие инструменты", "Утверждены источники/лимит/scopes; checkpoint/readback/отказ без дубля"],
    ["Минимальный рабочий запуск crew", analyst.id, "Не запущен; блокер — исполнитель, оснащение и разрешённый профиль", "После этапа 3 и критериев 5 выполнить одну находку того же случая", "Реальный run, источники, checkpoint и структурированное предложение", "Журнал именно worker; повторное чтение; не mock и не ручная работа"],
    ["Приёмка, документ и обратная связь", productHead.id, "Механизм документов есть; ручной результат готов; приёмка Сергеем ожидается", "Обсудить критерии до запуска; после запуска принять/вернуть реальный результат", "Один версионированный документ и явное решение/ответ", "Источник→проблема→исследование→техника→предложение; скачивание и scoped-доступ"],
    ["Регулярная работа и остальные источники", productHead.id, "Не начато; расписание/автосбор не включены", "Только после принятого рабочего цикла выбрать один следующий источник", "Расширение источников/специализаций и контроль свежести", "Разрешены лимиты/периодичность, есть остановка/журнал; нет автоматической стратегии"],
  ];
  phases.forEach(([name, role, state, nextStep, output, acceptance], index) => {
    const phase = add(`crew-roadmap-phase-${index}`, `RM.${index}`, name, "action", roadmap.id, {
      roleId: role, executorId: null, clientId: index === 1 ? productHead.id : "owner",
      recipientId: "owner", acceptorId: "owner", nextId: index === 6 ? null : `crew-roadmap-phase-${index + 1}`,
      description: `Статус: ${state}. Следующий конкретный шаг: ${nextStep}. Срок не утверждён.`,
      purpose: output, procedure: nextStep, success: acceptance, resourceIds: [resource.id],
      inputs: [{ name: index === 0 ? "Текущая модель и код" : "Результаты зависимых этапов и разрешённый контекст",
        sourceId: index === 0 ? landingGearCaseId : `crew-roadmap-output-${index - 1}`, freshness: "Сверить текущую версию перед каждым этапом" }],
      schedule: { days: [], hours: "", timezone: "", trigger: "По приёмке зависимостей, без фонового запуска", deadline: "Не согласован" },
      storage: "Одна owner/hypothesis модель; revisions и decisions.",
      exceptions: "Возврат на предыдущую работу с причиной; конфликт полномочий — Сергею.",
    });
    const result = add(`crew-roadmap-output-${index}`, `RM.${index}.R`, output, "result", phase.id, {
      clientId: "owner", recipientId: "owner", acceptorId: "owner", nextId: phase.nextId,
      description: `Текущий статус: ${state}`, storage: "Сохранённый roadmap и результаты связанного случая", success: acceptance,
    });
    link(phase.id, result.id, "produces", "Результат этапа для клиента, не статус работающего сотрудника");
    link(result.id, "owner", "acceptance", "Принять / вернуть конкретные замечания / отложить");
    link(result.id, phase.id, "return", "Недостающий результат или доказательство");
    if (index) link(phase.id, `crew-roadmap-output-${index - 1}`, "depends_on", "Не обходить предыдущую готовность");
  });
  // Acceptance design precedes execution; acceptance itself follows the real run.
  add("crew-pilot-acceptance-contract", "RM.PILOT.CRITERIA", "Критерии и формат первого пилота — до его запуска", "result", "crew-roadmap-phase-5", {
    roleId: productHead.id, clientId: analyst.id, acceptorId: "owner",
    description: "Подготовлены в разделе 7 roadmap, ожидают согласования. Это вход запуска, не фактическая приёмка результата.",
    success: "Утверждены источники, лимит, запреты, формат результата, readback/checkpoint, роль принимающего и возврат.",
  });
  link("crew-roadmap-phase-4", "crew-pilot-acceptance-contract", "requires", "Согласованные критерии до запуска; фактическая приёмка следует после");
  for (const [suffix, findingId, question] of [
    ["VOC", "INFO-LG-VOCALINGO", "Подсказки/перевод, история и текущий звонок против нового; не выдумывать автономный режим"],
    ["LING", "INFO-LG-LINGVANEX", "Уточнить same call / transfer / new call и возможность возврата AI; неизвестное сохранить"],
    ["QUO", "INFO-LG-QUO", "Разделить SMS/MMS/фото, caller/третий номер, своё/чужое IVR, transfer/new call"],
  ]) {
    const work = add(`crew-research-${suffix.toLowerCase()}`, `RM.W.${suffix}`, `Проверка находки ${suffix}: границы сценария`, "action", benchmark.id, {
      roleId: analyst.id, executorId: null, clientId: productHead.id, recipientId: productHead.id, acceptorId: productHead.id,
      nextId: "lg-action-6", resourceIds: [resource.id],
      referenceIds: [findingId, document.id, caseDoc.id, landingGearCaseId, "analyst-preparation"],
      description: "Исследовательская работа назначена в модели. Первичные тексты прочитаны вручную Replit; приложение и автономный crew не запускались.",
      purpose: question, procedure: "Найти/прочитать первичный источник; сохранить цитаты, дату, ограничения, неизвестное; передать продукту, предложить следующий вопрос без ожидания подсказки владельца.",
      success: "Заявления не выданы за живой тест; различия сценариев и недоступное явно указаны.",
      inputs: [{ name: "Предварительная находка, клиентская потребность и контекст landing gear", sourceId: landingGearCaseId, freshness: "25.10.2026; при новом источнике новая версия" }],
      schedule: { days: [], hours: "", timezone: "", trigger: "Новая связанная находка или разрешённый обзор источника, без scheduler", deadline: "" },
      exceptions: "Платный/закрытый/живой тест — отдельное разрешение; не объявлять завершение без результата.",
    });
    const result = add(`crew-research-output-${suffix.toLowerCase()}`, `RM.W.${suffix}.R`, `Документальный результат ${suffix} с ограничениями`, "result", work.id, {
      clientId: productHead.id, recipientId: productHead.id, acceptorId: productHead.id,
      description: "Ручной документальный результат в roadmap; продуктовая приёмка ожидается. Реального worker-run нет.",
      referenceIds: [document.id, findingId], storage: "Канонические элементы/документы общей модели, не второй реестр",
    });
    link(landingGearCaseId, work.id, "requires", "Связанная работа существующего случая, не дубликат");
    link(work.id, result.id, "produces", question);
    link(result.id, design.id, "handoff", "MKT.2 проактивно передаёт основание продукту; не меняет стратегию");
    link(result.id, productHead.id, "acceptance", "Источники, ограничения, продуктовый смысл; вернуть с вопросами при недостатке");
    link(result.id, work.id, "return", "Неполный источник/сценарий/ограничение");
    link(work.id, "lg-action-4", "depends_on", "Продолжение уже начатого бенчмаркинга случая, не параллельное исследование");
  }
  const caseNode = get(landingGearCaseId);
  caseNode.referenceIds.push(document.id, roadmap.id, ...crewIntakeFindings.map(f => f.id));
  link(roadmap.id, landingGearCaseId, "requires", "Один реальный случай как первый сквозной цикл");
  link("crew-roadmap-phase-1", support.id, "handoff", "Единый владелец случая; конкуренты направляются MKT.2");
  link("crew-roadmap-phase-1", benchmark.id, "handoff", "Конкурентная находка сразу получает исследовательскую ответственность");
  link("crew-roadmap-phase-1", byCode("MKT.1").id, "handoff", "Неизвестная потребность — отдельная проверка, без вывода о рынке");
  link("crew-roadmap-phase-1", product.id, "handoff", "Продуктовая оценка после проверки либо с явно обозначенной нехваткой доказательств");
  link(channels.id, techHead.id, "accountable_to", "Один непосредственный руководитель; не руководитель каждого получателя");
  link(developer.id, techHead.id, "accountable_to", "Существующее направление разработки");
  command({ type: "saveOperatingModel", baseVersion: revision.version, data });
  const after = readHypothesis(next, hypothesis);
  if (!isDeepStrictEqual(before.operatingModel!.revisions, after.operatingModel!.revisions.slice(0, -1)) ||
    !isDeepStrictEqual(before.documents, after.documents.slice(0, before.documents.length)) ||
    !isDeepStrictEqual(root.alternatives?.filter(a => a.id !== hypothesis), next.alternatives?.filter(a => a.id !== hypothesis)) ||
    !isDeepStrictEqual(root.elements, next.elements)) throw new Error("Preservation guard failed");
  return next;
}
