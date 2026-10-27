/** Documentation-only revision of the canonical P.LAB. Never imports runtime/provider modules. */
import assert from "node:assert/strict";
import type { ProjectModelState } from "../../../shared/projectModel";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { buildLabPacket, labRoleId, labPacketId, labFormId } from "./labRole";

export const reviewId = "DOC-PLAB-MANUAL-PASS-REV768";
export const protocolId = "DOC-PLAB-MANUAL-PROTOCOL-REV768";
export const rubricId = "DOC-PLAB-REVIEW-RUBRIC";
export const methodId = "DOC-PLAB-METHOD-RESPONSE";
export const diffId = "DOC-PLAB-V2-CHANGES";
const action = (s: string) => `lab-action-${s}`;
const result = (s: string) => `lab-result-${s}`;

export const rubric = {
  version: 1, status: "Черновик для сверки v2; не утверждённый норматив",
  judgeVersion: "plab-rubric-v1",
  rules: "Оценивать по контексту до подсказки, известной цели и разрешённым фактам. Приводить событие/таймкод и основание; недостаточно данных = неизвестно. Категории — основная оценка плюс независимые флаги дубля/пропуска. AI-оценка не отзыв владельца.",
  categories: [
    { name: "верная", definition: "Соответствует контексту, роли владельца и известным фактам, даёт применимый следующий ответ.", example: "На вопрос о времени приезда предлагает уточнить доступное окно, не выдумывая время." },
    { name: "бесполезная", definition: "Не содержит установленной ошибки, но не помогает текущему следующему действию.", example: "Повторяет приветствие после перехода к обсуждению цены." },
    { name: "ошибочная", definition: "Противоречит проверенному контексту, роли или смыслу реплики.", example: "Предлагает согласиться на выезд после явного отказа владельца." },
    { name: "выдумка", definition: "Добавляет конкретный факт/обещание без основания в доступных данных.", example: "Называет неподтверждённую цену ремонта $50." },
    { name: "дубль", definition: "Повторяет уже доставленный смысл без новой потребности или изменения контекста.", example: "Дважды подряд предлагает один и тот же вопрос о цене при отсутствии новой реплики." },
    { name: "пропуск", definition: "По полной доступной истории была явная возможность помочь по цели, но своевременной доставленной подсказки нет. Без полноты событий не подтверждать.", example: "Собеседник задал существенный вопрос, владелец затруднился; полный журнал не содержит подсказки до смены темы." },
  ],
};

