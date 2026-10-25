import type { OperatingData, WorkNode } from "./operatingModel";
import { emptyWorkNode } from "./operatingModelTemplate";

/** Definitions of an explicitly approved planning taxonomy, not runtime agents. */
const directions = [
  ["market", "Рынок и развитие предложения", "Исследования клиентов и конкурентов, бенчмаркинг, изменения и предложения проверок.", "Руководитель исследований и развития предложения", "product", "Какие сегменты, частота и основания достаточны для проверки?"],
  ["acquisition", "Привлечение клиентов B2C и B2B", "Каналы, реклама, кампании и измерение обращений.", "Руководитель привлечения клиентов", "sales", "Какие каналы, бюджеты, география и правила атрибуции будут согласованы?"],
  ["sales", "Продажи и начало использования", "Принять обращение, определить потребность, объяснить предложение, регистрация, покупка и первый результат.", "Руководитель продаж и начала использования", "service", "Каковы условия покупки, согласия и критерий успешного подключения B2C/B2B?"],
  ["service", "Оказание услуги TalkHint", "Пользовательские поручения, звонки и другие согласованные функции, результаты и учёт использования.", "Руководитель оказания услуги", "support", "Какие функции, ограничения, подтверждения и гарантии качества реально поддержаны?"],
  ["support", "Поддержка и удержание", "Проблемы, жалобы, помощь, причины ухода и возвращение.", "Руководитель поддержки и удержания", "product", "Какие сроки помощи, правила эскалации и основания возвращения приемлемы?"],
  ["product", "Продукт и дизайн", "Гипотезы, сценарии, требования, интерфейс и эффект изменений.", "Руководитель продукта и дизайна", "engineering", "Как принимаются гипотезы, требования, доступность интерфейса и измерения эффекта?"],
  ["engineering", "Разработка, инфраструктура и качество", "Реализация, тестирование, выпуск, доступность, безопасность и восстановление.", "Руководитель разработки, инфраструктуры и качества", "service", "Какие SLO, контроль выпуска, доступы и планы восстановления будут утверждены?"],
  ["finance", "Финансы и экономика", "Начисления, платежи, возвраты, расходы, сверка, экономика, бюджет и прогноз.", "Руководитель финансов и экономики", "control", "Каковы правила признания расходов, возвратов, сверки, бюджета и прогноза?"],
  ["team", "AI-команда и организация работы", "Должности, оснащение Crew, доступы, проверка исполнителей, процедуры и база знаний.", "Руководитель AI-команды и организации работы", "control", "Кто согласует доступы, проверяет исполнителя и отзывает полномочия?"],
  ["control", "Контроль и совершенствование компании", "Выполнение целей и правил, межотдельные сбои, исправления и сводная отчётность.", "Руководитель контроля и совершенствования", "market", "Каковы критерии контроля, приёмки исправлений и передачи предложений владельцу?"],
] as const;

