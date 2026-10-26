import type { ProjectModelState, ModelCommand } from "../../../shared/projectModel";
import type { OperatingData, WorkNode } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { actionDirection, actionOutputs, approvalNames, effortMinutes, levelNames, defaultRegister } from "../../../shared/actionRegister";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { structureFirstTitle } from "./structureFirstContent";
import { crewRoadmapId } from "./crewRoadmapContent";
export const registerRoadmapTitle = "TalkHint — единый roadmap работы crew над продуктом — v4 — реестр действий";
const marker = "<!-- COMPANY-ACTION-REGISTER-V1 -->";
const source = "https://lingvanex.com/products/phone-call-translator/";
const rows = [
  ["scan", "MKT.2.1", "Отслеживать конкурентов и изменения", "benchmark-role-reference", "Раз в неделю; отдельный сигнал об изменении — вне очереди после согласования", "Журнал изменений со ссылками и датами", "existing", "competitor-monitor"],
  ["verify", "MKT.2.2", "Проверять источники и реальные возможности", "benchmark-role-reference", "На каждую существенную находку; повторная проверка перед продуктовым выводом", "Пакет оснований, противоречий и неизвестного", "existing", "competitor-monitor"],
  ["compare", "MKT.2.3", "Сравнивать сценарий конкурента с TalkHint", "benchmark-role-reference", "После проверки каждой релевантной находки", "Сравнение одинакового сценария: работает / заявлено / планируется / неизвестно", "existing", "competitor-monitor"],
  ["propose", "MKT.2.4", "Формировать предложения продукту", "benchmark-role-reference", "При подтверждённом отличии или существенном пробеле", "Предложение проверки или изменения, связанное с проблемой и основанием", "existing", "competitor-monitor"],
  ["handoff", "MKT.2.5", "Передавать предложение на продуктовое рассмотрение", "benchmark-role-reference", "На каждую подготовленную версию предложения", "Переданный пакет с получателем и запросом обратной связи", "existing", "competitor-monitor"],
  ["followup", "MKT.2.6", "Отслеживать решение и обратную связь", "benchmark-role-reference", "Раз в неделю по открытым передачам; срок каждой работы согласовать отдельно", "Ссылка на фактическое решение / возврат / открытый вопрос и следующий шаг", "existing", "competitor-monitor"],
  ["support", "SUP.1.1", "Разобрать обращение пользователя для продуктовой оценки", "product-support-specialist", "При реально полученном обращении пользователя", "Обращение с потребностью, свидетельством, ограничениями и ответственным", "Не смешивать пользовательские сообщения с исследованием конкурентов; независимый вход улучшений.", "support-intake"],
  ["product", "PRD.1.1", "Рассмотреть поступившее основание улучшения продукта", "product-manager-specialist", "При передаче от бенчмаркинга либо поддержки", "Предложение решения владельцу или обоснованный запрос доработки", "Нужен общий получатель двух независимых потоков и прослеживаемая обратная связь.", "product-hypotheses"],
] as const;
const c = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
function registerTable(data: OperatingData) {
  const map = new Map(data.nodes.map(n => [n.id, n]));
  return [
    "| Действие / ID | Направление | Уровень | Должность | Периодичность / триггер | Доступность | Объём / период | Мин/операцию | Трудозатраты | Результат | Согласование |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...data.nodes.filter(n => n.kind === "action").map(n => {
      const r = n.register, minutes = effortMinutes(n);
      return `| ${[
        `${n.code} ${n.name} (${n.id})`, actionDirection(data, n)?.code ?? "Не определено",
        n.level ? levelNames[n.level] : "Не определён", map.get(n.roleId ?? "")?.name ?? "Не назначена",
        n.schedule.trigger || "Не задано", r?.availability || "Не определена",
        r?.operationsPerPeriod == null ? "Оценить" : `${r.operationsPerPeriod} / ${r.period || "период уточнить"}`,
        r?.minutesPerOperation == null ? "Оценить" : String(r.minutesPerOperation),
        minutes === null ? "Нет оценки" : `${minutes} мин / ${r!.period}`,
        actionOutputs(data, n.id).map(n => `${n.code}: ${n.name}`).join("; ") || "Не описан",
        r ? approvalNames[r.approval] : "Нет отдельной приёмки",
      ].map(c).join(" | ")} |`;
    }),
  ].join("\n");
}
export function prepareActionRegister(root: ProjectModelState, actor: string, checkedAt: string): ProjectModelState {
  const before = readHypothesis(root, "new-country");
  const doc = before.documents.find(d => d.title === registerRoadmapTitle || d.title === structureFirstTitle);
  const rev = before.operatingModel?.revisions.at(-1);
  if (!doc || !rev) throw Error("Existing single roadmap v3 and model required");
  if (doc.text.includes(marker)) return root;
  const data = structuredClone(rev.data);
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw Error(`Missing existing object: ${id}`);
    return n;
  };
  for (const id of ["competitor-monitor", "support-intake", "product-hypotheses", "benchmark-role-reference", "product-manager-specialist", "product-support-specialist", "lg-technical-role", "lg-qa-role"]) get(id);
  const idFor = (key: string) => `company-action-${key}`;
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => {
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `register:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  for (const [key, code, name, role, trigger, output, reason, parent] of rows) {
    if (data.nodes.some(n => n.id === idFor(key) || n.code === code)) throw Error(`Existing action requires reconciliation, not duplication: ${code}`);
    const n = emptyWorkNode(idFor(key), code, name, "action", parent);
    const isSuggestion = reason !== "existing";
    Object.assign(n, {
      level: "operation", detailState: "described", status: "proposal", roleId: role,
      clientId: "product-manager-specialist", recipientId: "product-manager-specialist",
      // Owner retains approval; product sufficiency acceptance is only a proposal.
      acceptorId: "owner", resourceIds: ["model-resource", "search-resource"],
      purpose: "Дать продукту прослеживаемое основание выбора следующей проверки с пользой для пользователя TalkHint.",
      description: "Черновик действий по переданному поручению, не утверждённые обязанности или запущенный исполнитель.",
      schedule: { days: [], hours: "", timezone: "", trigger: `Предложение: ${trigger}`, deadline: "Назначается каждой работе после согласования" },
      procedure: `${name}. Сохранить источник, дату, тип свидетельства, связанный сценарий и ограничение. Результат — ${output}. Не заменять отсутствие данных предположением. Передать следующему потребителю и зафиксировать фактический ответ.`,
      rules: "Неизвестное не равно нулю или отсутствию функции. Заявление разработчика отдельно от нашего теста. Одинаковый сценарий сравнения; не переносить возможности с другой функции. Должность — не экземпляр AI-агента.",
      constraints: "Без реальных звонков, платных тестов, выпуска, автономного исполнения и новых полномочий. Приёмка обычного исследования продуктом и эскалация руководителю остаются предложением до решения Сергея.",
      success: "Есть полезный получателю выход, датированные основания, ограничения, получатель и фактическая запись приёмки/возврата. Передача и молчание не равны принятию. Сейчас результат лишь спроектирован.",
      storage: "Та же операционная модель new-country и её ревизии.",
      delivery: "Карточка результата и типизированная связь передачи; внешняя отправка не включена.",
      exceptions: "Источник противоречив или существенный риск — запрос независимой проверки техническому специалисту/QA по необходимости, не постоянная дополнительная роль.",
      questions: "Согласовать периодичность, режим доступности, объём/время, границы обязанности и приёмки. Часовой пояс и сроки не назначены.",
      register: { ...defaultRegister(), period: key === "scan" || key === "followup" ? "неделя" : "на одну входящую работу",
        availability: "Предложение: пакетная работа; не постоянное дежурство, часы и часовой пояс согласовать",
        approval: isSuggestion ? "draft" : "discussion",
        source: "Переданное через чат поручение Сергея: реестр действий и первый разбор MKT.2",
        estimateBasis: "Объём и минуты пока не измерены и не оценены. Доступность не равна активной обработке.",
        proposalReason: isSuggestion ? `Предложение Replit: ${reason}` : "" },
    });
    const r = emptyWorkNode(`${n.id}-result`, `${code}.R`, output, "result", n.id);
    Object.assign(r, { status: "proposal", description: "Спроектированный выход; выполненная работа не подтверждена.",
      clientId: n.clientId, recipientId: n.recipientId, acceptorId: "owner", storage: n.storage });
    data.nodes.push(n, r);
    link(n.id, r.id, "produces", "Требуемый результат действия, не выполненный запуск");
  }
  const chain = ["scan", "verify", "compare", "propose", "handoff", "followup"];
  for (let i = 0; i < chain.length; i++) {
    const n = get(idFor(chain[i]));
    const consumer = i + 1 < chain.length ? idFor(chain[i + 1]) : "product-manager-specialist";
    n.nextId = consumer;
    if (i < 3) n.clientId = "benchmark-role-reference";
    const result = get(`${n.id}-result`);
    result.clientId = n.clientId;
    result.recipientId = consumer; result.nextId = consumer;
    n.inputs = [{ name: i ? "Результат предыдущего действия и его основания" : "Существующие карточки конкурентов, история изменений и реально переданные находки",
      sourceId: i ? `${idFor(chain[i - 1])}-result` : "competitor-monitor",
      freshness: "Дата публикации/данных и дата проверки; актуальность проверяется вручную" }];
    if (i) link(n.id, `${idFor(chain[i - 1])}-result`, "requires", "Вход имеет источник");
    link(result.id, consumer, "handoff", "Следующий потребитель результата; не линия подчинения");
  }
  const verify = get(idFor("verify"));
  verify.description += `\nПример — совместный разговор владельца и секретаря. Перепроверено ${checkedAt}: ${source} заявляет “You see the transcript live and can step in at any moment”. Это заявление разработчика, не наш живой тест. Не доказаны одновременная речь AI и владельца, механизм вмешательства, продолжение текущего звонка против перевода/нового звонка. Исходное обсуждение — основание проверки, не подтверждение реализации.`;
  verify.questions += "\nКак устроено вмешательство владельца: одновременный разговор, перехват, перевод или новый звонок? Что слышат стороны? Нужны документация/разрешённый ручной тест.";
  verify.referenceIds.push(doc.id);
  const compare = get(idFor("compare"));
  compare.procedure += " Для TalkHint отдельно проверить текущую архитектуру и ограничения через P.LG.TECH; QA подключать по риску. Не называть работающим то, что только описано.";
  const support = get(idFor("support")), product = get(idFor("product"));
  support.inputs = [{ name: "Фактически переданное обращение и разрешённые свидетельства", sourceId: "support-intake", freshness: "Дата обращения; не выдумывать доступ к будущим чатам" }];
  support.nextId = product.id;
  link(`${support.id}-result`, product.id, "handoff", "Независимый пользовательский вход, не обязательное исследование конкурентов");
  link(`${idFor("handoff")}-result`, product.id, "handoff", "Независимый вход из бенчмаркинга");
  product.inputs = [
    { name: "Пакет бенчмаркинга при наличии", sourceId: `${idFor("handoff")}-result`, freshness: "Версия источников; один из альтернативных входов" },
    { name: "Обращение пользователя при наличии", sourceId: `${support.id}-result`, freshness: "Датированное сообщение; один из альтернативных входов" },
  ];
  product.procedure += " Входы альтернативные: не требовать обращения пользователя для исследования конкурента и наоборот. Проверить связи/дубли, потребность и технические ограничения, подготовить предложение Сергею. Не принять его за владельца автоматически.";
  product.nextId = "owner";
  const pr = get(`${product.id}-result`); pr.recipientId = "owner"; pr.nextId = "owner";
  link(pr.id, "owner", "acceptance", "Запрос решения владельца, не доказательство приёмки");
  link(pr.id, idFor("followup"), "feedback", "Фактическое решение/возврат/пробел возвращается инициатору");
  const roadmap = get(crewRoadmapId);
  roadmap.nextId = idFor("scan");
  roadmap.description = "Единый roadmap v4. Сначала описание всей структуры, затем отдельное будущее подключение исполнителей. Согласован способ ведения реестра, не содержание всех карточек. Первый совместный разбор — MKT.2.1. B2C.1.1 сохранена, аудитория не выбрана.";
  roadmap.questions = "Согласовать MKT.2.1: полезный результат наблюдения, список источников, периодичность и границы ответственности.";
  get("crew-roadmap-phase-2").nextId = idFor("scan");
  get("crew-roadmap-phase-2").description = "Описание всей компании продолжается. Текущий участок — бенчмаркинг MKT.2; шесть действий к обсуждению, две смежные обязанности — предложения Replit. Исполнители не запускаются.";
  data.stageReports.push({ pass: 2, described: "Реестр действий в общей модели: шесть черновиков MKT.2 и два предложения смежных действий, два самостоятельных входа улучшений.",
    boundary: "Согласован только способ ведения; карточки, периодичность, объёмы, полномочия и сроки не утверждены.",
    dependencies: "Обсуждение MKT.2.1 с Сергеем; фактические последующие сообщения передавать явно.",
    gaps: "Объём/время неизвестны. Одновременный разговор владельца с AI не доказан первичным источником.",
    next: "Уточнить и согласовать MKT.2.1, проверить выход и передачу MKT.2.2; затем следующий незакрытый пункт." });
  let text = doc.text.replace("# Единый roadmap TalkHint — версия 3", "# Единый roadmap TalkHint — версия 4")
    .replace("**Первым обсуждаем существующую B2C.1.1 (ID criteria).**", "**Первым обсуждаем MKT.2.1, бенчмаркинг внутри развития. B2C.1.1 сохранена без выбранной аудитории.**")
    .replace("T01 (MKT.1 → MKT.2 → MKT.3)", "T01 (сейчас MKT.2, затем возвращаемся к незакрытым MKT.1/MKT.3)");
  const start = text.indexOf("## 10."), end = text.indexOf("## 11.");
  if (start < 0 || end < start) throw Error("Existing roadmap section anchors changed");
  text = text.slice(0, start) + `## 10. Реестр действий — согласованный способ, карточки для обсуждения
${marker}
Одна строка — существующее действие из общей модели. Отдел, роль и результаты выводятся по её связям. Таблица в вебе интерактивная; таблица документа — снимок этой ревизии, не второй редактируемый каталог.
Согласовано владельцем через переданное сообщение: вести действия, обязанности, результаты и оценки в едином реестре с историей. Содержание карточек и периодичность ниже — предложения.
Трудозатраты = число операций × минуты на операцию за явно заданный период. Нет объёма/времени/периода — нет оценки, не ноль. Нельзя складывать разные периоды. Доступность/ожидание не равны активной работе или загрузке.
Фильтр по должности показывает её действия; он не создаёт назначения агента. Новое действие сначала сопоставляется с обязанностями существующей роли; новую роль можно предложить с причиной, но не назначить автоматически.
${registerTable(data)}

### Два самостоятельных входа улучшений
Исследования конкурентов → MKT.2.1–MKT.2.6 → продуктовое рассмотрение.
Обращения пользователей → SUP.1 → продуктовое рассмотрение, без обязательного предварительного бенчмаркинга.
PRD.1 связывает основания с потребностью и решением; выпуск, расходы, внешние действия и стратегия остаются владельцу до явного делегирования.

### Находка для проверки: владелец и секретарь в разговоре
Источник ${source}, перепроверено ${checkedAt}. Цитата: “You see the transcript live and can step in at any moment”.
Статус: официально заявлено. Это подтверждает заявление о вмешательстве владельца, но НЕ доказывает совместный одновременный разговор, механизм переключения или продолжение того же звонка. Наш тест не проведён. MKT.2.2 получает открытый вопрос; не записывать его как готовую возможность TalkHint.

### Предложения Replit — отдельно от договорённостей
- SUP.1.1: выделить подготовку пользовательского обращения как самостоятельное действие; причина — иначе исследовательский поток скрывает самостоятельный клиентский вход.
- PRD.1.1: выделить рассмотрение двух потоков одним получателем; причина — нужен прослеживаемый переход от основания к продуктовому предложению и обратной связи.
- Для сравнения текущих возможностей привлекать существующего технического специалиста, а по риску QA; причина — маркетинговое заявление не подтверждает реализацию и совместимость. Новые полномочия не утверждены.
- Гипотеза продукта: исследовать безопасное вмешательство владельца в разговор Secretary; причина — ранее обсуждавшаяся находка. Не решение внедрять и не разрешение менять телефонию.
Все предложения имеют источник и причину в register.proposalReason/description либо в этом разделе. Утверждение — только отдельное решение владельца по версии.

### Как передавать следующие решения
Зафиксировано только реально доставленное в этот проект сообщение. Автоматического доступа к будущим разговорам ChatGPT нет.
Из ChatGPT передать через подключённый Product Crew конкретное поручение/решение с кодом действия, текстом изменения и статусом; проверить ответ сервера с ревизией. Если инструмент недоступен — прислать сообщение в этот чат. Пока ответ о сохранении не получен, не считать решение записанным.
Согласованный цикл: один пункт → обсуждение → фиксация принятого → повторное чтение/проверка связей → следующий незакрытый пункт.
Текущий следующий шаг: обсудить MKT.2.1 и предложенный еженедельный обзор; сроки, объём и минуты не утверждены.

` + text.slice(end);
  if (text.length > 50000) throw Error(`Roadmap text exceeds capacity: ${text.length}`);
  let next = root;
  const command = (c: ModelCommand) => { next = applyHypothesisCommand(next, "new-country", c, actor); };
  command({ type: "saveDocument", id: doc.id, title: registerRoadmapTitle, text, url: doc.url, elementIds: doc.elementIds });
  command({ type: "saveOperatingModel", baseVersion: rev.version, data });
  return next;
}
