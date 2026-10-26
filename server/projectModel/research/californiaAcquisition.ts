import type { ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import type { OperatingData, WorkNode } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { defaultRegister } from "../../../shared/actionRegister";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { emptyReporting } from "../../../shared/actionReporting";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { caActionId, caActions, caDirectorId, caDocumentId, caMarker, caResources, caResultId, caRoles, caSource } from "./californiaAcquisitionSpec";

const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const guard = "Только описание работы. Сейчас нет запуска рекламы/AI, расходов, покупок, звонков, публикации или выдачи доступов. Роли/полномочия предложены, сроки/формы не утверждены. Уже действующие полномочия не требуют повторного согласования того же лимита; эта запись новых полномочий не даёт.";
const powers = "Предлагается: директор управляет каналами и принимает материалы внутри явно утверждённых полномочий и бюджета. Увеличение бюджета, изменение цены и новые обещания — уполномоченному руководителю/Сергею. До явного делегирования расходы/внешние действия остаются Сергею. Личные деньги исполнителя исключены.";
const storage = "Существующее хранилище документов new-country; результат с версией, источником, действием и решением приёмки/возврата. Заполненных отчётов и рекламных кампаний этой задачей не создаётся.";
const resourceId = (key: string) => `ca-b2c-resource-${key}`;
const spec = new Map(caActions.map(s => [s.key, s]));
export const caReused = [
  ["management-action-marketing-plan", "plan-accept"],
  ["management-action-marketing-fact", "launch"],
  ["management-action-marketing-conversion", "metrics"],
  ["management-action-finance-events", "expenses"],
  ["management-action-report-acquisition-day", "daily"],
  ["management-action-report-acquisition-week", "weekly-receive"],
  ["management-action-report-acquisition-month", "monthly-receive"],
  ["management-action-control-acquisition", "control"],
] as const;
export function prepareCaliforniaAcquisition(root: ProjectModelState, actor: string): ProjectModelState {
  const model = readHypothesis(root, "new-country");
  const revision = model.operatingModel?.revisions.at(-1);
  const roadmap = model.documents.find(d => d.id === roadmapId);
  if (!revision || !roadmap || !model.documents.some(d => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT"))
    throw Error("Existing operating model, product book and canonical roadmap required");
  if (model.documents.some(d => d.id === caDocumentId && d.text.includes(caMarker))) return root;
  if (model.documents.some(d => d.id === caDocumentId)) throw Error("Existing source document requires reconciliation");
  const data = structuredClone(revision.data);
  const get = (id: string) => {
    const node = data.nodes.find(n => n.id === id);
    if (!node) throw Error(`Missing existing identity: ${id}`);
    return node;
  };
  const add = (node: WorkNode) => {
    if (data.nodes.some(n => n.id === node.id || n.code === node.code)) throw Error(`Reconcile before creating ${node.code}`);
    data.nodes.push(node); return node;
  };
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => {
    get(from); get(to);
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `ca:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  const resolve = (key: string) => key.startsWith("@") ? key.slice(1) : caActionId(key);
  const source = (key: string) => key.startsWith("@") ? key.slice(1) : caResultId(key);
  for (const [id, code, name] of caRoles) {
    const matches = data.nodes.filter(n => n.kind === "role" && (n.id === id || n.code === code || n.name === name));
    if (matches.length) throw Error(`Existing candidate role needs explicit reconciliation: ${code}`);
    const n = add(emptyWorkNode(id, code, name, "role", "dir-acquisition"));
    Object.assign(n, { managerId: "head-acquisition", status: "proposal", level: "operation", detailState: "described",
      clientId: id === caDirectorId ? "head-acquisition" : caDirectorId,
      purpose: id === caDirectorId ? "План и управляемый цикл привлечения B2C Калифорнии с подтверждённой пользой клиентам." : "Дать региональному директору достаточный результат закреплённых действий.",
      description: "Предложенное расширение существующей структуры T02 из действий, не новый отдел и не назначенный/запущенный агент.",
      constraints: guard, rules: id === caDirectorId ? powers : "Предложено готовить/проверять результаты закреплённых действий. Приёмка материалов не разрешает расходы, изменение цены или новые обещания.",
      resourceIds: ["model-resource"], referenceIds: [caDocumentId],
      success: "Получатель явно принимает прослеживаемую версию или возвращает вопрос; итог полезен конечному пользователю через достоверное предложение.",
      questions: "Назначение экземпляра AI, навыки, доступы и лимиты требуют отдельного решения; сроки и формы не утверждены.",
    });
  }
  for (const [key, name, supplier, availability] of caResources) {
    get(supplier);
    const n = add(emptyWorkNode(resourceId(key), `RES.ACQ.CA.${key.toUpperCase()}`, name, "resource", "b2c"));
    Object.assign(n, { roleId: supplier, status: "proposal", resourceState: "required",
      description: `Фактическая доступность: не подтверждена. ${availability}`,
      purpose: "Обеспечить действия региона без неразрешённых расходов.", constraints: guard, referenceIds: [caDocumentId] });
  }
  // Build the entire action set before linking, preserving every pre-existing identity.
  for (const [index, s] of caActions.map((s, index) => [index, s] as const)) {
    const role = get(s.role);
    const n = add(emptyWorkNode(caActionId(s.key), `ACQ.CA.${String(index + 1).padStart(2, "0")}`, s.name, "action", s.parent ?? "b2c"));
    const next = s.next.startsWith("@") ? get(resolve(s.next)) : null;
    const nextRole = next?.id ?? spec.get(s.next)?.role;
    if (!nextRole) throw Error(`Missing next consumer ${s.next}`);
    Object.assign(n, {
      level: "operation", detailState: "described", status: "proposal", roleId: role.id, executorId: null,
      clientId: nextRole, recipientId: nextRole, acceptorId: nextRole, nextId: resolve(s.next),
      description: "B2C / Калифорния. Содержание поручения сохранено; детализация, назначения и полномочия — к обсуждению.",
      purpose: "Дать следующему клиенту действия достаточный результат, не подменяя пользу пользователю промежуточным событием.",
      inputs: s.inputs.map(k => ({ name: k.startsWith("@") ? get(source(k)).name : spec.get(k)!.output,
        sourceId: source(k), freshness: "Проверить фактическую версию/дату на входе. Названный источник не означает уже полученный результат." })),
      resourceIds: ["model-resource", ...(s.resources ?? []).map(resourceId)],
      schedule: { days: [], hours: "", timezone: "", trigger: s.period ?? "При поступлении входа или адресного запроса; период кампании не утверждён", deadline: "Срок выполнения/ответа не согласован" },
      procedure: s.work, rules: powers, constraints: guard,
      success: `Результат «${s.output}» соответствует описанной работе; источники/даты/версии прослеживаются, факты отделены от допущений, получатель явно подтвердил достаточность. При нехватке — адресный возврат. Блокер не является принятым конечным результатом кампании.`,
      exceptions: "Конкретные замечания вернуть автору/поставщику с вопросом, версией и ответственным; исправленную версию передать повторно. Молчание не приёмка. Спор и пределы прав — руководителю/Сергею.",
      storage, delivery: "Передача ссылки на версию в той же модели; принимающее действие подтверждает получение/достаточность либо возврат.",
      questions: "Сроки, часы/часовой пояс, нагрузка, формы, назначенные исполнители и реальные доступы открыты.",
      reporting: { ...emptyReporting(), formName: ["plan", "materials-request", "budget-request", "daily", "weekly", "monthly"].includes(s.key)
        ? `${s.output} — бланк требуется разработать`
        : "Запись результата/передачи/приёмки в общем реестре — не отдельный рекурсивный отчёт",
        storage, formStatus: "required", approvalEvidence: "Форма не утверждена; разработка ChatGPT + Сергей, утверждает Сергей." },
      register: { ...defaultRegister(), approval: "discussion", source: caSource, period: s.period ?? "на одно поручение / версию",
        availability: "Режим, часы и часовой пояс неизвестны; 24/7 не назначено",
        estimateBasis: "Объём и минуты неизвестны. Часы = операции × минуты / 60 после оценки; не нулевая нагрузка.",
        proposalReason: "Содержание поручения владельца; точная детализация/новые роли и полномочия представлены для обсуждения." },
      referenceIds: [caDocumentId, "DOC-TALKHINT-PRODUCT-PASSPORT"],
    });
    const result = add(emptyWorkNode(caResultId(s.key), `${n.code}.R`, s.output, "result", n.id));
    Object.assign(result, { status: "proposal", roleId: role.id, clientId: nextRole, recipientId: nextRole,
      acceptorId: nextRole, nextId: n.nextId, description: "Требование к будущему результату, не созданный отчёт и не приёмка.",
      purpose: n.purpose, success: n.success, constraints: guard, storage, delivery: n.delivery, referenceIds: [caDocumentId] });
  }
  for (const s of caActions) {
    const n = get(caActionId(s.key)), controller = s.role.startsWith("head-") ? "owner"
      : get(s.role).managerId ?? "head-acquisition";
    link(n.id, caResultId(s.key), "produces", "Определение результата; результат ещё не выполнен.");
    link(n.id, controller, "accountable_to", "Контроль результата и передачи; верхняя граница — владелец.");
    link(caResultId(s.key), n.acceptorId!, "acceptance", "Явная приёмка/возврат версии, не автоматическое одобрение.");
    link(n.acceptorId!, n.id, "return", "Вернуть автору конкретный вопрос/замечания.");
    link(n.id, "owner", "escalation", "Недостаток полномочий, спор или неустранимый блокер.");
    for (const input of n.inputs) {
      link(input.sourceId!, n.id, "handoff", "Передача имеет парное принимающее действие и явный вход.");
      link(n.id, input.sourceId!, "depends_on", "Зависимость от достаточности входа, не от мнимого выполнения.");
    }
    for (const rid of n.resourceIds) link(n.id, rid, "requires", "Доступность ресурса проверяется отдельно от его перечисления.");
    // A declared next step is also an actual receiving edge with a matching input.
    const next = get(n.nextId!);
    if (next.kind === "action" && !next.inputs.some(i => i.sourceId === caResultId(s.key)))
      next.inputs.push({ name: s.output, sourceId: caResultId(s.key), freshness: "При передаче конкретной версии; повторная обработка после возврата, без дублей результата." });
    link(caResultId(s.key), next.id, "handoff", "Следующий получатель; этап и условие указаны в процедуре.");
  }
  for (const [id, key] of caReused) {
    const n = get(id), from = caResultId(key);
    if (!n.inputs.some(i => i.sourceId === from))
      n.inputs.push({ name: `B2C Калифорния: ${spec.get(key)!.output}`, sourceId: from,
        freshness: "При наличии версии регионального результата; отсутствие факта отмечать, не подставлять ноль." });
    n.referenceIds = Array.from(new Set([...n.referenceIds, caDocumentId]));
    n.procedure += "\nB2C Калифорния: принять связанную версию, подтвердить достаточность либо вернуть конкретные замечания поставщику; общие B2C/B2B обязанности и прежние связи сохраняются.";
    link(from, n.id, "handoff", "Региональный результат входит в существующий процесс, не дублирует его.");
    link(n.roleId!, caActionId(key), "return", "Возврат поставщику региона при недостаточном входе.");
  }
  const involved = new Set(caActions.map(s => s.role));
  for (const id of Array.from(involved)) {
    const n = get(id), duties = caActions.filter(s => s.role === id).map(s => `${get(caActionId(s.key)).code} ${s.name}`);
    n.referenceIds = Array.from(new Set([...n.referenceIds, caDocumentId]));
    n.resourceIds = Array.from(new Set([...n.resourceIds,
      ...caActions.filter(s => s.role === id).flatMap(s => get(caActionId(s.key)).resourceIds)]));
    n.procedure += `\nB2C Калифорния — обязанности из реестра: ${duties.join("; ")}.`;
    n.questions += "\nРасширение обязанностей/полномочия, сроки и ресурсы не превращаются в утверждённое назначение AI.";
    if (id !== "head-acquisition")
      link(id, "head-acquisition", "feedback", "Клиентский эффект и обратная связь регионального цикла, не вторая подчинённость.");
  }
  const roadmapNode = data.nodes.find(n => n.id === "crew-product-roadmap");
  if (roadmapNode) {
    roadmapNode.nextId = caActionId("mandate");
    roadmapNode.description += "\nДобавлен связанный цикл B2C Калифорнии; заполнение структуры, не реальный запуск.";
    roadmapNode.questions += "\nБлижайший разбор: роль директора, источник цели/периода и пределы полномочий; затем адресные запросы входов. 100 подписок не утверждены как цель. Прежние незакрытые вопросы сохраняются.";
    roadmapNode.referenceIds = Array.from(new Set([...roadmapNode.referenceIds, caDocumentId]));
  }
  const scoped = new Set(caActions.map(s => caActionId(s.key)));
  const gaps = actionChainGaps(data, scoped);
  if (gaps.length) throw Error(`Regional chain gaps: ${JSON.stringify(gaps.slice(0, 8))}`);
  const rows = caActions.map(s => {
    const n = get(caActionId(s.key));
    return `| ${n.code} | ${n.id} | ${s.name} | ${get(s.role).code} | ${s.output} | ${get(n.nextId!).code} |`;
  }).join("\n");
  const text = `# B2C Калифорния — связанный цикл привлечения, v1\n${caMarker}\nСтатус: описание поручения сохранено; детализация и новые роли/полномочия — на согласовании. Реальных исполнителей/рекламы/результатов нет.\n\n## Источник\n${caSource}\nДата сохранения — фактическая дата истории. Исходный разговор целиком не доступен; сохранено только реально переданное поручение. Книга продукта v2, прежние ID/история/связи сохранены.\n\n## Полномочия и границы\n${powers}\n${guard}\n\n## Сопоставление\nПереиспользованы HEAD.02, HEAD.01, HEAD.06, HEAD.07, HEAD.08, HEAD.09, P.PRODUCT, P-BENCH, P.ACQ, P.FIN, QA и саппорт. Предложены четыре специализированные роли в T02, не новые отделы; рекламный дизайнер не заменяет P.UX интерфейсов. Общий план/аналитика/финансовые события и отчёты T02 дополнены парными входами, не заменены региональными.\n\n## Действия\n| Код | ID | Действие | Должность | Результат | Следующий шаг |\n|---|---|---|---|---|---|\n${rows}\n\nПолные контракты каждого действия (поставщик/вход, клиент/результат, контроль, приёмка/возврат, ресурсы, периодичность/сроки, права и отчётность) находятся в той же операционной модели; обязанности — фильтр по должности.\n\n## Ресурсные пробелы и адресные действия\n${caResources.map(([key, name, supplier, note]) => `- ${resourceId(key)} — ${name}; поставщик ${get(supplier).code}. ${note}`).join("\n")}\nНа каждый ресурс есть принимающий запрос и ответ поставщика (brand-input/forms-input/access-input/channel-input/finance-input/history-input). Источники не означают, что доступ выдан или деньги есть.\n\n## Отчётность и критерии\nЕжедневно — отклонения/причина или гипотеза/мера/ответственный/срок/контроль эффекта. Еженедельно — один сводный лист цели, сегментов, предложения, отличий, каналов, бюджета, план-факта, стоимости клиента, блокеров, решений и следующей недели, с доказательствами. Ежемесячно — сверенный итог и прогноз. Формы требуется разработать ChatGPT с Сергеем, утвердить Сергею; точные сроки не согласованы. Продажа, регистрация, первая польза, уникальная первая успешная оплата, возврат и удержание — разные события.\n\n## Проверка полноты\n${caActions.length} новых конкретных действий, ${caRoles.length} предложенных ролей, ${caReused.length} переиспользованных действий. Формальных разрывов цепочки ${gaps.length}. Это полнота описанных связей, не готовность кампании/ресурсов и не доказанная эффективность.\nСледующий шаг: HEAD.02/Сергей рассматривают границы роли директора, поставщиков недостающих входов и критерий результата; затем адресно запрашивается достаточная версия входа. До этого реальный план/бюджет/сроки не утверждены.`;
  data.stageReports.push({ pass: 3, described: `${caActions.length} действий цикла B2C Калифорнии и ${caReused.length} парных принимающих входов существующих процессов.`,
    boundary: "Описание поручения, не продажа/кампания/запуск AI. 100 подписок — пример, не цель.",
    dependencies: "Цель/продукт/исследования/бенчмаркинг/финансы/история/площадки/брендбук/формы/инструменты/назначения.",
    gaps: "Сроки, нагрузка, формы, доступы, бюджет, назначения и делегирование не утверждены.",
    next: "Обсудить роль директора и запросить недостающие входы адресным поставщикам; запуск не следующий автоматический шаг." });
  const commands: ModelCommand[] = [
    { type: "createDocument", id: caDocumentId, title: "TalkHint — B2C Калифорния: цикл привлечения — v1 — на согласовании",
      text, url: "/admin/project-model?hypothesis=new-country&section=Процессы%20и%20Crew&workView=actions",
      elementIds: ["TH-PRODUCT"] },
    { type: "saveDocument", id: roadmap.id,
      title: roadmap.title.replace(/v\d+/, m => `v${Number(m.slice(1)) + 1}`),
      text: roadmap.text + `\n\n## B2C Калифорния — заполнение связанного цикла\n${caMarker}\nИсточник/индекс: ${caDocumentId}, v1. ${caActions.length} новых действий, ${caRoles.length} предложенных должностей; существующие ${caReused.length} действия дополнены, не продублированы. Книга продукта v2 неизменна. Структура описана, ресурсы и полномочия/формы/сроки открыты; 100 подписок не план. Следующий шаг — согласование роли/границ и получение недостающих входов от поставщиков. Реальный запуск, расходы и подключение AI отдельно, не разрешены этой задачей.`,
      url: roadmap.url, elementIds: roadmap.elementIds },
    { type: "saveOperatingModel", baseVersion: revision.version, data },
  ];
  let next = root;
  for (const command of commands) next = applyHypothesisCommand(next, "new-country", command, actor);
  return next;
}
