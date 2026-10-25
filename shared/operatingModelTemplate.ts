import type { OperatingData, WorkKind, WorkNode } from "./operatingModel";
export function emptyWorkNode(id: string, code: string, name: string, kind: WorkKind, parentId: string | null = null): WorkNode {
  return { id, code, name, kind, parentId, status: "proposal", description: "", purpose: "", clientId: null, roleId: null, executorId: null,
    recipientId: null, acceptorId: null, nextId: null, resourceIds: [], inputs: [], schedule: { days: [], hours: "", timezone: "", trigger: "", deadline: "" },
    procedure: "", rules: "", constraints: "", success: "", storage: "", delivery: "", exceptions: "", questions: "", resourceState: kind === "resource" ? "required" : null, referenceIds: [] };
}
export function initialOperatingModelDraft(): OperatingData {
  const n = (id: string, code: string, name: string, kind: WorkKind, parent: string | null = null, extra: Partial<WorkNode> = {}) =>
    ({ ...emptyWorkNode(id, code, name, kind, parent), ...extra });
  const nodes: WorkNode[] = [
    n("mission", "TH", "TalkHint — помощница для жизни и малого бизнеса в новой стране", "context", null, { status: "agreed", referenceIds: ["TH-PRODUCT"], description: "Целевая гипотеза, не заявление о готовности. Полная AI-компания проектируется через работу; исполнители не запускаются." }),
    n("owner", "C-01", "Сергей — заказчик исследования и стратегических решений", "client"),
    n("b2c", "B2C", "Привлечение частных пользователей", "process", "mission"),
    n("b2b", "B2B", "Привлечение самостоятельных специалистов и малого бизнеса", "process", "mission", { questions: "Сегмент, каналы и критерии спроса не утверждены. Черновая ветка." }),
    n("need", "B2C.N", "Найти людей с языковыми и организационными трудностями", "need", "b2c", { referenceIds: ["TH-CLIENT", "TH-PROBLEM"] }),
    n("capability", "B2C.C", "Выявление и проверка возможностей привлечения", "capability", "need"),
    n("search", "B2C.1", "Поиск клиентов: от критериев до принятого результата", "process", "capability"),
    n("criteria", "B2C.1.1", "Определить критерии аудитории и вопросы проверки", "action", "search", { clientId: "owner", roleId: "research-role", executorId: "criteria-crew", nextId: "discover", acceptorId: "owner", resourceIds: ["model-resource"], inputs: [{ name: "Продукт, клиент, проблема", sourceId: "mission", freshness: "Текущая версия блоков 1–3" }], procedure: "Прочитать согласованную гипотезу. Отделить личный опыт от проверенных фактов. Сформулировать критерии без выдуманного спроса.", success: "Критерии и неизвестное явно разделены." }),
    n("discover", "B2C.1.2", "Найти публичные каналы и свидетельства потребностей", "action", "search", { clientId: "owner", roleId: "discovery-role", executorId: "discovery-crew", nextId: "qualify", acceptorId: "owner", resourceIds: ["search-resource"], inputs: [{ name: "Критерии поиска", sourceId: "criteria", freshness: "После приёмки критериев" }], procedure: "В будущем искать по согласованным критериям; фиксировать URL, дату и ограничения. Сейчас поиск и сбор контактов не выполняются.", constraints: "Без рассылок, покупки баз, регистрации и персональных данных." }),
    n("qualify", "B2C.1.3", "Сопоставить свидетельства и подготовить предложения проверки", "action", "search", { clientId: "owner", roleId: "qualification-role", executorId: "qualification-crew", nextId: "review", acceptorId: "owner", resourceIds: ["model-resource"], inputs: [{ name: "Свидетельства", sourceId: "discover", freshness: "Дата источника и проверки обязательны" }], procedure: "Проверить соответствие критериям, не считать интерес покупкой. Описать противоречия и пробелы.", success: "Каждое предложение имеет основание и неизвестное." }),
    n("review", "B2C.1.4", "Содержательно рассмотреть отчёт: принять / вернуть / эскалировать", "action", "search", { clientId: "owner", roleId: "review-role", executorId: "owner", nextId: "decision", acceptorId: "owner", resourceIds: ["model-resource"], inputs: [{ name: "Отчёт поиска", sourceId: "report", freshness: "Версия отчёта и исходных действий" }], procedure: "Проверить источники и границы. Принять с обоснованием, вернуть конкретные пункты или передать владельцу. Решение — запись, не бесконечный отчёт о чтении.", success: "Есть решение и следующий шаг; стратегия не выбирается автоматически." }),
    n("decision", "B2C.R", "Принятый список гипотез каналов и план ручной проверки", "result", "search", { clientId: "owner", recipientId: "owner", acceptorId: "owner", storage: "История существующей модели владельца", questions: "Фактических клиентов и результатов исследования пока нет." }),
    n("report", "B2C.REP", "Отчёт о поиске возможностей привлечения", "report", "search", { clientId: "owner", recipientId: "review", roleId: "qualification-role", executorId: "qualification-crew", purpose: "Основание для ручного выбора следующей проверки", referenceIds: ["criteria", "discover", "qualify"], storage: "Общее хранилище модели и история версий", delivery: "В Dev-пространстве, без внешней отправки", schedule: { days: [], hours: "", timezone: "", trigger: "После завершения прохода", deadline: "Согласовать" } }),
    n("business-search", "B2B.1", "Уточнить бизнес-клиента и потребность в обращениях / расписании", "action", "b2b", { clientId: "owner", inputs: [{ name: "Сегмент и критерии", sourceId: null, freshness: "" }], questions: "Черновик: сегмент, должности, источники и процедура ещё не проработаны." }),
    n("research-dept", "D-01", "Исследования аудитории и возможностей", "department", null, { description: "Предложение, выведенное из действий; не активный отдел." }),
    ...[
      ["research-role", "P-01", "Аналитик критериев аудитории"],
      ["discovery-role", "P-02", "Исследователь каналов"],
      ["qualification-role", "P-03", "Аналитик свидетельств"],
      ["review-role", "P-04", "Ответственный за приёмку исследования"],
    ].map(([id, code, name]) => n(id, code, name, "role", "research-dept")),
    ...[
      ["criteria-crew", "CR-01", "Crew определения критериев"],
      ["discovery-crew", "CR-02", "Crew поиска источников"],
      ["qualification-crew", "CR-03", "Crew проверки свидетельств"],
    ].map(([id, code, name]) => n(id, code, name, "crew", null, { description: "Проектируемая ответственность, не запущенный AI-сотрудник." })),
    n("model-resource", "RES-01", "Модель TalkHint и разрешённые материалы", "resource", null, { resourceState: "required", description: "Само хранилище реализовано; доступ будущему исполнителю не согласован и не подключён." }),
    n("search-resource", "RES-02", "Публичный поиск / API", "resource", null, { resourceState: "required", questions: "Провайдер, доступ, бюджет и лимиты требуют отдельного согласования." }),
  ];
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => ({ id: `${kind}:${from}:${to}`, from, to, kind, reason });
  return { nodes, links: [
    link("criteria", "discover", "handoff", "Передать критерии"), link("discover", "qualify", "handoff", "Передать свидетельства"),
    link("qualify", "report", "produces", "Создать отчёт"), link("report", "review", "acceptance", "Проверить содержательно"),
    link("review", "decision", "produces", "Записать решение"), link("review", "qualify", "return", "Вернуть с конкретными замечаниями"),
    link("review", "owner", "escalation", "Неустранимые противоречия и полномочия"), link("qualification-role", "owner", "accountable_to", "Владелец принимает стратегические решения"),
    link("qualify", "discover", "depends_on", "Нужны источники, не только навигационный переход"),
  ], stageReports: [
    { pass: 1, described: "Сквозная B2C-цепочка и клиенты результатов; B2B — черновая ветка.", boundary: "Это проектирование, не выполненный поиск.", dependencies: "Блоки 1–3 новой гипотезы.", gaps: "Спрос и каналы не проверены.", next: "Уточнить критерии и декомпозицию." },
    { pass: 2, described: "Предложены отдельные должности и Crew для мини-задач, ресурсы и отчёт.", boundary: "Без совмещения ради экономии и без подключения.", dependencies: "Приёмка структуры владельцем.", gaps: "Часы, часовые пояса, бюджеты и доступы не согласованы.", next: "Заполнить ресурсы и сроки." },
    { pass: 3, described: "Показаны разные связи: передача, зависимость, приёмка, возврат, подотчётность и эскалация.", boundary: "Рабочий процесс приёмки ещё не запускался.", dependencies: "Согласование ролей и полномочий.", gaps: "Межотдельные пересечения будут уточняться при расширении.", next: "Содержательно разобрать один процесс и принять его модель." },
  ] };
}
export function defaultOperatingModel(): OperatingData {
  const data = initialOperatingModelDraft();
  const outputs = [
    { action: "criteria", next: "discover", id: "criteria-result", code: "B2C.1.1.R", name: "Критерии и вопросы проверки аудитории" },
    { action: "discover", next: "qualify", id: "sources-result", code: "B2C.1.2.R", name: "Перечень источников и свидетельств с датами" },
    { action: "qualify", next: "review", id: "findings-result", code: "B2C.1.3.R", name: "Проверенные основания и предложения ручной проверки" },
  ];
  for (const row of outputs) {
    const action = data.nodes.find(n => n.id === row.action)!;
    action.clientId = row.next;
    const result = emptyWorkNode(row.id, row.code, row.name, "result", row.action);
    Object.assign(result, { clientId: row.next, recipientId: row.next, acceptorId: "owner", nextId: row.next,
      storage: "Общая модель TalkHint; версия и источники обязательны",
      description: "Планируемый результат; фактическое исследование ещё не проведено." });
    data.nodes.push(result);
    data.links = data.links.filter(l => !(l.kind === "handoff" && l.from === row.action));
    data.links.push(
      { id: `produces:${row.action}:${row.id}`, from: row.action, to: row.id, kind: "produces", reason: "Явный результат действия" },
      { id: `handoff:${row.id}:${row.next}`, from: row.id, to: row.next, kind: "handoff", reason: "Передать следующему потребителю" },
    );
    const consumer = data.nodes.find(n => n.id === row.next)!;
    consumer.inputs = consumer.inputs.map(input => input.sourceId === row.action ? { ...input, sourceId: row.id } : input);
  }
  data.nodes.find(n => n.id === "report")!.inputs = [{
    name: "Проверенные основания", sourceId: "findings-result", freshness: "Версия исходных действий и датированные источники",
  }];
  return data;
}
