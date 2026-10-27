/** Existing Dev organization only; preserves history through the existing CAS archive. */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { renderProcessLetter } from "../server/callLab/processReport";
import type { WorkNode } from "../shared/operatingModel";
import { productBookMarker, productBookText, readProductBook } from "../shared/productBook";

const dir = "generated-artifacts/hint-owner-feedback-1";
const complaintId = "DOC-HINT-OWNER-FEEDBACK-001";
const factsId = "DOC-HINT-FAST-DIALOGUE-FACTS";
const trialId = "DOC-HINT-FAST-DIALOGUE-TRIAL";
const marker = "HINT-OWNER-FEEDBACK-001";
const documentUrl = (id: string) => {
  assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+$/i);
  return `https://${process.env.REPLIT_DEV_DOMAIN}/api/admin/product-crew/documents/${id}/download`;
};
const corpus: any[] = JSON.parse(await readFile(`${dir}/corpus.json`, "utf8"));
const bench = JSON.parse(await readFile(`${dir}/bench-results.json`, "utf8"));
assert.equal(bench.rows.length, 18);
const median = (xs: number[]) => { const a = [...xs].sort((a, b) => a - b); return Math.round(a[Math.floor(a.length / 2)]); };
const summaries = ["existing_prompt", "compact"].map(variant => {
  const rows = bench.rows.filter((r: any) => r.variant === variant);
  return { variant, completed: rows.length,
    completeJsonMedianMs: median(rows.map((r: any) => r.completeJsonMs)),
    firstDeltaMedianMs: median(rows.map((r: any) => r.firstDeltaMs)),
    englishWordsMedian: median(rows.flatMap((r: any) => r.englishWordCounts)),
    maxCards: Math.max(...rows.map((r: any) => r.cardCount)) };
});
const at = new Date().toISOString();
const steps = [
  { number: 1, role: "P.PRODUCT", roleId: "product-manager-specialist",
    actionId: "company-action-product", receivingActionId: "lab-action-intake",
    resultId: "hint-feedback-001-intake", status: "Жалоба принята и зарегистрирована",
    input: "Обращение владельца №1; поставщик — Сергей",
    procedure: "Сохранить слова владельца и границы разрешения. Связать с существующими действиями; передать в LAB.1, ENG.1.2, MKT.2.11 и PRD.REG.1.",
    result: "Запись жалобы и маршруты рассмотрения без продуктового изменения",
    recipient: "P.LAB; P.LG.TECH; P-BENCH; P.UX",
    acceptance: "Исходное наблюдение владельца не заменено speech-match; источники и запреты сохранены",
    returnRule: "Не тот звонок, потеря исходной цели или обещание изменения продукта — вернуть продукту" },
  { number: 2, role: "P.LAB", roleId: "laboratory-engineer-role",
    actionId: "lab-action-analyze", receivingActionId: "lab-action-product-receive",
    resultId: "hint-feedback-001-facts", status: "Ручной инженерный разбор сохранённых текстов и событий подготовлен; независимая QA не выполнена",
    input: "Три сохранённых owner-call; поставщик — существующее хранилище звонков, production read-only",
    procedure: "Сверить время/события, цель и тексты; сравнить Mint и кофейню. Отделить жалобу, счётчики, оценку и неизвестное.",
    result: "Сравнение трёх звонков, ошибочная подсказка о списании, ограничения отсутствующего аудио",
    recipient: "P.PRODUCT; P.LG.TECH; P.UX",
    acceptance: "Задержки с одинаковым определением, нуля использования владельца не подменяют 21% совпадений",
    returnRule: "Нет источника или неизвестное представлено фактом — адресный запрос поставщику" },
  { number: 3, role: "P.TECH → существующая P.LG.TECH", roleId: "lg-technical-role",
    actionId: "company-action-technical-assessment", receivingActionId: "lab-action-intake",
    resultId: "hint-feedback-001-tech", status: "Публичные возможности и код изучены; акустические связки не измерены",
    input: "Результат LAB.2; официальный Deepgram/OpenAI; текущие сборщики промптов",
    procedure: "Рассмотреть eager/partial, отмену устаревшего черновика, раннюю генерацию и компактный текст. Проверить фактический доступ отдельно от документации.",
    result: "Кандидаты стендов и адресный запрос недостающей записи/таймингов",
    recipient: "P.LAB; P.PRODUCT",
    acceptance: "Нет заявления «самая быстрая модель 2026» без сопоставимого теста; нет нового провайдера или ключа",
    returnRule: "Маркетинговая задержка провайдера выдана за задержку TalkHint — вернуть на измерение" },
  { number: 4, role: "P-BENCH", roleId: "benchmark-role-reference",
    actionId: "company-action-features", receivingActionId: "company-action-product",
    resultId: "hint-feedback-001-bench", status: "Существующие карточки сверены; скорость в живом разговоре не доказана",
    input: "Существующие версии карточек; поставщик — единая competitorDirectory",
    procedure: "Извлечь факты о copilot/режимах/агенте с датой и источниками. Не превращать заявления в тесты и не повторять каталог.",
    result: "Ссылки на прежние исследования и пробелы ручной проверки",
    recipient: "P.PRODUCT",
    acceptance: "Платформа, дата, статус доказательства; отсутствие замеров явно; Quo transfer не участие втроём",
    returnRule: "Скорость, вмешательство или автономность выданы за проверенные — вернуть P-BENCH" },
  { number: 5, role: "P.UX", roleId: "management-role-ux-designer",
    actionId: "management-action-ux", receivingActionId: "lab-action-product-receive",
    resultId: "hint-feedback-001-ux", status: "Предложение подготовлено; прототип и секундное чтение владельцем не проверены",
    input: "Жалоба владельца, тексты 14 подсказок, отсутствие screen recording кофейни",
    procedure: "Одна основная английская реплика, компактный перевод, без автоматически раскрытой пачки вариантов. Не менять интерфейс приложения.",
    result: "Проверяемая UX-гипотеза: 1 карточка, ориентир до 10–12 слов, без выдуманных личных фактов",
    recipient: "P.PRODUCT; P.LAB",
    acceptance: "Число слов не считается доказательством чтения за секунду; пустой неизвестный факт не заполняется догадкой",
    returnRule: "Сокращение текста меняет сторону разговора/смысл или скрывает неизвестное — вернуть" },
  { number: 6, role: "P.LAB", roleId: "laboratory-engineer-role",
    actionId: "lab-action-run", receivingActionId: "lab-action-qa",
    resultId: "hint-feedback-001-trial", status: "Выполнен ограниченный текстовый стенд: 18 запросов, 9 пар. Полный STT→iPhone replay заблокирован",
    input: "По три guest-момента каждого из трёх звонков; только предыдущие реплики, существующий OpenAI ключ",
    procedure: "Чередовать порядок вариантов; одна модель gpt-4.1-mini, streaming, maxRetries=0. Сохранить каждый ответ и usage. Не запускать телефонию, новые записи и автоповторы.",
    result: "Измерения first-delta/полного JSON, длина и карточки; ручная семантическая оценка отдельно",
    recipient: "P.LG.QA; затем P.PRODUCT",
    acceptance: "Нельзя продвигать вариант со сменой роли или выдумкой. Полная связка и независимая QA неизвестны.",
    returnRule: "Обнаружена путаница сторон у compact; выпуск отклонён инженерно, без имитации QA/решения владельца" },
  { number: 7, role: "P.PRODUCT", roleId: "product-manager-specialist",
    actionId: "lab-action-product-receive", receivingActionId: "company-action-product-decision",
    resultId: "hint-feedback-001-decision", status: "Одностраничная записка подготовлена; решение владельца и независимая QA ожидаются",
    input: "Результаты шагов 2–6; возврат LAB.QA пока не получен",
    procedure: "Свести находки и ограничения. По каждой развилке — «Нужно решение», без изменения обещаний или продукта.",
    result: "Одна страница с измерениями, отказом от небезопасного варианта и следующим проверяемым этапом",
    recipient: "Сергей; HEAD.06; HEAD.07",
    acceptance: "Факт, гипотеза, проверка и приёмка разделены; публикация только отдельного почтового исправления после проверок",
    returnRule: "Если нет входа, запросить его; не имитировать ответ специалиста или согласование Сергея" },
].map(step => ({ ...step, executor: "Replit Agent вручную в обозначенной роли; автономный исполнитель не запущен",
  trigger: "Жалоба владельца №1 от 27.10.2026", deadline: "Конкретный срок не согласован",
  controller: ["P.PRODUCT", "HEAD.07", "HEAD.07", "HEAD.01", "HEAD.06", "P.LG.QA", "HEAD.06"][step.number - 1],
  acceptanceStatus: step.number === 1 ? "Жалоба принята; это не приёмка исправления" : "Не получена независимая приёмка результата",
  reporting: "Дневной журнал → недельный план-факт → месячный вклад; событие жалобы не ждёт недельной сводки",
}));

