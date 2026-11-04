/** Owner-authorized phase two. Run only after phase one verified; no retries. */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { callProductionMcp, productionMcpDiagnostic } from "./product-crew-production-mcp.mjs";
import { knowledgeAppendInputs } from "../server/productCrew/knowledgeAppend.ts";
const dir = "generated-artifacts/nov04-publish-followup";
const load = async p => JSON.parse(await readFile(p, "utf8"));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2));
const hash = s => createHash("sha256").update(s).digest("hex");
const rpc = async (name, args = {}) =>
  (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
const journalId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
const log = { status: "preflight", operations: [] };
const baselineHashes = new Map(), checkedBaseline = new Set();
let revision;
const persist = () => save(`${dir}/new-lessons-log.json`, log);
async function read(id) {
  const d = await rpc("get_document", { documentId: id });
  if (d.revision !== revision || d.snapshotHash !== hash(d.text)) throw Error("READ_MISMATCH");
  if (!checkedBaseline.has(id)) {
    if (!baselineHashes.has(id) || baselineHashes.get(id) !== d.snapshotHash)
      throw Error("EXPECTED_BASELINE_HASH_MISMATCH");
    checkedBaseline.add(id);
  }
  await save(`${dir}/latest-${id}.json`, d);
  return d;
}
const base = () => ({ revision, requestId: randomUUID(),
  reason: "Чек-лист, числовые ожидания и принятый владельцем предел 9000; только proposed-уроки",
  ownerDecisionRef: "04.11: Publish выполнен; дописать журнал и уроки Лёве, Томе, Глебу; без звонков и запуска" });
async function write(name, args, id, expected, stampedId) {
  // A fresh target-document read supplies both current revision and text hash;
  // server-side CAS rejects a concurrent revision before applying any command.
  const fresh = await read(id);
  if (hash(fresh.text) !== (args.bookHash ?? args.documentHash)) throw Error("FRESH_TARGET_HASH_MISMATCH");
  const operation = { tool: name, uuid: args.requestId, revisionBefore: revision,
    hashBefore: args.bookHash ?? args.documentHash, status: "pending" };
  log.operations.push(operation); await persist();
  const result = await rpc(name, args);
  await save(`${dir}/new-receipt-${log.operations.length}.json`, result);
  if (result.saved !== true || result.launched !== false || result.replayed || result.revision !== revision + 2)
    throw Error("WRITE_RESPONSE_MISMATCH");
  revision = result.revision;
  const d = await read(id), v = JSON.parse(d.text);
  if (stampedId) {
    const entry = v.crewJournalEntries.find(x => x.id === stampedId);
    if (!entry || !Number.isFinite(Date.parse(entry.expectedResultRecordedAt))) throw Error("SERVER_TIMESTAMP_MISSING");
    operation.expectedResultRecordedAt = entry.expectedResultRecordedAt;
    delete entry.expectedResultRecordedAt;
  }
  if (JSON.stringify(v) !== JSON.stringify(expected)) throw Error("READBACK_MISMATCH");
  operation.status = "verified"; operation.revisionAfter = revision; operation.hashAfter = hash(d.text);
  await persist(); console.log(JSON.stringify(operation));
}
async function main() {
  const validateOnly = process.argv[2] === "--validate-only";
  if (!validateOnly && process.argv[2] !== "--owner-published") throw Error("CONFIRMATION_REQUIRED");
  const first = await load(`${dir}/write-log.json`);
  if (first.status !== "first_plan_verified" || first.operations.length !== 15 ||
      first.operations.some(x => x.status !== "verified")) throw Error("FIRST_PHASE_NOT_VERIFIED");
  for (const operation of first.operations)
    for (const document of operation.readback)
      baselineHashes.set(document.id, document.sha256);
  revision = first.operations.at(-1).revisionAfter;
  if (revision !== 1280) throw Error("FIRST_PHASE_COMMAND_COUNT_MISMATCH");
  if (!validateOnly) {
    const tools = await callProductionMcp("tools/list");
    for (const name of ["get_team", "get_document", "append_journal_entries", "append_knowledge_lessons"])
      if (!tools.tools.some(t => t.name === name)) throw Error("TOOL_MISSING");
    if ((await rpc("get_team")).revision !== revision) throw Error("PHASE_REVISION_CHANGED");
  }
  const prepared = await load("generated-artifacts/secretary-review-reliability/expectations/journal-entry-proposed-write.json");
  const entry = { ...prepared.entry,
    registeredAt: new Date().toISOString(),
    title: "Короткий чек-лист, числовые ожидания и компактный предел 9000",
    targetRoleIds: ["secretary-lab-engineer", "secretary-qa", "hint-call-prep-master"],
    fact: "Владелец принял и опубликовал пакет чек-листа/ожиданий и увеличение компактного предела до 9000 без сокращения правил. Стабильный префикс кэшируется; выше 9000 — полный промпт, откат сохранён. Живых контрольных звонков в этом заходе не было.",
    evidenceRefs: ["server/secretary/checklist.test.ts", "server/secretary/phoneC.test.ts", "server/aiCrew/expectations.test.ts"],
    verification: "Полный предыдущий пакет: 372 файла, 3619 passed, 0 failed, 44 skipped; production-вариант C прочитан отдельно. Это не замер следующего звонка.",
    before: "Pilot 208 по разбору владельца: 12 реплик вместо предполагаемых 6; пять вопросов слеплены в одной фразе. Не было формализованной независимой сверки с числовым ожиданием.",
    learned: "Нужны короткие пункты, независимая проверка закрытия и сравнение факта с заранее записанным ожиданием. Увеличение лимита промпта не разрешает сокращать правила или раздувать поручение.",
    next: "На следующих звонках Лёва/Тома сверяют чек-лист и заранее записанные ожидания; Глеб предлагает улучшение подготовки, не внедряет его.",
    expectedResult: {
      text: "На следующих звонках: 0 повторов уже закрытых вопросов. Лёва и Тома считают независимо по расшифровке; отсутствие замера не считается нулём. Оценка ≤6 реплик относится к гипотезе Pilot 208, а не ко всем поручениям.",
      appliesTo: "secretary_call",
      metrics: [{ metric: "repeat_questions", operator: "eq", value: 0, unit: "repeats" }],
    },
  };
  const now = new Date().toISOString();
  const reviewers = { "secretary-lab-engineer": "secretary-qa", "secretary-qa": "secretary-project-head",
    "hint-call-prep-master": "lg-qa-role" };
  const names = { "secretary-lab-engineer": "Лёва", "secretary-qa": "Тома", "hint-call-prep-master": "Глеб" };
  const lesson = (roleId, id, before, learned, next) => ({
    id, roleId, name: names[roleId], status: "proposed",
    proposedBy: { roleCode: "P.ORG", name: "Нина Кадрова",
      execution: "не запускалась; проект подготовлен вручную Replit по решению владельца" },
    actualAuthor: "Replit", reviewerRoleId: reviewers[roleId], acceptorId: "owner",
    acceptedAt: null, acceptedBy: null, before, learned, next, sourceEntryId: entry.id, registeredAt: now,
  });
  const numeric = (await load("generated-artifacts/secretary-review-reliability/expectations/proposed-lessons.json")).lessons;
  const checklist = (await load("generated-artifacts/secretary-review-reliability/proposed-lessons.json")).entries;
  const lessons = [
    ...numeric,
    ...checklist.map((x, i) => lesson(i === 0 ? "secretary-lab-engineer" : "hint-call-prep-master",
      `LESSON-PILOT208-CHECKLIST-${i === 0 ? "LEVA" : "GLEB"}-2026-11-04`,
      x.whatWas, x.whatLearned, x.nextTime)),
    lesson("secretary-lab-engineer", "LESSON-COMPACT9000-LEVA-2026-11-04",
      "Порог 5000 приводил к fallback полного промпта.",
      "Владелец разрешил 9000 включительно; выше — полный промпт без потери правил. Эффект кэша/скорости требует замера.",
      "Записывать promptChars/promptMode/fallbackReason/cachedInput и реальную задержку; не приписывать тесту результат звонка."),
    lesson("secretary-qa", "LESSON-COMPACT9000-TOMA-2026-11-04",
      "Проверка только обычного размера пропускает границы и изменение правил.",
      "Нужны границы 5001/8999/9000/9001, сохранность правил и полного fallback, стабильный cache key и откат.",
      "Независимо сверять режим/размер и отсутствие сокращения правил; тесты не заменяют контрольный звонок."),
    lesson("hint-call-prep-master", "LESSON-COMPACT9000-GLEB-2026-11-04",
      "Пять вопросов в одной фразе поручения удлиняли диалог.",
      "Больший лимит не заменяет короткий чек-лист и не разрешает сокращать безопасность.",
      "Готовить короткие пункты после стабильного префикса, явно выделять неизвестное и запреты; изменения только предложением владельцу."),
  ];
  // Reject a malformed proposal locally before any phase-two mutation.
  knowledgeAppendInputs.append_journal_entries.parse({ ...base(), documentHash: "0".repeat(64), entries: [entry] });
  for (const roleId of Object.keys(reviewers))
    knowledgeAppendInputs.append_knowledge_lessons.parse({ ...base(), roleId, bookHash: "0".repeat(64),
      lessons: lessons.filter(l => l.roleId === roleId) });
  await save(`${dir}/new-proposed-payload.json`, { entry, lessons });
  if (validateOnly) {
    console.log(JSON.stringify({ validated: true, productionRequests: 0, entries: 1, proposedLessons: lessons.length }));
    return;
  }
  const journal = await read(journalId), j = JSON.parse(journal.text);
  if (j.crewJournalEntries?.some(e => e.id === entry.id)) throw Error("ENTRY_ALREADY_PRESENT_RECONCILE_REQUIRED");
  await write("append_journal_entries", { ...base(), documentHash: hash(journal.text), entries: [entry] },
    journalId, { ...j, crewJournalEntries: [...j.crewJournalEntries, entry] }, entry.id);
  const bindings = (await load("generated-artifacts/crew-append-tools/binding-plan.json")).bindings;
  for (const roleId of Object.keys(reviewers)) {
    const b = bindings.find(b => b.roleId === roleId), profile = JSON.parse((await read(b.profileId)).text);
    if (profile.knowledgeBookDocumentId !== b.bookId) throw Error("BINDING_MISMATCH");
    const book = await read(b.bookId), value = JSON.parse(book.text), add = lessons.filter(l => l.roleId === roleId);
    if (add.some(l => value.proposedLessons.some(old => old.id === l.id))) throw Error("LESSON_ALREADY_PRESENT");
    await write("append_knowledge_lessons", { ...base(), roleId, bookHash: hash(book.text), lessons: add },
      b.bookId, { ...value, proposedLessons: [...value.proposedLessons, ...add] });
  }
  if ((await rpc("get_team")).revision !== revision || revision !== 1288) throw Error("FINAL_REVISION_MISMATCH");
  log.status = "verified"; log.finalRevision = revision; log.entriesAdded = 1; log.lessonsAdded = lessons.length;
  await persist(); console.log(JSON.stringify({ status: log.status, revision, newEntries: 1, newLessons: lessons.length }));
}
main().catch(async e => { log.status = "STOP_NO_RETRY"; await persist();
  console.log({ status: log.status, diagnostic: productionMcpDiagnostic(e),
    localReason: /^[A-Z_]+$/.test(e.message) ? e.message : "UNCONFIRMED" }); process.exitCode = 1; });
