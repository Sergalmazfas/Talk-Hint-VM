import type { OperatingData, WorkLink, WorkMetric, WorkNode } from "../../../shared/operatingModel";

export const mediaProtocolId = "DOC-PLAB-MEDIA-PROTOCOL";
export const mediaRoles = [
  { mode: "video", id: "lab-video-analyst-role", code: "P.LAB.VIDEO", name: "Аналитик видео экрана",
    documentId: "DOC-PLAB-VIDEO-WORK-PACKAGE" },
  { mode: "audio", id: "lab-audio-analyst-role", code: "P.LAB.AUDIO", name: "Аналитик звука звонка",
    documentId: "DOC-PLAB-AUDIO-WORK-PACKAGE" },
] as const;

const lab = "laboratory-engineer-role", qa = "lg-qa-role", head = "head-engineering";
const source = "Поручение владельца 27.10.2026: описать в crew отдельный анализ видео и звука; Gemini — кандидат для видео. Это не запуск.";
const boundary = "Только разрешённые тестовые материалы владельца. Не начинать запись, не включать микрофон, не менять Hint/Translator/iOS/production/телефонию. Не отправлять медиа внешней модели до проверки основания, доступа и условий обработки. Никаких покупок, подключения API, агентов, расписаний и рассылки.";
const trigger = "По поступлению достаточных разрешённых материалов — без искусственного ожидания двух дней. При нехватке — сразу адресный запрос. Время выполнения/SLA не утверждены.";
const forms = {
  perCall: {
    reportId: null, role: null, callId: null, mediaId: null, mode: null, sourceDate: null,
    environment: null, platform: null, appBuild: null, device: null, mediaHash: null,
    authorizationEvidence: null, processingPermission: null, retentionDecision: null,
    coverage: { expected: null, examined: null, skipped: [], denominatorDefinition: null },
    alignment: { anchor: null, clockOffsetMs: null, uncertaintyMs: null, evidence: [] },
    tools: [], observations: [], // Each observation uses the finding form below.
    metrics: [], missingInputs: [], requests: [], proposals: [],
    qa: { status: "не выполнено", reviewer: "P.LG.QA", issues: [], evidence: null },
    recipient: "P.LAB", receipt: null, ownerAcceptance: null,
  },
  finding: {
    id: null, intervalMs: { from: null, to: null }, eventId: null, speaker: null,
    observed: null, evidence: [], classification: null,
    kind: "наблюдение / гипотеза / неизвестно / предложение",
    modelClaim: null, verifiedAgainstSource: null, confidenceBasis: null,
    severity: null, impact: null, uncertainty: null, nextAction: null, responsible: null,
  },
  daily: {
    date: null, role: null, plannedMaterialIds: [], received: [], processed: [], blocked: [],
    plan: null, fact: null, deviationReason: null, findings: [], resourcesMissing: [],
    handedToQa: [], qaAccepted: [], qaReturned: [], receiptEvidence: [], next: [],
  },
  weekly: {
    period: null, dailyReportIds: [], plan: null, fact: null, denominator: null,
    acceptedFirstPass: null, returned: null, unresolved: [], newFindings: [],
    repeatedFailures: [], changesProposed: [], decisionsReceived: [],
    blockersBySupplier: [], nextPeriodProposal: [], receiver: "P.LAB / LAB.REPORT", receipt: null,
  },
  monthly: {
    period: null, weeklyReportIds: [], comparableBaseline: null, trend: null,
    limits: [], proposals: [], decisions: [], companyReportReceiver: "HEAD.07 через LAB.REPORT",
  },
};

