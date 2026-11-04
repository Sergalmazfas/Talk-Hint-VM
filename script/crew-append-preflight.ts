/** Offline reproduction on the freshly read production documents. No database/provider calls. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { initialModel } from "../server/projectModel/seed";
import { applyCommand } from "../server/projectModel/domain";
import { assertTransactionBatch } from "../server/projectModel/transactionBatch";
import { buildCompanyStructure } from "../shared/companyStructure";
import { defaultOperatingModel, emptyWorkNode } from "../shared/operatingModelTemplate";
import { knowledgeBindings, knowledgeAppendCommands, journalDocumentId, textHash } from "../server/productCrew/knowledgeAppend";
import { businessTables, project, type Schema } from "../server/companyData/relational";
import { ProductCrewService } from "../server/productCrew/service";
import type { ModelCommand } from "../shared/projectModel";

const dir = "generated-artifacts/crew-append-tools";
const packet = JSON.parse(await readFile("generated-artifacts/crew-lessons-nov02-03/packet.json", "utf8"));
const team = JSON.parse(await readFile(`${dir}/team.json`, "utf8"));
const data = buildCompanyStructure(defaultOperatingModel());
for (const id of Object.keys(knowledgeBindings))
  if (!data.nodes.some(n => n.id === id))
    data.nodes.push({ ...emptyWorkNode(id, id, id, "role"), managerId: "head-product" });
let state = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0, data }, "owner");
const read = async (id: string) => JSON.parse(await readFile(`${dir}/${id}.json`, "utf8"));
const profiles: Record<string, string> = {};
const baseline = new Map<string, string>();
for (const id of Object.keys(knowledgeBindings)) {
  const matches = team.roles.find((r: any) => r.id === id).employeeProfiles;
  assert.equal(matches.length, 1);
  profiles[id] = matches[0].documentId;
}
const ids = [...Object.values(profiles), ...Object.values(knowledgeBindings).filter(id => id.startsWith("DOC-PC")), journalDocumentId];
for (const id of ids) {
  const doc = await read(id);
  assert.equal(doc.revision, team.revision);
  baseline.set(id, doc.text);
  state = applyCommand(state, { type: "createDocument", id, title: doc.title, text: doc.text, url: "", elementIds: [] }, "owner");
}
const doc = (id: string) => state.documents.find(d => d.id === id)!;
const plan: any[] = [], operations: any[] = [];
const base = () => ({ revision: state.revision, requestId: randomUUID(), reason: "Принятый пакет журнала и уроков 02–03.11",
  ownerDecisionRef: "Владелец: один общий Publish; привязать семь книжек, затем 12 записей и 37 proposed-уроков" });
const apply = async (name: keyof typeof import("../server/productCrew/knowledgeAppend").knowledgeAppendInputs, args: any) => {
  const { commands } = knowledgeAppendCommands(state, name, args);
  // Add the real service receipt and exercise the domain and ordinary 1..3 batch cap.
  const service = new ProductCrewService({ read: async () => state,
    updateMany: async (owner: string, revision: number, cmds: ModelCommand[]) => {
      assert.equal(revision, state.revision);
      assertTransactionBatch(owner, revision, cmds, "new-country");
      assert.equal(cmds.length, commands.length + 1);
      state = cmds.reduce((s, c) => applyCommand(s, c, owner), state);
      return state;
    },
  } as any, { production: true });
  const before = state.revision;
  const result = await service.call("owner", name, args);
  assert.equal(result.revision, before + commands.length + 1);
  for (const c of commands) if (c.type === "createDocument" || c.type === "saveDocument") {
    const reread = await service.call("owner", "get_document", { documentId: c.id });
    assert.equal(reread.text, c.text);
    assert.equal(reread.snapshotHash, textHash(c.text));
  }
  operations.push({ name, roleId: args.roleId ?? null, commandCount: commands.length + 1,
    simulatedRevisionBefore: before, simulatedRevisionAfter: state.revision, readback: "passed" });
};
for (const [roleId, bookId] of Object.entries(knowledgeBindings)) {
  const profileId = profiles[roleId], source = doc(profileId);
  const old = bookId.startsWith("DOC-PC");
  const a = { ...base(), roleId, profileHash: textHash(source.text),
    ...(old ? { bookHash: textHash(doc(bookId).text) } : {}) };
  plan.push({ roleId, profileId, profileHash: a.profileHash, bookId, action: old ? "bind-existing-without-saving" : "create-empty-and-bind",
    bookHashBefore: old ? a.bookHash : null, commandsIncludingReceipt: old ? 2 : 3,
    profileDownloadUrl: `https://talkhint.app/api/admin/product-crew/documents/${encodeURIComponent(profileId)}/download` });
  const oldBytes = old ? doc(bookId).text : null;
  const oldProfile = JSON.parse(source.text);
  await apply("bind_employee_knowledge_book", a);
  assert.deepEqual(JSON.parse(doc(profileId).text), { ...oldProfile, version: oldProfile.version + 1, knowledgeBookDocumentId: bookId });
  if (old) assert.equal(doc(bookId).text, oldBytes);
}
const supplements = [
  ...packet.roleReviews.map((r: any) => ({ id: `RETRO-2026-11-02-03-DUTIES-${r.roleId}`, title: `Ручная сверка: ${r.name}`,
    text: JSON.stringify(r), status: "proposed", actualAuthor: "Replit", agentExecution: false })),
  { id: "RETRO-2026-11-02-03-RECONCILIATION", title: "Итог сверки обязанностей и границы доказательств",
    text: JSON.stringify({ sourceStatus: "Принятый пакет: ретроспектива подготовки до инструмента",
      ...packet.journalReconciliation, currentWritePlan: "После Publish: запись разрешённым append; агенты не читали и не запускались" }),
    status: "proposed", actualAuthor: "Replit", agentExecution: false },
];
const oldJournal = JSON.parse(doc(journalDocumentId).text);
await apply("append_journal_entries", { ...base(), documentHash: textHash(doc(journalDocumentId).text),
  entries: packet.entries, supplements });
assert.deepEqual(JSON.parse(doc(journalDocumentId).text), { ...oldJournal, crewJournalEntries: packet.entries, crewJournalSupplements: supplements });
const preparedLessons: Record<string, any[]> = {};
for (const [roleId, bookId] of Object.entries(knowledgeBindings)) {
  const lessons = packet.lessons.filter((l: any) => l.roleId === roleId).map((l: any) => {
    const { storedInProductionBook, writeStatus, ...content } = l; return content;
  });
  preparedLessons[roleId] = lessons;
  const before = JSON.parse(doc(bookId).text);
  await apply("append_knowledge_lessons", { ...base(), roleId, bookHash: textHash(doc(bookId).text), lessons });
  assert.deepEqual(JSON.parse(doc(bookId).text), { ...before, proposedLessons: lessons });
}
// The normalized projector sees the real seven profile texts, including required character fields.
const schema: Schema = Object.fromEntries(businessTables.map(t => [t, { keys: ["source_pointer"], columns: [] }]));
schema.company_extra_fields = { keys: ["source_path"], columns: ["workspace_id", "revision", "hypothesis_id",
  "source_path", "value_type", "string_value"].map(name => ({ name, type: "text", nullable: true, defaultValue: null })) };
for (const table of ["company_roles", "company_employee_profiles"] as const) {
  const keys = ["workspace_id", "hypothesis_id", "operating_version", "entity_id"];
  const columns = table === "company_roles" ? [...keys, "mode", "mode_source"] :
    [...keys, "profile_version", "display_name", "trait_1", "trait_2", "trait_3", "motto",
      "owner_selection_status", "source_document_id", "accepted_by", "accepted_at"];
  schema[table] = { keys: table === "company_roles" ? keys : [...keys, "profile_version"],
    columns: columns.map(name => ({ name, type: "text", nullable: true, defaultValue: null })) };
}
project(JSON.parse(JSON.stringify(state)), "offline", schema);
assert.equal(packet.entries.length, 12);
assert.equal(Object.values(preparedLessons).flat().length, 37);
assert.equal(operations.length, 15);
assert.equal(operations.reduce((n, o) => n + o.commandCount, 0), 34);
await writeFile(`${dir}/binding-plan.json`, JSON.stringify({ sourceRevision: team.revision, productionWrites: 0, bindings: plan }, null, 2));
await writeFile(`${dir}/baseline-manifest.json`, JSON.stringify({ revision: team.revision,
  journalId: journalDocumentId, journalHash: textHash(baseline.get(journalDocumentId)!) }, null, 2));
await writeFile(`${dir}/write-payloads.json`, JSON.stringify({ entries: packet.entries, supplements, lessonsByRole: preparedLessons }, null, 2));
await writeFile(`${dir}/preflight.json`, JSON.stringify({ productionWrites: 0, modelCalls: 0, sourceRevision: team.revision,
  domain: "passed", batchGuards: "passed", normalizedProjection: "passed", readback: "passed",
  oldBookBytesUnchangedDuringBinding: true, oldContentPreservedAfterAppend: true, commands: 34, calls: 15,
  entries: 12, lessons: 37, supplements: 8, operations }, null, 2));
console.log(JSON.stringify({ sourceRevision: team.revision, productionWrites: 0, calls: 15, commands: 34,
  entries: 12, lessons: 37, normalizedProjection: "passed" }));
