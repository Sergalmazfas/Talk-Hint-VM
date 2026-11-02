// Descriptive production MCP operations only. No provider, worker or owner-session API.
// Default is dry-run. A failed/ambiguous write is NEVER retried.
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const dir = "generated-artifacts/lab-team-link";
const hash = s => createHash("sha256").update(s).digest("hex");
const load = async name => JSON.parse(await readFile(`${dir}/${name}.json`, "utf8"));
const save = async (name, value) => writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2));
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const expectedRevision = 1181;
const decision = "Решение владельца: связать лабораторию Hint с командой; описательные записи, уроки proposed; рабочий Hint только с «да» владельца.";
const methodRule = "поменялся метод или инструмент — обязанности и книжки затронутых сотрудников обновляются в тот же день";
const profiles = [
  { roleId: "laboratory-engineer-role", name: "Замир", doc: "DOC-PLAB-PROMPT-PROPOSAL",
    responsibility: "Замир — владелец полигона Hint. Опыты по одному фактору: промпт, длина ответа, модель, поток, EOT или поставщик. В каждом прогоне фиксирует рецепт: версия и длина промпта, модель, параметры; добавляет строку в общую таблицу.",
    input: "Согласованный лабораторный вопрос, тот же зафиксированный корпус и версии метода/промпта.",
    output: "Фоме: рецепт и строка общей таблицы, доказательства, ошибки и исключённые прогоны." },
  { roleId: "lg-qa-role", name: "Фома", doc: "DOC-PLG-QA-PROMPT-PROPOSAL",
    responsibility: "Фома проверяет метод полигона Hint: изменён один фактор, корпус тот же, битые прогоны исключены, судья независим, версия промпта записана, опыт повторяем. Не объявляет проверку пройденной без доказательств.",
    input: "Замир: рецепт и общая таблица, зафиксированный корпус, версии промпта и метода, исходы всех попыток.",
    output: "Паше: независимое заключение о методе «подтверждено / не подтверждено», пробелы и условия повторения." },
  { roleId: "product-manager-specialist", name: "Паша", doc: "DOC-TEAM-PPRODUCT",
    responsibility: "Паша получает общую таблицу полигона и проверку Фомы; готовит «было → стало», варианты и цену скорости: стоимость, изменение качества, риски и ограничения. Передаёт Марии, не меняет рабочий Hint самостоятельно.",
    input: "Общая таблица Замира и независимая проверка метода Фомы.",
    output: "Марии: «было → стало», варианты, цена скорости, качество, стоимость и риски; что проверено и что нет." },
  { roleId: "head-product", name: "Мария", doc: "DOC-TEAM-HEAD06",
    responsibility: "Мария получает от Паши итог полигона Hint и передаёт владельцу короткое решение-рекомендацию «включаем / нет» с причиной, вариантами и ценой скорости. Фактическое включение или изменение рабочего Hint — только после отдельного «да» владельца.",
    input: "Паша: проверенная таблица, «было → стало», варианты и цена скорости по Hint.",
    output: "Владельцу: короткая рекомендация «включаем / нет», причина, эффект, цена и риск; ожидает решения владельца." },
];
const books = [
  { roleId: profiles[0].roleId, key: "knowledge-zamir", id: "DOC-PC-11c0b66c-e5c7-49d3-9e5f-2cef5621b47f" },
  { roleId: profiles[1].roleId, key: "knowledge-foma", id: "DOC-PC-1d862fd6-7ab5-4d37-ba1d-11d33609b4bf" },
];
const rulesId = "DOC-PC-b57c7c66-12b8-47cc-afe6-651a68e20132";
const sources = {};
for (const id of [...profiles.map(p => p.doc), ...books.map(b => b.id), rulesId]) {
  const v = await load(`${id}-before`);
  assert.equal(v.revision, expectedRevision);
  assert.equal(hash(v.text), v.snapshotHash);
  sources[id] = v;
}
const prompt = await load("prompt-reference-render");
const at = new Date().toISOString();
const proposedLessons = books.map(book => ({
  format: "talkhint.knowledge-book.lesson-proposals", roleId: book.roleId,
  targetDocumentId: book.id, targetBookKey: book.key, targetTextHash: sources[book.id].snapshotHash,
  status: "proposed", acceptedBy: null, runtimeInjected: false, mergedIntoOriginalBook: false,
  note: "Связанное дополнение к существующей книжке; старый документ и слои промпта сохранены.",
  lessons: [
    ["ONE-FACTOR", "Один опыт — один фактор", "Сравнивать один фактор за раз: промпт, длину ответа, модель, поток, EOT либо поставщика. Фиксировать один и тот же корпус и остальные параметры; если смена поставщика одновременно меняет модель, отмечать смешение факторов и не приписывать эффект одному фактору."],
    ["SPEECH-END-CLOCK", "Отсчёт от конца речи", "Измерять конец речи → STT final → первое готовое слово подсказки → полную подсказку при replay 1x. VAD-границы — автоматические, не human verified; не привязывать фразы к ним по порядку. Первый API-токен и ACK не равны первому слову и показу на экране."],
    ["INVALID-RUNS", "Битое не участвует в сравнении", "Ноль подсказок, ошибки API/квоты, повреждённый выход и отсутствие необходимых таймингов — invalid; исключать из p50/p95 и качества, но сохранять причину, попытку и расходы. Не считать неизвестное нулём и не повторять unknown вслепую."],
    ["INDEPENDENT-REPEATABLE", "Независимость и повторяемость", "Судья независим от оцениваемых кандидатов. Записывать версию/hash/длину промпта, модель и параметры, hash корпуса, повтор и версии метода/инструмента. Один и тот же исполнитель в разных ролях не создаёт независимую проверку."],
  ].map(([id, title, rule]) => ({ id: `HINT-POLYGON-${id}`, title, rule, date: at,
    proposedBy: "HEAD.07 / Replit по решению владельца", checkedBy: null, acceptedBy: null,
    status: "proposed", removedAt: null, sources: [{ type: "owner_decision", description: decision }],
    evidenceStatus: "Методическое предложение; не доказательство состоявшегося опыта или проверки." })),
}));
const recipeFields = ["runId", "question", "changedFactor", "factorBefore", "factorAfter", "controlledFactors",
  "corpusId", "fixtureIds", "corpusHash", "referenceVersion", "audioHash", "channelRole",
  "promptObjectId", "promptVersion", "systemPromptHash", "userPromptHash", "promptLengthCodePoints",
  "promptBytesUtf8", "actualInputTokens", "provider", "modelId", "requestParameters", "maxOutputTokens",
  "streaming", "EOT", "replaySpeed=1", "methodVersion", "toolVersion", "codeCommit", "repeatId",
  "speechEndSource", "speechEndMs", "sttFinalMs", "firstHintWordMs", "fullHintMs", "timingUncertainty",
  "firstHintWordP50Ms", "firstHintWordP95Ms", "fullHintP50Ms", "fullHintP95Ms",
  "quality", "judgeModelId", "judgeIndependent", "costUsd", "costRateSource", "invalidCount",
  "invalidReasons", "evidenceRefs", "QA", "proposedNextStep"];
