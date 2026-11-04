/** Explicit one-shot owner-authorized descriptive appends. No retries or runtime changes. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { callProductionMcp, productionMcpDiagnostic } from "./product-crew-production-mcp.mjs";
import { knowledgeAppendInputs, knowledgeBindings, journalDocumentId } from "../server/productCrew/knowledgeAppend";
const dir = "generated-artifacts/flying706";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const save = (name: string, data: unknown) => writeFile(`${dir}/${name}.json`, JSON.stringify(data, null, 2));
const rpc = async (name: string, args = {}) =>
  (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
const log: any[] = [];
async function main() {
  if (process.argv[2] !== "--owner-authorized") throw Error("EXPLICIT_AUTHORIZATION_REQUIRED");
  // Prevent accidental rerun of any confirmed or unconfirmed write.
  try { await readFile(`${dir}/lesson-write-log.json`); throw Error("EXISTING_WRITE_LOG_STOP"); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  const tools = await callProductionMcp("tools/list", {});
  for (const name of ["get_team", "get_document", "append_journal_entries", "append_knowledge_lessons"])
    if (!tools.tools.some((t: any) => t.name === name)) throw Error("TOOL_MISSING_STOP");
  const at = new Date().toISOString(), sourceEntryId = "JOURNAL-FLYING706-OPENING-2026-11-04";
  const entry = {
    id: sourceEntryId, title: "Flying J #706: запись принята за живого человека",
    eventDatePrecision: "range-only", eventPeriod: ["2026-11-04", "2026-11-04"],
    registeredAt: at, actualAuthor: "Replit", classification: "reported_fact", source: "owner",
    fact: "Владелец сообщил наложение вступления Кати на запись. Сохранённые word clocks подтверждают наложение последующей фразы. Retell GET: user_hangup, длительность 30.475 с; Twilio completed. Дальнейшее меню не установлено. Dev-исправление ожидания первой речи подготовлено, ещё не опубликовано; голос, языки, модель и безопасность не менялись. Отдельная проверка пропуска Лёвой/Томой в старом отчёте не подтверждена доступными данными.",
    evidenceRefs: ["retell:call_2deadbe120bae479f0dba0730d3", "generated-artifacts/flying706/diagnosis.md"],
    targetRoleIds: ["secretary-lab-engineer", "secretary-qa"],
    verification: "Только чтение production, Retell GET и Twilio GET; новых звонков и запусков команды не было.",
    productChangeAuthorized: false, newRuntimeExecution: false,
    before: "Короткое Thank you из записи могло приниматься за человека; при соединении сервер сам начинал вступление.",
    learned: "Начало звонка проверяется отдельно от выполнения поручения; thank you for calling/IVR не равно живому приветствию.",
    next: "Предложенные уроки проверяет владелец. Исправление кода — отдельно Клавдию и на Publish владельцем.",
    expectedResult: { text: "После отдельного Publish: 0 реплик Кати поверх определённой записи; не более 1 проверки начальной тишины; 0 повторов вступления. Этот звонок не переоценивать как успешный.",
      appliesTo: "secretary_call", metrics: [
        { metric: "speech_over_recording", operator: "eq", value: 0, unit: "count" },
        { metric: "initial_silence_probes", operator: "lte", value: 1, unit: "count" },
        { metric: "repeated_introductions", operator: "eq", value: 0, unit: "repeats" },
      ] },
  };
  const lessons = ["secretary-lab-engineer", "secretary-qa"].map((roleId, i) => ({
    id: `LESSON-FLYING706-OPENING-${i ? "TOMA" : "LEVA"}-2026-11-04`,
    roleId, name: i ? "Тома" : "Лёва", status: "proposed",
    proposedBy: { roleCode: "P.ORG", name: "Нина Кадрова",
      execution: "не запускалась; проект подготовлен вручную Replit по решению владельца" },
    actualAuthor: "Replit", reviewerRoleId: i ? "secretary-project-head" : "secretary-qa",
    acceptorId: "owner", acceptedAt: null, acceptedBy: null, sourceEntryId, registeredAt: at,
    before: "Flying J #706: запись автоответчика принята за человека; начало не выделено отдельной проверкой.",
    learned: "Thank you — фрагмент, не доказательство человека. Отдельно различать запись-IVR, voicemail, человека и тишину; завершение разговора не доказывает выполнения поручения.",
    next: i ? "Независимо сверять тип ответившего, первого говорящего и наложение речи по исходной расшифровке/word clocks; пропуск Лёвы указать в расхождениях. Нет времён — не проверено, не false."
      : "В каждом разборе отдельно указать тип ответившего, кто заговорил первым и говорила ли Катя поверх записи. Меню и voicemail не смешивать. При отсутствии звуковых времён честно указать, что наложение не измерено.",
  }));
  await save("proposed-lessons", { sourceEntryId, lessons });
  const steps = [
    { tool: "append_journal_entries", id: journalDocumentId, field: "crewJournalEntries", args: { entries: [entry] } },
    ...lessons.map(lesson => ({ tool: "append_knowledge_lessons", id: knowledgeBindings[lesson.roleId as keyof typeof knowledgeBindings],
      field: "proposedLessons", args: { roleId: lesson.roleId, lessons: [lesson] } })),
  ];
  for (const step of steps) {
    const team = await rpc("get_team"), revision = team.revision;
    if (!Number.isSafeInteger(revision) || log.length && revision !== log.at(-1).revisionAfter)
      throw Error("REVISION_CHANGED_STOP");
    const before = await rpc("get_document", { documentId: step.id });
    if (before.revision !== revision || before.snapshotHash !== hash(before.text)) throw Error("READ_HASH_MISMATCH_STOP");
    const value = JSON.parse(before.text), additions = "entries" in step.args ? step.args.entries : step.args.lessons;
    if ((value[step.field] ?? []).some((old: any) => additions.some(a => a.id === old.id))) throw Error("DUPLICATE_STOP");
    const expected = { ...value, [step.field]: [...(value[step.field] ?? []), ...additions] };
    const args = knowledgeAppendInputs[step.tool as keyof typeof knowledgeAppendInputs].parse({
      revision, requestId: randomUUID(), reason: "Урок по Flying J #706 по решению владельца; только proposed, без внедрения",
      ownerDecisionRef: "Решение владельца 2026-11-04, часть 2, пункт 7",
      ...step.args, [step.field === "crewJournalEntries" ? "documentHash" : "bookHash"]: before.snapshotHash,
    });
    const op: any = { tool: step.tool, documentId: step.id, revisionBefore: revision,
      hashBefore: before.snapshotHash, uuid: args.requestId, status: "pending" };
    log.push(op); await save("lesson-write-log", log);
    const result = await rpc(step.tool, args);
    await save(`lesson-receipt-${log.length}`, result);
    if (!result.saved || result.launched !== false || result.replayed || result.revision !== revision + 2)
      throw Error("RECEIPT_MISMATCH_STOP");
    const after = await rpc("get_document", { documentId: step.id });
    if (after.revision !== result.revision || after.snapshotHash !== hash(after.text)) throw Error("READBACK_HASH_STOP");
    const actual = JSON.parse(after.text);
    if (step.field === "crewJournalEntries") for (const item of actual[step.field])
      if (item.id === sourceEntryId) {
        if (!Number.isFinite(Date.parse(item.expectedResultRecordedAt))) throw Error("TIMESTAMP_MISSING_STOP");
        delete item.expectedResultRecordedAt;
      }
    if (!isDeepStrictEqual(actual, expected)) throw Error("READBACK_CONTENT_STOP");
    Object.assign(op, { revisionAfter: after.revision, hashAfter: after.snapshotHash, status: "verified" });
    await save("lesson-write-log", log);
    console.log(JSON.stringify(op));
  }
}
main().catch(async error => {
  await save("LESSON-STOP", { reason: /^[A-Z_]+$/.test(error?.message) ? error.message : "UNCONFIRMED_STOP",
    diagnostic: productionMcpDiagnostic(error) ?? null });
  console.error("LESSON_STOP_NO_RETRY"); process.exitCode = 1;
});
