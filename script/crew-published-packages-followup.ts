/** Explicit owner-authorized append-only followup. No retries or runtime activation. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { callProductionMcp, productionMcpDiagnostic } from "./product-crew-production-mcp.mjs";
import { knowledgeAppendInputs, knowledgeBindings } from "../server/productCrew/knowledgeAppend";

const dir = "generated-artifacts/published-packages-followup";
const journalId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const save = (name: string, value: unknown) => writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2));
const rpc = async (name: string, args = {}) =>
  (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
let revision: number;
const operations: any[] = [];
async function read(id: string) {
  const d = await rpc("get_document", { documentId: id });
  if (d.revision !== revision || d.snapshotHash !== hash(d.text)) throw Error("READ_REVISION_HASH_MISMATCH");
  await save(id, d);
  return d;
}
async function start() {
  await mkdir(dir, { recursive: true });
  const tools = await callProductionMcp("tools/list");
  await save("tools", tools);
  for (const name of ["get_team", "get_document", "append_journal_entries", "append_knowledge_lessons"])
    if (!tools.tools.some((t: any) => t.name === name)) throw Error("TOOL_MISSING");
  const team = await rpc("get_team");
  if (!Number.isSafeInteger(team.revision)) throw Error("BAD_REVISION");
  revision = team.revision;
  await save("team", team);
  console.log(JSON.stringify({ revision, roleCount: team.roles.length }));
}
async function main() {
  if (process.argv[2] === "--prepare-local") {
    await prepareLocal();
    return;
  }
  await start();
  const mode = process.argv[2];
  if (mode === "--read-only") {
    for (const id of [journalId, "DOC-PC-6513ce81-0fef-4b25-a8c5-2ba1f78879b5",
      ...Object.values(knowledgeBindings)]) {
      const d = await read(id);
      let v: any = {};
      try { v = JSON.parse(d.text); } catch { /* Passport is Markdown; preserve verified bytes. */ }
      console.log(JSON.stringify({ id, sha256: d.snapshotHash, title: d.title,
        entries: v.crewJournalEntries?.map((x: any) => ({ id: x.id, title: x.title })),
        lessons: v.proposedLessons?.map((x: any) => ({ id: x.id, before: x.before, next: x.next })) }));
    }
    return;
  }
  if (mode !== "--owner-published-append") throw Error("MODE_REQUIRED");
  const plan = JSON.parse(await readFile(`${dir}/plan.json`, "utf8"));
  if (revision !== plan.revision) throw Error("PLAN_REVISION_CHANGED_STOP");
  // Validate all payload shapes before any mutation.
  for (const p of plan.steps) {
    knowledgeAppendInputs[p.tool as keyof typeof knowledgeAppendInputs].parse({
      revision, requestId: randomUUID(), reason: plan.reason, ownerDecisionRef: plan.ownerDecisionRef,
      ...p.args, [p.tool === "append_journal_entries" ? "documentHash" : "bookHash"]: p.hashBefore,
    });
  }
  for (const p of plan.steps) {
    const d = await read(p.documentId);
    if (d.snapshotHash !== p.hashBefore) throw Error("EXPECTED_HASH_CHANGED_STOP");
    const before = JSON.parse(d.text);
    const field = p.tool === "append_journal_entries" ? "crewJournalEntries" : "proposedLessons";
    const additions = p.args.entries ?? p.args.lessons;
    if (additions.some((x: any) => (before[field] ?? []).some((y: any) => y.id === x.id)))
      throw Error("DUPLICATE_ID_STOP");
    const expected = { ...before, [field]: [...(before[field] ?? []), ...additions] };
    const args = {
      revision, requestId: randomUUID(), reason: plan.reason, ownerDecisionRef: plan.ownerDecisionRef,
      ...p.args, [p.tool === "append_journal_entries" ? "documentHash" : "bookHash"]: d.snapshotHash,
    };
    const op: any = { tool: p.tool, documentId: p.documentId, uuid: args.requestId,
      revisionBefore: revision, hashBefore: d.snapshotHash, status: "pending" };
    operations.push(op); await save("write-log", operations);
    const result = await rpc(p.tool, args);
    await save(`receipt-${operations.length}`, result);
    if (result.saved !== true || result.launched !== false || result.replayed ||
      result.revision !== revision + 2) throw Error("WRITE_RESPONSE_MISMATCH_STOP");
    revision = result.revision;
    const after = await read(p.documentId), actual = JSON.parse(after.text);
    if (field === "crewJournalEntries") {
      const addedIds = new Set(additions.map((x: any) => x.id));
      for (const e of actual[field]) if (addedIds.has(e.id)) {
        if (!Number.isFinite(Date.parse(e.expectedResultRecordedAt))) throw Error("MISSING_TIMESTAMP_STOP");
        delete e.expectedResultRecordedAt;
      }
    }
    if (!isDeepStrictEqual(actual, expected)) throw Error("READBACK_MISMATCH_STOP");
    op.status = "verified"; op.revisionAfter = revision; op.hashAfter = after.snapshotHash;
    await save("write-log", operations);
    console.log(JSON.stringify(op));
  }
  console.log(JSON.stringify({ status: "verified", revision, writes: operations.length }));
}
async function prepareLocal() {
  const load = async (name: string) => JSON.parse(await readFile(name, "utf8"));
  const doc = async (id: string) => load(`${dir}/${id}.json`);
  const team = await load(`${dir}/team.json`);
  const journal = await doc(journalId), j = JSON.parse(journal.text);
  const passportId = "DOC-PC-6513ce81-0fef-4b25-a8c5-2ba1f78879b5";
  const passport = await doc(passportId);
  const normLesson = await load("generated-artifacts/secretary-norms/lesson-final.json");
  const seva = JSON.parse((await doc(knowledgeBindings["secretary-project-head"])).text);
  const normEntry = j.crewJournalEntries.find((e: any) => e.id === normLesson.sourceEntryId);
  if (passport.snapshotHash !== "f987fd6617ea710b512ec09df7a56e3fd7caead9dbb940ad2e544ba1fa0993e9" ||
    !normEntry?.evidenceRefs.includes(`sha256:${passport.snapshotHash}`) ||
    !isDeepStrictEqual(seva.proposedLessons.find((x: any) => x.id === normLesson.id), normLesson))
    throw Error("NORMS_EXPECTED_STATE_MISMATCH");
  if (!j.crewJournalEntries.some((x: any) => x.id === "RETRO-2026-11-02-03-LIVE-REJECTED"))
    throw Error("GPT_LIVE_REJECTION_NOT_FOUND");
  const at = new Date().toISOString();
  const ids = {
    prepare: "JOURNAL-PUBLISHED-PREPARE-CALL-2026-11-04",
    thought: "JOURNAL-PUBLISHED-SAY-ASK-2026-11-04",
    voicemail: "JOURNAL-PUBLISHED-INTRO-VOICEMAIL-REPORTS-2026-11-04",
    translator: "JOURNAL-OWNER-REJECTED-OPENAI-TRANSLATOR-2026-11-04",
  };
  const lab = "secretary-lab-engineer", qa = "secretary-qa", head = "secretary-project-head";
  const prep = "hint-call-prep-master", ops = "management-role-operations-specialist";
  function entry(id: string, title: string, fact: string, roles: string[], metric: string,
    expectation: string, before: string, learned: string, next: string, ownerDecision = false) {
    return { id, title, eventDatePrecision: "range-only", eventPeriod: ["2026-11-04", "2026-11-04"],
      registeredAt: at, actualAuthor: "Replit", classification: ownerDecision ? "owner_decision" : "reported_fact",
      source: "owner", fact, evidenceRefs: ["Решение владельца: три пакета опубликованы; отложенные append-only записи",
        "generated-artifacts/secretary-incoming-review/AFTER_PUBLISH.md"],
      targetRoleIds: roles, verification: "Publish подтверждён владельцем. Здесь фиксируется решение и будущее ожидание; новых звонков и независимого боевого замера нет.",
      productChangeAuthorized: false, newRuntimeExecution: false, before, learned, next,
      expectedResult: { text: expectation, appliesTo: "other",
        metrics: [{ metric, operator: "eq", value: 0, unit: "count" }] } };
  }
  const entries = [
    entry(ids.prepare, "Опубликовано: подстраховка старого prepare_call",
      "По подтверждению владельца опубликована подстраховка старого prepare_call: валидный структурированный план распознаётся до нормализации свободного текста; старое поручение сохраняется как план. В письме и истории — читаемый текст без служебного JSON; ChatGPT получает подсказку использовать prepare_secretary_plan.",
      [prep, lab, qa, head], "raw_plan_json_in_owner_views",
      "Будущая проверка писем/истории: 0 сырых JSON-планов. Это ожидание, а не результат нового звонка.",
      "Старый коннектор мог передать готовый JSON-план текстом, а история показывала служебную оболочку.",
      "Сначала валидировать готовую структуру; нормализация свободного текста не должна портить подтверждённые данные.",
      "Проверять structured_plan, цель/пункты/запреты и читаемую историю; не запускать звонок автоматически."),
    entry(ids.thought, "Опубликовано: сказать/спросить, один пункт — одна мысль",
      "По подтверждению владельца опубликованы типы say/ask и сохранение исходных структурных границ sayAsk. Запятые и «;» внутри законченной мысли не режут её на пункты. SAY закрывается по речи Кати, ASK — по ответу гостя или честному «не знаю»; unknown не равен подтверждённому положительному результату. Лёва и Тома указывают тип и доказательство.",
      [prep, lab, qa], "split_structured_checklist_items",
      "Будущая проверка: 0 разрезанных сервером структурных пунктов; сохраняется полный смысл каждой мысли.",
      "Составная мысль могла дробиться по пунктуации, а цитата неверного говорящего принималась за выполнение.",
      "Границы задаёт структурированный план; закрытие зависит от типа пункта и говорящего.",
      "Проверять неизменность структурных пунктов, полный смысл и сторону цитаты."),
    entry(ids.voicemail, "Опубликовано: именное представление, voicemail и короткие рапорты",
      "По подтверждению владельца опубликован пакет: «Сергей просил передать…» / «Sergey asked me to let you know…», имя берётся из подтверждённых данных владельца; женская форма проверяется отдельно, пол не угадывается. Voicemail leave/skip, при отсутствии разрешения — без деталей; ASK не применим только при доказанном автоответчике. Письмо — три строки итога и детали ниже. Порог Тихона для очереди Секретаря — 10 минут со свежей проверкой результата перед тревогой.",
      [lab, qa, head, ops, prep], "false_secretary_queue_delay_alerts",
      "Будущая проверка: 0 ложных QUEUE_DELAY по завершённому/штатно ожидаемому разбору. 10 минут — порог, не обещание доставки. Нового звонка здесь нет.",
      "Местоимение могло навязать пол владельца, сообщение автоответчику считалось выполнением, завершённая цепочка — задержкой очереди.",
      "Подтверждённое имя, отдельная политика voicemail, разделение произнесено/получено и свежее чтение перед тревогой.",
      "Сверять аудио/текстовые часы, SAY/ASK, короткий итог и фактическое сохранение отчёта; пол и акустический сигнал не выдумывать."),
    entry(ids.translator, "Решение владельца: OpenAI для синхронного перевода отклонён",
      "Владелец сообщил: модель синхронного перевода OpenAI проверена на стенде и отклонена как хуже текущей связки. Точное model_id, измеренные задержки и количественная разница этим решением не заданы — не выдумывать. Текущую связку сохранять; не возобновлять отклонённое направление без нового решения. Это отдельное решение от уже записанного отказа от GPT-Live Секретаря.",
      [lab, qa, head], "unauthorized_rejected_translator_rollouts",
      "0 переносов отклонённой модели синхронного перевода OpenAI и 0 повторных платных опытов без нового решения владельца.",
      "Результат отдельного стендового сравнения перевода ещё не был отражён в журнале решений.",
      "Доступность модели не означает полезность; отказ владельца сохраняется отдельно по направлению.",
      "Перед предложением читать журнал; не смешивать отказ от переводчика с GPT-Live Секретаря.", true),
  ];
  if (entries.some(e => j.crewJournalEntries.some((x: any) => x.id === e.id)))
    throw Error("NEW_ENTRY_ALREADY_EXISTS_STOP");
  if (j.crewJournalEntries.some((e: any) =>
    /синхронн.*перевод|перевод.*OpenAI/i.test(`${e.title} ${e.fact}`) && /отклон/i.test(e.fact)))
    throw Error("TRANSLATOR_DECISION_POSSIBLY_DUPLICATED_STOP");
  const lessons: any[] = [];
  const reviewers: Record<string, string> = { [lab]: qa, [qa]: head, [head]: "head-product",
    [prep]: "lg-qa-role", [ops]: "head-engineering" };
  const names: Record<string, string> = { [lab]: "Лёва", [qa]: "Тома", [head]: "Сева", [prep]: "Глеб", [ops]: "Тихон" };
  function lesson(suffix: string, roleId: string, sourceEntryId: string, before: string, learned: string, next: string) {
    lessons.push({ id: `LESSON-PUBLISHED-${suffix}-2026-11-04`, roleId, name: names[roleId],
      status: "proposed", proposedBy: { roleCode: "P.ORG", name: "Нина Кадрова",
        execution: "не запускалась; проект подготовлен вручную Replit по решению владельца" },
      actualAuthor: "Replit", reviewerRoleId: reviewers[roleId], acceptorId: "owner",
      acceptedAt: null, acceptedBy: null, before, learned, next, sourceEntryId, registeredAt: at });
  }
  const legacy = await load("generated-artifacts/nov04-publish-followup/point4-proposed-lesson.json");
  lesson("PREPARE-CALL-GLEB", prep, ids.prepare, legacy.before, legacy.learned, legacy.next);
  const thought = await load("generated-artifacts/checklist-thought/proposed-lessons.json");
  for (const l of thought.lessons)
    lesson(`SAY-ASK-${l.roleId}`, l.roleId, ids.thought, l.before, l.learned, l.next);
  lesson("VOICEMAIL-TIMING-LEVA", lab, ids.voicemail,
    "Момент первого слова сравнивался с концом распознанной реплики.",
    "Это не доказывает, что слово было после акустического сигнала автоответчика.",
    "Разделять часы аудио и UTC, сигнал / тишину / конец текста; отсутствующую отметку писать «не измерено», а не придумывать.");
  lesson("VOICEMAIL-ASK-TOMA", qa, ids.voicemail,
    "Неотвеченные вопросы на голосовой почте выглядели незакрытым поручением.",
    "Вопрос на подтверждённом автоответчике не применим; произнесённое сообщение не доказывает его получение, согласие или выполнение.",
    "ASK отмечать «не применимо» только при доказательстве автоответчика; SAY проверять по реальной речи Кати; отдельно проверять, вернулся ли человек.");
  lesson("SHORT-REPORT-SEVA", head, ids.voicemail,
    "В письмо попадали развёрнутые внутренние данные.",
    "Нужен короткий результат, таблица пунктов и защищённая ссылка на детали.",
    "Три строки наверху, затем «тип / закрыт / цитата», факт против заранее записанного ожидания. Это не приёмка владельцем.");
  lesson("QUEUE-DELAY-TIKHON", ops, ids.voicemail,
    "Ожидание цепочки около 128 секунд превысило общий порог 120 секунд.",
    "Завершённый отчёт и задержка цепочки не доказывают сбой очереди.",
    "Применять отдельный порог Секретаря 10 минут и свежее чтение перед тревогой; балансы не подменять журналом usage, unknown не повторять.");
  lesson("VOICEMAIL-PLAN-GLEB", prep, ids.voicemail,
    "План не сообщал, что делать при голосовой почте.",
    "Без явного решения нельзя раскрывать детали поручения автоответчику.",
    "Optional voicemail=leave/skip; при отсутствии — короткая просьба перезвонить без деталей. Для leave готовить SAY-сообщение и прощание одной репликой.");
  for (const role of [prep, lab])
    lesson(`OWNER-NAME-${role}`, role, ids.voicemail,
      "В заготовке было He/Он.",
      "Местоимение навязывает пол владельца.",
      "Повторять подтверждённое имя, русскую форму/согласование не выдумывать; регрессия включает женское имя и отсутствие данных о роде.");
  const steps: any[] = [{ tool: "append_journal_entries", documentId: journalId,
    hashBefore: journal.snapshotHash, args: { entries } }];
  for (const roleId of [lab, qa, head, ops, prep]) {
    const bookId = knowledgeBindings[roleId as keyof typeof knowledgeBindings], b = await doc(bookId);
    const v = JSON.parse(b.text);
    const profile = team.roles.find((r: any) => r.id === roleId)?.employeeProfiles;
    if (profile?.length !== 1 || profile[0].knowledgeBookDocumentId !== bookId)
      throw Error("BINDING_MISMATCH");
    const newLessons = lessons.filter(l => l.roleId === roleId);
    for (const l of newLessons)
      if ((v.proposedLessons ?? []).some((x: any) => x.id === l.id ||
        isDeepStrictEqual([x.before, x.learned, x.next], [l.before, l.learned, l.next])))
        throw Error("LESSON_DUPLICATE_STOP");
    steps.push({ tool: "append_knowledge_lessons", documentId: bookId,
      hashBefore: b.snapshotHash, args: { roleId, lessons: newLessons } });
  }
  const plan = { revision: team.revision,
    reason: "После подтверждённого Publish: только недостающие записи журнала и proposed-уроки, append-only",
    ownerDecisionRef: "04.11: владелец подтвердил Publish трёх пакетов и разрешил отложенные записи; без звонков",
    steps };
  for (const p of steps)
    knowledgeAppendInputs[p.tool as keyof typeof knowledgeAppendInputs].parse({
      revision: plan.revision, requestId: randomUUID(), reason: plan.reason, ownerDecisionRef: plan.ownerDecisionRef,
      ...p.args, [p.tool === "append_journal_entries" ? "documentHash" : "bookHash"]: p.hashBefore });
  await save("plan", plan);
  await save("preflight", { revision: team.revision, norms: { documentId: passportId,
    sha256: passport.snapshotHash, journalEntryPresent: true, exactProposedLessonPresent: true,
    action: "skip_already_present" }, gptLiveRejection: "present_no_duplicate",
    entries: entries.length, lessons: lessons.length, expectedCommands: steps.length * 2,
    benchmark: "benchmark_AIPhone.md not attached/found; no guessed content" });
  console.log(JSON.stringify({ status: "local_payload_validated", revision: plan.revision,
    entries: entries.length, lessons: lessons.length, calls: steps.length, commands: steps.length * 2 }));
}
main().catch(async error => {
  await save("STOP", { operations, diagnostic: productionMcpDiagnostic(error),
    reason: /^[A-Z_]+$/.test(error.message) ? error.message : "UNCONFIRMED" }).catch(() => {});
  console.log(JSON.stringify({ status: "STOP_NO_RETRY", diagnostic: productionMcpDiagnostic(error),
    reason: /^[A-Z_]+$/.test(error.message) ? error.message : "UNCONFIRMED" }));
  process.exitCode = 1;
});