export const methodResponse = {
  version: 1, status: "Частичный технический ответ Replit по текущему коду; независимая QA не проведена",
  sender: "Ручная Dev-сессия Replit, техническое исследование; не запущенный P.LG.TECH",
  requestAction: "LAB.INPUT.REQUEST", receivingAction: "LAB.INPUT.RECEIVE", recipientRole: "P.LG.TECH",
  source: "02_LAB.METHOD_находки.md из ручного прохода rev768; наблюдения автора не заменены выводами Replit",
  requests: [
    { id: "PLAB-METHOD-1", question: "Encoding, sample_rate, channels, скорость replay",
      answer: "Три Deepgram-кандидата объявляют mulaw/8000; harness передаёт 160-байтные кадры каждые 5мс (×4). WAV разбивается на каналы и преобразуется в mulaw8k. OpenAI realtime получает PCM16/24k после конвертации mulaw8k, также ускоренно. Параметры текущего кода не доказывают параметры исторических прогонов.",
      sources: ["server/benchmark/candidates.ts", "server/benchmark/earsHarness.ts: REALTIME_ACCEL, streamDeepgram, streamOpenAiRealtime, jobs"],
      status: "частичный ответ", missing: "Исторический config и исходные аудиофайлы каждого run; гипотеза неправильного encoding не подтверждена." },
    { id: "PLAB-METHOD-2", question: "Как вычислен hash; почему результаты одинаковы",
      answer: "corpusHash сортирует фикстуры по id и хеширует id, JSON referenceTurns и goal; аудиобайты не входят. Пустой список даёт начало SHA256 пустой строки. createRun сохраняет hash без проверки непустоты в самой функции. Одинаковый WER не доказывает кэширование; в текущем harness кандидаты обрабатываются отдельно.",
      sources: ["server/benchmark/seed.ts: corpusHash", "server/benchmark/orchestrator.ts: createRun", "server/benchmark/earsHarness.ts"],
      status: "частичный ответ", missing: "Восстановить состав и происхождение двух исторических запусков; все вызывающие пути пустого run не проверены." },
    { id: "PLAB-METHOD-3", question: "Формула WER и нормализация",
      answer: "wordErrorRate = Levenshtein по словам / число слов reference; lowercase, удаление пунктуации, схлопывание пробелов. Пустой reference: 0 при пустом hypothesis, иначе условное 1. Harness считает канал целиком; aggregateScorecard взвешивает WER количеством слов reference. WER > 1 математически возможен при вставках, сам по себе не дефект. turnsScored=0 совместим с channel-level WER при отсутствии доказанного выравнивания.",
      sources: ["server/benchmark/earsMetrics.ts: normalizeText, wordErrorRate, aggregateScorecard", "server/benchmark/earsHarness.ts: docAligned, alignProvably"],
      status: "ответ по коду", missing: "Историческая версия кода и фактические тексты для пересчёта без нового API-прогона." },
    { id: "PLAB-METHOD-4", question: "Кто создал/проверил reference трёх фикстур",
      answer: "По коду нельзя установить авторство и подтверждение конкретных трёх исторических reference. Отчёт различает human-verified и STT-assisted reference; последний может давать смещение в пользу OpenAI.",
      sources: ["server/benchmark/report.ts", "server/benchmark/seed.ts"],
      status: "ожидает вход", missing: "P.LG.TECH: три fixture_id, referenceTurns, verified/evidence и история; материалы пока не получены." },
    { id: "PLAB-METHOD-5", question: "База времени eotP50 и finalP50",
      answer: "atMs измеряется от старта websocket локальным nowMs. final задержка = (hypAtMs - lastFrameSentAtMs) ×4 при неотрицательной разнице; EOT = hypAtMs ×4 - reference.tEndMs. Перцентили берутся по непустым значениям. В коде отмечено, что Deepgram при ускоренной отправке может отставать на минуты, и описана защита от обрезания хвоста. Эти оценки не являются измерением реальной latency без ускорения.",
      sources: ["server/benchmark/earsHarness.ts: streamDeepgram, scoreTurn", "server/benchmark/earsMetrics.ts: aggregateScorecard"],
      status: "частичный ответ", missing: "Сырые события старых run, часы и границы reference; численные причины конкретных 120–205 секунд не доказаны." },
  ],
  disposition: "Ответы записаны вручную Replit. Ответ/приёмка P.LAB и независимая QA ожидаются. Новые прогоны, чтение звонков и API не выполнялись.",
};

export const changes = [
  "1. LAB.2 → LAB.8 (выполнен/не выполнен с причиной) → LAB.QA; параллельный вход QA удалён.",
  "2. Максимум два возврата QA; затем письмо QA: расхождения не устранены. Результат не становится принятым.",
  "3. Альтернативный путь LAB.8 → письмо при недоступной QA; новая версия после поздней QA.",
  "4. HEAD.07 — выборочный последующий контроль, не шлюз каждого письма.",
  "5. Предложены agent-1/P.LAB и независимый agent-2/P.LG.QA; outbox — код. Ничего не назначено/запущено.",
  "6. Вход LAB.PRODUCT только из принятого QA разбора либо принятой сводки, не сырой LAB.2.",
  "7. Решение продукта возвращается в LAB.REPORT, будущий LAB.7 — только предложение, без создания фиктивного действия.",
  "8. В тему возвращены длительность, ошибки и пропуски; неизвестное ?, не 0.",
  "9. Четыре KPI переименованы с сохранением legacy aliases. Технологии/дизайн исключены из KPI P.LAB, предполагаемые P.TECH/P.UX не создаются и не назначаются.",
  "10. Заполнены паспорт, триггер и success/failure; экспорт теперь включает явные критерии.",
  "11. Версионированная рубрика с примерами сохранена отдельным связанным документом; статус для сверки.",
];

