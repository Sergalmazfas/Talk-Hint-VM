import { createHash, randomUUID } from "node:crypto";
import type { ElementInput, ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import type { OperatingData, WorkNode } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { defaultRegister } from "../../../shared/actionRegister";
import { emptyReporting } from "../../../shared/actionReporting";
import { readProductBook, productBookDocumentId, productBookText } from "../../../shared/productBook";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { chiefActions, engineeringDeadline, engineeringDoc, engineeringFacts, engineeringGuard,
  engineeringMarker, engineeringRequests, engineeringRoadmap, engineeringRole, technicalPassportText } from "./engineeringAuditSpec";

export interface EngineeringAuditEvidence { commit: string; at: string; tests: string }
export function prepareEngineeringAudit(root: ProjectModelState, actor: string, evidence: EngineeringAuditEvidence): ProjectModelState {
  const model = readHypothesis(root, "new-country");
  const priorDoc = model.documents.find(d => d.id === engineeringDoc || /TalkHint.*технический паспорт|технический паспорт.*TalkHint/i.test(d.title));
  if (priorDoc?.text.includes(engineeringMarker)) return root;
  const docId = priorDoc?.id ?? engineeringDoc;
  const productDoc = model.documents.find(d => d.id === productBookDocumentId);
  const book = readProductBook(productDoc);
  const roadmap = model.documents.find(d => d.id === engineeringRoadmap);
  const op = model.operatingModel?.revisions.at(-1);
  if (!op || !productDoc || !book || !roadmap) throw Error("Existing book, roadmap and model required");
  const data: OperatingData = structuredClone(op.data);
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw Error("Existing engineering node required: " + id);
    return n;
  };
  const chief = get(engineeringRole);
  if (chief.managerId !== "ai-ceo" || chief.executorId !== "replit-current-dev-session")
    throw Error("Existing manual role assignment changed; reconcile first");
  const commands: ModelCommand[] = [];
  const addRef = (n: WorkNode) => { n.referenceIds = Array.from(new Set([...n.referenceIds, docId])); };
  const input = (n: WorkNode, id: string, name: string) => {
    get(id);
    if (!n.inputs.some(i => i.sourceId === id))
      n.inputs.push({ sourceId: id, name, freshness: "Дата/версия/платформа/окружение; при противоречии запросить поставщика. Не считать устаревший вход принятым." });
  };
  const link = (from: string, to: string, kind: "produces" | "accountable_to" | "handoff" | "acceptance" | "return", reason: string) => {
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `eng-audit:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  const resources = [
    ["engineering-resource-source", "Рабочая копия кода и документация · текущий Replit-сеанс", "connected",
      `Доступ проверен чтением в Dev ${evidence.at}; commit ${evidence.commit}. Доступ будущего worker/production не следует из этого.`],
    ["engineering-resource-dev-tests", "Node / Vitest / TypeScript · текущий Replit-сеанс", "connected",
      "Vitest фактически выполнен в этом сеансе; TypeScript проверяется при сохранении. Не означает Mac, телефонный стенд или платный API."],
    ["engineering-resource-native-proof", "Mac / Xcode / iPhone / доказательство сборки", "required",
      "xcodebuild в текущем Linux отсутствует. Получатель запроса — mobile/Сергей; нужны сборка, устройство и протокол без новых звонков."],
    ["engineering-resource-release-proof", "Доказательства production/провайдеров/приёмки", "required",
      "Текущие deployment, квоты, устройство и внешние каналы не проверены; требуется отдельное разрешение. Не покупать/не публиковать."],
  ] as const;
  for (const [id, name, state, description] of resources) {
    if (data.nodes.some(n => n.id === id)) throw Error("Partial engineering import; reconcile resource " + id);
    const n = emptyWorkNode(id, id.replace("engineering-resource-", "RES.ENG."), name, "resource", chief.parentId);
    Object.assign(n, { resourceState: state, roleId: engineeringRole, description, purpose: description, constraints: engineeringGuard });
    addRef(n); data.nodes.push(n);
  }
  const resourceIds = resources.map(r => r[0]);
  const originalChief = data.nodes.filter(n => n.kind === "action" && n.roleId === engineeringRole).map(n => n.id);
  for (const spec of chiefActions) {
    const id = "engineering-chief-" + spec.key;
    if (data.nodes.some(n => n.id === id)) throw Error("Partial engineering import; reconcile action " + id);
    const n = emptyWorkNode(id, spec.code, spec.name, "action", "development");
    Object.assign(n, { roleId: engineeringRole, clientId: spec.receiver, recipientId: spec.receiver,
      acceptorId: spec.key === "release-review" ? "owner" : spec.receiver, nextId: spec.next,
      level: "direction", purpose: spec.purpose, procedure: spec.work });
    data.nodes.push(n);
  }
  const touched = new Set<string>();
  function contract(n: WorkNode, source: string, trigger: string) {
    touched.add(n.id); addRef(n);
    n.resourceIds = Array.from(new Set([...n.resourceIds, "model-resource", ...resourceIds]));
    n.storage = "Единая new-country → Документы/Работа; отдельный ID результата, история, автор, источник, дата и доказательство приёмки/возврата.";
    n.delivery = "Версионная ссылка принимающему; подтверждение получения и содержательной приёмки отдельно. Не автоматический запуск или рассылка.";
    n.schedule = { ...n.schedule, trigger, deadline: engineeringDeadline };
    input(n, source, "Вход и поставщик: " + get(source).code);
    input(n, "owner", "Границы и явно переданное поручение владельца");
    n.rules += "\nРазличать роль/исполнителя/работу, код/тест/пользовательскую доступность/приёмку. Источник/версия/дата обязательны. Новые полномочия и сроки — на обсуждении.";
    n.constraints += "\n" + engineeringGuard;
    n.success = "Результат отвечает входному критерию, прослеживается к источнику/версии и клиенту; ограничения не скрыты. Решение принимающего или конкретный возврат записан явно. При отсутствии ответа — ожидает, не завершён.";
    n.exceptions = "Неполный вход → адресный запрос поставщику; недостаточный результат → автору действия с конкретным критерием, версией и следующим сроком. Спор/риск → существующему руководителю, затем владельцу. Молчание не приёмка, бесконечных контролёров нет.";
    n.questions += "\nСрок/нагрузка/стоимость, экземпляры исполнителей и доступы не утверждены. Требуется согласовать критерий до обязательства.";
    n.register = { ...(n.register ?? defaultRegister()), source: engineeringMarker + "; поручение владельца",
      approval: "discussion", period: trigger, availability: "Не согласована; период отчётности не равен дежурству 24/7",
      operationsPerPeriod: n.register?.operationsPerPeriod ?? null, minutesPerOperation: n.register?.minutesPerOperation ?? null,
      estimateBasis: "Не измерено. Указать основание/допущения и получить оценки перед обещанием срока." };
    n.reporting = { ...(n.reporting ?? emptyReporting()), required: true,
      storage: n.storage, formName: n.reporting?.formName || "План-факт и запись передачи технического результата",
      formStatus: n.reporting?.formStatus ?? "required" };
    n.acceptorId ??= n.recipientId ?? n.clientId ?? "head-product";
    n.clientId ??= n.acceptorId; n.recipientId ??= n.clientId;
    const manager = get(n.roleId!).managerId;
    if (!data.links.some(l => l.from === n.id && l.kind === "accountable_to") && manager)
      link(n.id, manager, "accountable_to", "Контроль в существующей иерархии; новые полномочия не утверждены.");
    let outputs = data.links.filter(l => l.from === n.id && l.kind === "produces").map(l => get(l.to));
    if (!outputs.length) {
      const out = data.nodes.find(x => x.id === n.id + "-result")
        ?? emptyWorkNode(n.id + "-result", n.code + ".OUT", "Результат: " + n.name, "result", n.parentId);
      if (!data.nodes.some(x => x.id === out.id)) data.nodes.push(out);
      outputs = [out]; link(n.id, out.id, "produces", "Описание ожидаемого результата, не факт исполнения.");
    }
    for (const out of outputs) {
      out.roleId ??= n.roleId; out.recipientId ??= n.recipientId; out.clientId ??= n.clientId;
      out.acceptorId ??= n.acceptorId; out.success = n.success; out.exceptions = n.exceptions;
      out.nextId ??= n.id; out.storage = n.storage; out.delivery = n.delivery; addRef(out);
      link(out.id, out.acceptorId!, "acceptance", "Содержательная приёмка по критерию, не факт согласования.");
      link(n.nextId ?? out.recipientId!, n.id, "return", "Вернуть автору с причиной/версией/вопросом; молчание не принятие.");
      if (n.nextId && get(n.nextId).kind === "action") {
        const receiving = get(n.nextId);
        input(receiving, out.id, `Принять ${out.code}, проверить достаточность либо вернуть ${n.code}`);
        addRef(receiving);
        receiving.exceptions += `\nПо передаче ${n.code}: вернуть конкретный вопрос/критерий, не считать документ ответом или приёмкой.`;
        input(receiving, n.id, `Передача от ${n.code}: проверить достаточность или вернуть`);
        link(n.id, receiving.id, "handoff", "Передача входа с явной проверкой/возвратом; не новая подчинённость.");
      }
    }
  }
  // Both old and new actions remain the duties of the same HEAD.07.
  for (const id of originalChief) {
    const n = get(id);
    n.purpose = "Клиенту результата нужен достоверный технический план-факт и основания решения. " + n.purpose;
    n.procedure += `\nРевизия HEAD.07: связать цель/критерий с фактом/доказательством/отклонением/мерой. Отделять проверку технических оснований от продуктового решения, разрешения владельца и пользовательской приёмки. Период/потребитель остаются прежними. ${engineeringGuard}`;
    contract(n, "company-action-product-reference-result", n.schedule.trigger || "При передаче результата/периоде отчёта");
  }
  // All new action IDs exist before cross-referenced sources and receivers are linked.
  for (const spec of chiefActions) {
    const n = get("engineering-chief-" + spec.key);
    contract(n, spec.supplier, spec.trigger);
    const out = data.links.find(l => l.from === n.id && l.kind === "produces")!;
    get(out.to).name = spec.output;
  }
  for (const id of ["company-action-technical-facts", "company-action-technical-assessment"]) {
    const n = get(id); contract(n, "company-action-product-reference-result", "Запрос HEAD.07/продукта или изменение реализации");
    n.procedure += "\nПередать датированное доказательство/ограничения из технического паспорта. Эта ручная ревизия не исполняет все будущие технические запросы и не подтверждает доступы worker.";
  }
  Object.assign(chief, { clientId: "head-product", recipientId: "head-product", acceptorId: "head-product",
    purpose: "Обеспечить продукт и владельца актуальным техническим состоянием, согласуемым планом, ресурсными основаниями и проверяемыми поставками; польза — надёжный результат пользователя.",
    detailState: "described", resourceIds: Array.from(new Set([...chief.resourceIds, ...resourceIds])),
    success: "Клиент получил версионное основание решения с неизвестным и явной приёмкой/возвратом. Описание не равно запуску команды.",
    constraints: engineeringGuard, rules: "Продукт задаёт полезный результат, инженер — техническую достоверность/план и риски; владелец сохраняет неделегированные решения.",
    schedule: { ...chief.schedule, trigger: "Изменение продукта/вход/дефект; план-факт день/неделя/месяц/квартал", deadline: engineeringDeadline } });
  addRef(chief); input(chief, "company-action-product-reference-result", "Версия продукта, цель и критерий");
  chief.procedure += "\nОбязанности выводятся из собственных действий:\n" +
    data.nodes.filter(n => n.kind === "action" && n.roleId === engineeringRole).map(n => `${n.code}: ${n.name}`).join("\n");
  for (const id of ["lg-technical-role", "management-role-app-architect", "management-role-backend-specialist",
    "management-role-frontend-specialist", "management-role-mobile-specialist", "lg-qa-role",
    "management-role-operations-specialist", "crew-product-developer", "crew-channel-specialist"]) addRef(get(id));

  for (const id of Array.from(touched)) {
    for (const incoming of data.links.filter(l => l.kind === "handoff" && l.to === id))
      input(get(id), incoming.from, "Связанная передача: " + get(incoming.from).code);
  }
  const gaps = actionChainGaps(data, touched);
  if (gaps.length) throw Error("Engineering contract gaps: " + JSON.stringify(gaps));
  const roleActions = data.nodes.filter(n => n.kind === "action" && n.roleId === engineeringRole)
    .map(n => {
      const spec = chiefActions.find(s => "engineering-chief-" + s.key === n.id);
      return `#### ${n.code} / ${n.id}: ${n.name}
Входы/источники: ${n.inputs.map(i => get(i.sourceId!).code).join("; ")}. Поставщики: ${Array.from(new Set(n.inputs.map(i => get(i.sourceId!).roleId ?? get(i.sourceId!).id))).join("; ")}. Полные определения/актуальность входов сохранены в карточке действия.
Работа: ${spec?.work ?? "Сохранить предмет этого существующего действия: проверить технические основания, план-факт, отклонения и доказательства; получить решение либо адресный возврат по его периоду/критерию. Это контроль/отчёт, а не вторая реализация функций."}
Ресурсы: общий комплект HEAD.07 выше; дополнительно ${n.resourceIds.filter(id => !resourceIds.includes(id as typeof resourceIds[number])).map(id => get(id).code).join("; ")}. Готовность будущих доступов не подтверждена.
Результат: ${data.links.filter(l => l.from === n.id && l.kind === "produces").map(l => get(l.to).name).join("; ")}.
Клиент/получатель: ${n.recipientId}; принимающий: ${n.acceptorId}; контроль: ${data.links.filter(l => l.from === n.id && l.kind === "accountable_to").map(l => l.to).join(", ")}.
Приёмка/возврат: критерий и правила раздела «Паспорт HEAD.07» + предметный результат; решение фиксируется явно. Следующий шаг: ${n.nextId}.
Триггер: ${n.schedule.trigger}; срок не согласован, общие условия оценки выше.
Отчётность: ${n.reporting?.formName}; форма ${n.reporting?.formStatus}, не утверждена этой ревизией. Объём/минуты/трудозатраты неизвестны.
`; }).join("\n");
  const text = technicalPassportText({ ...evidence, sourceRevision: root.revision, roleActions });
  const put = (id: string, title: string, text: string) => {
    if (text.length > 50000) throw Error(`Document exceeds existing limit: ${id} (${text.length}); reconcile without truncating`);
    commands.push(model.documents.some(d => d.id === id)
    ? { type: "saveDocument", id, title, text, url: "/admin/project-model?hypothesis=new-country&section=Процессы%20и%20Crew&workView=team", elementIds: ["TH-PRODUCT"] }
    : { type: "createDocument", id, title, text, url: "/admin/project-model?hypothesis=new-country&section=Процессы%20и%20Crew&workView=team", elementIds: ["TH-PRODUCT"] });
  };
  put(docId, "TalkHint — технический паспорт и главный инженер — v1 — на согласовании", text);
  book.version++; book.updatedAt = evidence.at; book.status = "На согласовании";
  // The existing book stores rendered prose and JSON; keep the full technical
  // matrix in its linked appendix rather than duplicating it past the document limit.
  for (const fact of engineeringFacts) {
    const f = book.features.find(f => f.id === fact.id); if (!f) continue;
    f.evidence += `\n26.10: ${docId} §${fact.id}; код ≠ приёмка.`;
    const keyFacts: Record<string, string> = {
      outgoing: "Код ограничивает поручение номерами +1; +33 не подтверждён.",
      chat: "Отдельный /api/chat — не единый голосовой чат с почтой.",
      sms: "Служебные SMS не доказывают готовность MMS/фото.",
      secretary: "Swift default Retell + Engine; сохранённый OpenAI остаётся.",
    };
    if (keyFacts[f.id]) f.implementation += "\n26.10: " + keyFacts[f.id];
  }
  book.responsibilities += `\nHEAD.07: ${docId}. Replit — ручной исполнитель; продукт рассматривает, приёмка ожидается.`;
  book.nextStage += "\n26.10: согласовать технический снимок, сборки и один следующий результат; сроки неизвестны.";
  put(productDoc.id, `TalkHint — живая книга продукта — v${book.version} — на согласовании`, productBookText(book));
  const roadmapVersion = Number(/— v(\d+)/.exec(roadmap.title)?.[1] ?? 15) + 1;
  put(roadmap.id, `TalkHint — единый roadmap работы crew над продуктом — v${roadmapVersion} — технический снимок и структура`,
    roadmap.text + `\n\n## ${engineeringMarker}\nТехнический паспорт ${docId}, книга v${book.version}; HEAD.07 сохранена, ${originalChief.length} прежних действий и ${chiefActions.length} новых управленческих действий. Описание и ручной снимок выполнены; согласование, устройство и ресурсы неизвестны. Полное описание структуры остаётся первым этапом, запуск AI — будущий отдельный. Предлагаемый следующий шаг: продукт/Сергей принимают техническую базу/платформы/критерий; затем адресно закрыть входы, оценить и согласовать один следующий результат. SMS/MMS и встроенный чат/почта не реализованы и не утверждены как календарный план. ${engineeringDeadline}\n${engineeringGuard}`);

  for (const req of engineeringRequests) {
    const old = model.elements.find(e => e.id === req.id);
    const coordination = { ...(old?.coordination ?? { kind: "work" as const, origin: "owner_chatgpt" as const, operations: [], relatedIds: [] }),
      state: "blocked" as const, roleId: req.role, processId: req.process,
      relatedIds: Array.from(new Set([...(old?.coordination?.relatedIds ?? []), engineeringRole, req.process])),
      nextStep: req.question + " Ответа/приёмки нет; срок согласовать.",
      operations: [...(old?.coordination?.operations ?? []), { id: randomUUID(), at: evidence.at,
        fingerprint: createHash("sha256").update(engineeringMarker + req.id).digest("hex") }] };
    get(req.role); get(req.process);
    const element: ElementInput = old
      ? { title: old.title, kind: old.kind, scope: old.scope, section: old.section,
        contentStatus: old.contentStatus, implementationStatus: old.implementationStatus,
        description: old.description + "\n\n" + req.question,
        details: { ...old.details, nextStep: req.question, source: (old.details.source ?? "") + "\n" + docId }, coordination }
      : { title: "HEAD.07: " + req.question.split(".")[0], kind: "research", scope: "talkhint", section: "Процессы и Crew",
        contentStatus: "proposal", implementationStatus: "not_started", description: req.question,
        details: { client: engineeringRole, accountable: req.role, source: docId, evidence: "Ответ/получение/приёмка не подтверждены.",
          acceptance: "Источник/дата/версия, полный ответ либо конкретный пробел и возврат; контроль по существующему руководителю.",
          nextStep: req.question, provenance: "Ручная регистрация Replit по поручению владельца, не вызов автономной роли." }, coordination };
    commands.push(old ? { type: "saveElement", id: req.id, element } : { type: "createElement", id: req.id, element });
    const receiving = get(req.process);
    addRef(receiving); input(receiving, "owner", "Адресный запрос HEAD.07 по техническому снимку");
    receiving.procedure += `\n${req.id}: принять запрос HEAD.07, подтвердить актуальность/достаточность, ответить источником либо вернуть конкретное уточнение; срока/исполнения/приёмки пока нет.`;
    receiving.exceptions += "\nНедостаточно входа — вернуть HEAD.07 конкретный вопрос; не имитировать ответ или запуск.";
  }
  // Supply a real partial technical result without closing the wider worker-readiness request.
  const pending = model.elements.find(e => e.id === "PB-GAP-TECH");
  if (!pending?.coordination) throw Error("Existing technical request required");
  commands.push({ type: "saveElement", id: pending.id, element: {
    title: pending.title, kind: pending.kind, scope: pending.scope, section: pending.section,
    contentStatus: pending.contentStatus, implementationStatus: pending.implementationStatus,
    description: pending.description + `\nЧастичный ручной ответ: ${docId}. Технический снимок выполнен Replit; оснащение/worker/пилот не подтверждены и запрос не закрыт.`,
    details: { ...pending.details, source: (pending.details.source ?? "") + "\n" + docId,
      evidence: "Ручная техническая ревизия и unit-тесты выполнены; ответ по готовности worker и приёмка отсутствуют." },
    coordination: { ...pending.coordination, state: "blocked", resultDocumentId: docId,
      nextStep: "HEAD.07/продукт рассматривают частичный технический снимок. ENG.BENCH.1–6 и устройство/приёмка остаются открыты. Не считать запрос выполненным.",
      operations: [...pending.coordination.operations, { id: randomUUID(), at: evidence.at,
        fingerprint: createHash("sha256").update(engineeringMarker + pending.id).digest("hex") }] },
  } });
  commands.push({ type: "createElement", id: "ENG-REVIEW-2026-10-26", element: {
    title: "Главный инженер: ручная техническая ревизия 26.10.2026 — на рассмотрении",
    kind: "research", scope: "talkhint", section: "Процессы и Crew", contentStatus: "proposal", implementationStatus: "in_progress",
    description: engineeringGuard + " Выполнено чтение кода/модели и тесты; технический документ передан на рассмотрение, не принят.",
    details: { client: "head-product", accountable: engineeringRole, source: docId, evidence: evidence.tests,
      provenance: "Фактический ручной исполнитель — Replit текущего Dev-сеанса. Не автономная crew.",
      acceptance: "HEAD.06/Сергей рассматривают достоверность/достаточность; QA — границы доказательств. Явная приёмка либо адресный возврат." },
    coordination: { kind: "work", origin: "owner_chatgpt", state: "awaiting_review", roleId: engineeringRole,
      processId: "company-action-technical-control", resultDocumentId: docId,
      relatedIds: ["PB-GAP-TECH", "BENCH-REQ-PRODUCT-BASE", engineeringRole],
      nextStep: "Рассмотреть технический снимок; получить конкретные сборки/критерий и выбрать следующий результат. Срок не согласован.",
      operations: [{ id: randomUUID(), at: evidence.at, fingerprint: createHash("sha256").update(engineeringMarker).digest("hex") }] },
  } });
  commands.push({ type: "saveOperatingModel", baseVersion: op.version, data });
  let next = root;
  for (const command of commands) next = applyHypothesisCommand(next, "new-country", command, actor);
  return next;
}