const packageObject = {
  format: "talkhint.stage.review-result", version: 1,
  title: "Полигон Hint → команда: обязанности, промпт, предложенные уроки и правило AI Crew",
  accepted: false, runtimeChanged: false, source: decision, sourceRevision: expectedRevision,
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([id, d]) => [id, d.snapshotHash])),
  documents: {
    "hint-lab-team-contract": {
      format: "talkhint.lab.team.contract", version: 1, mode: "hint", status: "descriptive",
      operationalOwnerRoleId: profiles[0].roleId,
      roles: profiles.map((p, i) => ({
        roleId: p.roleId, name: p.name, responsibility: p.responsibility,
        trigger: i === 0 ? "Вопрос для разрешённого лабораторного опыта."
          : i === 1 ? "Готов рецепт и строка общей таблицы."
          : i === 2 ? "Готовы таблица и заключение независимой проверки."
          : "Паша передал варианты и проверенное «было → стало».",
        input: p.input, result: p.output, customerRoleId: i < 2 ? profiles[2].roleId : i === 2 ? profiles[3].roleId : "owner",
        acceptorRoleId: i < 2 ? profiles[2].roleId : i === 2 ? profiles[3].roleId : "owner",
        independentReviewRoleId: i === 0 ? profiles[1].roleId : null,
      })),
      experimentRecipeFields: recipeFields,
      commonTable: { status: "schema_only_no_new_experiment", columns: recipeFields, rows: [],
        historicalRowsNotInvented: true, missingMeasurement: null },
      comparisonRequirements: ["Один фактор, одинаковый зафиксированный корпус.",
        "Битые прогоны исключены; ошибки и цена не скрываются.",
        "Независимый судья, сохранены версия/длина промпта и рецепт повторения.",
        "Конец речи и частичные/полные ответы — разные часы; replay 1x.",
        "Копия результата не равна приёмке; человек с двумя названиями роли не независим."],
      chain: ["Замир → независимая проверка Фомы → Паша → Мария → владелец"],
      productGate: "Рабочий Hint, его промпт, модели и провайдеры меняются только с «да» владельца.",
    },
    "hint-prompt-object": {
      format: "talkhint.prompt.registry", id: "hint-live-brain-prompt", version: prompt.version,
      status: "described_not_activated", source: prompt.source, referenceRender: prompt.referenceRender,
      liveRequestLength: null, liveRequestLengthNote: "Промпт зависит от цели, истории, языка, контекста и флагов. Контрольный рендер не выдаётся за запрос production.",
      perRunRequired: ["promptVersion", "systemPromptHash", "userPromptHash", "lengthCodePoints", "bytesUtf8", "actualInputTokens"],
      history: [{ at, change: "Первичная описательная регистрация; промпт не изменён.",
        beforeVersion: null, afterVersion: prompt.version, speedEffectMs: null, qualityEffect: null,
        evidenceStatus: "не измерено", runIds: [], ownerDeploymentApproval: null }],
      futureHistoryFields: ["изменение", "до/после версии и длины", "рецепт", "скорость", "качество", "цена", "доказательства", "решение владельца"],
      livePromotionRequires: "Отдельное явное «да» владельца; запись истории сама по себе не разрешает включение.",
    },
    "knowledge-zamir-proposals": proposedLessons[0],
    "knowledge-foma-proposals": proposedLessons[1],
    "ai-crew-method-update-rule": {
      format: "talkhint.company-rules.addendum", version: 1, rule: methodRule,
      sourceDocumentId: rulesId, sourceDocumentHash: sources[rulesId].snapshotHash,
      status: "owner_requested_descriptive_addendum", inPlaceCanonicalDocumentUpdated: false,
      interpretation: "Обновить описания обязанностей и предложить уроки в тот же день. Это не приёмка уроков, не изменение личности или рабочих промптов и не обход жёсткого правила владельца.",
      sameDayTracking: ["Дата смены метода/инструмента", "Затронутые роли", "Запись обязанностей", "Предложенные уроки", "Связанные версии и документы"],
    },
  },
  boundaries: { agentsEnabled: false, modelsEnabled: false, productChanged: false, callsMade: false,
    providerRequests: 0, published: false, ownerAcceptancePerformed: false,
    oldBooksRewritten: false, oldRulesRewritten: false },
};
const text = JSON.stringify(packageObject, null, 2);
assert(text.length <= 40000);
const plan = { revision: expectedRevision, sourceHashes: packageObject.sourceHashes,
  packetHash: hash(text), packetChars: text.length, tools: ["create_work", "submit_result", ...profiles.map(() => "update_employee_sections")],
  expectedCommands: [1, 2, 2, 2, 2, 2], expectedTotalCommands: 11,
  expectedFinalRevision: expectedRevision + 11, package: packageObject };