type ProcessSpec = {
  id: string; direction: string; code: string; name: string; input: string;
  output: string; consumer: string; nature: NonNullable<WorkNode["workNature"]>; unknown: string;
};
const processes: ProcessSpec[] = [
  { id: "search", direction: "market", code: "B2C.1", name: "Поиск клиентов: от критериев до принятого результата", input: "Согласованная гипотеза и вопросы аудитории", output: "Предложения ручной проверки потребностей и каналов", consumer: "b2c", nature: "mixed", unknown: "Детализация существующих действий пока не продолжается." },
  { id: "competitor-monitor", direction: "market", code: "MKT.2", name: "Исследование конкурентов и бенчмаркинг", input: "Существующие карточки, источники и паспорт аналитика", output: "Изменения, противоречия и предложения проверок", consumer: "product-hypotheses", nature: "mixed", unknown: "Источники, лимиты и запуск аналитика требуют отдельного согласования." },
  { id: "offer-development", direction: "market", code: "MKT.3", name: "Развитие предложения по результатам исследований", input: "Свидетельства клиентов, конкурентов и использования", output: "Обоснованные варианты изменения предложения", consumer: "product-hypotheses", nature: "mixed", unknown: "Критерии достаточности доказательств и выбора предложений." },
  { id: "b2c", direction: "acquisition", code: "B2C", name: "Привлечение частных пользователей", input: "Исследования аудитории и утверждённое предложение", output: "Измеримые обращения частных пользователей", consumer: "intake", nature: "mixed", unknown: "Каналы и целевые показатели не выбраны; эффект не гарантирован." },
  { id: "b2b", direction: "acquisition", code: "B2B", name: "Привлечение самостоятельных специалистов и малого бизнеса", input: "Проверяемый бизнес-сегмент и предложение", output: "Измеримые бизнес-обращения", consumer: "intake", nature: "mixed", unknown: "Отличия B2B, сегмент и каналы пока открыты." },
  { id: "campaigns", direction: "acquisition", code: "ACQ.3", name: "Подготовка кампаний и измерение обращений", input: "Утверждённые цели, материалы и бюджет", output: "Проект кампании и схема атрибуции обращений", consumer: "intake", nature: "mixed", unknown: "Реклама, бюджеты, сообщения и расписания не включены." },
  { id: "intake", direction: "sales", code: "SAL.1", name: "Приём обращения и определение потребности", input: "Обращение и разрешённые сведения о клиенте", output: "Согласованная потребность и следующий шаг", consumer: "proposal-choice", nature: "mixed", unknown: "Каналы приёма, состав данных и сроки ответа." },
  { id: "proposal-choice", direction: "sales", code: "SAL.2", name: "Объяснение и выбор предложения", input: "Потребность и подтверждённые условия продукта", output: "Выбранный вариант либо причина отказа", consumer: "onboarding", nature: "mixed", unknown: "Тарифы и процедура выбора не утверждены этой моделью." },
  { id: "onboarding", direction: "sales", code: "SAL.3", name: "Регистрация, подключение и подготовка первого результата", input: "Выбор клиента, необходимые согласия и настройки", output: "Готовность к первой услуге и перечень ограничений", consumer: "payments", nature: "mixed", unknown: "Состав подключения и отличие личного/рабочего режима требуют проверки." },
  { id: "task-service", direction: "service", code: "SVC.1", name: "Принятие и выполнение разрешённого пользовательского поручения", input: "Подтверждённое поручение, контекст и полномочия", output: "Фактический результат, частичный исход или явная ошибка", consumer: "support-intake", nature: "mixed", unknown: "Перечень реально доступных функций и условий внешнего действия проверяется отдельно." },
  { id: "service-results", direction: "service", code: "SVC.2", name: "Сохранение и передача результата поручения", input: "Фактический исход и разрешённая история", output: "Повторно читаемый результат с ограничениями данных", consumer: "support-intake", nature: "deterministic", unknown: "Правила хранения и доставки по продуктовым каналам не устанавливаются здесь." },
  { id: "usage-accounting", direction: "service", code: "SVC.3", name: "Учёт использования и событий оказания услуги", input: "События выполнения и данные провайдеров", output: "Учёт использования для сверки, поддержки и продукта", consumer: "finance-reconcile", nature: "deterministic", unknown: "Метрики, единицы и правила подтверждённого расхода." },
  { id: "support-intake", direction: "support", code: "SUP.1", name: "Разбор проблем, жалоб и помощь пользователю", input: "Обращение, результат услуги и разрешённая диагностика", output: "Решение проблемы либо обоснованная эскалация", consumer: "repeat-use", nature: "mixed", unknown: "SLA, приоритеты и согласия на диагностику." },
  { id: "repeat-use", direction: "support", code: "SUP.2", name: "Повторное использование и возвращение", input: "Удовлетворённая потребность либо завершённая помощь", output: "Следующее использование либо причины отказа", consumer: "churn-review", nature: "probabilistic", unknown: "Механики возвращения не утверждены; сообщения не отправляются." },
  { id: "churn-review", direction: "support", code: "SUP.3", name: "Разбор ухода и причин неудовлетворённости", input: "Фактический уход или отказ и доступные свидетельства", output: "Причины с уровнем доказательности и предложения проверки", consumer: "product-hypotheses", nature: "mixed", unknown: "Не путать отсутствие активности с доказанной причиной ухода." },
  { id: "product-hypotheses", direction: "product", code: "PRD.1", name: "Рассмотрение гипотез и приоритетов продукта", input: "Исследования, жалобы, использование и экономика", output: "Предложения требований с основаниями для решения", consumer: "product-design", nature: "mixed", unknown: "Приоритеты выбирает владелец через существующие решения, не автоматически." },
  { id: "product-design", direction: "product", code: "PRD.2", name: "Проектирование сценариев, требований и интерфейса", input: "Принятые цели и ограничения", output: "Проверяемые сценарии, требования и дизайн", consumer: "development", nature: "mixed", unknown: "Критерии UX, доступности и согласования дизайна." },
  { id: "product-impact", direction: "product", code: "PRD.3", name: "Проверка эффекта продуктовых изменений", input: "Выпущенное изменение и сопоставимые метрики", output: "Наблюдаемый эффект с ограничениями причинного вывода", consumer: "goal-review", nature: "mixed", unknown: "План измерения и пороги эффекта ещё не согласованы." },
  { id: "development", direction: "engineering", code: "ENG.1", name: "Реализация согласованных требований", input: "Принятые требования и критерии готовности", output: "Изменение с проверками и документированными ограничениями", consumer: "quality", nature: "mixed", unknown: "Конкретные исполнители и права записи не назначены." },
  { id: "quality", direction: "engineering", code: "ENG.2", name: "Проверка качества и безопасности", input: "Изменение, угрозы и сценарии использования", output: "Проверки, дефекты и основание допуска к выпуску", consumer: "release", nature: "mixed", unknown: "Контуры тестов, риск-порог и приёмка требуют решения." },
  { id: "release", direction: "engineering", code: "ENG.3", name: "Управляемый выпуск и откат", input: "Принятое изменение и отдельное разрешение на выпуск", output: "Зафиксированный выпуск либо отказ с причиной", consumer: "reliability", nature: "deterministic", unknown: "Этот процесс только описан; публикация не запускается." },
  { id: "reliability", direction: "engineering", code: "ENG.4", name: "Доступность, инциденты и восстановление", input: "Сигналы состояния и подтверждённые инциденты", output: "Восстановление, разбор причин и меры предупреждения", consumer: "company-corrections", nature: "mixed", unknown: "Цели доступности, аварийные полномочия и доступы." },
  { id: "billing", direction: "finance", code: "FIN.1", name: "Начисления и условия оплаты", input: "Условия предложения и события использования", output: "Проверяемое основание начисления", consumer: "payments", nature: "deterministic", unknown: "Тарифы, налоги и юридические правила не определяются этой структурой." },
  { id: "payments", direction: "finance", code: "FIN.2", name: "Оплата, возвраты и исключения платежей", input: "Начисление, условие покупки, подтверждённый платёж или запрос возврата", output: "Фактический платёжный статус или решение о возврате", consumer: "task-service", nature: "mixed", unknown: "Оплата до/после услуги, пробный доступ и права возврата открыты." },
  { id: "finance-reconcile", direction: "finance", code: "FIN.3", name: "Учёт расходов и сверка событий всего клиентского пути", input: "Расходы до покупки, использование, платежи и возвраты", output: "Сверенные расходы и денежные события, расхождения отдельно", consumer: "budget", nature: "deterministic", unknown: "Источники первичных данных, валюта, период и политика сверки." },
  { id: "budget", direction: "finance", code: "FIN.4", name: "Экономика, бюджет и прогноз", input: "Сверенный учёт и явно обозначенные допущения", output: "Сценарные бюджеты и прогнозы для решения владельца", consumer: "goal-review", nature: "mixed", unknown: "Бюджеты и доходность не утверждены; прогноз не факт." },
  { id: "role-design", direction: "team", code: "ORG.1", name: "Выведение должностей из действий и результатов", input: "Действия, клиенты результатов и требования качества", output: "Предложения обязанностей, навыков, ценностей и полномочий", consumer: "crew-equipment", nature: "mixed", unknown: "Не совмещать специализированные роли ради экономии." },
  { id: "crew-equipment", direction: "team", code: "ORG.2", name: "Оснащение Crew и проверка исполнителей", input: "Принятый паспорт роли, процедуры и тесты", output: "Подтверждённая готовность либо список блокеров", consumer: "access-review", nature: "mixed", unknown: "В этом этапе нет подключения исполнителей, SDK или платных API." },
  { id: "access-review", direction: "team", code: "ORG.3", name: "Согласование, учёт и отзыв доступов", input: "Необходимые ресурсы, ограничения и полномочия", output: "Решение о доступе и условия отзыва", consumer: "knowledge", nature: "mixed", unknown: "Описанная роль не даёт реальных прав; согласование отдельно." },
  { id: "knowledge", direction: "team", code: "ORG.4", name: "Процедуры, база знаний и актуальность", input: "Принятые правила, результаты проверок и изменения", output: "Версионированные процедуры с источниками и потребителями", consumer: "goal-review", nature: "mixed", unknown: "Владельцы актуальности и циклы пересмотра не назначены." },
  { id: "goal-review", direction: "control", code: "CTL.1", name: "Контроль утверждённых целей и правил", input: "Утверждённые цели и фактические результаты направлений", output: "Отклонения, причины и предложения владельцу", consumer: "strategy-review", nature: "mixed", unknown: "Цели и пороги контроля должны быть отдельно утверждены." },
  { id: "company-corrections", direction: "control", code: "CTL.2", name: "Разбор межотдельных сбоев и приёмка исправлений", input: "Возвраты результатов, инциденты и противоречия", output: "Принятые исправления либо эскалация", consumer: "strategy-review", nature: "mixed", unknown: "Критерии межотдельной приёмки и сроки эскалации." },
  { id: "strategy-review", direction: "control", code: "CTL.3", name: "Сводная отчётность и предложения пересмотра стратегии", input: "Жалобы, использование, экономика и изменения конкурентов", output: "Предложения с основаниями для существующего механизма решений", consumer: "owner", nature: "mixed", unknown: "Существующий механизм решений сохраняется; автоматического выбора стратегии нет." },
];

