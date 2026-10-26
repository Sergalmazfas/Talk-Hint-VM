import assert from "node:assert/strict";
import type { ProjectModelState } from "../../../shared/projectModel";
import { passportChapterSchema, hintChapterDocumentId, type PassportChapter } from "../../../shared/passportChapter";
import { productBookDocumentId, productBookText, readProductBook } from "../../../shared/productBook";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";

export type HistoricalHintRun = {
  id: string; run_type: string; status: string; started_at: string; finished_at: string | null;
  config: any; scorecard: any; corpus_hash: string; prompt_version: string;
};
const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const A = {
  product: ["company-action-product-reference", "company-action-product-sufficiency", "company-action-product-return"],
  workflow: ["company-action-technical-facts", "company-action-technical-control"],
  lab: ["engineering-chief-readiness", "engineering-chief-priorities"],
  metrics: ["engineering-chief-estimates", "engineering-chief-readiness"],
  bench: ["company-action-plans", "company-action-features", "company-action-handoff", "company-action-followup"],
  design: ["company-action-owner-competitor-test"],
};
/** Read historical aggregates only: never audio, transcripts, private tokens or provider requests. */
export function summarizeHintRuns(rows: HistoricalHintRun[]): PassportChapter["runs"] {
  return rows.map(r => {
    const values = Array.isArray(r.scorecard) ? r.scorecard : r.scorecard?.candidates ?? [];
    const keep = ["candidateId", "model", "turns", "turnsScored", "channelsScored", "errors",
      "schemaInvalid", "successfulHints", "avgReadyMs", "avgFirstTokenMs", "avgFullOutputMs",
      "estCostPer10MinCall", "wer", "guestWer", "ownerWer", "eotP50", "finalP50", "perTurnBasis",
      "clientRenderEstimated", "clientRenderEstimateMs", "semanticIsProxy"];
    const metrics = values.map((c: any) => Object.fromEntries(keep.filter(k => c[k] !== undefined).map(k => [k, c[k]])));
    return {
      id: r.id, createdAt: new Date(r.started_at).toISOString(), status: r.status,
      configuration: (r.config?.candidates ?? []).map((c: any) => c.model || c.config?.model || c.id).join(" → ") || "Нет данных",
      summary: `${r.run_type}; ${metrics.length} строк результатов.`,
      source: `benchmark_runs/${r.id}`,
      metrics: { candidates: metrics, corpusHash: r.corpus_hash, promptVersion: r.prompt_version, finishedAt: r.finished_at },
      limitations: "См. ограничения слоя «Лаборатория»; не новый запуск.",
    };
  });
}

