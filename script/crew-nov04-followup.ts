/** Explicit owner-authorized descriptive writes only. Never run by startup/build. */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { callProductionMcp, productionMcpDiagnostic } from "./product-crew-production-mcp.mjs";
import { knowledgeAppendInputs } from "../server/productCrew/knowledgeAppend";

const dir = "generated-artifacts/nov04-publish-followup";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const load = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const save = async (p: string, v: unknown) => writeFile(p, JSON.stringify(v, null, 2));
const rpc = async (name: string, args = {}) =>
  (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
const journalId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
let revision = 1246;
const operations: any[] = [];
const log = { status: "preflight", sourceRevision: revision, operations };
const persist = () => save(`${dir}/write-log.json`, log);
const common = () => ({ revision, requestId: randomUUID(),
  reason: "Журнал и proposed-уроки по утверждённым пакетам; без запуска сотрудников и изменения продукта",
  ownerDecisionRef: "Решение владельца 04.11: Publish выполнен; семь привязок, 12 записей, 37 уроков, затем чек-лист/ожидания" });

async function read(id: string) {
  const d = await rpc("get_document", { documentId: id });
  if (d.revision !== revision || d.snapshotHash !== hash(d.text)) throw Error("READ_REVISION_HASH_MISMATCH");
  await save(`${dir}/latest-${id}.json`, d);
  return d;
}
async function write(name: keyof typeof knowledgeAppendInputs, args: any, count: number,
  expected: Record<string, any>, stamped = false) {
  knowledgeAppendInputs[name].parse(args);
  const fresh = await rpc("get_team");
  if (fresh.revision !== revision) throw Error("FRESH_REVISION_MISMATCH");
  const op: any = { name, uuid: args.requestId, revisionBefore: revision, expectedCommands: count,
    hashBefore: args.profileHash ?? args.bookHash ?? args.documentHash, status: "pending" };
  operations.push(op); await persist();
  const result = await rpc(name, args);
  await save(`${dir}/receipt-${operations.length}.json`, result);
  if (result.saved !== true || result.launched !== false || result.replayed ||
    result.revision !== revision + count) throw Error("WRITE_RESPONSE_MISMATCH_STOP_NO_RETRY");
  revision = result.revision; op.revisionAfter = revision; op.readback = [];
  for (const [id, value] of Object.entries(expected)) {
    const d = await read(id), actual = JSON.parse(d.text);
    if (stamped) {
      for (const field of ["crewJournalEntries", "crewJournalSupplements"]) {
        const expectedIds = new Set((value[field] ?? []).map((x: any) => x.id));
        for (const item of actual[field] ?? []) if (expectedIds.has(item.id) && item.expectedResultRecordedAt) {
          if (!Number.isFinite(Date.parse(item.expectedResultRecordedAt))) throw Error("BAD_SERVER_TIMESTAMP");
          // Only remove newly-added server fields, not timestamps of old history.
          if (!(value[field] ?? []).find((x: any) => x.id === item.id)?.expectedResultRecordedAt)
            delete item.expectedResultRecordedAt;
        }
      }
    }
    if (JSON.stringify(actual) !== JSON.stringify(value)) throw Error("READBACK_MISMATCH_STOP_NO_RETRY");
    op.readback.push({ id, revision, sha256: hash(d.text) });
  }
  op.status = "verified"; await persist();
  console.log(JSON.stringify({ step: operations.length, name, revision, status: "verified" }));
}
const goal = (metric: string, text: string) => ({ text, appliesTo: "other",
  metrics: [{ metric, operator: "eq", value: 0, unit: "count" }] });

async function main() {
  if (process.argv[2] !== "--owner-published") throw Error("EXPLICIT_CONFIRMATION_REQUIRED");
  const tools = await callProductionMcp("tools/list");
  for (const name of Object.keys(knowledgeAppendInputs))
    if (!tools.tools.some((t: any) => t.name === name)) throw Error("TOOL_MISSING");
  const team = await rpc("get_team");
  if (team.revision !== revision) throw Error("INITIAL_REVISION_CHANGED_STOP");
  const plan = await load("generated-artifacts/crew-append-tools/binding-plan.json");
  const payload = await load("generated-artifacts/crew-append-tools/write-payloads.json");
  const baseline = await load("generated-artifacts/crew-append-tools/baseline-manifest.json");
  const metrics = [
    "missing_independent_translation_channels", "false_call_end_alerts",
    "unbound_authorized_call_plans", "prep_role_missing_character_traits",
    "unapproved_identity_changes", "enabled_recommendation_models",
    "unreviewed_secretary_reports", "speed_runs_without_stage_timings",
    "bridges_above_authorized_frequency", "language_switches_from_short_asr_noise",
    "unauthorized_gpt_live_rollouts", "unapproved_voice_or_language_changes",
  ];
  payload.entries.forEach((e: any, i: number) => { e.expectedResult = goal(metrics[i],
    `Будущая проверка по уроку «${e.title}»: 0 нарушений (${metrics[i]}). Это не замер звонков 02–03.11 и не ретроспективная приёмка.`); });
  payload.supplements.forEach((e: any) => { e.expectedResult = goal("unapproved_duty_implementations",
    "0 внедрений предложенных обязанностей без решения владельца; дополнение остаётся proposed."); });
  // Validate the complete payload before the first write.
  const dummy = { ...common(), documentHash: "0".repeat(64) };
  knowledgeAppendInputs.append_journal_entries.parse({ ...dummy, entries: payload.entries, supplements: payload.supplements });
  for (const b of plan.bindings) {
    const p = await read(b.profileId);
    if (hash(p.text) !== b.profileHash || JSON.parse(p.text).knowledgeBookDocumentId != null) throw Error("BINDING_PRECONDITION_MISMATCH");
    if (b.bookHashBefore && hash((await read(b.bookId)).text) !== b.bookHashBefore) throw Error("OLD_BOOK_HASH_MISMATCH");
    knowledgeAppendInputs.append_knowledge_lessons.parse({ ...common(), roleId: b.roleId,
      bookHash: "0".repeat(64), lessons: payload.lessonsByRole[b.roleId] });
  }
  if (hash((await read(journalId)).text) !== baseline.journalHash) throw Error("JOURNAL_BASELINE_CHANGED");
  await save(`${dir}/validated-original-payload.json`, payload);
  log.status = "writing"; await persist();
  for (const b of plan.bindings) {
    const p = await read(b.profileId), value = JSON.parse(p.text);
    if (hash(p.text) !== b.profileHash || value.knowledgeBookDocumentId != null) throw Error("PROFILE_CHANGED");
    const expected: Record<string, any> = { [b.profileId]: { ...value, version: value.version + 1, knowledgeBookDocumentId: b.bookId } };
    const args: any = { ...common(), roleId: b.roleId, profileHash: hash(p.text) };
    if (b.bookHashBefore) {
      const book = await read(b.bookId);
      if (hash(book.text) !== b.bookHashBefore) throw Error("OLD_BOOK_CHANGED");
      args.bookHash = hash(book.text); expected[b.bookId] = JSON.parse(book.text);
    } else expected[b.bookId] = { format: "talkhint.employee.knowledge-book", version: 1, roleId: b.roleId,
      proposedLessons: [], acceptedLessons: [], runtimeChanged: false };
    await write("bind_employee_knowledge_book", args, b.commandsIncludingReceipt, expected);
  }
  const journal = await read(journalId), j = JSON.parse(journal.text);
  if (hash(journal.text) !== baseline.journalHash) throw Error("JOURNAL_CHANGED");
  await write("append_journal_entries", { ...common(), documentHash: hash(journal.text),
    entries: payload.entries, supplements: payload.supplements }, 2, {
      [journalId]: { ...j, crewJournalEntries: payload.entries, crewJournalSupplements: payload.supplements },
    }, true);
  for (const b of plan.bindings) {
    const book = await read(b.bookId), v = JSON.parse(book.text), lessons = payload.lessonsByRole[b.roleId];
    await write("append_knowledge_lessons", { ...common(), roleId: b.roleId, bookHash: hash(book.text), lessons }, 2,
      { [b.bookId]: { ...v, proposedLessons: [...(v.proposedLessons ?? []), ...lessons] } });
  }
  log.status = "first_plan_verified"; await persist();
  console.log(JSON.stringify({ status: log.status, revision, bindings: 7, entries: 12, lessons: 37 }));
}
main().catch(async e => {
  log.status = "STOP_NO_RETRY"; await persist();
  console.log(JSON.stringify({ status: log.status, diagnostic: productionMcpDiagnostic(e),
    localReason: /^([A-Z_]+)$/.test(e.message) ? e.message : "UNCONFIRMED" }));
  process.exitCode = 1;
});