export const mediaProtocol = {
  format: "talkhint.plab.media-protocol", version: 1, status: "описано; на сверке; не исполнено",
  source, scope: "Сначала Hint. Translator — следующий отдельный маршрут после проверки дорожек; общая структура пригодна, подключение не сделано.",
  hierarchy: "HEAD.07 → P.LAB → P.LAB.VIDEO / P.LAB.AUDIO. P.LG.QA независима от авторов.",
  identity: "Существующая new-country и её история. Приложение к принятому P.LAB v2, не замена и не повторная приёмка.",
  execution: { crewStarted: false, integrationsConnected: false, modelRequestsMade: 0, emailsSent: 0,
    recordingEnabled: false, productChanged: false, productionChanged: false, newCalls: 0 },
  stages: ["описано", "реализовано", "проверено", "принято", "в плане"],
  permissions: boundary,
  inputManifest: {
    callId: null, ownerScopeProof: null, mediaId: null, protectedLocation: null, sha256: null,
    mediaType: null, durationMs: null, timezone: null, startedAt: null, mode: null,
    environment: null, platform: null, appBuild: null, captureMethod: null, trackMap: null,
    consentAndPurposeEvidence: null, retentionDecision: null,
    transcriptRef: null, hintEventsRef: null, uiTelemetryRef: null, goalRef: null, ownerFeedbackRef: null,
  },
  requiredEvidence: {
    video: "Приватное исходное видео, временные метки кадров, частота/пропуски выборки; видимое содержимое и координаты карточки. Видео не доказывает прочтение/использование.",
    audio: "Приватный исходник, формат/кодек/sample rate, каналы и карта Owner/Guest с учётом телефонной ноги; эталон только после проверки человеком. Отсутствующая дорожка не восстанавливается догадкой.",
    sync: "Общий якорь и смещение часов с погрешностью. Серверный ACK, отметка UI, видимый кадр, произнесённая и использованная реплика — разные факты.",
  },
  measurementDefinitions: {
    defaults: "План/факт/норматив неизвестны до фактического прохода и решения. Указать единицу, сторону, интервалы, период, среду, сборку, числитель/знаменатель и источник.",
    videoCoverage: "Проверенные интервалы / согласованные допустимые интервалы; отдельно число извлечённых и просмотренных кадров, FPS и пропуски. Выборка не равна всему видео.",
    visibleAt: "PTS первого проверенного кадра с карточкой. При выборке фактический момент лежит между последним проверенным кадром без карточки и первым с ней; сохранить этот интервал.",
    wordErrorRate: "WER=(S+D+I)/N по проверенному человеческому reference после согласованной нормализации; N>0. Стороны и покрытие раздельно. Без reference — null, не оценка модели как истина.",
    timing: "Акустический конец реплики→полный готовый текст, STT final→ACK, конец реплики→видимый кадр — отдельные метрики. Только пары с якорем/погрешностью; число валидных и исключённых пар обязательно.",
    percentiles: "p50/p95 nearest-rank: отсортировать N валидных значений, взять ceil(p*N)-й элемент, p=0.50/0.95. N=0 → null; не смешивать разные маршруты и сборки.",
    translation: "Раздельно: текст перевода, отметка UI, видимый перевод и слышимый синтез. Наличие одного не доказывает другое; без соответствующей дорожки/кадра — неизвестно.",
    use: "Совпадение распознанной речи с текстом не равно использованию/полезности. Отзыв владельца хранится отдельным источником.",
  },
  resources: [
    { id: "lab-resource-materials", owner: "P.LAB / владелец материала", available: "Для нового видео/аудио корпуса не подтверждено",
      purpose: "Разрешённые исходные медиа + manifest", access: "Приватный доступ по callId; отдельное основание/согласие, цель и хранение",
      limits: "Срок хранения, объём файлов и маршрут загрузки не утверждены", expense: "Не установлена; покупок нет",
      check: "Получить разрешённый файл, проверить hash, читаемость, полноту и привязку к звонку" },
    { id: "lab-av-resource-video-tools", owner: "P.LG.TECH", available: "Нужен; ресурс worker не выдан",
      purpose: "Чтение контейнера, извлечение кадров/сцен с исходными PTS, OCR при необходимости",
      access: "Предложение: ffprobe/ffmpeg либо эквивалент на сервере, read-only вход",
      limits: "FPS выборки, точность, длительность, размер/CPU — неизвестны до проверки",
      expense: "Не измерена", check: "На согласованной фикстуре открыть видео, получить кадры с PTS и отчёт пропусков; наличие бинарника не достаточно" },
    { id: "lab-av-resource-gemini", owner: "P.LG.TECH; решение HEAD.07/владелец",
      available: "Gemini предложен владельцем; провайдер/модель/API и доступ worker не проверены",
      purpose: "Визуальная интерпретация разрешённого видео либо извлечённых кадров, гипотезы ошибок интерфейса",
      access: "Сначала проверить существующие интеграции/доступ проекта; ключи в документах не хранить",
      limits: "Контекст, видео/FPS, длительность, квоты, политика обработки/хранения — требуют проверки",
      expense: "Цена/лимит не утверждены; платных вызовов в этой задаче нет",
      check: "Отдельно разрешённая фикстура: реальные кадры/таймкоды → ответ → сверка с исходником → принятый QA протокол. Описание возможностей модели не равно проверке" },
    { id: "lab-av-resource-audio-tools", owner: "P.LG.TECH", available: "Нужен; отдельный аудиопроход не проверен",
      purpose: "Проверка аудио, каналов, разметка речи/пауз и сравнение STT; модель слушателя независима от оцениваемой STT",
      access: "Разрешённый локальный декодер; STT/модель выбираются после проверки существующего оснащения",
      limits: "Не пересэмплировать без фиксации преобразования; квоты и точность не установлены",
      expense: "Не измерена/не утверждена", check: "Фикстура с известным составом сторон и человеческим reference; проверить карту каналов и отчёт потерь" },
    { id: "lab-av-resource-alignment", owner: "P.LG.TECH", available: "Схема описана; реализация синхронизации не проверена",
      purpose: "Связать audio/video PTS и серверные/iPhone события без ложной точности",
      access: "Read-only снимки событий и manifest", limits: "Без якоря и погрешности сквозная задержка неизвестна",
      expense: "Не измерена", check: "Контрольная фикстура с известным смещением и пропуском события" },
    { id: "lab-resource-private-store", owner: "P.LG.TECH", available: "Есть общий ресурс; путь медиа-отчётов и права worker не проверены",
      purpose: "Исходники и версии результатов в существующем защищённом хранилище",
      access: "Не публичная модель/ссылка с capability; в crew только безопасные метаданные",
      limits: "Срок хранения/удаления и размер требуют решения", expense: "Не измерена",
      check: "Записать разрешённый результат и прочитать под тем же владельцем; отрицательная проверка другого владельца" },
    { id: "lab-resource-qa", owner: "HEAD.07", available: "Есть QA-роль; этот новый медиа-проход не выполнен",
      purpose: "Независимая проверка наблюдений и выводов", access: "Приватный исходник и пакет, не только слова автора",
      limits: "Сохранить фактический возврат; отсутствие QA не означает принято", expense: "Не измерена",
      check: "Контрольный пакет с известной ошибкой → возврат → исправление → реальная приёмка" },
  ],
  requests: [
    { id: "MEDIA.INPUT.OWNER", supplier: "Владелец через P.LAB", recipient: "LAB.1 → специалисты",
      request: "Существующее разрешённое видео/аудио тестового Hint-звонка и идентификатор; если нет — отметить отсутствие. Включить подтверждение обработки участников, цель и решение о хранении.",
      status: "ожидает входа; новый звонок или новая запись не запрашиваются автоматически", answer: null },
    { id: "MEDIA.INPUT.TECH", supplier: "P.LG.TECH", recipient: "LAB.INPUT.RECEIVE → оба специалиста",
      request: "Проверить приватный путь, форматы, права, инструменты кадров/звука и якорь синхронизации; предложить способ доступа Gemini и модель с условиями/стоимостью, без подключения и вызова.",
      status: "запрос описан и связан; ответ не получен", answer: null },
    { id: "MEDIA.INPUT.PRODUCT", supplier: "P.PRODUCT", recipient: "LAB.1 → оба специалиста",
      request: "Передать фактическую цель звонка, актуальную главу Hint/сборку, ожидаемое поведение и отдельный отзыв владельца.",
      status: "часть описания Hint существует; комплект на конкретный новый медиапроход не принят", answer: null },
  ],
  handoff: "Специалист формирует пакет → существующая LAB.QA принимает/возвращает по eventId/таймкоду → P.LAB принимает комплект и связывает видео+звук → LAB.2/LAB.MAIL.PREPARE. Дневной/недельный/месячный вклад → отдельное принимающее действие P.LAB → LAB.REPORT → HEAD.07. Код outbox не принимает QA.",
  decisions: "Формат JSON — черновик для ручного прохода владельцем. Полномочия выполнять медиа-анализ, внешний процессинг, ресурсы и KPI-нормативы не утверждены.",
  forms,
};