export function buildCompanyStructure(previous: OperatingData): OperatingData {
  if (previous.companyStructureVersion) return previous;
  const data = structuredClone(previous);
  const originalIds = new Set(data.nodes.map(n => n.id));
  const add = (node: WorkNode) => {
    if (data.nodes.some(n => n.id === node.id || n.code === node.code)) throw new Error("Company structure identity/code collision; reconcile owner edits");
    data.nodes.push(node); return node;
  };
  const existing = (id: string) => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw new Error("Expected saved object missing; do not recreate");
    return n;
  };
  const create = (id: string, code: string, name: string, kind: WorkNode["kind"], parent: string | null, extra: Partial<WorkNode> = {}) =>
    add({ ...emptyWorkNode(id, code, name, kind, parent), ...extra });
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => {
    if (data.links.some(l => l.from === from && l.to === to && l.kind === kind)) return;
    data.links.push({ id: `company:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  for (const id of ["mission", "owner", "search", "b2c", "b2b", "need", "capability", "research-dept"]) existing(id);
  create("company-strategy", "STR", "Стратегия TalkHint: владелец, миссия, цели и границы", "context", null, {
    level: "strategy", status: "agreed", detailState: "outlined", clientId: "owner", purpose: "Сохранить миссию и границы владельца; рассматривать предложения на основании данных.",
    description: "Трёхуровневая структура согласована. Новые бизнес-цели и самостоятельные полномочия AI не утверждены.",
    referenceIds: ["TH-PRODUCT"], questions: "Цели, метрики, горизонты, допустимые риски и полномочия необходимо согласовать.",
    rules: "Стратегические решения принимает Сергей через существующий механизм решений. Структура не запускает сотрудников.",
  });
  existing("mission").parentId = "company-strategy";
  existing("owner").parentId = "company-strategy";
  create("company-goals", "STR.G", "Цели, показатели и границы — для согласования", "context", "company-strategy", {
    purpose: "Место для целей владельца без выдуманного утверждения.", clientId: "owner", detailState: "outlined",
    questions: "Количественные цели, срок и самостоятельные права AI CEO не заданы.",
    constraints: "Без публикации, внешних действий и активных сотрудников в рамках текущего этапа.",
  });
  create("ai-ceo", "CEO", "AI CEO — проектируемая роль", "role", "company-strategy", {
    managerId: "owner", detailState: "outlined", clientId: "owner",
    purpose: "Собирать данные, готовить стратегические предложения, распределять утверждённые цели и контролировать результаты в согласованных полномочиях.",
    constraints: "Самостоятельные полномочия, доступы и реальные исполнения не утверждены. Не изменяет стратегию автоматически.",
    questions: "Границы делегирования и критерии контроля будут согласованы отдельно.",
  });
  create("personal-customer", "CLI.B2C", "Частный пользователь — клиент услуги", "client", "company-strategy", { detailState: "outlined", description: "Тип клиента, не реальный контакт. Сегмент и спрос не подтверждены." });
  create("business-customer", "CLI.B2B", "Самозанятый / владелец бизнеса — клиент услуги", "client", "company-strategy", { detailState: "outlined", description: "Тип клиента; рабочие полномочия и покупка требуют отдельной проверки." });
  for (let i = 0; i < directions.length; i++) {
    const [id, name, purpose, role, consumer, unknown] = directions[i];
    create(`dir-${id}`, `T${String(i + 1).padStart(2, "0")}`, name, "department", "company-strategy", {
      level: "direction", status: "agreed", detailState: "outlined", purpose, clientId: `dir-${consumer}`, roleId: `head-${id}`, acceptorId: "ai-ceo",
      description: "Название и место направления согласованы. Предложенные процессы, должности и доступы не являются утверждёнными исполнителями.",
      inputs: [{ name: "Цели владельца и подтверждённые данные связанных направлений", sourceId: "company-goals", freshness: "При изменении оснований; период ещё не согласован" }],
      questions: unknown, rules: "Предложения передаются на рассмотрение; полномочия и доступы согласуются отдельно.",
      constraints: "Нет действующего отдела, подключённого Crew или фонового исполнения.",
    });
    create(`head-${id}`, `HEAD.${String(i + 1).padStart(2, "0")}`, role, "role", `dir-${id}`, {
      managerId: "ai-ceo", detailState: "outlined", clientId: "ai-ceo", purpose: `Предлагаемая ответственность за результаты направления «${name}».`,
      questions: "Обязанности, навыки, ценности, лимиты и права будут выведены из действий.", constraints: "Проектируемая должность, не работающий сотрудник.",
    });
    create(`dir-report-${id}`, `REP.${String(i + 1).padStart(2, "0")}`, `Отчёт направления: ${name}`, "report", `dir-${id}`, {
      detailState: "outlined", clientId: "ai-ceo", recipientId: "strategy-review", acceptorId: "owner", roleId: `head-${id}`,
      purpose: "Результаты, отклонения, основания, неизвестное и предложения без автоматического решения.",
      storage: "Существующая модель владельца и история", delivery: "Проектируемая доставка в рабочем пространстве; не внешняя отправка.",
      questions: "Автор-исполнитель и периодичность не согласованы.",
    });
    link(`dir-${id}`, `dir-report-${id}`, "produces", "Сводный результат направления для контроля и следующего потребителя");
    link(`dir-report-${id}`, `dir-${consumer}`, "handoff", "Содержательный результат, не подчинение");
    link(`dir-report-${id}`, "strategy-review", "handoff", "Данные для сводной отчётности");
  }
  for (const p of processes) {
    let n = data.nodes.find(n => n.id === p.id);
    if (n) {
      // Preserve code/name/description and all existing substantive fields, reparent only.
      n.parentId = `dir-${p.direction}`;
      n.level = "operation"; n.detailState = p.id === "search" ? "described" : "outlined";
      n.roleId ??= `head-${p.direction}`; n.clientId ??= p.consumer;
      n.purpose ||= p.name; n.questions ||= p.unknown;
      if (!n.inputs.length) n.inputs.push({ name: p.input, sourceId: "company-goals", freshness: "Версия согласованных оснований" });
      n.workNature = p.nature; n.marketEffect = "Выполнение процесса не доказывает рыночный эффект или покупку.";
    } else {
      n = create(p.id, p.code, p.name, "process", `dir-${p.direction}`, {
        level: "operation", detailState: "outlined", purpose: p.name, clientId: p.consumer, roleId: `head-${p.direction}`, acceptorId: `head-${p.direction}`,
        inputs: [{ name: p.input, sourceId: `dir-${p.direction}`, freshness: "Актуальные разрешённые сведения; период уточнить" }],
        questions: p.unknown, workNature: p.nature, marketEffect: "План и выполнение не гарантируют спрос, конверсию или удержание.",
        constraints: "Крупный проектируемый процесс; ежедневные мини-действия не декомпозированы и исполнители не подключены.",
      });
    }
    const outputId = p.id === "search" ? "decision" : `out-${p.id}`;
    if (p.id !== "search") create(outputId, `${p.code}.OUT`, p.output, "result", p.id, {
        detailState: "outlined", clientId: p.consumer, recipientId: p.consumer, acceptorId: `head-${p.direction}`, storage: "Общая модель и история; фактические результаты ещё не получены",
      });
    link(p.id, outputId, "produces", p.id === "search" ? "Существующий итог B2C.R без копии результата" : "Предлагаемый выход крупного процесса");
    link(outputId, p.consumer, "handoff", "Следующий потребитель результата; не линия руководства");
    link(p.id, `dir-report-${p.direction}`, "produces", "Основание отчёта направления");
  }
  existing("research-dept").parentId = "dir-market";
  existing("need").parentId = "search";
  existing("capability").parentId = "search";
  existing("business-search").parentId = "search";
  // Existing mini-actions and their content remain intact, including B2C.1.1.
  for (const n of data.nodes) {
    if (originalIds.has(n.id) && n.kind === "role") n.managerId = "head-market";
  }
  for (const n of data.nodes.filter(n => n.kind === "crew")) n.parentId ??= "dir-market";
  for (const n of data.nodes.filter(n => n.kind === "resource")) n.parentId ??= "dir-team";
  const monitor = existing("competitor-monitor");
  if (data.nodes.some(n => n.id === "benchmark-role-reference")) {
    monitor.roleId = "benchmark-role-reference";
    monitor.referenceIds.push("benchmark-role-reference");
  }
  const path = [
    ["acquire", "Привлечение", "b2c", "Личные потребности и языковая поддержка", "Бизнес-потребности; параллельный процесс B2B", ""],
    ["intake", "Приём обращения", "intake", "Уточнить личную задачу", "Уточнить бизнес-задачу и полномочия представителя", ""],
    ["choose", "Выбор предложения", "proposal-choice", "Понятное предложение для личного использования", "Условия для самостоятельной работы / бизнеса", "Тарифы и различия пока не утверждены"],
    ["connect", "Регистрация / подключение", "onboarding", "Личный профиль и необходимые согласия", "Рабочий контекст, доступы и согласия отдельно", "Рабочий/личный контекст нельзя смешивать"],
    ["pay", "Оплата при необходимости", "payments", "Платит сам человек", "Платит владелец / уполномоченное лицо — уточнить", "Момент оплаты и пробный режим открыты; возможен переход без оплаты на этом этапе"],
    ["deliver", "Оказание услуги", "task-service", "Личное поручение в разрешённых пределах", "Рабочее поручение и разрешённые данные бизнеса", "Только фактически поддержанные функции, не вся целевая концепция"],
    ["help", "Поддержка", "support-intake", "Помощь по личному использованию", "Помощь по рабочему использованию и доступам", "При возникновении проблемы; не обязательная жалоба каждого клиента"],
    ["repeat", "Повторное использование", "repeat-use", "Следующая личная потребность", "Повторные рабочие задачи", "Ветка при продолжении использования"],
    ["leave", "Разбор ухода", "churn-review", "Причина отказа неизвестна без свидетельств", "Причина ухода бизнеса отдельно от личного использования", "Альтернатива повторному использованию, не обязательный следующий шаг"],
  ];
  data.customerPath = path.map(([id, name, processId, b2c, b2b, condition]) => ({
    id, name, processId, b2c, b2b, condition, ...(id === "acquire" ? { b2bProcessId: "b2b" } : {}),
  }));
  for (let i = 1; i < path.length - 1; i++) link(path[i - 1][2], path[i][2], "handoff", "Планируемая передача по клиентскому пути, с условием этапа");
  link("b2b", "intake", "handoff", "Вход B2B в общий путь с отдельным рабочим контекстом");
  link("onboarding", "task-service", "handoff", "Если оплата на этом этапе не нужна; правило пока открыто");
  link("task-service", "repeat-use", "handoff", "При успешном использовании без обращения в поддержку");
  link("repeat-use", "task-service", "handoff", "Следующее поручение");
  link("support-intake", "churn-review", "handoff", "Альтернатива: уход после проблемы");
  for (const source of [...path.map(p => p[2]), "b2b", "campaigns", "competitor-monitor", "development", "crew-equipment", "usage-accounting"])
    link(source, "finance-reconcile", "finance_event", source === "campaigns" ? "Расходы до покупки; не ждать продажи" : source === "churn-review" ? "Возвраты, остаточные обязательства и расходы после ухода при наличии" : "Разрешённые фактические события, расход или платёж; неизвестное не равно нулю");
  for (const source of ["support-intake", "usage-accounting", "budget", "competitor-monitor", "churn-review"]) {
    link(source, "product-hypotheses", "feedback", "Основание для пересмотра продукта, не автоматическое изменение");
    link(source, "strategy-review", "feedback", "Предложение пересмотра тактики и стратегии через существующее рассмотрение");
  }
  link("strategy-review", "company-strategy", "feedback", "Предложения → существующий механизм решений → решение Сергея; без автоматической стратегии");
  link("strategy-review", "dir-acquisition", "feedback", "Предложение пересмотра тактики, только после решения");
  const incoming: Record<string, [string, string][]> = {
    market: [["support-intake", "Проблемы и жалобы"], ["competitor-monitor", "Изменения конкурентов"]],
    acquisition: [["dir-report-market", "Исследования аудитории"], ["proposal-choice", "Условия предложения"]],
    sales: [["b2c", "Личные обращения"], ["b2b", "Бизнес-обращения"]],
    service: [["onboarding", "Подключение и разрешённый контекст"], ["payments", "Платёжный статус, если требуется"]],
    support: [["service-results", "Фактические результаты услуги"], ["churn-review", "Свидетельства ухода"]],
    product: [["dir-report-market", "Исследования"], ["support-intake", "Жалобы"], ["budget", "Экономика"]],
    engineering: [["product-design", "Принятые требования"]],
    finance: [["campaigns", "Расходы до покупки"], ["usage-accounting", "Использование"], ["payments", "Платежи и возвраты"]],
    team: [["role-design", "Требования к должностям"], ["quality", "Результаты проверок"]],
    control: [["goal-review", "Отклонения целей"], ["company-corrections", "Межотдельные сбои"]],
  };
  for (const [direction, inputs] of Object.entries(incoming)) {
    existing(`dir-${direction}`).inputs.push(...inputs.map(([sourceId, name]) => ({
      sourceId, name, freshness: "Датированные события / текущая принятая версия; периодичность уточнить",
    })));
  }
  data.companyStructureVersion = 1;
  data.stageReports.push({
    pass: 1, described: "Верхняя картина: стратегия, десять тактических направлений, крупные операционные процессы и отдельный клиентский путь.",
    boundary: "Процессы — предложения, не завершённая детализация компании. B2C.1.1 не углубляли.",
    dependencies: "Миссия и прежние материалы сохранены; должности имеют отдельную единственную линию руководства.",
    gaps: "Цели, полномочия, бюджеты, расписания и большинство подробных процедур ещё не согласованы.",
    next: "Согласовать границы направлений и путь клиента, затем раскрывать по одному процессу: исследования → привлечение → начало использования → услуга → поддержка.",
  });
  return data;
}