export function reviseLabRole(root: ProjectModelState, pass: any, fixes: string, findings: string, now: string) {
  const state = readHypothesis(root, "new-country");
  assert.equal(pass.metadata.sourceRevision, 768);
  assert.equal(pass.trialProtocol.length, 14);
  assert.ok(pass.manualPass);
  const oldPacket = JSON.parse(state.documents.find(d => d.id === labPacketId)!.text);
  if (oldPacket.version === 2) return root;
  assert.equal(state.revision, 768, "Reconcile newer revision before writing");
  const original = state.operatingModel!.revisions.at(-1)!;
  const data = structuredClone(original.data);
  const node = (s: string) => { const n = data.nodes.find(n => n.id === s); assert.ok(n, s); return n; };
  const role = node(labRoleId), head = role.managerId!;
  const aliases: Record<string, string> = { test_calls_done: "owner_calls_received", review_on_time: "reviews_accepted",
    quality_report_on_time: "quality_blocks_accepted", report_on_time: "period_reports_accepted" };
  const adjacent = new Set(["scouting_on_time", "candidates_accepted", "proposals_accepted"]);
  for (const n of data.nodes.filter(n => n.id === labRoleId || n.id.startsWith("lab-action-"))) {
    n.metrics = n.metrics?.filter(m => !adjacent.has(m.id)).map(m => ({ ...m, id: aliases[m.id] ?? m.id }));
  }
  Object.assign(role, {
    description: "Одна проектируемая AI-должность анализа звонков по фактическому режиму. Работник ещё не запущен.",
    storage: "Общая модель хранит описание; материалы и почта — только в защищённом хранилище.",
    delivery: "Письмо владельцу через код outbox; проверенные продуктовые вопросы продукту; сводки HEAD.07.",
    exceptions: "Неизвестные данные → адресный запрос. Сбой QA не останавливает информационное письмо; это не приёмка.",
    procedure: "Материалы → разбор → прогон/не выполнен → независимая QA → письмо; сбой QA/два возврата → письмо с явными ограничениями.",
    schedule: { ...role.schedule, trigger: "Завершение разрешённого звонка владельца; новый результат QA; закрытие отчётного периода" },
    referenceIds: [...role.referenceIds, reviewId, protocolId, rubricId, methodId],
  });
  const set = (s: string, fields: object) => Object.assign(node(action(s)), fields);
  set("analyze", { nextId: action("run"), recipientId: node(action("run")).roleId,
    inputs: [...node(action("analyze")).inputs, { name: "Версия рубрики", sourceId: head, freshness: `${rubricId} v1, черновик` }] });
  // Recipient and acceptor remain distinct: the author routes the result but never accepts its own analysis.
  set("qa", { inputs: [{ name: "Разбор LAB.2 и протокол LAB.8, рубрика v1", sourceId: result("run"), freshness: "Одна версия звонка/разбора" }],
    recipientId: labRoleId, clientId: labRoleId, acceptorId: node(action("send")).roleId,
    procedure: node(action("qa")).procedure + " Не более двух возвратов к LAB.2 на цепочку звонка; затем QA: расхождения не устранены со списком. При сбое/недоступности QA письмо НЕ ПРОВЕРЕНО QA. HEAD.07 контролирует выборочно после факта, письмо не ждёт.",
    success: "Реальное независимое решение QA и доказательства; HEAD.07 не обязательный шлюз отправки.",
    exceptions: "Два возврата исчерпаны → письмо с расхождениями; сбой QA → непроверенное письмо, не ложная приёмка." });
  set("letter", { inputs: [
    { name: "Разбор и протокол LAB.8", sourceId: result("run"), freshness: "Актуальная версия" },
    { name: "QA: решение, расхождения либо явная недоступность", sourceId: result("qa"), freshness: "Опциональный вход; отсутствие не блокирует письмо" }],
    procedure: node(action("letter")).procedure + " После двух возвратов: QA: расхождения не устранены. При отсутствии QA отправить НЕ ПРОВЕРЕНО QA без ожидания HEAD.07. Поздняя QA создаёт новую report_version, а не незаметную повторную отправку той же версии." });
  set("send", { procedure: node(action("send")).procedure + " Исполнитель — обычный серверный код outbox, не LLM. Dedup по call_id/report_version; late-QA correction отдельная версия." });
  set("product", { inputs: [{ name: "Только независимо принятый QA разбор либо принятая сводка", sourceId: result("qa"), freshness: "verdict=accepted; непроверенные письма не принятие" }],
    procedure: node(action("product")).procedure + " Нет принятого материала → ожидает, не блокирует письмо." });
  set("product-receive", { nextId: action("period"), procedure: node(action("product-receive")).procedure + " Решение → LAB.REPORT, раздел решения. Будущий LAB.7 потребует отдельного согласования." });
  for (const n of data.nodes.filter(n => n.id.startsWith("lab-action-"))) {
    n.referenceIds = Array.from(new Set([...n.referenceIds, rubricId, reviewId]));
    n.exceptions += " Неуспех фиксировать с причиной и адресатом, не считать выполнением.";
    if (n.reporting) n.reporting.templateVersion = "2";
    n.delivery = `Результат ${result(n.id.replace("lab-action-", ""))} → ${n.recipientId}; ответ/возврат фиксируется, отсутствие не приёмка.`;
    const r = node(result(n.id.replace("lab-action-", "")));
    r.clientId = n.clientId;
    r.recipientId = n.recipientId;
    r.delivery = n.delivery;
    // Explicit success/failure in the exported procedure are filled, not a schema extension.
  }
  const remove = new Set([
    `${result("analyze")}:${action("qa")}`, `${result("analyze")}:${action("product")}`,
    `${result("product-receive")}:${action("intake")}`,
  ]);
  data.links = data.links.filter(l => !remove.has(`${l.from}:${l.to}`));
  const add = (from: string, to: string, reason: string) => {
    node(from); node(to);
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === "handoff"))
      data.links.push({ id: `lab:handoff:${from}:${to}`, from, to, kind: "handoff", reason,
        readiness: { structure: "passed", resources: "unknown", trial: "unknown", evidence: "Описание v2; runtime не выполнен" } });
  };
  add(result("analyze"), action("run"), "Строгая последовательность до QA");
  add(result("run"), action("letter"), "Только при недоступной QA; НЕ ПРОВЕРЕНО QA");
  add(result("qa"), action("product"), "Только verdict accepted");
  add(result("period-receive"), action("product"), "Только принятая сводка");
  add(result("product-receive"), action("period"), "Решение → отчётность, не новый приём звонка");
  for (const l of data.links.filter(l => l.from === action("qa") && l.to === head && l.kind === "acceptance")) {
    l.to = node(action("send")).roleId!;
    l.id = `lab:acceptance:${action("qa")}:${l.to}`;
    l.reason = "P.OPS принимает только комплектность статуса QA для письма; не меняет verdict QA. HEAD.07 контролирует выборочно после факта.";
  }
  for (const l of data.links.filter(l => l.from === action("qa") && l.to === action("analyze") && l.kind === "return"))
    l.reason = "Не более двух возвратов; затем письмо с неустранёнными расхождениями, не приёмка";
  let next = root;
  const save = (id: string, title: string, value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    assert.ok(text.length <= 50000, `${id} exceeds document limit: ${text.length}`);
    const exists = readHypothesis(next, "new-country").documents.some(d => d.id === id);
    next = applyHypothesisCommand(next, "new-country", { type: exists ? "saveDocument" : "createDocument",
      id, title, text, url: "", elementIds: [] }, "Replit: ручной проход P.LAB и исправления описания v2; runtime запрещён");
  };
  // Lossless two-part record: original package body plus filled trialProtocol/manualPass.
  const { trialProtocol, manualPass, ...body } = pass;
  save(reviewId, "P.LAB — переданный проход rev768 — тело без протокола", body);
  save(protocolId, "P.LAB — переданный проход rev768 — протокол и вердикт", { trialProtocol, manualPass,
    reconstruction: `Полный объект = тело ${reviewId} + trialProtocol + manualPass из этого документа` });
  save(rubricId, "P.LAB — рубрика разбора v1 — на сверке", rubric);
  save(methodId, "P.LAB — LAB.METHOD — находки и технический ответ v1", { originalFindings: findings, ...methodResponse, checkedAt: now });
  save(diffId, "P.LAB — изменения v1 → v2", { changes, originalReview: fixes, status: "Исправления подготовлены; сверка владельцем ожидается", at: now });
  const form = JSON.parse(state.documents.find(d => d.id === labFormId)!.text);
  form.version = 2;
  form.subject = "[Лаборатория · {режим}] {дата} · {языки} · {длительность} · ошибок {N|?} · пропущено {N|?} · {статус QA}";
  form.rules.push("QA недоступна → НЕ ПРОВЕРЕНО QA; после двух возвратов → QA: расхождения не устранены. Это не приёмка.");
  form.rubricDocumentId = rubricId;
  save(labFormId, "P.LAB — форма письма v2 — на сверке", form);
  next = applyHypothesisCommand(next, "new-country", { type: "saveOperatingModel", baseVersion: original.version, data },
    "Replit: исправления 1–11 после ручного прохода; роли и действия сохранены");
  const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
  const roadmap = state.documents.find(d => d.id === roadmapId);
  if (roadmap) save(roadmapId, roadmap.title, roadmap.text + `\n\nP.LAB v2: ручной проход rev768 сохранён (${protocolId}), исправления ${diffId}. Сейчас: сверка изменённых мест v2 владельцем. После явного «да» — отдельный этап установки CrewAI. Worker/почта/QA не запущены.`);
  const s = readHypothesis(next, "new-country");
  const packet: any = buildLabPacket({ ...s, revision: s.revision + 1 });
  packet.version = 2;
  packet.metadata.capturedAt = now;
  packet.metadata.stage = "Ручной проход v1: принять с исправлениями; v2 ожидает сверки";
  packet.gate.jsonManualPass = "v1 пройден с исправлениями; v2 не принят";
  packet.manualReview = { sourceRevision: 768, verdict: manualPass.verdict, bodyDocumentId: reviewId, protocolDocumentId: protocolId, diffDocumentId: diffId };
  packet.executionProposal = {
    status: "Спецификация будущего пилота, не назначение и не работающие исполнители",
    agent1: { role: "P.LAB", tasks: ["разбор", "подготовка письма"] },
    agent2: { role: "P.LG.QA", context: "независимый, отдельный от agent1" },
    transport: { role: "P.OPS", executor: "обычный серверный код outbox", active: false },
    pending: ["P.PRODUCT", "P.COORD"], head07: "Replit только в текущей Dev-сессии; выборочный последующий контроль, не шлюз письма",
  };
  packet.futureRuntime.passes = ["P.LAB анализ", "LAB.8 выполнен/не выполнен", "независимая QA либо явная недоступность", "P.LAB письмо", "outbox код"];
  packet.flowPolicy = { sequence: ["LAB.2", "LAB.8", "LAB.QA", "LAB.MAIL.PREPARE", "LAB.MAIL.SEND"],
    maxQaReturns: 2, onExhausted: "QA: расхождения не устранены", onQaUnavailable: "НЕ ПРОВЕРЕНО QA",
    lateQa: "Новая версия письма с новым dedup ключом; не менять прошлую",
    noWaitFor: ["HEAD.07", "P.PRODUCT", "P.COORD"] };
  packet.metricAliases = aliases;
  packet.adjacentMetricProposals = { "P.TECH": ["scouting_on_time", "candidates_accepted"], "P.UX": ["proposals_accepted"],
    status: "Предлагаемое соответствие; наличие/назначение этих ролей не подтверждено; чужие паспорта не изменены" };
  packet.rubric = { documentId: rubricId, ...rubric };
  packet.methodRequests = { documentId: methodId, status: methodResponse.status, requestIds: methodResponse.requests.map(r => r.id) };
  packet.actionCommon.execution = "Только ручное описание; executionProposal не назначает executor";
  packet.task.steps = ["Сверить diff v1→v2", "Проверить LAB.2→LAB.8→QA и оба обхода QA", "Проверить письмо/дедуп/приёмку продукта", "Явно принять либо вернуть v2; установка до отдельного да запрещена"];
  for (const a of packet.actions) {
    const n = node(a.id);
    a.success = n.success;
    a.failure = n.exceptions;
    delete a.acceptance; // Same value is exposed as success, not duplicated.
    a.reportingTemplateVersion = "2";
  }
  // Lossless factoring of repeated exported defaults. Canonical nodes stay complete.
  packet.actionCommon.status = "описано; выполнение/проверка/приёмка не подтверждены";
  packet.actionCommon.controllerId = head;
  packet.actionCommon.schedule = packet.actions[0].schedule;
  packet.actionCommon.failure = node(action("intake")).exceptions;
  for (const a of packet.actions) {
    delete a.status;
    delete a.controllerId;
    if (a.failure === packet.actionCommon.failure) delete a.failure;
    if (JSON.stringify(a.schedule) === JSON.stringify(packet.actionCommon.schedule)) delete a.schedule;
  }
  packet.resultCommon = { status: "Схема результата; не выполнено" };
  for (const r of packet.results) delete r.status;
  packet.linkCommon = { readiness: { structure: "passed", resources: "unknown", trial: "unknown" },
    evidence: "Структурные ссылки существуют; реальные ресурсы/QA/исполнение не проверены" };
  for (const l of packet.links) {
    if (l.readiness?.structure === "passed" && l.readiness?.resources === "unknown" && l.readiness?.trial === "unknown")
      delete l.readiness;
  }
  packet.exportRules = "Отсутствующее поле action берётся из actionCommon (status/controllerId/schedule/failure). result.status из resultCommon; link.readiness из linkCommon. Это нормализация повторов, не отсутствие требования.";
  save(labPacketId, "P.LAB — рабочий JSON v2 — ожидает сверки", packet);
  const after = readHypothesis(next, "new-country");
  assert.equal(JSON.parse(after.documents.find(d => d.id === labPacketId)!.text).metadata.sourceRevision, after.revision);
  assert.deepEqual(after.elements, state.elements);
  assert.deepEqual(after.relations, state.relations);
  return next;
}