const specifications = {
  video: [
    ["INTAKE", "Принять видео и проверить достаточность входа", "P.LAB / LAB.1; владелец; P.PRODUCT", "Manifest, защищённый файл, цель/сборка, основание обработки", "Проверить область владельца, файл, hash, длительность, разрешения, цель и пригодность. Неполнота → MEDIA.INPUT.OWNER/TECH/PRODUCT, не выдумывать.", "Принятый технический комплект или адресный запрос с причиной", "lab-av-resource-video-tools"],
    ["FRAMES", "Получить таймлайн кадров и границы выборки", "Предыдущий шаг; P.LG.TECH", "Исходное видео и известная временная шкала", "Проверить декодирование и PTS. Предложить сцены/кадры вокруг появления карточек; сохранить частоту и пропуски. Между выборочными кадрами точный момент неизвестен.", "Индекс кадров/интервалов, покрытие и погрешность", "lab-av-resource-video-tools"],
    ["OBSERVE", "Описать видимые подсказки и состояние экрана", "Индекс кадров; актуальная глава Hint", "Кадры, текст/OCR, язык/варианты/геометрия карточек", "Gemini использовать только после выдачи ресурса. Привязать каждое наблюдение к реальному кадру/таймкоду, проверить OCR. Не восстанавливать невидимые экраны; ответы модели — гипотезы до проверки.", "Доказательный реестр видимых состояний", "lab-av-resource-gemini"],
    ["ALIGN", "Сопоставить видимый показ с событиями звонка", "P.LG.TECH; аудиоаналитик", "hintId/eventId, ui telemetry, якорь и смещение часов", "Сопоставить карточки по тексту/ID и времени. Отделить ACK, UI-событие и кадр. Записать погрешность; без якоря не считать точную сквозную задержку.", "Таблица соответствий и несопоставленных событий", "lab-av-resource-alignment"],
    ["FINDINGS", "Выделить проблемы показа и предложения UX", "Видимые состояния; P.PRODUCT/отзыв владельца", "Обрезка, наложение, смена/устаревание, длина/число вариантов", "Отделить видимую обрезку от гипотезы читаемости. Считать карточки/слова, а не объявлять чтение за секунду доказанным. Передать P.UX предложения через P.LAB, без изменения интерфейса.", "Находки с кадрами, ограничениями и адресными предложениями", "lab-av-resource-video-tools"],
  ],
  audio: [
    ["INTAKE", "Принять аудио и проверить состав дорожек", "P.LAB / LAB.1; владелец; P.LG.TECH", "Manifest, разрешённый оригинал, каналы, кодек, частота и карта сторон", "Проверить доступ/основание и целостность. Учитывать, на какой телефонной ноге записан поток: inbound/outbound не равны Owner/Guest автоматически. Не считать видео со включённым микрофоном записью обеих сторон.", "Комплект аудио или конкретный запрос недостающей стороны/данных", "lab-av-resource-audio-tools"],
    ["REFERENCE", "Подготовить временную разметку и проверяемый эталон", "Оригинал; P.LG.TECH; человек для спорного reference", "Речь, паузы, наложения, шум, доступные стороны", "Разметить сегменты с таймкодами. Не заменять пропавшую речь текстом модели. Эталон помечать непроверенным до человеческой верификации; не считать WER без проверенного reference.", "Разметка и версия эталона с неизвестными участками", "lab-av-resource-audio-tools"],
    ["STT", "Сравнить распознавание с исходной речью", "Разметка; текущая STT/логи от P.LG.TECH", "Текст STT, speaker map, эталон и правила нормализации", "Проверить пропуски/подмены, в том числе I see. При проверенном эталоне считать S/D/I/N по стороне и участку. Без него дать локальные доказательства и неизвестный WER; не назначать новую STT наугад.", "Различия STT, покрытие и ошибки с аудио-интервалами", "lab-av-resource-audio-tools"],
    ["TIMING", "Разобрать задержки и звук перевода", "P.LG.TECH; видеоаналитик", "Окончание речи по аудио, partial/final, ready/send/ACK/UI, синхронизация", "Разделить аудио EOT→готовая подсказка, STT final→ACK и видимый кадр; посчитать p50/p95 только для валидных сопоставлений. Перевод: проверить оригинал/синтез/эхо только по реально доступным дорожкам; маршрут Translator пока в плане.", "Таймлайн задержек и потерь с знаменателями/погрешностью", "lab-av-resource-alignment"],
    ["FINDINGS", "Сформировать звуковые причины и предложения стендам", "Результаты STT/тайминга; цель и отзыв владельца", "Качество речи, скорость/перебивания, цель, факты и контекст", "Разделить акустическую проблему, ошибку STT и ошибку подсказки. Причинность без доказательства — гипотеза. Предложить проверку связок через P.LAB/P.LG.TECH, не переключать продукт.", "Находки, последствия, гипотезы и задания на проверку", "lab-av-resource-audio-tools"],
  ],
} as const;

