/** Owner's descriptive proposal. Not imported by the application or agents. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { journalEntrySchema } from "../../server/productCrew/knowledgeAppend";

const norm = z.object({
  id: z.string(), name: z.string(), baseline: z.number(), target: z.number(),
  unit: z.enum(["ms", "turns", "repeats", "restarts_per_phrase"]),
  guard: z.string(), definition: z.string(), approximateBaseline: z.boolean().optional(),
}).strict();
export const secretaryNormsSchema = z.object({
  format: z.literal("talkhint.secretary.norms-passport"), status: z.literal("proposed"),
  title: z.literal("Паспорт норм Секретаря"), ownerRoleId: z.literal("secretary-project-head"),
  planFromRoleId: z.literal("head-product"), enabled: z.literal(false),
  createdAt: z.string().datetime(),
  baseline: z.object({
    source: z.literal("owner_report"), reference: z.literal("Pilot 208"),
    reportedSampleSize: z.literal(1), independentlyRecomputed: z.literal(false),
    preliminary: z.literal(true), rebaseAfterFirstCCalls: z.literal(5),
    idealKatyaTurns: z.literal(6),
  }).strict(),
  goals: z.array(norm).length(5),
  hold: z.tuple([
    z.object({ id: z.literal("checklist_coverage"), target: z.literal(100), unit: z.literal("percent"), definition: z.string() }).strict(),
    z.object({ id: z.literal("invented_facts"), target: z.literal(0), unit: z.literal("count"), definition: z.string() }).strict(),
  ]),
  observation: z.array(z.object({ id: z.string(), name: z.string(), target: z.null(), definition: z.string() }).strict()).length(4),
  stages: z.object({
    maxOptimizationMetricsPerProduct: z.literal(1), activeMetricId: z.null(),
    proposedFirstMetricId: z.literal("response_pause_median_ms"),
    nextStepImprovementPercent: z.tuple([z.literal(20), z.literal(30)]),
    exactInitialOwnerTargetsPreserved: z.literal(true), rules: z.array(z.string()),
  }).strict(),
  proposalGate: z.object({ journalReadRequired: z.literal(true), rejected: z.tuple([z.literal("GPT-Live")]), retained: z.literal("Retell") }).strict(),
  duties: z.array(z.object({
    roleId: z.string(), trigger: z.string(), result: z.string(), acceptorRoleId: z.string(),
  }).strict()).length(4),
  factTemplate: z.object({
    status: z.literal("not_measured"),
    metricIds: z.array(z.string()), value: z.null(), evidence: z.null(),
    fields: z.array(z.string()),
    missingDataRule: z.string(),
  }).strict(),
  appendOnly: z.object({
    immutableOriginal: z.literal(true), nextFacts: z.string(), correctionRule: z.string(),
  }).strict(),
  boundaries: z.array(z.string()),
}).strict();
export type SecretaryNorms = z.infer<typeof secretaryNormsSchema>;
export function makeSecretaryNorms(createdAt: string): SecretaryNorms {
  return secretaryNormsSchema.parse({
    format: "talkhint.secretary.norms-passport", status: "proposed", title: "Паспорт норм Секретаря",
    ownerRoleId: "secretary-project-head", planFromRoleId: "head-product", enabled: false, createdAt,
    baseline: { source: "owner_report", reference: "Pilot 208", reportedSampleSize: 1,
      independentlyRecomputed: false, preliminary: true, rebaseAfterFirstCCalls: 5, idealKatyaTurns: 6 },
    goals: [
      { id: "response_pause_median_ms", name: "Пауза до ответа, медиана", baseline: 1700, target: 1400, unit: "ms",
        definition: "Конец речи собеседника → первый звук ответа Кати; отдельно помечать связку и содержательный ответ.",
        guard: "Качество не ниже; исходная оценка качества не задана числом и не считается измеренной." },
      { id: "response_pause_p95_ms", name: "Пауза до ответа, p95", baseline: 3300, target: 2600, unit: "ms",
        definition: "Та же точка отсчёта и выборка валидных реплик, что у медианы; число реплик и метод p95 обязательны.",
        guard: "Качество не ниже; отсутствие оценки качества не равно выполнению сторожа." },
      { id: "katya_turns", name: "Реплик Кати при сохранении всех пунктов", baseline: 12, target: 8, unit: "turns",
        definition: "Фактических реплик 12, идеальная версия 6; целевое число не более 8. Сложность других поручений явно учитывать.",
        guard: "Все пункты закрыты; честное «не знаю» — закрытый пункт, не положительный ответ." },
      { id: "repeat_questions", name: "Повторы отвеченных вопросов", baseline: 3, target: 0, unit: "repeats",
        definition: "Повтор уже закрытого вопроса; уточнение противоречащих цифр отдельно, не скрывать под исключением.",
        guard: "Не терять обязательные пункты поручения." },
      { id: "restarts_per_phrase", name: "Перезапуски на фразу", baseline: 2.7, target: 1.5, unit: "restarts_per_phrase",
        approximateBaseline: true, definition: "Число перезапусков / число фраз собеседника; сохранять числитель и знаменатель.",
        guard: "Без выдачи старых фактов после исправлений собеседника." },
    ],
    hold: [
      { id: "checklist_coverage", target: 100, unit: "percent",
        definition: "Закрытые пункты / все пункты × 100. Честное «не знаю» считается закрытым с исходом unknown и цитатой." },
      { id: "invented_facts", target: 0, unit: "count",
        definition: "Ноль выдуманных фактов; каждый спорный факт проверять по источнику/расшифровке, отсутствие источника не подтверждает факт." },
    ],
    observation: [
      { id: "platform_cost_per_minute", name: "Стоимость минуты платформы", target: null, definition: "Фактическое usage и тариф/дата; валюта и состав платформы отдельно. Оценка не является счётом." },
      { id: "call_cost", name: "Стоимость звонка", target: null, definition: "Фактическая стоимость данного звонка с указанным составом; неизвестные компоненты не равны нулю." },
      { id: "review_cost", name: "Стоимость разбора", target: null, definition: "Фактические токены/usage и сохранённые ставки Лёвы/Томы/Севы, без вызова моделей ради измерения." },
      { id: "abandoned_calls", name: "Брошенные звонки", target: null, definition: "Число/доля, окно, знаменатель и причина. Не смешивать no-answer, технический обрыв и отказ собеседника. Отклонение — сигнал, не нарушение цели." },
    ],
    stages: { maxOptimizationMetricsPerProduct: 1, activeMetricId: null,
      proposedFirstMetricId: "response_pause_median_ms", nextStepImprovementPercent: [20, 30],
      exactInitialOwnerTargetsPreserved: true,
      rules: [
        "Все нормы proposed; активной ступени и автоматического внедрения нет. Первой предложена медиана, остальные цели в очереди.",
        "Следующая ступень — улучшение на 20–30% относительно подтверждённого текущего значения, с сохранением сторожей.",
        "Точные начальные значения заданы владельцем и не пересчитаны ради диапазона 20–30%: 1,7→1,4 ≈17,6%; 12→8 ≈33,3%; 3→0 =100%; 2,7→1,5 ≈44,4%. Это не самостоятельная смена целей.",
        "Достигнута ступень и сторожи подтверждены — Мария решает «держим» или предлагает следующую. Одна оптимизируемая метрика на продукт.",
        "«Не получается» допускается только с доказательствами стенда и нескольких вариантов; после решения фиксируем результат и держим.",
        "Пересмотр при новой модели, отставании от конкурента по бенчмарку или просадке. Изменения продукта всё равно только с согласования владельца.",
        "Базу уточнить после первых пяти звонков C, не выдавая один Pilot 208 за статистику серии.",
      ] },
    proposalGate: { journalReadRequired: true, rejected: ["GPT-Live"], retained: "Retell" },
    duties: [
      { roleId: "secretary-lab-engineer", trigger: "Каждый разрешённый разбор завершённого звонка",
        result: "Факт по каждой норме: окно, выборка, замер, единицы, источник, сторож, план/факт/расхождение; неизвестное явно не измерено.", acceptorRoleId: "secretary-qa" },
      { roleId: "secretary-qa", trigger: "Получен разбор Лёвы",
        result: "Независимая сверка каждого факта, чисел и сторожей; подтверждено / не подтверждено / не измерено, расхождения с доказательствами.", acceptorRoleId: "secretary-project-head" },
      { roleId: "secretary-project-head", trigger: "Раз в неделю, по проверенным фактам",
        result: "Сводка план против факта, тренд/выборка/пробелы, сигналы наблюдения и предложение «держим / следующая ступень» Марии.", acceptorRoleId: "head-product" },
      { roleId: "head-product", trigger: "Недельная сводка Севы или условие пересмотра",
        result: "План спускается Севе; решение «держим / следующая ступень» и вопрос владельцу, если требуется изменение продукта.", acceptorRoleId: "owner" },
    ],
    factTemplate: { status: "not_measured", metricIds: [
      "response_pause_median_ms", "response_pause_p95_ms", "katya_turns", "repeat_questions", "restarts_per_phrase",
      "checklist_coverage", "invented_facts", "platform_cost_per_minute", "call_cost", "review_cost", "abandoned_calls",
    ], value: null, evidence: null, fields: [
      "callId", "codeVersion", "window", "metricId", "value", "unit", "sampleSize",
      "numerator", "denominator", "sourceRef", "guardResult", "reviewer", "planVsFact", "reason", "recordedAt",
    ], missingDataRule: "Отсутствующий/неподтверждённый факт = не измерено, не 0 и не успех. База владельца не заменяет факт нового звонка." },
    appendOnly: { immutableOriginal: true,
      nextFacts: "Дописывать отдельную запись журнала с ID/хэшем паспорта и источниками. Новая ступень/версия — новый документ результата со ссылкой на прежний; исходник не заменять.",
      correctionRule: "Исправления отдельной датированной записью с причиной и ссылкой; не удалять и не переписывать старые планы, факты или историю." },
    boundaries: [
      "Только описательный proposed-план; не SLA и не доказательство внедрения.",
      "Не менять продукт, Катю, голос, язык, приветствие, IVR, промпты, модели, доступы, цены и настройки.",
      "Не включать агентов, расписания, платные прогоны, звонки и Publish. Никакой приёмки за владельца.",
      "Перед любым предложением свежее чтение журнала и решений; не предлагать отвергнутое: GPT-Live отклонён владельцем, Retell остаётся.",
    ],
  });
}
export const hashText = (text: string) => createHash("sha256").update(text).digest("hex");
export function normsJournalEntry(p: SecretaryNorms, documentId: string, documentHash: string, at: string) {
  return journalEntrySchema.parse({
    id: "JOURNAL-SECRETARY-NORMS-2026-11-04", title: "Паспорт норм Секретаря: proposed plan/fact",
    eventDatePrecision: "range-only", eventPeriod: ["2026-11-04", "2026-11-04"], registeredAt: at,
    actualAuthor: "Replit", classification: "owner_decision", source: "owner",
    fact: `Создан proposed-документ ${documentId}, SHA-256 ${documentHash}. Владелец документа — Сева, план спускает Мария. ` +
      "Цели: медиана 1700→1400 мс; p95 3300→2600 мс; реплик 12 при идеале 6→не более 8; повторов 3→0; перезапусков примерно 2,7→не более 1,5/фразу. " +
      "Держать: закрытие пунктов 100%, честное «не знаю» закрывает unknown; выдуманных фактов 0. Качество не ниже; без старых фактов. " +
      "База владельца — один Pilot 208, предварительная, не пересчитана здесь; уточнить после первых 5 звонков C. Все нормы proposed, не живые пороги.",
    evidenceRefs: [documentId, `sha256:${documentHash}`],
    targetRoleIds: ["secretary-project-head", "secretary-lab-engineer", "secretary-qa"],
    verification: "Документ прочитан через production MCP, текст и hash совпали. Это не замер звонка и не автоматическое внедрение обязанностей/промптов.",
    productChangeAuthorized: false, newRuntimeExecution: false,
    before: "Предварительные цифры одного звонка не были оформлены отдельным proposed-паспортом норм plan/fact.",
    learned: "Отделять цели, держать и наблюдение. Не путать не измерено с 0/успехом; сохранять сторожи. Не предлагать отклонённый GPT-Live: Retell остаётся.",
    next: "Лёва предлагает факт по каждой норме, Тома независимо проверяет; Сева еженедельно план/факт Марии. Активной ступени нет; медиана предложена первой. Новые факты — append-only со ссылкой на паспорт.",
    expectedResult: {
      text: "Только proposed-нормы, не действующие пороги звонков. Медиана ≤1400 мс; p95 ≤2600 мс; реплик ≤8; повторов 0; перезапусков ≤150 на 100 фраз (=1,5/фразу); закрытие пунктов 100%; выдумок 0. Качество не ниже, без старых фактов. Одна оптимизируемая метрика за раз; факт пока не измерен.",
      appliesTo: "other",
      metrics: [
        { metric: "proposed_pause_median_ms", operator: "lte", value: p.goals[0].target, unit: "ms" },
        { metric: "proposed_pause_p95_ms", operator: "lte", value: p.goals[1].target, unit: "ms" },
        { metric: "proposed_katya_turns", operator: "lte", value: p.goals[2].target, unit: "turns" },
        { metric: "proposed_repeat_questions", operator: "eq", value: 0, unit: "repeats" },
        { metric: "proposed_restarts_per_100_phrases", operator: "lte", value: 150, unit: "count" },
        { metric: "proposed_checklist_coverage", operator: "gte", value: 100, unit: "percent" },
        { metric: "proposed_invented_facts", operator: "eq", value: 0, unit: "count" },
      ],
    },
  });
}
export function renderSecretaryNorms(raw: SecretaryNorms) {
  const p = secretaryNormsSchema.parse(raw);
  const goalRows = p.goals.map(g => `| ${g.name} | ${g.baseline} | ≤ ${g.target} | ${g.unit} | ${g.guard} |`).join("\n");
  return `# ${p.title}\n\nСтатус: proposed. Владелец документа: Сева; план спускает Мария. Агентов не запускать.\n\n` +
    `База: предварительные цифры владельца по одному Pilot 208; не пересчитаны независимо. Уточнить после первых 5 звонков C.\n\n` +
    `## Цели (команда влияет)\n| Метрика | База | Цель | Единица | Сторож |\n|---|---:|---:|---|---|\n${goalRows}\n\n` +
    `Идеальная версия Pilot 208 — 6 реплик, предложенная цель — ≤8. «Не знаю» закрывает пункт с исходом unknown, не означает положительного ответа.\n\n` +
    `## Держать\n- Пункты поручения закрыты 100%.\n- Выдуманных фактов 0.\n\n` +
    `## Наблюдение — без целей\n${p.observation.map(o => `- ${o.name}: ${o.definition}`).join("\n")}\n\n` +
    `## Ступени\n${p.stages.rules.map(r => `- ${r}`).join("\n")}\n\n` +
    `## Перед предложением\nСвериться с журналом. GPT-Live отклонён, Retell остаётся. Не предлагать отвергнутое.\n\n` +
    `## Кто заполняет plan/fact\n${p.duties.map(d => `- ${d.roleId}: ${d.trigger} → ${d.result} → ${d.acceptorRoleId}`).join("\n")}\n\n` +
    `Факт сейчас: не измерено. Автоматическое заполнение/новое расписание этим документом не включается.\n\n` +
    `## Append-only\n${p.appendOnly.nextFacts}\n${p.appendOnly.correctionRule}\n\n` +
    `## Границы\n${p.boundaries.map(b => `- ${b}`).join("\n")}\n\n` +
    `## Структурированный паспорт\n\`\`\`json\n${JSON.stringify(p, null, 2)}\n\`\`\``;
}