const ownerRequests = [
  { id: "HINT-FB1-OWNER-AUDIO", title: "Запрос владельцу: существующая запись для акустического стенда",
    recipient: "Сергей", supplier: "Владелец либо ответственный хранения",
    question: "Есть ли уже законно сохранённые аудиозаписи этих трёх звонков с разрешением на лабораторное использование?",
    why: "Без исходного аудио нельзя измерить распознавание, EOT и подготовку подсказки во время речи",
    steps: "Сообщить, есть ли записи. Если есть — передать через защищённый канал. Новый звонок или новую запись сейчас не просим.",
    status: "Ожидает ответа; наличие и согласие участников неизвестны", receivingActionId: "lab-action-intake" },
  { id: "HINT-FB1-OWNER-UI", title: "Запрос владельцу: материал показа кофейни, если сохранён",
    recipient: "Сергей", supplier: "Владелец",
    question: "Если сохранились скриншоты/запись экрана кофейни без лишних персональных данных — передать для сверки.",
    why: "Отметка visible не доказывает читаемость; проверка за секунду не проведена",
    status: "Ожидает; новый звонок не требуется", receivingActionId: "management-action-ux" },
];

const competitorFacts = JSON.parse(await readFile(`${dir}/competitor-extract.json`, "utf8"));
const facts = { format: "talkhint.hint.fast-dialogue.facts", version: 1, at, role: "P.LAB",
  source: "Production SELECT, без изменений исходных звонков/отчётов; ручная инженерная оценка",
  ownerReport: { usedHints: 0, evidence: "Прямая жалоба владельца №1",
    algorithmSpeechMatchIsNotUsage: true, outcome: "Кофейня поняла замечание; получение письма/передача ответственному не подтверждены" },
  calls: corpus.map((c, i) => ({ label: ["Mint 26.10 Denver (UTC 27.10)", "Mint 27.10", "Кофейня 27.10"][i],
    callSid: c.callSid, startedAt: c.startedAt, endedAt: c.endedAt,
    durationMs: Date.parse(c.endedAt) - Date.parse(c.startedAt),
    latency: c.metadata?.hintLatency?.summary, attempts: c.metadata?.hintLatency?.entries?.length,
    hints: c.metadata?.hintLatency?.entries ?? [], transcript: c.transcript,
    uiHintCount: new Set((c.metadata?.hintUiVisibility?.events ?? []).filter((e: any) => e.kind === "hint").map((e: any) => e.utteranceId)).size,
    sttReference: "Нет", acousticReplay: "Не выполнен", interlocutor: i === 2 ? "Живой человек — подтверждено владельцем" : "Робот — указано владельцем",
  })),
  findings: [
    "Кофейня: 17 событий, 14 sent/ACK, 11 hint UI claims; 3 drop (cooldown/duplicate_suggestion/farewell по одному).",
    "Кофейня: #5 утверждает incorrect charge без надёжного основания и уводит от обратной связи о крышке.",
    "Кофейня: шесть choice-подсказок добавляют нагрузку выбора; чтение за секунду не проверено.",
    "Кофейня: система называет 3 частичных совпадения/21%; владелец сообщил ноль использований. Это разные измерения.",
    "Кофейня p50/p95 2217/5136 мс, Mint 27.10 2154/3617, Mint 26.10 Denver 1810/2735. Начало измерения STT final, конец ACK, не акустика/чтение.",
    "Разный темп по наблюдению владельца; turn-level timestamps/аудио для количественного окна ответа отсутствуют.",
    "Полнота истории неизвестна. Нельзя утверждать исчезновение подсказок на экране по отсутствию UI claims.",
    "Кофейня: письмо SENT, но автоматический разбор MODEL_FAILURE и QA не выполнена. Старый production не сохранил подробную причину/снимок в job; calls сохранили текст/события.",
  ],
  technical: {
    currentCode: "Flux v2 STT → завершённая реплика → BRAIN → полный JSON → owner UI. По записям конкретные STT/brain model неизвестны; default кода не доказательство runtime.",
    verifiedPublicDocsAt: at,
    sources: [
      { url: "https://developers.deepgram.com/docs/flux/quickstart", claim: "EagerEndOfTurn/TurnResumed; ранняя генерация с отменой, 80ms chunks; задержки — заявления провайдера, не TalkHint" },
      { url: "https://developers.openai.com/api/docs/guides/realtime-transcription", claim: "Инкрементальные delta и настройка delay; документация доступа к модели в аккаунте не доказывает" },
    ],
    proposals: [
      { variant: "Flux eager → отменяемый черновик → проверка актуальности → одна карточка", state: "Кандидат; акустический стенд blocked: нет аудио/Eager/TurnResumed истории" },
      { variant: "Realtime partial transcript → краткий текстовый prompter", state: "Кандидат; фактический протокол/акустический результат не проверены" },
      { variant: "gpt-4.1-mini: текущий сборщик против compact", state: "18 текстовых запросов выполнены; не доказательство live готовности" },
    ],
  }, competitorFacts,
  ux: { status: "Предложение, не реализация и не приёмка",
    proposal: "Одна основная английская реплика, короткий перевод, без постоянно раскрытого множества вариантов; неизвестный личный факт — короткий helper, не утверждение.",
    target: "Ориентир 10–12 слов/1 карточка; прочтение за секунду требует проверки Сергеем",
    risk: "Короткий текст может потерять цель и перепутать говорящего; стенд уже показал такой отказ",
    productionScreensChanged: false },
};
const page = `# P.PRODUCT · жалоба владельца №1 · результат лабораторного этапа
Статус: на рассмотрении. Продукт, production, телефония и экран Hint не изменялись.

**Что нашли.** Кофейня — живой быстрый разговор, а не Mint-робот. Владелец использовал 0 подсказок.
14 sent/ACK, 11 отметок показа, p50/p95 STT final→ACK 2217/5136 мс.
Ошибка #5 — неподтверждённое списание денег; 6 choice-подсказок усложняют чтение.
Сравнение Mint: 26.10 Denver 1810/2735 мс, 27.10 2154/3617 мс. Это не задержка от конца речи до прочтения.

**Что сработало на стенде.** 9 пар, 18 реальных текстовых запросов существующим ключом.
Тот же gpt-4.1-mini, streaming: медиана полного JSON ${summaries[0].completeJsonMedianMs} мс у текущего шаблона,
${summaries[1].completeJsonMedianMs} мс у compact. Это небольшой текстовый опыт, не победитель связки.
Compact в coffee/sample0 перепутал владельца с кофейней: «We received your photos».
Инженерный вердикт: НЕ переносить compact в продукт. Независимая QA этого стенда не выполнялась.

**Нужно решение / вход**
1. Продолжить проверку явной привязки speaker/цели и короткой реплики на тех же текстах; не выпускать только ради скорости. Предложение, не новое утверждённое изменение.
2. Для eager/partial/STT нужен существующий законно сохранённый звук либо иной согласованный корпус. Владелец/хранение — ответ ожидается.
3. Чтение за секунду: P.UX готовит критерии; проверка владельцем не проведена, число слов её не заменяет.
4. Конкуренты: P-BENCH имеет публичные описания, не live-замеры. Подписки и мобильные тесты — только Сергей по отдельному решению.
5. Почтовая цепочка: Dev сохраняет source и безопасную диагностику сбоя; форма дополнена причинами возврата QA.
Точная причина старого MODEL_FAILURE неизвестна. Полный успешный анализ кофейни не подтверждён; «можно публиковать» не объявлено.

**Приёмка:** жалоба принята P.PRODUCT; результаты ролей подготовлены одним Replit Agent вручную.
Ответы независимых исполнителей, QA и приёмка Сергея не имитируются. Срок решения не согласован.
`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev-only storage");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const before = await unpackModel(pool, q.rows[0].owner_key, q.rows[0].state);
  const s = readHypothesis(before, "new-country");
  if (process.argv.includes("--finalize-diagnostic")) {
    await finalizeDiagnostic(pool, q.rows[0].owner_key, s);
  } else {
  if (s.documents.some(d => d.id === complaintId)) throw new Error("Complaint already exists; read and version, never duplicate/replay");
  const current = s.operatingModel!.revisions.at(-1)!;
  const data = structuredClone(current.data);
  for (const step of steps) {
    const action = data.nodes.find(n => n.id === step.actionId)!;
    assert.ok(action && data.nodes.some(n => n.id === step.receivingActionId));
    const result: WorkNode = { id: step.resultId, code: `FB.HINT.1.${step.number}`,
      kind: "result", name: `${step.role}: ${step.status}`.slice(0, 490), parentId: action.parentId,
      status: "proposal", description: step.status, purpose: step.result,
      roleId: step.roleId, clientId: "product-manager-specialist", executorId: null,
      recipientId: data.nodes.find(n => n.id === step.receivingActionId)!.roleId,
      acceptorId: step.number === 6 ? "lg-qa-role" : "head-product", nextId: step.receivingActionId,
      resourceIds: [...action.resourceIds], inputs: [{ name: step.input, sourceId: step.actionId, freshness: at }],
      schedule: { days: [], hours: "", timezone: "America/Denver", trigger: step.trigger, deadline: step.deadline },
      procedure: step.procedure, rules: step.acceptance, constraints: "Только лаборатория. Нет изменения продукта/production/телефонии.",
      success: step.acceptance, storage: `Документы ${complaintId}, ${factsId}, ${trialId}; история new-country`,
      delivery: "Результат доступен в общей модели; внешняя независимая приёмка не получена",
      exceptions: step.returnRule, questions: step.acceptanceStatus, resourceState: null,
      referenceIds: ["TH-PRODUCT"] };
    data.nodes.push(result);
    const link = (kind: any, from: string, to: string, reason: string) => data.links.push({
      id: `${marker}:${step.number}:${kind}`, kind, from, to, reason,
      readiness: { structure: "passed", resources: "unknown", trial: "unknown",
        evidence: "Структурная связь проверена; описание результата не доказывает работу автономной роли или приёмку" } });
    link("produces", action.id, result.id, step.result);
    link("handoff", result.id, step.receivingActionId, "Парное принимающее действие; результат подготовлен, приёмка ожидается");
    link("return", step.receivingActionId, action.id, step.returnRule);
    action.description += `\n${marker}: случай по жалобе кофейни, ${complaintId}; результат ${result.id}. Остальные обязанности сохранены.`;
  }
  const complaint = { format: "talkhint.owner-feedback", id: marker, version: 1, at,
    sourceRevision: s.revision, status: "Принята; лабораторное рассмотрение; исправление не принято",
    ownerText: "Живой собеседник; 0 использованных подсказок, не успевали, нервничал; ошибочная тема денег, слишком много вариантов. Нужна связка для быстрого живого разговора.",
    clarification: "Поздняя фраза «я вообще вернул деньги» неоднозначна. Не считаем подтверждением возврата денег: транскрипт содержит предложение кофейни, подтверждённой операции нет.",
    consent: "Разбор сохранённых owner-call и стенд; никаких новых звонков, записей, покупок, production или изменений Hint",
    roleMapping: { "P.TECH": "существующая P.LG.TECH, новая должность не создавалась" },
    steps, ownerRequests, handoffs: steps.map(x => ({ fromActionId: x.actionId, resultId: x.resultId,
      acceptingActionId: x.receivingActionId, state: "Материал подготовлен; независимая приёмка ожидается",
      actualAnswer: null, acceptance: x.acceptance, returnRule: x.returnRule })),
    onePage: page, factsDocumentId: factsId, trialDocumentId: trialId,
    runtimeCrewStarted: false, overallAccepted: false,
  };
  const trial = { ...bench, format: "talkhint.hint.fast-dialogue.trial", version: 1, at, summaries,
    manualEngineeringReview: { verdict: "Compact не допущен к выпуску", independentQA: false,
      issues: [{ callIndex: 2, sampleIndex: 0, variant: "compact", category: "выдумка/смена говорящего",
        text: "Thank you, Taylor. We received your photos and noted the lid issue.",
        reason: "Владелец отправлял фото. Нельзя от его лица утверждать, что кофейня их получила." }],
      goalRetentionCount: null, inventedFactsCountComplete: null,
      note: "Один установленный отказ достаточен для недопуска; полной независимой классификации всех выходов нет." } };
  const next = await persistModelUpdate(pool, q.rows[0].owner_key, root => {
    assert.equal(readHypothesis(root, "new-country").revision, s.revision, "Concurrent update");
    let n = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: current.version, data },
      "P.PRODUCT: жалоба №1 и связанные результаты/принимающие действия; не приёмка вариантов");
    const save = (id: string, title: string, text: string, url: string) => {
      assert.ok(text.length <= 50000, `Document size: ${id}`);
      const old = readHypothesis(n, "new-country").documents.find(d => d.id === id);
      n = applyHypothesisCommand(n, "new-country", { type: old ? "saveDocument" : "createDocument", id, title, text,
        url, elementIds: old?.elementIds ?? ["TH-PRODUCT"] }, "Ручная роль Replit Agent; история и идентичность сохранены; приёмка отдельно");
    };
    const url = documentUrl;
    save(complaintId, "Hint — жалоба владельца №1: быстрый живой разговор — v1 — на рассмотрении", JSON.stringify(complaint), url(complaintId));
    save(factsId, "P.LAB — кофейня и два Mint: факты, техника, бенчмарк и UX — v1", JSON.stringify(facts), url(factsId));
    save(trialId, "P.LAB — быстрый диалог: 18 текстовых проб — v1 — compact не допущен", JSON.stringify(trial), url(trialId));
    const chapterDoc = s.documents.find(d => d.id === "DOC-TALKHINT-CHAPTER-HINT")!;
    const chapter = JSON.parse(chapterDoc.text);
    chapter.version += 1;
    chapter.ownerFeedback = [{ id: marker, documentId: complaintId, factsId, trialId,
      status: "Жалоба принята; стенд выполнен частично; compact не допущен; независимая QA ожидается",
      productBehaviorChanged: false, at }];
    save(chapterDoc.id, "TalkHint — глава Hint — v2 — жалоба и стенд связаны — на согласовании",
      JSON.stringify(chapter), chapterDoc.url);
    const book = s.documents.find(d => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT")!;
    save(book.id, "TalkHint — живая книга продукта — v10 — жалоба Hint связана — на согласовании",
      book.text.replace("Версия: 9.", "Версия: 10.") +
      `\n\n## ${marker} · 27.10.2026\nЖалоба владельца → ${complaintId}; три звонка → ${factsId}; 18 проб → ${trialId}. Compact быстрее на текстовом стенде, но перепутал стороны; не допущен. Независимая QA и полный акустический стенд не выполнены. Продукт не менялся. Глава Hint v2, на согласовании.\n`,
      book.url);
    const roadmap = s.documents.find(d => d.id === "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d")!;
    save(roadmap.id, "TalkHint — единый roadmap — v22 — жалоба Hint и лабораторная проверка",
      roadmap.text + `\n\n## ${marker} · этап лаборатории, ${at}\n${page}\nДокументы: ${complaintId}, ${factsId}, ${trialId}. Результаты связаны с существующими действиями PRD.1.1, LAB.2, ENG.1.2, MKT.2.11, PRD.REG.1, LAB.8, LAB.PRODUCT.RECEIVE. Даты выпуска не назначены.\n`,
      roadmap.url);
    return n;
  }, true);
  const saved = readHypothesis(next, "new-country");
  for (const id of [complaintId, factsId, trialId]) assert.ok(saved.documents.some(d => d.id === id));
  const savedData = saved.operatingModel!.revisions.at(-1)!.data;
  assert.ok(savedData.links.every(l => savedData.nodes.some(n => n.id === l.from) && savedData.nodes.some(n => n.id === l.to)));
  assert.equal(savedData.nodes.filter(n => n.code.startsWith("FB.HINT.1.")).length, 7);
  await writeFile(`${dir}/one-page.md`, page);
  await writeFile(`${dir}/work-package.json`, JSON.stringify({ complaint,
    savedRevision: saved.revision, operatingVersion: saved.operatingModel!.revisions.at(-1)!.version,
    factsDocumentId: factsId, trialDocumentId: trialId, summaries }, null, 2));
  const sample = renderProcessLetter({ synthetic: true, duration_ms: 195448,
    qa_status: "QA: расхождения не устранены",
    qa_issues: ["#5 · ошибочная: тема списания денег не подтверждена", "#пример · выдумка: смена говорящего"],
    deterministic: { recorded_attempts: 17, with_recorded_text: 14, sent: 14, acknowledged: 14,
      hints_ui_claimed: 11, translations_ui_claimed: 11, dropped: 3,
      drop_reasons: { cooldown: 1, duplicate_suggestion: 1, farewell: 1 },
      stt_final_to_ack_ms: { p50: 2217, p95: 5136, samples: 14 } } });
  await writeFile(`${dir}/synthetic-short-letter.txt`,
    `Пример рендера на исторических счётчиках кофейни. QA issues ниже демонстрационные, не реальный вердикт QA по этому звонку.\n${sample.subject}\n\n${sample.body}`);
  console.log(JSON.stringify({ savedRevision: saved.revision, operatingVersion: saved.operatingModel!.revisions.at(-1)!.version,
    documents: [complaintId, factsId, trialId], resultNodes: 7, linksAdded: 21,
    roleCountUnchanged: true, productionChanged: false, emailsSent: 0 }));
  }
} finally { await pool.end(); }