function metric(id: string, name: string, formula: string, unit: string, scope: string): WorkMetric {
  return { id, name, formula, unit, scope, plan: null, fact: null, numerator: null, denominator: null,
    evidence: "Проход не выполнялся; норматив не утверждён. Неизвестное не считать нулём." };
}

export function prepareLabMediaRoles(before: OperatingData, at: string) {
  const data = structuredClone(before);
  for (const id of [lab, qa, head, "dir-engineering", "lab-action-intake", "lab-action-qa",
    "lab-action-request", "lab-action-supply", "lab-action-analyze", "lab-action-period"])
    if (!data.nodes.some(n => n.id === id)) throw new Error(`Missing existing counterpart: ${id}`);
  function upsert(node: WorkNode) {
    const old = data.nodes.find(n => n.id === node.id);
    if (old) Object.assign(old, node, { status: old.status, executorId: old.executorId });
    else data.nodes.push(node);
  }
  function node(id: string, code: string, name: string, kind: WorkNode["kind"], roleId: string | null): WorkNode {
    return { id, code, name, kind, parentId: "dir-engineering", status: "proposal", description: source,
      purpose: name, clientId: lab, roleId, executorId: null, recipientId: lab, acceptorId: qa, nextId: null,
      resourceIds: ["lab-resource-materials", "lab-resource-private-store", "lab-resource-qa"],
      inputs: [], schedule: { days: [], hours: "", timezone: "America/Denver", trigger, deadline: "Не согласован; без намеренной отсрочки" },
      procedure: "", rules: "Не принимать собственные выводы; промежуточные технические проверки — не независимая QA.",
      constraints: boundary, success: "Каждый вывод связан с исходным интервалом/событием; неизвестное явно, статус не завышен.",
      storage: "Существующее приватное хранилище; в crew — безопасный указатель/метаданные и версии.",
      delivery: "Описан маршрут; реальной передачи/ответа или приёмки ещё нет.",
      exceptions: "Вернуть конкретный таймкод/поле и причину; запросить отсутствующий вход у указанного поставщика. Исправленная версия сохраняет историю.",
      questions: "Исполнитель не подключён; медиа, разрешения, инструменты/API, сроки и нормативы не подтверждены.",
      resourceState: null, referenceIds: [mediaProtocolId], detailState: "described",
      ...(kind === "action" || kind === "process" ? { workNature: "mixed" as const } : {}) };
  }
  function link(from: string, to: string, kind: WorkLink["kind"], reason: string) {
    const id = `lab-av:${kind}:${from}:${to}`;
    if (!data.links.some(l => l.id === id)) data.links.push({ id, from, to, kind, reason,
      readiness: { structure: "passed", resources: "unknown", trial: "unknown", evidence: `${mediaProtocolId}; только описание ${at}` } });
  }
  for (const r of mediaProtocol.resources.filter(r => r.id.startsWith("lab-av-resource"))) {
    const n = node(r.id, `RES.LAB.AV.${r.id.replace("lab-av-resource-", "").replace(/-/g, ".").toUpperCase()}`, r.purpose, "resource", "lg-technical-role");
    Object.assign(n, { resourceState: "required", resourceIds: [], acceptorId: head, purpose: r.purpose,
      procedure: r.check, description: JSON.stringify(r), rules: r.limits, constraints: `${r.access}. ${boundary}` });
    upsert(n);
  }
  const documents: { id: string; title: string; packet: Record<string, unknown> }[] = [];
  for (const spec of mediaRoles) {
    const role = node(spec.id, spec.code, spec.name, "role", spec.id);
    Object.assign(role, { managerId: lab, level: "operation", acceptorId: head,
      purpose: spec.mode === "video" ? "Дать P.LAB доказательства фактического показа Hint, не подменяя их ACK или догадкой о чтении."
        : "Дать P.LAB доказательства качества речи/STT и звуковых задержек, не выдавая модельный текст за эталон.",
      referenceIds: [spec.documentId, mediaProtocolId], procedure: "Выполнять действия ниже по выданному комплекту; недостающие входы запрашивать. Передавать результат независимой QA и P.LAB.",
      resourceIds: [...role.resourceIds, "lab-av-resource-alignment", spec.mode === "video" ? "lab-av-resource-video-tools" : "lab-av-resource-audio-tools",
        ...(spec.mode === "video" ? ["lab-av-resource-gemini"] : [])] });
    role.metrics = [
      metric(`${spec.code}.coverage`, "Покрытие согласованного корпуса", "проверенные допустимые материалы / все допустимые материалы согласованного плана ×100; при неизвестном знаменателе null", "%", "План по callId/mediaId за период; не весь продукт"),
      metric(`${spec.code}.acceptance`, "Приёмка с первого предъявления", "пакеты, впервые принятые независимой QA / впервые рассмотренные QA пакеты ×100; ожидающие исключены с отдельным счётчиком", "%", "Период и первая версия пакета"),
      metric(`${spec.code}.evidence`, "Доказательность находок", "находки с проверенным исходным интервалом / все предъявленные проверяемые находки ×100; гипотезы отдельно", "%", "Полный предъявленный реестр; выборку и потери указать"),
    ];
    upsert(role);
    link(role.id, lab, "accountable_to", "Подчинённость P.LAB; HEAD.07 контролирует направление.");
    const rows = [
      ...specifications[spec.mode],
      ["REPORT", "Сформировать отчёт и передать независимой QA", "Все предыдущие шаги", "Доказательства, метрики с знаменателями, пропуски и предложения",
        "Заполнить форму perCall и finding, сохранить версию; передать LAB.QA с доступным исходником. Не заявлять приёмку до реального ответа.",
        "Версионированный отчёт и ожидающая передача QA", "lab-resource-qa"],
      ["REWORK", "Принять замечания и вернуть исправленную версию", "P.LG.QA / LAB.QA либо P.LAB", "Реальные замечания по интервалам, категории и недостающим полям",
        "Подтвердить получение; разобрать каждое замечание, исправить либо доказательно возразить. Сохранить было/стало и отправить QA. Не запускать бесконечные циклы; повторный лимит требует решения.",
        "Ответ по замечаниям и новая версия либо адресный blocker", "lab-resource-qa"],
      ["PERIOD", "Собрать дневной, недельный и месячный план-факт", "Собственные версии и реальные решения QA/P.LAB", "План, обработанные и заблокированные материалы, приёмка, находки и ресурсы",
        "Дневной журнал → недельный план-факт → месячный вклад. Исключить дубли по reportId/version, сохранять ссылки на доказательства. Принимать нормативы и часы отчёта только после решения.",
        "Вклад по формам daily/weekly/monthly; P.LAB принимает отдельным действием", "lab-resource-private-store"],
    ];
    const actions: WorkNode[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const [suffix, name, supplier, input, procedure, output, resource] = row;
      const n = node(`lab-${spec.mode}-action-${suffix.toLowerCase()}`, `${spec.code}.${suffix}`, name, "action", spec.id);
      n.referenceIds.push(spec.documentId);
      n.inputs = [{ name: `${input}; поставщик: ${supplier}`, sourceId: i === 0 ? "lab-action-intake" : actions.at(-1)!.id, freshness: "тот же callId, версия и снимок; актуальность проверяется" }];
      if (suffix === "REWORK") n.inputs[0].sourceId = "lab-action-qa";
      if (suffix === "PERIOD") n.inputs[0].sourceId = `lab-${spec.mode}-action-report`;
      if (i === 2 || i === 3) n.inputs.push({ name: "Фактические инструменты, карта сторон/события и якорь; поставщик P.LG.TECH",
        sourceId: "lab-action-supply", freshness: "ответ на MEDIA.INPUT.TECH, та же версия источника" });
      n.procedure = procedure;
      n.purpose = output;
      n.resourceIds = Array.from(new Set([...n.resourceIds, resource]));
      n.success += ` Результат: ${output}. Приёмка: полнота входов, верный говорящий/таймкод, источник, ограничения, отсутствие неподтверждённых фактов.`;
      n.rules += " Контролёр HEAD.07; содержание независимо проверяет P.LG.QA; комплектность/включение в сводку принимает P.LAB.";
      n.acceptorId = suffix === "PERIOD" ? lab : qa;
      n.recipientId = ["REPORT", "REWORK"].includes(suffix) ? qa : lab;
      n.nextId = suffix === "PERIOD" ? "lab-av-accept-period" : ["REPORT", "REWORK"].includes(suffix) ? "lab-action-qa"
        : `lab-${spec.mode}-action-${rows[i + 1]?.[0].toLowerCase()}`;
      n.reporting = { required: true, formName: suffix === "PERIOD" ? "daily → weekly → monthly" : "perCall / finding; версия и процедура",
        templateDocumentId: mediaProtocolId, templateVersion: "1", storage: n.storage, formStatus: "draft", approvalEvidence: "" };
      n.metrics = role.metrics.map(m => ({ ...m, id: `${n.code}:${m.id}` }));
      if (suffix === "PERIOD") n.schedule.trigger = "Дневной итог, недельный план-факт, месячный вклад; точное время/границы периода не согласованы";
      else if (suffix === "REWORK") n.schedule.trigger = "Только фактически полученный возврат QA/P.LAB; нет ответа — ожидание, не фиктивная доработка";
      else if (i > 0) n.schedule.trigger = "Достаточный результат предыдущего шага; обработка по событию без намеренной отсрочки";
      upsert(n); actions.push(n);
      link(n.id, resource, "requires", "Ресурс обязателен; фактическая выдача не подтверждена.");
      if (i > 0 && i < 6) link(actions[i - 1].id, n.id, "handoff", `${output}; промежуточная проверка не равна QA.`);
    }
    link("lab-action-intake", actions[0].id, "handoff", "Разрешённый комплект конкретного звонка; без файла — запрос, не фиктивный проход.");
    link(actions[0].id, "lab-action-request", "handoff", "Недостающие входы → существующий адресный запрос лаборатории.");
    link("lab-action-supply", actions[0].id, "return", "Технический ответ/предоставленный ресурс возвращается конкретному специалисту; ответа пока нет.");
    for (const n of actions.filter(a => /REPORT|REWORK/.test(a.code))) {
      link(n.id, "lab-action-qa", "handoff", "Результат и исходное доказательство на независимую QA.");
      link("lab-action-qa", actions.find(a => a.code.endsWith(".REWORK"))!.id, "return", "Возврат с конкретным интервалом/полем; не имитировать ответ.");
    }
    link(actions.at(-1)!.id, "lab-av-accept-period", "handoff", "Отчёт исполнителя и парное принимающее действие P.LAB.");
    documents.push({ id: spec.documentId, title: `${spec.code} — ${spec.name} — рабочий JSON v1 — на сверке`,
      packet: { format: "talkhint.crew.role-package", version: 1, snapshotDate: "2026-10-27", capturedAt: at,
        source, status: "описано; оснащение и ручной проход не подтверждены", role, actions,
        client: "Внутренний: P.LAB; QA проверяет выводы. P.PRODUCT и P.UX получают сводные вопросы через P.LAB. Внешний клиент напрямую не обслуживается.",
        procedure: "INTAKE → разбор → REPORT → независимая LAB.QA → REWORK при реальном возврате → P.LAB; PERIOD отдельным маршрутом.",
        decisionRights: "Read-only анализ только выданного разрешённого материала; адресные запросы и предложения. Не принимает своё заключение, не меняет продукт и не тратит деньги.",
        resources: mediaProtocol.resources.filter(r => role.resourceIds.includes(r.id)),
        forms, protocolDocumentId: mediaProtocolId, requests: mediaProtocol.requests,
        trialProtocol: actions.map(a => ({ actionId: a.id, status: "не выполнено", result: null, evidence: null,
          reason: "Задача — описание обязанностей; медиа/ресурсы и разрешение исполнения не выданы",
          missingInputs: a.inputs.map(x => x.name), responsible: a.roleId, qaAcceptance: null })),
        interpretation: "описано ≠ реализовано ≠ проверено ≠ принято; будущий runtime не запущен" } });
  }
  for (const [id, code, name, procedure, nextId] of [
    ["lab-av-accept-reviewed", "LAB.AV.RECEIVE", "Принять проверенные видео/аудио материалы и собрать общий результат",
      "Получить оба отчёта либо явное отсутствие одного. Проверить реальный вердикт LAB.QA, совпадение callId/версий, полноту и противоречия. Не смешивать визуальный показ, звук и использование. При отсутствии QA пометить непроверенным. Передать доказательства в LAB.2; письмо формирует существующая LAB.MAIL.PREPARE.", "lab-action-analyze"],
    ["lab-av-accept-period", "LAB.AV.PERIOD.RECEIVE", "Принять периодические отчёты специалистов",
      "Подтвердить получение daily/weekly/monthly, проверить план/факт, знаменатели, дубли, блокеры и ссылки. Вернуть конкретные пробелы; принятый вклад включить в LAB.REPORT. График и нормативы не выдумывать.", "lab-action-period"],
  ]) {
    const n = node(id, code, name, "action", lab);
    Object.assign(n, { procedure, nextId, acceptorId: head, recipientId: lab,
      inputs: mediaRoles.map(r => ({ name: `${r.code}: отчёт с доказательствами и статусом QA`, sourceId: `lab-${r.mode}-action-${id.endsWith("period") ? "period" : "report"}`, freshness: "тот же звонок или отчётный период" })),
      exceptions: "Возврат соответствующему специалисту с причиной/полем. Не считать получением само наличие документа." });
    upsert(n);
    link(id, nextId, "handoff", "Продолжение существующей лабораторной и общей отчётности, не параллельный отчётный каталог.");
    for (const r of mediaRoles) link(id, `lab-${r.mode}-action-${id.endsWith("period") ? "period" : "rework"}`, "return", "Парный возврат конкретному поставщику.");
  }
  link("lab-action-qa", "lab-av-accept-reviewed", "handoff", "Фактический вердикт и проверенные исходники; не ожидаемый/придуманный ответ.");
  for (const id of [lab, "lab-action-intake", "lab-action-qa", "lab-action-request", "lab-action-supply", "lab-action-period"]) {
    const n = data.nodes.find(x => x.id === id)!;
    if (!n.referenceIds.includes(mediaProtocolId)) n.referenceIds.push(mediaProtocolId);
    if (!n.description.includes("LAB.MEDIA.EXTENSION")) n.description += `\nLAB.MEDIA.EXTENSION: ${mediaProtocolId}. Два специалиста → существующие LAB.1/LAB.INPUT.REQUEST/LAB.INPUT.RECEIVE/LAB.QA/LAB.REPORT; исполнение не включено.`;
  }
  return { data, documents, protocol: mediaProtocol };
}
