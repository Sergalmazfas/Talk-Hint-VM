/**
 * NOT run by builds, startup or tests.
 * Run only AFTER the owner's explicit Publish confirmation:
 * node script/crew-append-apply.mjs --after-owner-publish
 * One writer, no retries; a failed/ambiguous response always stops.
 */
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { callProductionMcp, productionMcpDiagnostic } from "./product-crew-production-mcp.mjs";
import { pathToFileURL } from "node:url";
const dir = "generated-artifacts/crew-append-tools";
const digest = text => createHash("sha256").update(text).digest("hex");
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--after-owner-publish")
    throw Error("OWNER_PUBLISH_CONFIRMATION_REQUIRED_NO_WRITE");
  const plan = JSON.parse(await readFile(`${dir}/binding-plan.json`, "utf8"));
  const payload = JSON.parse(await readFile(`${dir}/write-payloads.json`, "utf8"));
  const rpc = async (name, args = {}) => (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
  const list = await callProductionMcp("tools/list");
  for (const name of ["append_journal_entries", "append_knowledge_lessons", "bind_employee_knowledge_book"])
    if (!list.tools?.some(t => t.name === name)) throw Error("PUBLISHED_TOOL_MISSING_STOP");
  let team = await rpc("get_team"), revision = plan.sourceRevision;
  if (team.revision !== revision) throw Error("SOURCE_REVISION_CHANGED_NEW_PLAN_REQUIRED");
  const journalId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
  const baseline = JSON.parse(await readFile(`${dir}/baseline-manifest.json`, "utf8"));
  const run = { status: "in_progress", startedAt: new Date().toISOString(), sourceRevision: revision, operations: [] };
  const file = `${dir}/production-write-journal-${randomUUID()}.json`;
  const persist = () => writeFile(file, JSON.stringify(run, null, 2));
  const read = async id => {
    const d = await rpc("get_document", { documentId: id });
    if (d.revision !== revision || d.snapshotHash !== digest(d.text)) throw Error("READ_REVISION_OR_HASH_MISMATCH_STOP");
    return d;
  };
  const common = () => ({ revision, requestId: randomUUID(),
    reason: "Принятые журнал 02–03.11 и proposed-уроки; без изменения продукта и запуска",
    ownerDecisionRef: "Владелец: общий Publish, семь привязок, 12 записей и 37 proposed-уроков" });
  async function write(name, args, expected, commands) {
    team = await rpc("get_team");
    if (team.revision !== revision) throw Error("FRESH_REVISION_CHANGED_STOP");
    const entry = { name, requestId: args.requestId, revisionBefore: revision,
      expectedCommands: commands, status: "pending", beforeHashes: {
        ...(args.profileHash ? { profile: args.profileHash } : {}),
        ...(args.bookHash ? { book: args.bookHash } : {}),
        ...(args.documentHash ? { journal: args.documentHash } : {}),
      } };
    run.operations.push(entry); await persist(); // Recovery locator before the request.
    const result = await rpc(name, args);
    entry.revisionAfter = result.revision;
    if (result.saved !== true || result.launched !== false || result.replayed ||
        result.revision !== revision + commands) throw Error("WRITE_RESPONSE_MISMATCH_STOP_NO_RETRY");
    revision = result.revision;
    entry.readback = [];
    for (const [id, text] of Object.entries(expected)) {
      const d = await read(id);
      if (d.text !== text) throw Error("READBACK_TEXT_MISMATCH_STOP_NO_RETRY");
      entry.readback.push({ id, sha256: digest(d.text), revision: d.revision });
      await writeFile(`${dir}/after-${id}.json`, JSON.stringify(d, null, 2));
    }
    entry.status = "verified"; await persist();
  }
  try {
    await persist();
    for (const binding of plan.bindings) {
      const profile = await read(binding.profileId);
      if (digest(profile.text) !== binding.profileHash) throw Error("PROFILE_CHANGED_STOP_NEW_PLAN");
      const value = JSON.parse(profile.text);
      if (value.knowledgeBookDocumentId != null) throw Error("ALREADY_BOUND_STOP_NO_RETRY");
      const expected = { [binding.profileId]: JSON.stringify({ ...value, version: value.version + 1,
        knowledgeBookDocumentId: binding.bookId }) };
      const args = { ...common(), roleId: binding.roleId, profileHash: binding.profileHash };
      if (binding.action === "bind-existing-without-saving") {
        const book = await read(binding.bookId);
        if (digest(book.text) !== binding.bookHashBefore) throw Error("OLD_BOOK_CHANGED_STOP_NEW_PLAN");
        args.bookHash = binding.bookHashBefore;
        expected[binding.bookId] = book.text; // Verify binding left the old bytes intact.
      } else {
        expected[binding.bookId] = JSON.stringify({ format: "talkhint.employee.knowledge-book", version: 1,
          roleId: binding.roleId, proposedLessons: [], acceptedLessons: [], runtimeChanged: false });
      }
      await write("bind_employee_knowledge_book", args, expected, binding.commandsIncludingReceipt);
    }
    const journal = await read(journalId);
    if (digest(journal.text) !== baseline.journalHash) throw Error("JOURNAL_CHANGED_STOP_NEW_PLAN");
    const parsed = JSON.parse(journal.text);
    if (parsed.crewJournalEntries || parsed.crewJournalSupplements) throw Error("APPEND_TARGET_ALREADY_PRESENT_STOP");
    await write("append_journal_entries", { ...common(), documentHash: digest(journal.text),
      entries: payload.entries, supplements: payload.supplements },
    { [journalId]: JSON.stringify({ ...parsed, crewJournalEntries: payload.entries, crewJournalSupplements: payload.supplements }) }, 2);
    for (const b of plan.bindings) {
      const book = await read(b.bookId), before = JSON.parse(book.text), lessons = payload.lessonsByRole[b.roleId];
      const expected = JSON.stringify({ ...before, proposedLessons: [...(before.proposedLessons ?? []), ...lessons] });
      await write("append_knowledge_lessons", { ...common(), roleId: b.roleId, bookHash: digest(book.text), lessons },
        { [b.bookId]: expected }, 2);
    }
    team = await rpc("get_team");
    if (team.revision !== revision) throw Error("FINAL_REVISION_CHANGED_STOP");
    for (const b of plan.bindings) {
      const matches = team.roles.find(r => r.id === b.roleId)?.employeeProfiles;
      if (matches?.length !== 1 || matches[0].knowledgeBookDocumentId !== b.bookId) throw Error("FINAL_BINDING_MISMATCH_STOP");
    }
    if (revision !== plan.sourceRevision + 34 || run.operations.length !== 15) throw Error("COMMAND_COUNT_MISMATCH_STOP");
    run.status = "verified"; run.finalRevision = revision; await persist();
    console.log(JSON.stringify({ status: run.status, calls: 15, commands: 34, entries: 12, lessons: 37, finalRevision: revision }));
  } catch (error) {
    run.status = "STOP_NO_RETRY";
    // Diagnostics are constrained by the transport helper; no headers, credentials or raw server error.
    run.transportDiagnostic = productionMcpDiagnostic(error);
    await persist(); throw Error("STOP_NO_RETRY_CHECK_WRITE_JOURNAL");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.error("STOP: no retry, no further production write. Inspect the saved operation journal."); process.exitCode = 1; });