async function finalizeDiagnostic(pool: Pool, owner: string, state: any) {
  const diagnosticId = "DOC-HINT-COFFEE-DIAGNOSTIC";
  if (state.documents.some((d: any) => d.id === diagnosticId))
    throw new Error("Diagnostic already recorded; do not duplicate");
  let diagnostic: any;
  try { diagnostic = JSON.parse(await readFile(`${dir}/coffee-diagnostic-report.json`, "utf8")); }
  catch { diagnostic = JSON.parse(await readFile(`${dir}/coffee-diagnostic-failure.json`, "utf8")); }
  const successfulAnalysis = !!diagnostic.analysis && diagnostic.execution !== "analysis_not_completed";
  const qa = diagnostic.qa_status ?? "НЕ ПРОВЕРЕНО QA";
  const note = `Диагностический ручной Dev-проход кофейни: анализ ${successfulAnalysis ? "выполнен" : "не завершён"}, ${qa}. Новое письмо не отправлялось. Независимая QA этого разбора не означает QA компактного стенда или приёмку владельцем. Историческая причина production MODEL_FAILURE остаётся неизвестной.`;
  const original = state.documents.find((d: any) => d.id === complaintId);
  const complaint = JSON.parse(original.text);
  complaint.version += 1;
  complaint.updatedAt = new Date().toISOString();
  complaint.diagnosticDocumentId = diagnosticId;
  complaint.diagnosticStatus = { analysisCompleted: successfulAnalysis, qa,
    issues: diagnostic.qa_issues ?? [], stageFailure: diagnostic.failure ?? null,
    productionReportUnchanged: true, emailSent: false, ownerAccepted: false, benchIndependentQa: false };
  complaint.resources = [
    { name: "Сохранённые тексты/события трёх звонков", owner: "Технический ответственный", availability: "Прочитаны read-only; снимок доступен лаборатории", verification: factsId, limits: "Не аудио, не STT reference, история ограничена" },
    { name: "OpenAI API / gpt-4.1-mini", owner: "Владелец существующего ключа проекта", availability: "18 лабораторных запросов завершены", verification: trialId, limits: "max_tokens450, 45сек, maxRetries0; это конфигурация стенда, не утверждённый бюджет. Usage не счёт." },
    { name: "Self-hosted CrewAI / независимая QA", owner: "HEAD.07", availability: "Один диагностический проход выполнен либо сохранён диагностический отказ", verification: diagnosticId, limits: "Без облачной CrewAI; один проход, до 2 внутренних возвратов; не повторная отправка письма" },
    { name: "Чтение официальных публичных документов", owner: "Технический ответственный", availability: "Выполнено Replit Agent; доступ будущему worker не доказан", verification: factsId, limits: "Доступность в документации не равна доступности модели в аккаунте" },
    { name: "Паспорта конкурентов", owner: "P.PRODUCT", availability: "Прочитаны существующие версии", verification: factsId, limits: "Нет новых живых мобильных тестов и доказанных замеров скорости" },
    { name: "Исходное аудио / ранние события STT", owner: "Владелец/ответственный хранения", availability: "Не выдано/наличие неизвестно", verification: "HINT-FB1-OWNER-AUDIO", limits: "Не создавать записи без согласия; полный STT/eager стенд заблокирован" },
    { name: "Материал экрана кофейни", owner: "Сергей", availability: "Не получен", verification: "HINT-FB1-OWNER-UI", limits: "Читаемость за секунду не подтверждена" },
  ];
  for (const step of complaint.steps) step.resources = complaint.resources.filter((_: any, i: number) =>
    step.number === 3 ? [0, 1, 3, 5].includes(i) : step.number === 4 ? i === 4 :
      step.number === 5 ? [0, 6].includes(i) : step.number === 6 ? [0, 1, 2, 5].includes(i) : [0, 4].includes(i));
  complaint.onePage += `\n\n## Дополнение v2 — диагностика и оснащение\n${note}\nНужно решение: продолжение лабораторного speaker/goal-контроля, получение существующего аудио, UX-проверка. Полная связка быстрого живого разговора не готова. До устранения блокеров разбор/приёмку не объявлять успешными.\n`;
  const current = state.operatingModel.revisions.at(-1);
  const data = structuredClone(current.data);
  const result = data.nodes.find((n: any) => n.id === "hint-feedback-001-decision");
  result.description += `\n${note}`;
  result.questions = "Владелец не принял изменение; native QA сохранённого звонка и QA стенда разделены.";
  const next = await persistModelUpdate(pool, owner, root => {
    assert.equal(readHypothesis(root, "new-country").revision, state.revision);
    let n = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: current.version, data },
      "P.PRODUCT: фактический диагностический результат, без приёмки стенда или владельца");
    const save = (id: string, title: string, text: string, url: string) => {
      assert.ok(text.length <= 50000, `Document size: ${id}`);
      const existing = readHypothesis(n, "new-country").documents.find(d => d.id === id);
      n = applyHypothesisCommand(n, "new-country", { type: existing ? "saveDocument" : "createDocument",
        id, title, text, url, elementIds: existing?.elementIds ?? ["TH-PRODUCT"] }, "Фактический диагностический проход; production и рассылка без изменений");
    };
    save(diagnosticId, "P.LAB — кофейня: один ручной диагностический проход — v1",
      JSON.stringify({ format: "talkhint.coffee.manual-diagnostic", version: 1, at: new Date().toISOString(),
        sourceEnvironment: "production", executionEnvironment: "development", report: diagnostic,
        emailSent: false, originalReportUnchanged: true, note }),
      documentUrl(diagnosticId));
    save(complaintId, "Hint — жалоба владельца №1 — v2 — диагностика и оснащение", JSON.stringify(complaint),
      documentUrl(complaintId));
    for (const id of [factsId, trialId]) {
      const doc = state.documents.find((d: any) => d.id === id);
      save(id, doc.title, doc.text, documentUrl(id));
    }
    const chapterDoc = state.documents.find((d: any) => d.id === "DOC-TALKHINT-CHAPTER-HINT");
    const chapter = JSON.parse(chapterDoc.text);
    chapter.version += 1;
    chapter.ownerFeedback[0].diagnosticDocumentId = diagnosticId;
    chapter.ownerFeedback[0].diagnosticStatus = qa;
    save(chapterDoc.id, "TalkHint — глава Hint — v3 — жалоба и диагностика — на согласовании", JSON.stringify(chapter), chapterDoc.url);
    const book = state.documents.find((d: any) => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT");
    // Keep the renderer's JSON block valid: never append prose after it.
    // Earlier case notes are incorporated into supported fields below.
    const rawBook = book.text.split(productBookMarker)[1].trim();
    const structuredBook = JSON.parse(rawBook.slice(0, rawBook.lastIndexOf("}") + 1));
    structuredBook.version = 11;
    structuredBook.updatedAt = new Date().toISOString();
    structuredBook.current += `\n${marker}: ${complaintId} v2. Быстрый диалог: 18 текстовых проб; compact не допущен. Диагностика: ${diagnosticId}.`;
    structuredBook.roadmap += `\n${marker}: стенд STT/eager ждёт существующего аудио; speaker/goal и UX-проверки не приняты. Никакого изменения Hint или production.`;
    const validBookText = productBookText(structuredBook);
    assert.ok(readProductBook({ ...book, text: validBookText })?.version === 11);
    save(book.id, "TalkHint — живая книга продукта — v11 — диагностика Hint связана — на согласовании",
      validBookText, book.url);
    const roadmap = state.documents.find((d: any) => d.id === "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d");
    save(roadmap.id, "TalkHint — единый roadmap — v23 — фактическая диагностика кофейни",
      roadmap.text + `\n\n## ${marker} — дополнение диагностики\n${note}\nЗапросы владельцу и ресурсы — ${complaintId} v2. Этап не закрыт автоматически.\n`, roadmap.url);
    return n;
  }, true);
  const saved = readHypothesis(next, "new-country");
  assert.ok(saved.documents.find(d => d.id === diagnosticId)?.text.includes(qa));
  await writeFile(`${dir}/one-page.md`, complaint.onePage);
  await writeFile(`${dir}/work-package.json`, JSON.stringify({ complaint,
    savedRevision: saved.revision, diagnosticDocumentId: diagnosticId,
    operatingVersion: saved.operatingModel!.revisions.at(-1)!.version, summaries }, null, 2));
  console.log(JSON.stringify({ savedRevision: saved.revision, operatingVersion: saved.operatingModel!.revisions.at(-1)!.version,
    complaintVersion: complaint.version, qa, diagnosticDocumentId: diagnosticId,
    productionChanged: false, emailSent: false }));
}
