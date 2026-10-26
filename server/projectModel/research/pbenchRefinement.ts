import { randomUUID, createHash } from "node:crypto";
import type { ElementInput, ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import type { OperatingData, WorkNode } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { defaultRegister } from "../../../shared/actionRegister";
import { emptyReporting } from "../../../shared/actionReporting";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { analystActions, dutyMapping, pbenchDeadline, pbenchDocs, pbenchGuard, pbenchMarker,
  pbenchReturn, pbenchRole, pbenchStorage, toolSpecs } from "./pbenchRefinementSpec";
import { dailyTemplate, toolsDocument, trialReport, weeklyTemplate } from "./pbenchRefinementContent";

export const pbenchRoadmap = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
export const pbenchRequests = [
  { id: "BENCH-REQ-PRODUCT-BASE", role: "head-product", process: "company-action-product-reference",
    title: "P-BENCH: база TalkHint и критерии сравнения", client: pbenchRole,
    question: "HEAD.06: передать статус/версию базы TalkHint, платформы/сборки, аудиторию, рабочее отдельно от планируемого, ограничения, цены либо их неизвестность. P.PRODUCT: приложить параметры сравнения. Утверждение базы не поручается аналитику.",
    output: "Версионный пакет базы и критериев либо точный перечень неподтверждённого", controller: "head-product" },
  { id: "BENCH-REQ-RESEARCH-PLAN", role: "head-market", process: "company-action-list-review",
    title: "P-BENCH: статус списка, план и приёмка исследования", client: pbenchRole,
    question: "Подтвердить фактический статус списка VocaLingo/Lingvanex/TaraAI/AI Phone/Guardianly, задачи/глубину/периодичность/приоритеты, критерии качества и маршрут приёмки. Quo — отдельная связанная находка. Формы и сроки пока не утверждены.",
    output: "Решение по списку и входной план либо возврат конкретных вопросов", controller: "owner" },
  { id: "PB-GAP-TECH", role: "lg-technical-role", process: "benchmark-ready-storage",
    title: "P-BENCH: технические доказательства и оснащение", client: pbenchRole,
    question: "Дополнение к существующему PB-GAP-TECH: подтвердить фактические возможности TalkHint и подготовить оценку ресурсов P-BENCH по DOC-PBENCH-TOOL-READINESS, ENG.BENCH.1–6. Нужны поиск, чтение/магазины/PDF, браузер, модель, внутреннее чтение/запись, расчёты, лимиты/стоимость и проверка результата. Не подключать/запускать платные инструменты или worker.",
    output: "Доказательства продукта и оценка готовности каждого ресурса: проверено / настроено без проверки / нет", controller: "head-engineering" },
  { id: "BENCH-REQ-FINANCE", role: "head-finance", process: "management-action-economics",
    title: "P-BENCH: финансовая база и методика сопоставления", client: pbenchRole,
    question: "Дать утверждённые цены/лимиты TalkHint либо статус их отсутствия, методику сравнения стоимости сценария/валют/периодов, допустимость внешних оценок масштаба и способ учёта затрат аналитика. Ничего не оплачивать; без утверждения не задавать бюджет.",
    output: "Версионная финансовая основа и правила сопоставимости либо список неизвестного", controller: "owner" },
  { id: "INFO-LG-VOCALINGO", role: "product-manager-specialist", process: "company-action-product",
    title: "VocaLingo: рассмотреть расхождение версий", client: "head-product",
    question: "Рассмотреть достаточность наблюдения changelog 1.73/24.10 против прочитанного US App Store 1.71/11.10. Уточнить платформу/доступность и при необходимости оформить тест Сергею в существующей карточке. Ни баг, ни доступность на iPhone не доказаны.",
    output: "Решение исследовать/проверить/отложить либо адресный вопрос с версией", controller: "head-product" },
  { id: "INFO-LG-LINGVANEX", role: "product-manager-specialist", process: "company-action-product",
    title: "Lingvanex: рассмотреть управление разговором", client: "head-product",
    question: "Рассмотреть официальный can step in. Не установлены присутствие AI после вмешательства и возврат разговора ему. Использовать существующий MKT.2.19/паспорт Lingvanex для теста Сергея, не создавать вторую карточку/тестировщика.",
    output: "Решение о следующей проверке или конкретный возврат, не имитация успешного теста", controller: "head-product" },
  { id: "INFO-LG-NEED", role: "product-manager-specialist", process: "company-action-product",
    title: "История контакта и получение итога: продуктовое рассмотрение", client: "head-product",
    question: "На связанном случае ремонта рассмотреть непрерывность задачи/контакта, номера и сообщений/фото, передачи контекста и получения итога. Использовать заявления Guardianly/Lingvanex как основания сравнения, не как проверенные MMS или готовую реализацию TalkHint. Не подменять установление фактов нового исследования причинностью.",
    output: "Оценка достаточности/пользы и следующая проверка, изменение, отсрочка или отказ с основанием", controller: "head-product" },
] as const;

/** Explicit one-off Dev content update. No startup hook, external I/O or execution. */
export function refinePbench(root: ProjectModelState, actor: string): ProjectModelState {
  const model = readHypothesis(root, "new-country");
  if (model.documents.some(d => d.id === pbenchDocs.contracts && d.text.includes(pbenchMarker))) return root;
  if (Object.values(pbenchDocs).some(id => model.documents.some(d => d.id === id)))
    throw Error("Partial prior P-BENCH documents require reconciliation, not replacement");
  const rev = model.operatingModel?.revisions.at(-1), prep = model.analystPreparation?.revisions.at(-1);
  const roadmap = model.documents.find(d => d.id === pbenchRoadmap);
  const ownership = model.documents.find(d => d.id === "DOC-BENCHMARK-OWNERSHIP-HANDOFF");
  if (!rev || !prep || !roadmap || !ownership) throw Error("Existing operating model, passport, ownership and canonical roadmap required");
  const data = structuredClone(rev.data);
  const node = (id: string): WorkNode => {
    const found = data.nodes.find(n => n.id === id);
    if (!found) throw Error(`Missing existing identity ${id}`);
    return found;
  };
  const existing = data.nodes.filter(n => n.kind === "action" && n.roleId === pbenchRole);
  if (existing.length !== 18 || existing.some(n => !analystActions.some(s => s.id === n.id && s.code === n.code)))
    throw Error("P-BENCH action set changed; reconcile actual identities before importing");
  const related = new Set(existing.map(n => n.id));
  const touched = new Set(related);
  const beforeGaps = actionChainGaps(data, related);
  const addText = (old: string, text: string) => [old, `\n${pbenchMarker}\n${text}`].filter(Boolean).join("\n");
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => {
    node(from); node(to);
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `pbench:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  const input = (target: WorkNode, sourceId: string, name: string) => {
    node(sourceId);
    if (!target.inputs.some(i => i.sourceId === sourceId))
      target.inputs.push({ name, sourceId, freshness: "Конкретные версия/дата/поставщик/статус на входе; неизвестное и условную ветвь отметить явно." });
  };
  const outputs = (id: string) => data.links.filter(l => l.from === id && l.kind === "produces").map(l => node(l.to));
  const resources = toolSpecs.map(t => t.id);
  for (const t of toolSpecs) {
    let n = data.nodes.find(n => n.id === t.id);
    if (!n) {
      n = emptyWorkNode(t.id, `RES.PBENCH.${t.id.replace("benchmark-resource-", "").toUpperCase()}`, t.name, "resource", "competitor-monitor");
      n.roleId = t.owner; n.resourceState = "required"; n.status = "proposal";
      data.nodes.push(n);
    }
    // Shared resources keep their state and owner: specification is not a grant.
    n.description = addText(n.description, `${t.purpose}\n${t.api}\nВыдача для P-BENCH: ${t.owner}. ${t.access}`);
    n.questions = addText(n.questions, `${t.limits}\n${t.costs}\n${t.check}\nРаботоспособность именно worker не подтверждена.`);
    n.referenceIds = Array.from(new Set([...n.referenceIds, pbenchDocs.tools]));
  }
  for (const spec of analystActions) {
    const n = node(spec.id);
    n.purpose = addText(n.purpose, spec.purpose);
    n.procedure = addText(n.procedure, `Необходимые данные: ${spec.data}\nДействия: ${spec.work}`);
    n.rules = addText(n.rules, "Сохранять источник, версию, платформу/регион и статус доказательства. Предварительное сопоставление не заменяет принадлежащее продукту MKT.2.3. Утверждение базы не является действием аналитика.");
    n.constraints = addText(n.constraints, pbenchGuard);
    n.schedule = { ...n.schedule, trigger: spec.period, deadline: pbenchDeadline };
    n.resourceIds = Array.from(new Set([...n.resourceIds, ...resources, ...(spec.resources ?? [])]));
    n.storage = pbenchStorage;
    n.delivery = addText(n.delivery, "Записать документ/версию и связанную работу в существующей очереди; получение/приёмку указывать только по реальному подтверждению. Ответа нет — ожидание.");
    n.success = addText(n.success, `Результат: ${spec.output}. Указаны источники, дата, платформа, фактический предел доказательства и следующий вопрос. При нехватке доказательств допустим честный результат с пробелом и способом проверки; это не утверждение факта или продукта.`);
    n.exceptions = addText(n.exceptions, pbenchReturn);
    n.questions = addText(n.questions, "Ответы, назначения экземпляров AI, сроки и ресурсы не подтверждены. Где требуется утверждение — остаётся на согласовании. Количество операций/время не измерено.");
    n.reporting = { ...emptyReporting(), ...n.reporting, storage: pbenchStorage };
    if (spec.form || !n.reporting.templateDocumentId) {
      n.reporting.templateDocumentId = spec.form === "weekly" ? pbenchDocs.weekly : pbenchDocs.daily;
      n.reporting.formName = spec.form === "weekly" ? "Недельный план-факт / материалы месяца" : "Ежедневный журнал — запись проверки, результата и передачи";
      n.reporting.templateVersion = "1"; n.reporting.formStatus = "draft";
      n.reporting.approvalEvidence = "Подготовлен Replit по поручению; разработка/согласование ChatGPT + Сергей, утверждение Сергея не получено.";
    }
    n.register = { ...defaultRegister(), ...n.register, approval: "discussion", period: spec.period,
      source: addText(n.register?.source ?? "", "Поручение сохранить результаты пробного прохода и уточнить существующую P-BENCH."),
      proposalReason: "16 укрупнённых обязанностей сопоставлены с 18 существующими действиями; сроки, оснащение и формы не утверждены." };
    n.referenceIds = Array.from(new Set([...n.referenceIds, ...Object.values(pbenchDocs)]));
    if (!n.clientId) n.clientId = "product-manager-specialist";
    if (!n.acceptorId) n.acceptorId = n.clientId;
    if (!n.nextId) throw Error(`Explicit receiving action required: ${n.code}`);
    const receiver = node(n.nextId);
    const out = outputs(n.id);
    if (!out.length) throw Error(`Existing result required: ${n.code}`);
    link(n.id, "head-market", "accountable_to", "HEAD.01 контролирует доказательства/достаточность; не утверждение продукта или назначение исполнителя.");
    for (const r of out) {
      r.description = addText(r.description, `Состав будущего результата: ${spec.output}. Заполненные факты — только по связанному документу/работе; шаблон и связь не означают исполнение.`);
      r.recipientId ??= receiver.roleId ?? n.clientId;
      r.acceptorId ??= n.acceptorId;
      r.referenceIds = Array.from(new Set([...r.referenceIds, pbenchDocs.contracts]));
      link(r.id, n.acceptorId, "acceptance", "Требуется явная приёмка/возврат; аналитик проверяет вход только для своей задачи, не утверждает базу продукта.");
      link(n.acceptorId, n.id, "return", "Адресный возврат автору с вопросом и версией, не автоматический вердикт.");
      link(r.id, receiver.id, "handoff", "Сохранённая следующая передача, не подтверждение фактической доставки.");
      input(receiver, r.id, `Условный вход от ${n.code}: ${spec.output}`);
      touched.add(receiver.id);
    }
  }
  // Source/criteria and monthly contributions are paired with existing actions.
  input(node("company-action-context-check"), "company-action-product-reference-result", "База от PRD.1.9/HEAD.06 с реальным статусом");
  input(node("company-action-verify"), "company-action-criteria-result", "Параметры сравнения от PRD.1.11/P.PRODUCT");
  link("company-action-criteria-result", "company-action-verify", "handoff", "Критерии продуктового менеджера — вход аналитика, не его самостоятельное утверждение.");
  for (const r of outputs("company-action-weekly-send")) {
    input(node("company-action-monthly-prepare"), r.id, "Материалы аналитика за месяц: ссылки на недели/журнал и открытые решения");
    link(r.id, "company-action-monthly-prepare", "handoff", "Месячную сводку готовит HEAD.01 по MKT.2.15.");
  }
  touched.add("company-action-monthly-prepare");
  node("company-action-context-check").clientId = "product-manager-specialist";
  node("company-action-context-check").acceptorId = pbenchRole;
  node("company-action-context-check").rules += "\nПриёмка входа P-BENCH = оценка достаточности для проверки, не утверждение базы/функций. PRD.1.9/HEAD.06 не переназначены.";
  node("company-action-product-reference").procedure = addText(node("company-action-product-reference").procedure,
    "Ответить на BENCH-REQ-PRODUCT-BASE: передать статус базы/версию, явно отделить неподтверждённое. Сохранение книги и оценка входа аналитиком сами по себе не утверждают продукт.");
  touched.add("company-action-product-reference");
  for (const id of ["company-action-product", "company-action-product-sufficiency", "company-action-product-notify", "company-action-weekly-receive"]) {
    const n = node(id); touched.add(id);
    n.procedure = addText(n.procedure, "Для переданных материалов P-BENCH зафиксировать получение, достаточность/точный возврат и решение лишь после реального рассмотрения; паспорта обновляет продукт. Три текущих вопроса связаны с существующими INFO-LG-VOCALINGO/INFO-LG-LINGVANEX/INFO-LG-NEED.");
    n.schedule.deadline = pbenchDeadline;
  }
  for (const spec of pbenchRequests) {
    const receiving = node(spec.process);
    node(spec.role); node(spec.controller);
    receiving.referenceIds = Array.from(new Set([...receiving.referenceIds, pbenchDocs.requests]));
    receiving.procedure = addText(receiving.procedure, `${spec.id}: ${spec.question}\nПолучить запрос, проверить достаточность, ответить/вернуть конкретный вопрос. Срок ответа не согласован; отсутствие подключённого исполнителя не скрывать.`);
    receiving.schedule.deadline = pbenchDeadline;
    touched.add(receiving.id);
  }
  // Reconcile all existing neighbouring typed handoffs touched above, preserving edge IDs.
  for (const l of data.links.filter(l => l.kind === "handoff" && touched.has(l.to))) {
    const receiving = node(l.to);
    if (receiving.kind === "action") input(receiving, l.from, `Условный вход по существующей передаче: ${node(l.from).code}`);
  }
  const role = node(pbenchRole);
  Object.assign(role, {
    purpose: "Дать P.PRODUCT проверенные сообщения/источники для решения о полезных пользователю TalkHint сценариях; не копировать функции без потребности.",
    clientId: "product-manager-specialist", recipientId: "product-manager-specialist", acceptorId: "head-market",
    resourceIds: Array.from(new Set([...role.resourceIds, ...resources])),
    procedure: addText(role.procedure, dutyMapping.map((d, i) => `${i + 1}. ${d[0]} → ${d[1]}. ${d[2]}`).join("\n")),
    success: "Прослеживаемые источники/версии, факты отдельно от гипотез, конкретный клиент и вопрос, реальные приёмка/возврат либо честное ожидание. Выполнение описания, оснащение и работа исполнителя различаются.",
    storage: pbenchStorage, exceptions: pbenchReturn, constraints: addText(role.constraints, pbenchGuard),
    referenceIds: Array.from(new Set([...role.referenceIds, ...Object.values(pbenchDocs)])),
  });
  input(role, "company-action-product-reference-result", "Версионная база от HEAD.06 с реальным статусом принятия");
  input(role, "company-action-criteria-result", "Параметры сравнения от P.PRODUCT");
  role.schedule = { ...role.schedule, trigger: "Задание, изменение источника, ответ/возврат; ежедневный журнал, недельный отчёт и материалы месяца. Точные часы/периодичность не согласованы.", deadline: pbenchDeadline };
  node("resource-profile-benchmark-role-reference").description = addText(node("resource-profile-benchmark-role-reference").description,
    `Конкретное оснащение: ${pbenchDocs.tools}. Выдача/лимиты/стоимость/проверки по каждой позиции. Статус ресурсов worker не подтверждён.`);
  const roadmapNode = node("crew-product-roadmap");
  roadmapNode.nextId = "company-action-context-check";
  roadmapNode.questions = addText(roadmapNode.questions, "Текущий фокус P-BENCH: получить базу/критерии/план/финансовую методику и оценку ресурсов, согласовать формы/сроки. Описание роли не равно подключению исполнителя.");
  const remaining = actionChainGaps(data, related);
  if (remaining.length) throw Error(`P-BENCH contract gaps: ${JSON.stringify(remaining)}`);

  const at = new Date().toISOString();
  const commands: ModelCommand[] = [];
  for (const q of pbenchRequests) {
    const old = model.elements.find(e => e.id === q.id);
    const coord = {
      kind: old?.coordination?.kind ?? (q.id.startsWith("INFO-") ? "information" as const : "work" as const),
      state: "blocked" as const, roleId: q.role, processId: q.process,
      relatedIds: Array.from(new Set([...(old?.coordination?.relatedIds ?? []), pbenchRole, q.process, q.client])),
      nextStep: "Подтвердить получение назначенным исполнителем; ответить или вернуть вопрос. Исполнитель не подключён; ответа/приёмки нет, срок согласовать.",
      origin: "owner_chatgpt" as const,
      operations: [...(old?.coordination?.operations ?? []), { id: randomUUID(), fingerprint: createHash("sha256").update(pbenchMarker + q.id).digest("hex"), at }],
    };
    const element: ElementInput = {
      title: old?.title ?? q.title, section: old?.section ?? "Процессы и Crew", scope: "talkhint",
      kind: old?.kind ?? "action", description: addText(old?.description ?? "", `${q.question}\nСтатус: запрос зарегистрирован Replit вручную в существующей очереди, подтверждения получения/ответа/приёмки нет. Это не запуск роли.`),
      contentStatus: old?.contentStatus ?? "proposal", implementationStatus: old?.implementationStatus ?? "planned",
      coordination: coord,
      details: { ...old?.details, client: q.client, accountable: q.role,
        inputs: addText(old?.details.inputs ?? "", `${pbenchDocs.trial}; ${pbenchDocs.tools}; источник — поручение владельца сохранить пробный проход.`),
        output: addText(old?.details.output ?? "", q.output), recipient: q.client,
        acceptance: addText(old?.details.acceptance ?? "", `Именованный клиент получает версию с доказательствами/неизвестным; контролёр ${q.controller}. Явно принимает достаточность либо возвращает вопрос. Срок не согласован.`),
        rules: addText(old?.details.rules ?? "", pbenchGuard),
        evidence: addText(old?.details.evidence ?? "", "Факт: запрос сохранён в модели. Получение адресатом, ответ, приёмка и возврат не подтверждены."),
        nextStep: coord.nextStep, source: addText(old?.details.source ?? "", pbenchDocs.trial),
        provenance: addText(old?.details.provenance ?? "", "Внесено вручную Replit по текущему поручению владельца; не ответ другой роли и не автономная crew."),
      },
    };
    commands.push(old ? { type: "saveElement", id: old.id, element } : { type: "createElement", id: q.id, element });
  }
  const putDoc = (id: string, title: string, text: string) => {
    commands.push({ type: "createDocument", id, title, text,
      url: "/admin/project-model?hypothesis=new-country&section=Процессы%20и%20Crew&workView=actions", elementIds: ["TH-PRODUCT"] });
  };
  putDoc(pbenchDocs.daily, "P-BENCH — ежедневный журнал — бланк v1 — черновик", dailyTemplate);
  putDoc(pbenchDocs.weekly, "P-BENCH — недельный план-факт и материалы месяца — бланк v1 — черновик", weeklyTemplate);
  putDoc(pbenchDocs.tools, "P-BENCH — оснащение и проверка готовности — v1 — на согласовании", toolsDocument());
  putDoc(pbenchDocs.trial, "P-BENCH — один ручной проход пяти конкурентов — 26.10.2026 — v1 — на рассмотрении", trialReport);
  putDoc(pbenchDocs.requests, "P-BENCH — внутренние запросы и предметы рассмотрения — v1 — ожидают ответа",
    `# ${pbenchMarker}\nЗапросы — реальные записи существующей очереди, не выданные доступы, не подтверждённая доставка и не ответы AI.\n` +
    pbenchRequests.map(q => `\n## ${q.id} — ${q.title}\nАдресат ${q.role}; принимающее действие ${node(q.process).code}/${q.process}; клиент ${q.client}; контролёр ${q.controller}.\n${q.question}\nОжидаемый результат: ${q.output}.\nСостояние: blocked — исполнитель не подключён/ответ не получен. Подтверждений получения, ответа, приёмки/возврата нет. ${pbenchDeadline}`).join("\n") +
    `\nПравило ответа: реальный ответ связать с исходным ID и версией, не создавать второй запрос. ${pbenchReturn}`);
  putDoc(pbenchDocs.contracts, "P-BENCH — соответствие 16/18 и контракты действий — v1 — на согласовании",
    `# ${pbenchMarker}\nВсе 18 ID/кодов сохранены. 16 обязанностей укрупнённые, а не команда удалить две строки. Паспорт — прежний analystPreparation и роль P-BENCH, этот документ — индекс соответствия и сохранённых действий, не второй каталог.\n` +
    dutyMapping.map((d, i) => `${i + 1}. ${d[0]} → ${d[1]}. ${d[2]}`).join("\n") +
    `\n## Пробелы/возможные дубли\nТри RM-проверки ограничены исходным случаем, не повторяют весь регулярный мониторинг. MKT.LEG.1/2 и ACQ.CA.05 — отдельные потребители, сохранены. Возврат — цикл той же работы. Новые универсальные действия/роли не добавлены. Формальное MKT.2.3 остаётся P.PRODUCT. Три отсутствовавшие связи контролёра RM дополнены.\n` +
    analystActions.map(s => {
      const n = node(s.id);
      return `\n## ${n.code} — ${n.name} — ${n.id}\nНазначение: ${s.purpose}\nИсполнитель-должность ${pbenchRole}, экземпляр AI: ${n.executorId ?? "нет"}; данные: ${s.data}.\nТриггер: ${s.period}\nВходы/поставщики: ${n.inputs.map(i => {
        const src = node(i.sourceId!); return `${src.code}/${src.id} (${src.roleId ?? "по связанной карточке источника"})`;
      }).join("; ")}\nРабота: ${s.work}\nРезультат: ${s.output}; результаты ${outputs(n.id).map(r => r.id).join(", ")}.\nКлиент ${n.clientId}; получатель результата: ${outputs(n.id).map(r => r.recipientId).join(", ")}; принимающий ${n.acceptorId}; контроль HEAD.01; далее ${n.nextId}.\nПриёмка: источники/версия/предел доказательства/следующий вопрос, явная достаточность либо адресный возврат. Полные существующие и дополненные критерии — в карточке действия той же модели.\nСрок ответа не согласован; молчание не приёмка. Ресурсы: ${n.resourceIds.join(", ")}; readiness ${pbenchDocs.tools}.\nБланк: ${n.reporting!.templateDocumentId}, v${n.reporting!.templateVersion}, ${n.reporting!.formStatus}.`;
    }).join("\n") +
    `\n## Общие условия всех 18 действий\n${pbenchDeadline}\n${pbenchReturn}\nХранение: ${pbenchStorage}\n## Проверка описания\nДо уточнения: ${beforeGaps.length} формальных замечаний P-BENCH. После: ${remaining.length} по actionChainGaps для 18 действий. Это структурная проверка полей/связей, не оценка смысловой готовности, оснащения, принятия или реального исполнения. ${pbenchGuard}`);
  if (model.elements.some(e => e.id === "BENCH-PASS-2026-10-26")) throw Error("Existing manual pass requires reconciliation");
  commands.push({ type: "createElement", id: "BENCH-PASS-2026-10-26", element: {
    title: "P-BENCH: один ручной проход пяти конкурентов — ожидает рассмотрения",
    kind: "research", scope: "talkhint", section: "Процессы и Crew",
    contentStatus: "proposal", implementationStatus: "in_progress",
    description: "Один фактически выполненный Replit ручной проход 26.10.2026, а не работа автономного P-BENCH. Прочитаны пять карточек и 16 публичных страниц; документ перенесён из предыдущего ответа по поручению владельца. Полные снимки страниц/затраты не архивировались. Приёмки/возврата от продукта нет.",
    details: { client: "product-manager-specialist", accountable: pbenchRole,
      source: pbenchDocs.trial, evidence: "Факт ручного прохода и границы доказательства изложены в документе. Получение/приёмка клиентом не подтверждены.",
      provenance: "Выполнено вручную Replit, сохранено по текущему поручению владельца через MCP. Не автономное выполнение AI-роли.",
      acceptance: "P.PRODUCT рассматривает достаточность для следующего решения; HEAD.01 проверяет доказательства. Решение или адресный возврат фиксируется явно.",
      nextStep: "Получить реальное рассмотрение документа, не считать сохранение приёмкой." },
    coordination: { kind: "work", state: "awaiting_review", roleId: pbenchRole, processId: "company-action-verify",
      relatedIds: [pbenchRole, "company-action-handoff", "company-action-product"],
      nextStep: "P.PRODUCT/HEAD.01: подтвердить получение и рассмотреть фактический пакет либо вернуть вопрос. Срок не согласован.",
      resultDocumentId: pbenchDocs.trial, origin: "owner_chatgpt",
      operations: [{ id: randomUUID(), fingerprint: createHash("sha256").update(pbenchMarker + "manual-pass").digest("hex"), at }] },
  } });
  const preparation = structuredClone(prep.data);
  preparation.passport = {
    ...preparation.passport,
    purpose: role.purpose,
    duties: dutyMapping.map((d, i) => `${i + 1}. ${d[0]} → ${d[1]}. ${d[2]}`).join("\n"),
    inputs: "HEAD.06: база TalkHint и её реальный статус; P.PRODUCT: критерии; HEAD.01: перечень/план; HEAD.08: методика/цены/неизвестное; техника: доказательства и инструменты. Запросы DOC-PBENCH-REQUESTS. Собственная проверка MKT.2.8 не утверждает базу.",
    outputs: `Проверенные сообщения, адресные запросы, журнал (${pbenchDocs.daily}), неделя/материалы месяца (${pbenchDocs.weekly}); продукт ведёт паспорта. Один фактический ручной проход ${pbenchDocs.trial} не равен регулярному исполнению.`,
    frequency: "Журнал в дни работы; еженедельный план-факт; месячные материалы HEAD.01. Краткий обзор рабочих дней/внеочередные сигналы предложены, частота/часовой пояс/часы и сроки ответа не согласованы; scheduler выключен.",
    quality: `${pbenchReturn}\nИсточники/даты/платформы, прежнее/новое, заявления/тесты/гипотезы разделены. Нет рядов роста — неизвестно. KPI и знаменатели в ${pbenchDocs.weekly}; нормативы не утверждены.`,
    handoff: `P.PRODUCT — клиент, HEAD.01 — контроль доказательств, HEAD.06 — содержание продукта. Парные принимающие действия сохранены. ${pbenchStorage}\n${pbenchDeadline}\nПроверки мобильных приложений Сергей, права расходов/выпуска не делегированы.`,
  };
  preparation.approvalNotes = addText(preparation.approvalNotes,
    `18 действий уточнены без замены 16 строками. Комплект инструментов и запросы сохранены; рабочий доступ AI не подтверждён. Прежние limits сохранены без утверждения. Формы — черновики, ответы/приёмки отсутствуют. ${pbenchGuard}`);
  commands.push({ type: "saveAnalystPreparation", baseVersion: prep.version, preparation });
  commands.push({ type: "saveDocument", id: ownership.id,
    title: ownership.title.replace("v1", "v2"),
    url: ownership.url, elementIds: ownership.elementIds,
    text: ownership.text + `\n\n## ${pbenchMarker}\nУточнение ${pbenchDocs.contracts}; оснащение ${pbenchDocs.tools}; очередь ${pbenchDocs.requests}. P-BENCH проверяет достаточность входа, HEAD.06 сохраняет PRD.1.9; формальное MKT.2.3 и паспорта — P.PRODUCT. Обязательность существующего MKT.2.12 этой задачей не отменялась и не расширялась. Ответы/приёмка не выдуманы; сроки не утверждены.` });
  commands.push({ type: "saveDocument", id: roadmap.id,
    title: roadmap.title.replace(/v\d+/, v => `v${Number(v.slice(1)) + 1}`),
    url: roadmap.url, elementIds: roadmap.elementIds,
    text: roadmap.text + `\n\n## ${pbenchMarker}\nОписание: существующие 18 действий сверены с 16 обязанностями, паспорт обновлён; формы журнала/недели с KPI — черновики. Реальная ручная работа: один проход ${pbenchDocs.trial}; не автономное исполнение. Обеспечено: запись/чтение Replit проверяются; доступы worker/сроки/бюджет/формы не утверждены. Ожидают ${pbenchRequests.length} связанных записей: ${pbenchRequests.map(q => q.id).join(", ")}. Сохранены прежние ID/история/книга/паспорта конкурентов. Следующий шаг — получить недостающие входы и согласовать достаточность/формы/сроки P-BENCH. Полнота описания не означает готовность должности или запуск AI; подключение исполнителей — отдельный будущий этап.` });
  commands.push({ type: "saveOperatingModel", baseVersion: rev.version, data });
  let next = root;
  for (const command of commands) next = applyHypothesisCommand(next, "new-country", command, actor);
  return next;
}

/** Preserve the already-saved pass; close only the directly adjacent LG.6 contract. */
export function finishPbenchHandoff(root: ProjectModelState, actor: string): ProjectModelState {
  const model = readHypothesis(root, "new-country");
  const revision = model.operatingModel?.revisions.at(-1);
  const contract = model.documents.find(d => d.id === pbenchDocs.contracts);
  const roadmap = model.documents.find(d => d.id === pbenchRoadmap);
  if (!revision || !contract || !roadmap) throw Error("Existing refinement required");
  const receiving = revision.data.nodes.find(n => n.id === "lg-action-6");
  // Minimal fixtures may not contain this older case; never create another process.
  if (!receiving || revision.data.links.some(l => l.from === receiving.id && l.kind === "accountable_to")) return root;
  const role = revision.data.nodes.find(n => n.id === receiving.roleId);
  const manager = revision.data.nodes.find(n => n.id === role?.managerId);
  if (!manager) throw Error("Existing LG.6 manager required; do not invent accountability");
  const data = structuredClone(revision.data);
  data.links.push({ id: "pbench:accountable_to:lg-action-6", from: receiving.id, to: manager.id,
    kind: "accountable_to", reason: "Предложенный контроль по существующему единственному руководителю HEAD.06. Роль AI CEO спроектирована, не запущена; это не новые полномочия или приёмка результата." });
  const ids = new Set([
    ...analystActions.map(s => s.id),
    ...data.nodes.filter(n => analystActions.some(s => s.id === n.id)).map(n => n.nextId!).filter(Boolean),
    ...pbenchRequests.map(q => q.process),
    "company-action-product-sufficiency", "company-action-product-notify", "company-action-monthly-prepare",
  ]);
  const gaps = actionChainGaps(data, ids);
  if (gaps.length) throw Error(`Adjacent contracts require reconciliation: ${JSON.stringify(gaps)}`);
  const note = `\n\n## Проверка соседних передач\nПроверены ${ids.size} действия: 18 P-BENCH и 14 соседних/принимающих. Закрыт ранее существовавший разрыв LG.6: контролирующая связь с ${manager.code}/${manager.id} по сохранённому руководителю HEAD.06. Связь предложенная, исполнитель AI CEO не подключён. Формальных разрывов actionChainGaps в этом ограниченном наборе: 0. Это не проверка готовности всей компании, не назначение, не утверждение полномочий или результата.`;
  let next = root;
  const commands: ModelCommand[] = [
    { type: "saveDocument", id: contract.id, title: contract.title.replace("v1", "v2"),
      text: contract.text + note, url: contract.url, elementIds: contract.elementIds },
    { type: "saveDocument", id: roadmap.id, title: roadmap.title.replace(/v\d+/, v => `v${Number(v.slice(1)) + 1}`),
      text: roadmap.text + note, url: roadmap.url, elementIds: roadmap.elementIds },
    { type: "saveOperatingModel", baseVersion: revision.version, data },
  ];
  for (const command of commands) next = applyHypothesisCommand(next, "new-country", command, actor);
  return next;
}
