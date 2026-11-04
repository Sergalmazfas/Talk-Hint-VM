/** Descriptive MCP writes only. No runtime calls, retries, activation or approval. */
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { makeSecretaryNorms, renderSecretaryNorms, hashText, normsJournalEntry } from "./lib/secretaryNorms";
import { inputs } from "../server/productCrew/service";
import { knowledgeAppendInputs } from "../server/productCrew/knowledgeAppend";
import { callProductionMcp, productionMcpDiagnostic } from "./product-crew-production-mcp.mjs";

const dir = "generated-artifacts/secretary-norms", journalId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
const load = async (name: string) => JSON.parse(await readFile(`${dir}/${name}`, "utf8"));
const save = (name: string, value: unknown) => writeFile(`${dir}/${name}`, JSON.stringify(value, null, 2));
const rpc = async (name: string, args = {}) =>
  (await callProductionMcp("tools/call", { name, arguments: args }, { timeoutMs: 120000 })).structuredContent.result;
const operations: any[] = [];
const log: any = { status: "preflight", operations };
const persist = () => save("write-log.json", log);
let revision: number;
async function document(id: string) {
  const d = await rpc("get_document", { documentId: id });
  if (d.revision !== revision || d.snapshotHash !== hashText(d.text)) throw Error("DOCUMENT_READ_MISMATCH");
  await save(`readback-${id}.json`, d);
  return d;
}
async function command(name: string, args: any, commands: number, hashBefore: string) {
  const operation = { tool: name, uuid: args.requestId, revisionBefore: revision,
    expectedCommands: commands, hashBefore, status: "pending" };
  operations.push(operation); await persist();
  const result = await rpc(name, args);
  await save(`receipt-${operations.length}.json`, result);
  if (result.saved !== true || result.launched !== false || result.replayed || result.revision !== revision + commands)
    throw Error("WRITE_RESULT_UNCONFIRMED");
  revision = result.revision;
  return { result, operation: operation as any };
}
async function verified(operation: any, hashAfter: string) {
  operation.status = "verified"; operation.revisionAfter = revision; operation.hashAfter = hashAfter;
  await persist();
  console.log(JSON.stringify({ tool: operation.tool, status: operation.status, revision }));
}
async function main() {
  const resume = process.argv[2] === "--continue-confirmed-work";
  if (!resume && process.argv[2] !== "--apply-owner-proposed") throw Error("OWNER_CONFIRMATION_REQUIRED");
  const previous = resume ? await load("create-work-timeout.json") : null;
  const confirmed = resume ? await load("work-after-unknown.json") : null;
  if (resume && (previous.status !== "STOP_NO_RETRY" || previous.diagnostic?.category !== "timeout" ||
      previous.operations.length !== 1 || previous.operations[0].tool !== "create_work" ||
      previous.operations[0].status !== "pending" || confirmed.revision !== 1289 ||
      confirmed.record.coordination.operations[0].id !== previous.operations[0].uuid || confirmed.result !== null))
    throw Error("RESUME_NOT_RECONCILED");
  const before = await load("team-before.json"), journalBefore = await load("journal-before.json");
  const search = await load("search-before.json");
  if (before.revision !== 1288 || journalBefore.revision !== before.revision || search.revision !== before.revision ||
      search.elements.length || search.nodes.length || search.documents.length) throw Error("BASELINE_NOT_CLEAR");
  const tools = await callProductionMcp("tools/list");
  for (const name of ["get_team", "get_document", "get_work", "create_work", "submit_result", "append_journal_entries", "append_knowledge_lessons"])
    if (!tools.tools.some((t: any) => t.name === name)) throw Error("TOOL_MISSING");
  const team = await rpc("get_team", { roleId: "secretary-project-head" });
  revision = team.revision;
  if (revision !== before.revision + (resume ? 1 : 0) ||
      !isDeepStrictEqual(team.roles, before.roles)) throw Error("BASELINE_CHANGED");
  const journal = await document(journalId);
  if (journal.snapshotHash !== journalBefore.snapshotHash || journal.text !== journalBefore.text) throw Error("JOURNAL_BASELINE_CHANGED");
  const priorJournal = JSON.parse(journal.text);
  if (priorJournal.crewJournalEntries.some((e: any) => e.id === "JOURNAL-SECRETARY-NORMS-2026-11-04"))
    throw Error("DUPLICATE_JOURNAL_ENTRY");
  if (!/GPT.Live/i.test(journal.text) || !/Retell/i.test(journal.text)) throw Error("REJECTED_OPTIONS_NOT_READ");
  const bookId = team.roles[0].employeeProfiles?.[0]?.knowledgeBookDocumentId;
  // get_team.linkedWork contains operating-model nodes, not MCP work records.
  // Reconcile the descriptive work exclusively with get_work below.
  if (bookId !== "DOC-KNOWLEDGE-SECRETARY-HEAD" ||
      !isDeepStrictEqual(team.roles[0].linkedWork, before.roles[0].linkedWork)) throw Error("ROLE_BASELINE_CHANGED");
  const bookBefore = await document(bookId), bookValue = JSON.parse(bookBefore.text);
  if (bookValue.proposedLessons.some((l: any) => l.id === "LESSON-SECRETARY-NORMS-SEVA-2026-11-04")) throw Error("DUPLICATE_LESSON");
  const passport = resume ? await load("passport.json") : makeSecretaryNorms(new Date().toISOString());
  const at = passport.createdAt, text = renderSecretaryNorms(passport);
  await save("passport.json", passport); await writeFile(`${dir}/passport.md`, text);
  // Validate all four future payload shapes before the first mutation.
  const draftId = "00000000-0000-4000-8000-000000000001";
  inputs.create_work.parse({ revision, requestId: draftId, title: passport.title,
    description: "Только proposed-паспорт норм plan/fact. Описательная работа Севы, план Марии; не запуск и не приёмка.",
    client: "head-product", need: "Единый proposed-план норм с честным фактом и сторожами",
    roleId: "secretary-project-head", processId: "crew-product-roadmap", relatedIds: ["secretary-project-head", "head-product"],
    nextStep: "Марии на рассмотрение; продукт, Катю и исполнителей не менять.",
    expectedResult: "Паспорт proposed: 5 целей, 2 держать, 4 наблюдения; одна оптимизируемая метрика за раз. Факт не измерен.",
    acceptance: "Мария рассматривает план; владелец отдельно согласует изменения продукта. Самоприёмки и автоматического принятия нет." });
  const workArgs = inputs.create_work.parse({ revision, requestId: resume ? previous.operations[0].uuid : randomUUID(), title: passport.title,
    description: "Только proposed-паспорт норм plan/fact. Описательная работа Севы, план Марии; не запуск и не приёмка.",
    client: "head-product", need: "Единый proposed-план норм с честным фактом и сторожами",
    roleId: "secretary-project-head", processId: "crew-product-roadmap", relatedIds: ["secretary-project-head", "head-product"],
    nextStep: "Марии на рассмотрение; продукт, Катю и исполнителей не менять.",
    expectedResult: "Паспорт proposed: 5 целей, 2 держать, 4 наблюдения; одна оптимизируемая метрика за раз. Факт не измерен.",
    acceptance: "Мария рассматривает план; владелец отдельно согласует изменения продукта. Самоприёмки и автоматического принятия нет." });
  const nextStep = "Предложено Марии; приёмку не выполнять. Факты и исправления дописывать в журнал со ссылкой на паспорт, старый документ не заменять.";
  inputs.submit_result.parse({ revision, requestId: draftId, recordId: "draft", title: passport.title, text, nextStep });
  const entryDraft = normsJournalEntry(passport, `DOC-PC-${draftId}`, hashText(text), at);
  knowledgeAppendInputs.append_journal_entries.parse({ revision, requestId: draftId,
    reason: "Решение владельца: proposed-паспорт норм, без внедрения", ownerDecisionRef: "04.11: Паспорт норм Секретаря plan/fact; всё proposed",
    documentHash: journal.snapshotHash, entries: [entryDraft] });
  const lesson = {
    id: "LESSON-SECRETARY-NORMS-SEVA-2026-11-04", roleId: "secretary-project-head", name: "Сева",
    status: "proposed", proposedBy: { roleCode: "P.ORG", name: "Нина Кадрова",
      execution: "не запускалась; проект подготовлен вручную Replit по решению владельца" },
    actualAuthor: "Replit", reviewerRoleId: "head-product", acceptorId: "owner", acceptedAt: null, acceptedBy: null,
    before: "Нормы обсуждались по одному звонку; неизвестный факт легко спутать с нулём, а несколько целей — начать менять одновременно.",
    learned: "Разделять цели/держать/наблюдение, предварительную базу владельца и измеренный факт. Одна оптимизируемая метрика за раз; не предлагать отвергнутый GPT-Live.",
    next: "Недельная сводка plan/fact Марии с выборкой и сторожами; после первых пяти C предложить уточнение базы. Факты/исправления append-only; продукт не внедрять.",
    sourceEntryId: entryDraft.id, registeredAt: at,
  };
  const canonicalLesson = knowledgeAppendInputs.append_knowledge_lessons.parse({ revision, requestId: draftId,
    reason: "Урок Севе после ручной работы Replit", ownerDecisionRef: "Правило ручной работы и proposed-паспорт норм",
    roleId: lesson.roleId, bookHash: bookBefore.snapshotHash, lessons: [lesson] }).lessons[0];
  const workId = `PC-WORK-${workArgs.requestId.toUpperCase()}`;
  let workWrite: any, reconciledWork: any;
  if (resume) {
    const fingerprint = hashText(JSON.stringify({ name: "create_work", ...workArgs, revision: undefined }));
    const fresh = await rpc("get_work", { recordId: workId });
    if (!isDeepStrictEqual(fresh, confirmed) || fresh.record.coordination.operations[0].fingerprint !== fingerprint)
      throw Error("CONFIRMED_WORK_FINGERPRINT_MISMATCH");
    reconciledWork = fresh;
    await save("prior-timeout-log.json", previous);
    operations.push({ ...previous.operations[0], status: "verified_by_readback", revisionAfter: revision,
      hashAfter: hashText(JSON.stringify(fresh.record)), reconciledBy: "get_work; same UUID and request fingerprint" });
    log.status = "resumed_after_confirmed_readback"; await persist();
    workWrite = { result: { record: fresh.record }, operation: operations[0] };
  } else workWrite = await command("create_work", workArgs, 1, hashText(JSON.stringify(team)));
  const work = resume ? reconciledWork : await rpc("get_work", { recordId: workId });
  await save("work-created.json", work);
  if (work.revision !== revision || !isDeepStrictEqual(work.record, workWrite.result.record) ||
      work.record.coordination.roleId !== "secretary-project-head" ||
      work.record.coordination.kind !== "work" || work.record.coordination.state !== "assigned" || work.result !== null)
    throw Error("WORK_READBACK_MISMATCH");
  await verified(workWrite.operation, hashText(JSON.stringify(work.record)));
  // The preceding verified readback is the fresh input for the next command;
  // no intervening production mutation occurred.
  const freshWork = work;
  const resultArgs = inputs.submit_result.parse({ revision, requestId: randomUUID(),
    recordId: workId, title: passport.title, text, nextStep });
  const resultWrite = await command("submit_result", resultArgs, 2, hashText(JSON.stringify(freshWork.record)));
  const documentId = `DOC-PC-${resultArgs.requestId}`, d = await document(documentId);
  if (d.text !== text || d.title !== passport.title || d.snapshotHash !== hashText(text)) throw Error("PASSPORT_READBACK_MISMATCH");
  await verified(resultWrite.operation, d.snapshotHash);
  const freshJournal = await document(journalId);
  if (freshJournal.snapshotHash !== journal.snapshotHash) throw Error("JOURNAL_CHANGED");
  const entry = normsJournalEntry(passport, documentId, d.snapshotHash, new Date().toISOString());
  const journalArgs = knowledgeAppendInputs.append_journal_entries.parse({ revision, requestId: randomUUID(),
    reason: "Решение владельца: proposed-паспорт норм, без внедрения", ownerDecisionRef: "04.11: Паспорт норм Секретаря plan/fact; всё proposed",
    documentHash: freshJournal.snapshotHash, entries: [entry] });
  const journalWrite = await command("append_journal_entries", journalArgs, 2, freshJournal.snapshotHash);
  const j = await document(journalId), actual = JSON.parse(j.text);
  const stamped = actual.crewJournalEntries.find((e: any) => e.id === entry.id);
  if (!stamped || !Number.isFinite(Date.parse(stamped.expectedResultRecordedAt))) throw Error("EXPECTATION_TIMESTAMP_MISSING");
  delete stamped.expectedResultRecordedAt;
  if (!isDeepStrictEqual(actual, { ...priorJournal, crewJournalEntries: [...priorJournal.crewJournalEntries, entry] }))
    throw Error("JOURNAL_READBACK_MISMATCH");
  await verified(journalWrite.operation, j.snapshotHash);
  const freshBook = await document(bookId);
  if (freshBook.snapshotHash !== bookBefore.snapshotHash) throw Error("BOOK_CHANGED");
  const lessonArgs = knowledgeAppendInputs.append_knowledge_lessons.parse({ revision, requestId: randomUUID(),
    reason: "Урок Севе после ручной работы Replit", ownerDecisionRef: "Правило ручной работы и proposed-паспорт норм",
    roleId: lesson.roleId, bookHash: freshBook.snapshotHash, lessons: [canonicalLesson] });
  const lessonWrite = await command("append_knowledge_lessons", lessonArgs, 2, freshBook.snapshotHash);
  const b = await document(bookId);
  if (!isDeepStrictEqual(JSON.parse(b.text), { ...bookValue, proposedLessons: [...bookValue.proposedLessons, canonicalLesson] }))
    throw Error("LESSON_READBACK_MISMATCH");
  await verified(lessonWrite.operation, b.snapshotHash);
  const finalWork = await rpc("get_work", { recordId: workId });
  if (finalWork.revision !== revision || finalWork.record.coordination.state !== "awaiting_review" ||
      finalWork.result?.id !== documentId || finalWork.result.text !== text) throw Error("FINAL_WORK_MISMATCH");
  await save("work-final.json", finalWork);
  const finalTeam = await rpc("get_team", { roleId: "secretary-project-head" });
  if (finalTeam.revision !== revision || revision !== 1295 ||
      !isDeepStrictEqual(finalTeam.roles, team.roles)) throw Error("FINAL_ROLE_MISMATCH");
  log.status = "verified"; log.revisionBefore = before.revision; log.revisionAfter = revision;
  log.documentId = documentId; log.workId = workId; log.downloadPath = d.downloadPath;
  log.normsStatus = "proposed"; log.fact = "not_measured";
  await persist(); console.log(JSON.stringify({ status: "verified", revision, documentId, workId }));
}
main().catch(async e => {
  log.status = "STOP_NO_RETRY"; log.diagnostic = productionMcpDiagnostic(e);
  log.reason = /^[A-Z_]+$/.test(e.message) ? e.message : "UNCONFIRMED";
  await persist(); console.log(JSON.stringify(log)); process.exitCode = 1;
});