await save("plan", plan);
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ dryRun: true, packetChars: text.length, packetHash: hash(text), commands: plan.expectedTotalCommands }));
  process.exit(0);
}
try { await readFile(`${dir}/write-attempt-started.json`); throw Error("Prior attempt exists; do not repeat."); }
catch (e) { if (e.code !== "ENOENT") throw e; }
await save("write-attempt-started", { at, expectedRevision, note: "No automatic retries or resumption." });
let revision = expectedRevision;
const journal = [];
async function rpc(name, args) {
  const r = await fetch("https://talkhint.app/api/product-crew/mcp", { method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": process.env.PRODUCT_CREW_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(150000) });
  const raw = await r.text();
  if (!r.ok) throw Error(`HTTP_${r.status}; ${name}; STOP, no retry`);
  let j; try { j = JSON.parse(raw); } catch { throw Error(`NON_JSON; ${name}; STOP, no retry`); }
  if (j.error || j.result?.isError) throw Error(`MCP refusal ${name}: ${JSON.stringify(j.error ?? j.result)}`);
  return JSON.parse(j.result.content[0].text);
}
async function readDoc(id, expectedHash) {
  const d = await rpc("get_document", { documentId: id });
  assert.equal(d.revision, revision, "Unexpected global revision; STOP");
  assert.equal(hash(d.text), d.snapshotHash, "Document hash mismatch; STOP");
  if (expectedHash) assert.equal(d.snapshotHash, expectedHash, "Source changed; STOP");
  return d;
}
async function write(name, body, commands, beforeHash) {
  const requestId = randomUUID(), before = revision;
  const entry = { name, requestId, revisionBefore: before, expectedCommands: commands, beforeHash,
    requestHash: hash(canonical(body)), attemptedAt: new Date().toISOString(), status: "attempting" };
  journal.push(entry); await save("journal", journal);
  const result = await rpc(name, { ...body, revision: before, requestId });
  await save(`receipt-${journal.length}`, result);
  assert.equal(result.saved, true); assert.equal(result.launched, false);
  assert.notEqual(result.replayed, true);
  assert.equal(result.revision, before + commands, "Command/revision divergence; STOP");
  assert(result.record.coordination.operations.some(o => o.id === requestId), "Missing UUID receipt; STOP");
  revision = result.revision;
  Object.assign(entry, { revisionAfter: revision, status: "saved_needs_readback", recordId: result.record.id });
  await save("journal", journal);
  return result;
}
async function checkWork(id) {
  const value = await rpc("get_work", { recordId: id });
  assert.equal(value.revision, revision);
  return value;
}
try {
  // Serial bounded reads: don't overwhelm the production snapshot/DB pool.
  for (const [id, source] of Object.entries(sources)) await readDoc(id, source.snapshotHash);
  const work = await write("create_work", {
    title: "Связать полигон Hint с командой: описательный пакет",
    description: decision,
    client: "Владелец и Мария: проверяемые варианты улучшения Hint без самовольного включения.",
    need: "Опыты полигона должны давать проверенный метод, «было → стало» и решение владельцу; знания и обязанности не отстают от метода.",
    roleId: "product-manager-specialist", processId: "lab-action-method",
    relatedIds: [...profiles.map(p => p.roleId), ...[rulesId, ...books.map(b => b.id)]
      .flatMap(id => sources[id].elementIds ?? [])].filter((id, i, all) => all.indexOf(id) === i).slice(0, 40),
    nextStep: "Сохранить описательное дополнение; связать рабочие места. Агентов не запускать.",
    expectedResult: "Контракт полигона, отдельный объект промпта, предложенные уроки и дополнение AI Crew, связанные с четырьмя рабочими местами.",
    acceptance: "Повторное чтение и сохранение границ; проверка и приёмка не выполнены за Фому, Марию или владельца.",
  }, 1, hash(canonical(plan.sourceHashes)));
  let checked = await checkWork(work.record.id);
  assert.equal(checked.record.coordination.roleId, "product-manager-specialist");
  journal.at(-1).status = "readback_verified";
  await save("journal", journal);
  const workHash = hash(canonical(checked.record));
  const freshWork = await checkWork(work.record.id);
  assert.equal(hash(canonical(freshWork.record)), workHash);
  const result = await write("submit_result", { recordId: work.record.id, title: packageObject.title,
    text, nextStep: "Описательное дополнение сохранено; повторное чтение и ссылки рабочих мест. Уроки proposed, приёмки нет." }, 2, workHash);
  checked = await checkWork(work.record.id);
  const documentId = checked.record.coordination.resultDocumentId;
  assert.equal(checked.record.coordination.state, "awaiting_review");
  const doc = await readDoc(documentId, hash(text));
  assert.equal(checked.result.id, documentId);
  await save("package-after", doc);
  journal.at(-1).status = "readback_verified";
  journal.at(-1).afterHash = doc.snapshotHash;
  await save("journal", journal);
  for (const p of profiles) {
    const fresh = await readDoc(p.doc, sources[p.doc].snapshotHash);
    const before = JSON.parse(fresh.text), workplace = structuredClone(before.employeeSections.workplace);
    workplace.description += `\n\nПолигон Hint: ${p.responsibility}`;
    workplace.inputs.push(p.input); workplace.outputs.push(p.output);
    workplace.sourceDocumentIds = [...new Set([...workplace.sourceDocumentIds, documentId])];
    workplace.laboratory = { title: "Полигон Hint", description: "Замир: один фактор и рецепт → Фома: независимая проверка метода → Паша: «было → стало», варианты и цена скорости → Мария: рекомендация владельцу «включаем / нет». Описание, не запуск.",
      documentId };
    workplace.limitations.push(`Правило AI Crew: ${methodRule}. Уроки остаются proposed до принятия.`,
      "Рабочий Hint и промпт не меняются без отдельного «да» владельца; этот пакет не выдаёт доступов, бюджетов или запуска.");
    assert(workplace.inputs.length <= 20 && workplace.outputs.length <= 20 && workplace.limitations.length <= 20);
    await write("update_employee_sections", { roleId: p.roleId, profileHash: fresh.snapshotHash,
      reason: `${p.name}: описательная связь с полигоном, без смены обязанностей графа, личности, рабочего промпта, модели и прав.`,
      ownerDecisionRef: decision, sections: { workplace } }, 2, fresh.snapshotHash);
    const reread = await readDoc(p.doc);
    const after = JSON.parse(reread.text);
    assert.equal(after.version, before.version + 1);
    assert.equal(canonical(after.employeeSections.workplace), canonical(workplace));
    const unchanged = value => {
      const clone = structuredClone(value);
      delete clone.version; delete clone.employeeSections.workplace;
      return canonical(clone);
    };
    assert.equal(unchanged(after), unchanged(before), "Unexpected profile modification; STOP");
    journal.at(-1).status = "readback_verified";
    journal.at(-1).afterHash = reread.snapshotHash;
    await save(`${p.doc}-after`, reread); await save("journal", journal);
    console.log(JSON.stringify({ role: p.name, revision, hash: reread.snapshotHash, status: "verified" }));
  }
  for (const id of [...books.map(b => b.id), rulesId]) await readDoc(id, sources[id].snapshotHash);
  assert.equal(revision, plan.expectedFinalRevision);
  await save("completed", { revision, workId: work.record.id, documentId,
    commands: journal.reduce((n, e) => n + e.expectedCommands, 0), calls: journal.length,
    packetHash: doc.snapshotHash, allReadbacksPassed: true, originalBooksAndRulesUnchanged: true,
    originalBooksRuleAppendices: "Linked additions, not in-place canonical JSON edits.",
    runtimeChanged: false, promptsChanged: false, modelsChanged: false, agentsLaunched: false });
  console.log(JSON.stringify({ status: "completed", revision, documentId, calls: journal.length }));
} catch (e) {
  await save("STOP", { at: new Date().toISOString(), revision, error: String(e.message),
    note: "No retry. A failed write may have saved; inspect fresh receipts before any further action." });
  console.error("STOP:", e.message);
  process.exitCode = 1;
}
