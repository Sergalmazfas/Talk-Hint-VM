import type { ProjectModelState, ModelCommand } from "../../../shared/projectModel";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { crewSetupTitle } from "./crewSetup";
import { crewRoadmapId } from "./crewRoadmapContent";
import { nextStructureQuestion, structureFirstDocument, structureFirstMarker, structureFirstTitle } from "./structureFirstContent";

/** Explicit Dev content update: keep the one roadmap, node IDs and past revisions. */
export function prepareStructureFirst(root: ProjectModelState, actor: string): ProjectModelState {
  const before = readHypothesis(root, "new-country");
  const revision = before.operatingModel?.revisions.at(-1);
  if (!revision) throw Error("Existing operating model required");
  const doc = before.documents.find(d => d.title === structureFirstTitle || d.title === crewSetupTitle);
  if (!doc) throw Error("Existing roadmap v2 required; do not create another roadmap");
  if (doc.text.includes(structureFirstMarker)) return root; // Never replay over later owner edits.
  const data = structuredClone(revision.data);
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw Error(`Existing identity missing: ${id}`);
    return n;
  };
  const card = get("criteria"), result = get("criteria-result");
  Object.assign(card, {
    status: "proposal", detailState: "described", clientId: "discover", roleId: "research-role",
    acceptorId: "owner", recipientId: "discover", nextId: "discover",
    purpose: "Дать исследователю источников проверяемую рамку: кого и какую потребность изучать, чтобы маркетинг и продукт могли выбрать аудиторию, предложение и следующую проверку.",
    description: "Предложение к обсуждению, не утверждено Сергеем. Клиент непосредственного результата — P-02, исследователь источников; конечные внутренние клиенты MKT.1 — маркетинг и продукт. Внешняя польза: изучать реальные личные задачи приезжего и не проектировать функцию без потребности. Сегмент, страна и язык пока не выбраны.",
    inputs: [
      { name: "Целевая концепция и границы new-country", sourceId: "mission", freshness: "Актуальная версия гипотезы; концепция не доказывает готовность функций" },
      { name: "Восьмичастный стандарт результата MKT.1", sourceId: "decision", freshness: "Последняя сохранённая редакция; B2C/B2B разделять" },
      { name: "Личный опыт владельца из случая landing gear; свидетельство INFO-LG-OWNER", sourceId: "case-landing-gear-2026-10-25", freshness: "Сообщение 25.10.2026; один случай, не исследование распространённости" },
    ],
    procedure: "1. Получить от Сергея границы первой B2C-аудитории и ситуации. 2. Описать включение/исключение по стране, языку, жизненной ситуации и личной задаче. 3. Различить задачу, препятствие, нынешнее решение и желаемый результат. 4. Составить вопросы проверки частоты, последствий, альтернатив, готовности пользоваться/платить, не придумывая ответы. 5. Для каждого утверждения указать факт/сообщение/гипотезу, источник, дату и неизвестное. 6. Подготовить ограничения поиска и ожидаемые доказательства; передать исследователю источников только после согласования карточки.",
    rules: "Знания: стандарт MKT.1, сегментация B2C/B2B, различение факта и гипотезы, проверка источников и ограничения выборки. Полномочия: предлагать критерии и вопросы, читать разрешённые материалы; не утверждать стратегию и не расширять доступ. B2B-пользователь, покупатель и принимающий решение разбираются отдельно, не смешиваются с B2C.",
    constraints: "Не запускать исследование, интервью, звонки, рекламу, покупки или AI-исполнителя. Не считать опыт одного человека спросом. Не менять другие карточки и не подтверждать полномочия от имени владельца. Подключённый API не требуется для приёмки описания.",
    success: "После явного обсуждения Сергеем выбрана одна B2C-аудитория и ситуация; есть критерии включения/исключения, вопросы проверки, источники/статусы, неизвестное, выход и принимающий. Исследователь может искать свидетельства без догадок о границах. Нехватка доказательств допустима, скрытые допущения — нет. Утверждение конкретной версии фиксируется отдельно; сейчас статус proposal.",
    storage: "Существующая карточка criteria, результат criteria-result и ревизии new-country.",
    delivery: "После приёмки — criteria-result → discover; итоговое исследование MKT.1 — маркетингу и продукту.",
    schedule: { ...card.schedule, trigger: "После ответа Сергея на ближайший вопрос и согласования версии карточки", deadline: "Не согласован" },
    exceptions: "Нет ответа/противоречат источники — сохранить вопрос и вернуть Сергею; не выбирать сегмент автоматически. Замечания принимающего фиксировать в истории, затем новая редакция.",
    questions: nextStructureQuestion + "\nДалее неизвестны: ситуация первого разбора, критерии исключения, география и языки, доступные доказательства и границы будущей проверки. Срок не согласован.",
  });
  // Keep existing resources/crew references; their runtime state is not design approval.
  if (!card.resourceIds.includes("model-resource")) card.resourceIds.push("model-resource");
  if (!card.referenceIds.includes("INFO-LG-OWNER")) card.referenceIds.push("INFO-LG-OWNER");
  Object.assign(result, {
    status: "proposal", detailState: "described", clientId: "discover", recipientId: "discover",
    acceptorId: "owner", nextId: "discover",
    description: "Требуемый выход B2C.1.1, не заполненные результаты исследования: рамка одного B2C-сегмента, ситуация/задача, включение/исключение, вопросы проверки, реестр оснований и неизвестного, инструкция исследователю источников.",
    success: card.success, questions: nextStructureQuestion,
  });
  const roadmap = get(crewRoadmapId);
  Object.assign(roadmap, {
    status: "proposal", detailState: "described",
    description: "Единый roadmap v3 для обсуждения. Сначала полное описание стратегии, руководства, T01–T10, пути клиента и технических специализаций. Текущий один пункт — B2C.1.1 (criteria). Исполнители подключаются только отдельным будущим решением после приёмки всей структуры.",
    procedure: "Инвентаризация → описание всей структуры через действия/клиентов/результаты → сверка передач, ресурсов и приёмки → явная приёмка описания Сергеем → отдельно будущие подключение/пилот/регулярная работа.",
    success: "Все направления, руководство и техническая команда описаны, связи и пробелы проверены, каждая принятая версия имеет явное решение Сергея. Наличие живого AI-исполнителя не требуется.",
    nextId: card.id, questions: nextStructureQuestion,
  });
  const phases: Record<number, [string, string, string]> = {
    0: ["Инвентаризация описания", "Модель и пробелы сверены; это ручная проверка, не завершённость структуры.", "Текущее наполнение и граница детализации перечислены без потери старых материалов."],
    1: ["Описание приёма информации и передач", "Частично описано на landing gear; весь поток источников и межотдельная приёмка требуют разбора.", "Для входа указаны источник/тип/дата, ответственный, связанные работы, проверка, решение и обратная связь."],
    2: ["Полное описание компании через действия", "Каркас 10 направлений и 23 ролей есть. Следующий пункт — criteria; остальные обсуждаем последовательно.", "Описаны стратегия, CEO/руководители, T01–T10, все необходимые технические специализации; клиент/потребность/действия/результат/приёмка/полномочия прослеживаются."],
    3: ["Описание знаний, ресурсов и границ доступа", "Ресурсные профили предложены; нужны спецификации для каждой должности, без подключения.", "Каждой должности описаны знания, источники актуальности, необходимые инструменты, ограничения и получатели; подключать API не требуется."],
    4: ["Будущий этап: подключение и проверка исполнителей", "Отложен до приёмки всей структуры и отдельного разрешения владельца. Не следующий шаг.", "После отдельного решения проверены исполнитель, бюджет, доступы, отмена и результат; сейчас запуск запрещён."],
    5: ["Приёмка полноты описания структуры", "Критерии предложены; полная структура и roadmap не утверждены.", "Формальная и содержательная сверка всех ветвей, явная приёмка/возврат конкретных версий Сергеем; отсутствие live-исполнителя не блокирует описание."],
    6: ["Будущий этап: регулярное исполнение", "Отложен. Расписания и автоматический сбор не запускаются.", "Отдельно согласованы регулярность, лимиты и приёмка после проверенного исполнения; не условие завершения описания."],
  };
  for (const [index, [name, state, success]] of Object.entries(phases)) {
    const phase = get(`crew-roadmap-phase-${index}`);
    Object.assign(phase, { name, status: "proposal", description: `Статус: ${state}`, success,
      constraints: "Сейчас только описание структуры; отсутствие запущенного исполнителя не блокирует его готовность. Внешние действия и запуск не разрешены." });
    const output = get(`crew-roadmap-output-${index}`);
    output.name = `Результат этапа: ${name}`;
    output.description = `Требуемый результат, не утверждён: ${success}`;
    output.status = "proposal";
  }
  const order = [0, 2, 1, 3, 5, 4, 6];
  const phaseIds = new Set(order.map(i => `crew-roadmap-phase-${i}`));
  const outputIds = new Set(order.map(i => `crew-roadmap-output-${i}`));
  // Replace only prior phase sequencing, never case/research or line-management links.
  data.links = data.links.filter(l => !(l.kind === "depends_on" && phaseIds.has(l.from) && outputIds.has(l.to)));
  for (let i = 0; i < order.length; i++) {
    get(`crew-roadmap-phase-${order[i]}`).nextId = i + 1 < order.length ? `crew-roadmap-phase-${order[i + 1]}` : null;
    if (i) data.links.push({ id: `structure-first:${order[i]}:${order[i - 1]}`, kind: "depends_on",
      from: `crew-roadmap-phase-${order[i]}`, to: `crew-roadmap-output-${order[i - 1]}`,
      reason: order[i] === 4 ? "Будущий запуск только после приёмки всей описанной структуры и отдельного разрешения" : "Сохранить последовательность описания и приёмки без требования live-исполнителя" });
  }
  data.stageReports.push({ pass: 1, described: "Roadmap v3: сначала вся структура; criteria подготовлена к обсуждению, не принята.",
    boundary: "Другие действия не заполнены автоматически; сотрудники не подключаются.",
    dependencies: "Ответ Сергея о первой B2C-аудитории и ситуации.",
    gaps: "Полные паспорта руководства/направлений и специализированной технической команды ещё не завершены.",
    next: "Обсудить criteria, сохранить согласованную редакцию, проверить связи и только затем discover." });
  const text = structureFirstDocument(data);
  if (text.length > 50000) throw Error("Roadmap document exceeds supported size; preserve original");
  let next = root;
  const command = (c: ModelCommand) => { next = applyHypothesisCommand(next, "new-country", c, actor); };
  command({ type: "saveDocument", id: doc.id, title: structureFirstTitle, text, url: doc.url, elementIds: doc.elementIds });
  command({ type: "saveOperatingModel", baseVersion: revision.version, data });
  return next;
}