export function prepareHintChapter(root: ProjectModelState, runs: HistoricalHintRun[], protocol: any, now: string) {
  const state = readHypothesis(root, "new-country");
  const existing = state.documents.find(d => d.id === hintChapterDocumentId);
  if (existing) return root; // Explicit first import only; subsequent edits use the same document/revision.
  const doc = state.documents.find(d => d.id === productBookDocumentId);
  const book = readProductBook(doc);
  assert.ok(doc && book, "Existing canonical product book required");
  assert.equal(protocol.packageVersion, 2, "Need actual package v2, not an assumed revision");
  assert.equal(protocol.metadata.sourceDataRevision, 744);
  const data = state.operatingModel?.revisions.at(-1)?.data;
  assert.ok(data, "Existing operating model required");
  for (const id of Object.values(A).flat()) assert.ok(data.nodes.some(n => n.id === id && n.kind === "action"), `Missing action ${id}`);
  const progress = (implemented: boolean | null = null, verified: boolean | null = null) =>
    ({ described: true, implemented, verified, accepted: null, planned: false });
  const layer = (title: string, summary: string, leadRoleId: string, actionIds: string[], sourceIds: string[]) => ({
    title, summary, progress: progress(), leadRoleId, participantRoleIds: [] as string[],
    assignment: "Связь с существующей областью ответственности; не назначение нового AI-исполнителя и не расширение полномочий.",
    actionIds, inputs: "Источники и существующий паспорт; пробелы возвращаются поставщику.",
    output: "Проверяемое описание соответствующего слоя главы Hint.",
    receiver: "Менеджер продукта; владелец принимает главу после прохода JSON.",
    acceptance: "Источник, дата, границы и неизвестное прослеживаются; нет подмены реализации проверкой и приёмкой.",
    next: "Сверить источник и вернуть недостающие входы адресным запросом.", sourceIds, unknown: [] as string[],
  });
  const chapter: PassportChapter = {
    format: "talkhint.passport-chapter", version: 1, mode: "hint", title: "Hint — звоню сам с подсказками",
    status: "На согласовании", bookDocumentId: productBookDocumentId,
    relatedFeatureIds: ["copilot", "outgoing", "results"], snapshotDate: "2026-10-26", capturedAt: now,
    sourceRevision: state.revision, scope: "Dev. Только книга/источники/JSON; без звонков, новых моделей, стендов, расходов или выпуска.",
    identityNote: "В прежней книге возможность copilot объединяет «Copilot / подсказки». Hint здесь самостоятельный режим главы, не переименование или удаление Copilot. Старые ID, записи и содержание сохранены.",
    schedule: { startedOn: "2026-10-26", dueOn: "2026-10-28", basis: "Согласовано 2 рабочих дня; начало фактической работы 26.10. Срок подготовки не означает приёмки." },
    layers: {
      product: layer("Как работает", "Подтверждено владельцем: Prepare → цель → звонок → перевод реплики собеседника → одна или две подсказки (родной язык + английская фраза) → History. На развилке две подсказки. RU/ES → EN. Не выдумывать и не называть неизвестные цифры. Владелец говорит сам; это не автономный звонок Кати.",
        "product-manager-specialist", A.product, ["owner-behavior", "owner-case"]),
      workflow: layer("Связка", "iPhone Twilio SDK / CallKit → Twilio → PSTN. Копия μ-law mono8k → /twilio-stream → Deepgram Flux → BRAIN → owner-scoped /ui. UI WebSocket передаёт текст, не основной звук. В коде flux-general-en и default gpt-5.6-terra; фактическая модель конкретного звонка неизвестна.",
        "head-engineering", A.workflow, ["audio", "hint-code"]),
      lab: layer("Лаборатория", "Ears/Brain /diagnostics: отдельное сравнение STT на аудиофикстурах и BRAIN по тексту. В Dev найдены сохранённые исторические прогоны; история ниже. Они не доказывают работу на текущем iPhone, актуальную доступность моделей или выбор лучшей связки.",
        "head-engineering", A.lab, ["benchmark-storage", "historical-runs", "secretary-storage"]),
      metrics: layer("Метрики", "Предлагаются четыре целевые метрики; все ждут решения владельца, значения целей и актуальные end-to-end измерения неизвестны. Исторические средние BRAIN и WER нельзя выдавать за сегодняшнюю скорость/качество на iPhone.",
        "head-engineering", A.metrics, ["historical-runs", "owner-behavior"]),
      bench: layer("Конкуренты", "P-BENCH rev744 packageVersion=2 подтверждён чтением архива. VocaLingo: текстовый AI Assistant с пресетами по сообщению владельца; сохранённая справка подтверждает контекстные подсказки и необходимость завершить звонок для смены режима. AI Phone: заявлены субтитры/итог, но контекстные подсказки не подтверждены. Это источники и предыдущие наблюдения, не выполненные мобильные тесты.",
        "benchmark-role-reference", A.bench, ["pbench-v2", "vocalingo", "ai-phone"]),
      design: layer("Экраны и дизайн", "В исходниках есть экран звонка Hint; эталонная цепочка скриншотов текущей установленной сборки и сопоставление с окнами конкурентов не получены. Требуется адресный запрос владельцу, не автоматическая установка/покупка приложений.",
        "management-role-ux-designer", A.design, ["ios-screen", "owner-behavior"]),
    },
    sources: [
      { id: "owner-behavior", type: "подтверждено владельцем", title: "Путь Hint и правила подсказок", location: "attached_assets/Pasted--Replit--1793050536971_1793050536971.txt:15", date: "2026-10-26",
        evidence: "Prepare, цель, RU/ES→EN, одна/две подсказки, не выдумывать цифры, History.", limitation: "Слова владельца; не сквозная проверка всех сборок и языков." },
      { id: "owner-case", type: "сообщение владельца", title: "Сервис / ручка трейлера, 25.10", location: "attached_assets/Pasted--Replit--1793050536971_1793050536971.txt:15", date: "2026-10-25",
        evidence: "Ошибки распознавания в начале; номер/фото не попали в контекст задачи. Подсказки помогли владельцу поговорить.", limitation: "Последовательность и причины требуют журналов. География спорная; один случай не доказательство рынка или серверного дефекта." },
      { id: "audio", type: "сохранённая техническая ревизия", title: "Аудиопаспорт v1, rev758", location: "DOC-TALKHINT-AUDIO-PASSPORT", date: "2026-10-26",
        evidence: "Маршрут Hint, μ-law8k, SDK/CallKit, ссылки со строками и контрольными суммами.", limitation: "Документация кода, не испытание устройства." },
      { id: "hint-code", type: "код", title: "Hint media / STT / BRAIN", location: "server/websocket.ts", date: "2026-10-26",
        evidence: "flux-general-en&encoding=mulaw&sample_rate=8000; HINT_MODEL default gpt-5.6-terra; /ui scoped.", limitation: "Default не доказывает runtime конкретного звонка; поддержка RU/ES описана владельцем, а не принята этим просмотром." },
      { id: "benchmark-storage", type: "код/схема", title: "Постоянное хранилище Ears/Brain", location: "shared/schema.ts:586-644", date: "2026-10-26",
        evidence: "benchmark_fixtures и benchmark_runs: corpus_hash, config, prompt_version, availability, results, scorecard, report, error, started/finished. API /api/admin/benchmark.", limitation: "Автоматический TTL benchmark_runs в просмотренном коде не найден. Срок хранения и резервное копирование не утверждены; это не доказательство вечного хранения." },
      { id: "historical-runs", type: "чтение Dev-БД", title: "Исторические Ears/Brain", location: "benchmark_runs", date: "2026-10-26",
        evidence: `${runs.length} сохранённых записей прочитано без запуска: ${runs.filter(r => r.status === "running").length} running. В JSON только агрегаты, не аудио и транскрипты.`,
        limitation: "Записи августа 2026; running не доказательство активного worker. Не перезапускались, production не проверялся." },
      { id: "secretary-storage", type: "код, не проверка удалённого окружения", title: "Secretary Lab: временное и сохранённое", location: "server/secretaryLab/comparisonStore.ts; server/secretaryLab/retell.ts:88", date: "2026-10-26",
        evidence: "Retell web-сессии — Map, завершённые очищаются после часа. Сохранённые сравнения — PgComparisonRepository / secretary_lab_comparisons, COMPARISON_RETENTION_DAYS=30; отдельный Dev-only API.", limitation: "Различать живую сессию и явно сохранённое сравнение. Наличие кода не подтверждает доступность таблицы/сохранения в каждом окружении; в этой задаче не сохраняли чужие прогоны." },
      { id: "pbench-v2", type: "сохранённый пакет / прежние наблюдения", title: "P-BENCH rev744, пакет v2", location: "attached_assets/0_P-BENCH_trial_protocol_rev744_1793036943949.zip", date: "2026-10-26",
        evidence: "format=talkhint.pbench.work-package; packageVersion=2; metadata.sourceDataRevision=744. Предыдущий ручной отчёт DOC-PBENCH-MANUAL-PASS-2026-10-26; VocaLingo v4, AI Phone v3. Пробный протокол Claude не принят.",
        limitation: "Протокол содержит новые сведения AI Call/AI Phone, VocaLingo — прежнее. Не приёмка продуктом и не новый исследовательский проход." },
      { id: "vocalingo", type: "сохранённое заявление поставщика", title: "VocaLingo AI Assistant", location: "https://help.vocalingo.app/en/help/articles/9323243-ai-assistant-mode-during-calls", date: "2026-10-25",
        evidence: "Карточка v4 в пакете: текстовый Assistant по контексту; говорит пользователь; смена режима требует завершения звонка. Пресеты переданы владельцем как находка.", limitation: "Скорость/полезность, текущая версия и скриншоты не тестировались. Пресеты нуждаются в привязке к конкретному фрагменту источника." },
      { id: "ai-phone", type: "сохранённое заявление поставщика", title: "AI Phone — перевод, субтитры и итог", location: "https://apps.apple.com/us/app/ai-phone-call-voice-translator/id6465173251", date: "2026-10-25",
        evidence: "Карточка AI Phone v3 и исходный ручной отчёт; субтитры/итог не равны генерируемым ответам Hint.", limitation: "Живой тест и приёмка отсутствуют; актуальную доступность/тариф нужно проверять отдельно." },
      { id: "ios-screen", type: "код", title: "Экран Hint и отдельные режимы iOS", location: "ios/TalkHint/SceneDelegate.swift", date: "2026-10-26",
        evidence: "Hint/Copilot — раздельные вкладки; CallManager.swift использует SDK/CallKit.", limitation: "Код не заменяет скриншоты установленной сборки, сравнение дизайна или UX-приёмку." },
      { id: "retell-duration", type: "код", title: "Предел реального телефонного агента", location: "server/secretary/retellPhone.ts:24-55,128-155", date: "2026-10-26",
        evidence: "max_call_duration_ms=300000 проверяется при телефонном admission; register-phone-call использует проверенного агента.", limitation: "Retell remote/runtime не запрашивались. Не обобщать на других провайдеров." },
    ],
    metrics: [
      { id: "hint-latency", name: "Задержка до подсказки", definition: "Конец релевантной реплики Guest → первая полностью пригодная подсказка, показанная владельцу. Дополнительно разделить STT, очередь, BRAIN, доставку, рендер.",
        unit: "мс; p50/p95 и n", denominator: "Все атрибутированные релевантные реплики; отдельно пропуски и недоступные тайминги.", target: null, actual: null, status: "ждёт решения владельца", method: "Согласованный набор диалогов, устройство/сборка, синхронизированные события; исторический avgReadyMs не заменяет эту метрику." },
      { id: "hint-stt", name: "Ошибки распознавания", definition: "WER=(замены+удаления+вставки)/слов эталона; отдельно точность критичных сущностей, пропуски реплик и разделение говорящих.",
        unit: "доля/процент с n", denominator: "Слова проверенного reference; сущности и реплики — отдельные знаменатели.", target: null, actual: null, status: "ждёт решения владельца", method: "Одинаковый разрешённый корпус и reference с датой/языком/каналом; не сравнивать ускоренные задержки с real-time." },
      { id: "hint-utility", name: "Полезность", definition: "Доля релевантных подсказок, которые принимающий оценил как подходящие задаче; отдельно ложные факты и неизвестные цифры.",
        unit: "доля; число оценок", denominator: "Все оценённые подсказки выбранного набора; пропущенные оценки неизвестны, не успешны.", target: null, actual: null, status: "ждёт решения владельца", method: "Согласовать рубрику до теста; оценка владельца и автоматического judge маркируются отдельно, без фиктивных ответов." },
      { id: "hint-cost", name: "Цена минуты", definition: "Атрибутированные STT + BRAIN + телефония и иные переменные расходы / длительность обслуживаемого звонка в минутах.",
        unit: "USD/минута", denominator: "Измеренные минуты звонков того же набора; расходы инфраструктуры отдельно с методом распределения.", target: null, actual: null, status: "ждёт решения владельца", method: "Usage и датированные тарифы от финансов; оценки отделять от счёта. Неизвестная цена модели не ноль." },
    ],
    labs: [
      { name: "Ears/Brain", path: "/diagnostics", workflow: "Start application", storage: "Dev PostgreSQL benchmark_runs + benchmark_fixtures; результаты, отчёт и конфигурация сохраняются.", retention: "Автоматический TTL в просмотренном коде не найден; утверждённый срок неизвестен.", sourceIds: ["benchmark-storage", "historical-runs"], limitations: "Исторические сравнительные прогоны; не iPhone акустика и не новый запуск. Для будущей записи аудио отдельно нужны согласия и политика хранения." },
      { name: "Secretary Lab (контекст хранения)", path: "/secretary-lab", workflow: "Start application", storage: "Временные session Map отдельно от явно сохраняемых PostgreSQL comparisons.", retention: "Retell terminal session около 1 часа; сохранённое comparison по коду 30 дней.", sourceIds: ["secretary-storage"], limitations: "Не утверждать, что вся история исчезает через час или что comparisons автоматически сохраняют каждую сессию. Никаких вызовов стенда в этой работе." },
    ],
    runs: summarizeHintRuns(runs),
    labHistory: { status: "предложение",
      proposal: "Не заводить вторую базу: использовать существующий benchmark_runs для прогонов Hint, главу — как индекс источников/выводов. Сравнение/решение связывать существующим документом с ревизиями; крупные разрешённые артефакты — ссылками в согласованном хранилище. Сроки/удаление и доступы согласовать до автоматизации; текущий механизм лаборатории не менять.",
      fields: ["run_id и corpus_hash", "модели/настройки/prompt/code version", "даты/платформа/язык/условия", "метрики и знаменатели", "ошибки/пропуски", "расходы и источник тарифа", "вывод и ограничения", "принимающий/решение/возврат", "связь с главой и разрешёнными артефактами"],
      noImplementation: "Это предложение устройства истории, не изменение TTL, новая таблица, автоматический импорт сессий или разрешение сохранять запись звонка." },
    procedures: [
      { id: "HINT-P1", title: "Сверить пользовательский сценарий", roleId: "product-manager-specialist", input: "Описание владельца и существующий паспорт.", steps: ["Прочитать слой «Как работает».", "Сопоставить Prepare, развилку, языки и History с доказательствами.", "Запросить конкретные отсутствующие скриншоты, не додумывать поведение."], resources: "Эта глава, исходное сообщение владельца, материалы текущей сборки по запросу.", result: "Описание с подтверждениями и вопросами.", recipient: "Главный инженер/дизайн, затем владелец.", acceptance: "Понятен путь и результат; опыт владельца отделён от проверки сборки.", returnTo: "Владелец — за материалами; продукт — за формулировкой.", deadline: "В пределах подготовки до 28.10; сроки ответов поставщиков не согласованы.", actionIds: A.product, limitations: "Не исполнять другой ролью фиктивную приёмку." },
      { id: "HINT-P2", title: "Проверить связку и историю лаборатории", roleId: "head-engineering", input: "Аудиопаспорт, код, сохранённые benchmark_runs.", steps: ["Сверить текущие defaults и отдельные аудиоканалы.", "Прочитать историю, corpus/config и ограничения метрик.", "Отделить доступность, завершение прогона, выбор связки и выпуск.", "Если данных нет — адресный запрос, не платный повтор."], resources: "Read-only текущего проекта/Dev базы; доступ будущего worker не выдан.", result: "Технические основания и пробелы, предложение следующей проверки.", recipient: "Менеджер продукта.", acceptance: "Источники/условия/выборка прослеживаются; нет утверждения актуального победителя без решения.", returnTo: "Технический специалист или QA по конкретному пробелу.", deadline: "Срок главы 28.10; новый тест не разрешён.", actionIds: [...A.workflow, ...A.lab], limitations: "Нельзя вызывать requireRetellPhone, прогоны или внешние модели для диагностики." },
      { id: "HINT-P3", title: "Сопоставить найденное у конкурентов", roleId: "benchmark-role-reference", input: "Пакет P-BENCH v2 rev744 и карточки VocaLingo/AI Phone.", steps: ["Проверить дату и вид свидетельства.", "Различить субтитры/перевод и контекстную подсказку.", "Непроверенные пресеты/окна направить на уточнение.", "Передать продукту находку и ожидать реальный ответ."], resources: "Сохранённые источники в главе; мобильные тесты только Сергей, без новой покупки.", result: "Сравнение с ограничениями и вопросами.", recipient: "P.PRODUCT через существующие передачи.", acceptance: "У каждого вывода источник/дата, неизвестное явно, нет выдуманного роста или живого теста.", returnTo: "Аналитику с точным недостающим доказательством.", deadline: "Ответ продукта не получен; SLA не утверждён.", actionIds: A.bench, limitations: "Не принимать прошлый пробный протокол за принятое продуктовое решение." },
      { id: "HINT-P4", title: "Пройти JSON и дать приёмку главы", roleId: "product-manager-specialist", input: "Полный JSON пакета, четыре предложения метрик и открытые запросы.", steps: ["Открыть источники и пройти пункты reviewProtocol.", "На каждом записать результат, материал либо блокер.", "Передать владельцу список замечаний/предложение принятия.", "Записать только реально полученное решение, иначе ожидание."], resources: "JSON, веб-книга, ответы владельца/поставщиков.", result: "Заполненный протокол и решение либо адресный возврат.", recipient: "Сергей — принимающий после прохода.", acceptance: "Нет незаметных неизвестных/нерабочих ссылок; сценарий, роли, лаборатория и следующий шаг понятны.", returnTo: "Автору конкретного слоя; молчание не приёмка.", deadline: "Дата прохода владельцем не назначена.", actionIds: ["lg-action-8", "company-action-product-sufficiency"], limitations: "В этой реализации протокол не исполняется вместо владельца/ChatGPT." },
    ],
    requests: [
      { id: "HINT-REQ-SCREENS", to: "Сергей → P.PRODUCT и P.UX", request: "Передайте снимки текущей сборки Hint без лишних персональных данных.", materials: ["Номер версии/build и iOS, язык интерфейса и язык подсказок.", "Prepare: ввод → вопросы → карточка цели.", "Звонок Hint: перевод и одна/две подсказки на развилке.", "History: статус, transcript и итог, если он есть.", "По возможности RU→EN и ES→EN с указанием реально показанного; не совершать новый звонок ради этого запроса без отдельного решения."], receivingActionId: "company-action-product-reference", status: "ожидает материалов; запрос представлен в главе", response: null },
      { id: "HINT-REQ-COMPETITORS", to: "Сергей через менеджера продукта", request: "Скриншоты VocaLingo Assistant с пресетами и AI Phone subtitles/summary: платформа, версия, тариф и дата.", materials: ["Экран выбора режима/пресета.", "Экран звонка/подсказок.", "Экран итога.", "Отметка нужен ли аккаунт/подписка; расходы не разрешены."], receivingActionId: "company-action-owner-competitor-test", status: "ожидает решения о ручном тесте/имеющихся материалов", response: null },
      { id: "HINT-REQ-FINANCE", to: "Руководитель финансов → главный инженер/продукт", request: "Датированные тарифы и метод атрибуции STT/BRAIN/Twilio для USD/мин; отделить usage от счёта.", materials: ["Тарифы/лимиты/валюта/период.", "Правило включения инфраструктурных затрат."], receivingActionId: "engineering-chief-estimates", status: "описанный адресный запрос; реального ответа нет", response: null },
      { id: "HINT-REQ-ACCEPT", to: "Сергей", request: "Пройти JSON главы и решить целевые значения четырёх метрик.", materials: ["Протокол reviewProtocol.", "Численные цели/рубрика либо замечания."], receivingActionId: "lg-action-8", status: "ожидает прохода; не принято", response: null },
    ],
    reviewProtocol: [
      { id: "R1", check: "Прочитан сценарий Hint; RU/ES, развилка и неизвестные цифры отражены верно.", status: "не выполнено", evidence: null, blocker: null, responsible: "Владелец / P.PRODUCT" },
      { id: "R2", check: "Экран, сборка, лаборатория и текущая связка не смешаны с планом/историей.", status: "не выполнено", evidence: null, blocker: "Текущие скриншоты/build ещё не получены.", responsible: "Владелец / HEAD.07 / P.UX" },
      { id: "R3", check: "Исторические прогоны имеют конфигурацию, дату и ограничения; сравнение не выдаётся за выбор/выпуск.", status: "не выполнено", evidence: null, blocker: null, responsible: "HEAD.07 / QA" },
      { id: "R4", check: "Каждый слой имеет ответственного, вход, результат, получателя, действия и возврат.", status: "не выполнено", evidence: null, blocker: null, responsible: "P.PRODUCT" },
      { id: "R5", check: "Четыре целевые метрики рассмотрены владельцем, решение или возврат записаны явно.", status: "не выполнено", evidence: null, blocker: "Цели ждут решения владельца.", responsible: "Сергей" },
      { id: "R6", check: "Прочитан и проверен JSON; зафиксировано реальное принятие либо конкретные замечания.", status: "не выполнено", evidence: null, blocker: "Проход ещё не выполнен.", responsible: "Сергей" },
    ],
    nextChapters: ["Катя", "Translator", "Prepare", "History", "Copilot"],
    limitations: ["Никаких свежих звонков, тестов моделей или мобильных тестов.", "Архив прототипа книги v2 не передан; v1 — только предложение UI, его статус «Copilot снят» отвергнут владельцем.", "Разрешение подготовить главу не означает её приёмки, согласования нормативов или подключения исполнителей.", "Другие workspace/production/устройства автоматически не наблюдаются."],
    katyaDuration: { milliseconds: 300000, scope: "Реальный телефонный агент Кати через Retell, не только лаборатория; другие провайдеры отдельно.", evidence: "retellPhoneConfiguration + verifyRetellPhoneAgent + /v2/register-phone-call; источник retell-duration.", remoteVerified: false, separateSilenceTimeout: true },
  };
  chapter.layers.workflow.progress = progress(true);
  chapter.layers.workflow.participantRoleIds = ["lg-technical-role", "crew-channel-specialist"];
  chapter.layers.lab.progress = progress(true);
  chapter.layers.lab.participantRoleIds = ["lg-qa-role", "benchmark-role-reference"];
  chapter.layers.lab.unknown = ["Новый инженер лаборатории — предложение, не создан/не назначен.", "Приёмка и актуальный победитель связки не найдены.", "avgReadyMs — среднее BRAIN с оценённым вкладом рендера, не акустика iPhone. EOT/final replay могли быть ускорены. Сравнивать только одинаковые corpus/config/версии; стоимость историческая/оценочная."];
  chapter.layers.product.unknown = ["Текущие скриншоты/сборка и воспроизводимый проход не получены."];
  chapter.layers.design.participantRoleIds = ["product-manager-specialist", "management-role-mobile-specialist"];
  chapter.layers.metrics.participantRoleIds = ["management-role-finance-analyst", "lg-qa-role"];
  const parsed = passportChapterSchema.parse(chapter);
  for (const l of Object.values(parsed.layers)) {
    assert.ok(data.nodes.some(n => n.id === l.leadRoleId && n.kind === "role"), `Missing role ${l.leadRoleId}`);
    for (const id of l.participantRoleIds) assert.ok(data.nodes.some(n => n.id === id && n.kind === "role"), `Missing participant ${id}`);
    for (const id of l.sourceIds) assert.ok(parsed.sources.some(s => s.id === id), `Missing source ${id}`);
  }
  const text = JSON.stringify(parsed);
  assert.ok(text.length < 50000, `Chapter exceeds existing limit: ${text.length}`);
  const actor = "Replit · глава Hint по согласованному поручению Сергея; не приёмка главы";
  let next = applyHypothesisCommand(root, "new-country", { type: "createDocument", id: hintChapterDocumentId,
    title: "TalkHint — глава Hint — v1 — на согласовании", text,
    url: "/admin/project-model?hypothesis=new-country&view=book&chapter=hint", elementIds: doc.elementIds }, actor);
  const updatedBook = { ...book, version: book.version + 1, updatedAt: now,
    chapterRefs: { ...book.chapterRefs, hint: hintChapterDocumentId },
    nextStage: "Глава Hint: JSON и проход владельцем. Затем Катя → Translator → Prepare → History → Copilot." };
  const bookText = productBookText(updatedBook);
  assert.ok(bookText.length <= 50000, `Canonical book exceeds limit: ${bookText.length}`);
  next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: doc.id, text: bookText,
    title: `TalkHint — живая книга продукта — v${updatedBook.version} — Hint связан — на согласовании`, url: doc.url, elementIds: doc.elementIds }, actor);
  const roadmap = state.documents.find(d => d.id === roadmapId);
  assert.ok(roadmap, "Existing roadmap required");
  const version = Number(/— v(\d+)/.exec(roadmap.title)?.[1]);
  assert.ok(version > 0);
  next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: roadmap.id,
    title: `TalkHint — единый roadmap — v${version + 1} — главы паспорта`, url: roadmap.url, elementIds: roadmap.elementIds,
    text: `${roadmap.text}\n\n## Согласованный порядок книги · 26.10.2026\nПервый шаг: Hint (${hintChapterDocumentId} v1), подготовка 26–28.10.2026. Источники/структура описаны; приёмка только после прохода JSON владельцем, цели метрик ждут решения. Затем Катя → Translator → Prepare → History → Copilot. Ничего не удаляется, Copilot остаётся; дальнейшее решение после книги и бенчмарка. Исполнители/платные испытания/выпуск не запускаются. Прототип v2 не получен; v1 не источник фактов.` }, actor);
  return next;
}
