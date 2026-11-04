import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { assertTransactionBatch } from "../projectModel/transactionBatch";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel, emptyWorkNode } from "../../shared/operatingModelTemplate";
import { ProductCrewService, inputs, productionTeamTools, writeTools } from "./service";
import { knowledgeBindings, knowledgeAppendCommands, journalDocumentId, textHash } from "./knowledgeAppend";
import type { ProjectModelState, ModelCommand } from "../../shared/projectModel";
import type { ModelRepository } from "../projectModel/repository";
import { ModelError } from "../projectModel/modelError";
import { businessTables, project, type Schema } from "../companyData/relational";

const role = "secretary-project-head", oldRole = "laboratory-engineer-role";
function fixture() {
  const data = buildCompanyStructure(defaultOperatingModel());
  for (const id of Object.keys(knowledgeBindings))
    if (!data.nodes.some(n => n.id === id))
      data.nodes.push({ ...emptyWorkNode(id, id, id, "role"), managerId: "head-product" });
  let s = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0, data }, "owner");
  const add = (id: string, value: object) => {
    s = applyCommand(s, { type: "createDocument", id, title: id, text: JSON.stringify(value),
      url: "", elementIds: [] }, "owner");
  };
  add(journalDocumentId, { format: "talkhint.improvement-journal", version: 31,
    cases: [{ id: "old", unknown: "keep" }], history: [{ at: "old" }],
    largeLegacyMaterial: "x".repeat(51_000), futureField: { keep: true } });
  for (const id of Object.keys(knowledgeBindings)) {
    add(`PROFILE-${id}`, { version: 9, format: "talkhint.employee.profile",
      visualPassport: { roleId: id, character: { traits: ["точный", "честный", "спокойный"], motto: "Факты" } },
      knowledgeBookDocumentId: null, prompt: "DO NOT CHANGE", executorId: "unchanged", permissions: ["unchanged"],
      futureField: { keep: true } });
    if ([oldRole, "lg-qa-role", "management-role-operations-specialist"].includes(id))
      add(knowledgeBindings[id as keyof typeof knowledgeBindings], {
        format: "talkhint.stage.review-result", accepted: false,
        documents: [{ knowledgeBook: { oldLesson: "ORIGINAL" }, prompt: "UNCHANGED" }], futureField: "keep",
      });
  }
  return s;
}
const get = (s: ProjectModelState, id: string) => s.documents.find(d => d.id === id)!;
const common = (s: ProjectModelState) => ({ revision: s.revision, requestId: randomUUID(),
  reason: "Только описательная запись", ownerDecisionRef: "Решение владельца" });
const entry = () => ({ id: "RETRO-ONE", title: "Разбор", eventDatePrecision: "range-only" as const,
  eventPeriod: ["2026-11-02", "2026-11-03"], registeredAt: "2026-11-04T01:00:00.000Z",
  actualAuthor: "Replit", classification: "reported_fact", source: "owner", fact: "Факт владельца",
  evidenceRefs: [], targetRoleIds: Object.keys(knowledgeBindings), verification: "По сообщению владельца",
  productChangeAuthorized: false, newRuntimeExecution: false, before: "Было", learned: "Узнали", next: "Проверить" });
const journalArgs = (s: ProjectModelState) => ({ ...common(s),
  documentHash: textHash(get(s, journalDocumentId).text), entries: [entry()] });
const bindArgs = (s: ProjectModelState, id = role) => ({ ...common(s), roleId: id,
  profileHash: textHash(get(s, `PROFILE-${id}`).text),
  ...([oldRole, "lg-qa-role", "management-role-operations-specialist"].includes(id)
    ? { bookHash: textHash(get(s, knowledgeBindings[id as keyof typeof knowledgeBindings]).text) } : {}) });
const lesson = (id = role) => ({ id: "LESSON-ONE", roleId: id, name: "Сотрудник", status: "proposed",
  proposedBy: { roleCode: "P.ORG", name: "Нина Кадрова",
    execution: "не запускалась; проект подготовлен вручную Replit по решению владельца" },
  actualAuthor: "Replit", reviewerRoleId: "head-product", acceptorId: "owner", acceptedAt: null,
  acceptedBy: null, before: "Было", learned: "Узнали", next: "Проверять", sourceEntryId: "RETRO-ONE",
  registeredAt: "2026-11-04T01:00:00.000Z" });
function apply(s: ProjectModelState, name: keyof typeof import("./knowledgeAppend").knowledgeAppendInputs, a: unknown) {
  return knowledgeAppendCommands(s, name, a).commands.reduce((state, c) => applyCommand(state, c, "owner"), s);
}
const lessonArgs = (s: ProjectModelState, id = role) => ({ ...common(s), roleId: id,
  bookHash: textHash(get(s, knowledgeBindings[id as keyof typeof knowledgeBindings]).text), lessons: [lesson(id)] });

describe("append-only journal and employee knowledge", () => {
  it("preserves >50k canonical journal, all unknown keys and old history; MCP returns full text and volumes", async () => {
    const s = fixture(), old = JSON.parse(get(s, journalDocumentId).text);
    const next = apply(s, "append_journal_entries", journalArgs(s));
    const saved = JSON.parse(get(next, journalDocumentId).text);
    expect(saved).toEqual({ ...old, crewJournalEntries: [entry()] });
    expect(next.operatingModel).toEqual(s.operatingModel);
    const r = await new ProductCrewService({ read: async () => next } as ModelRepository)
      .call("owner", "get_document", { documentId: journalDocumentId });
    expect(r.text).toBe(get(next, journalDocumentId).text);
    expect(r.snapshotHash).toBe(textHash(r.text));
    expect(r.volumeManifest.volumes.length).toBeGreaterThan(1);
  });
  it.each(Object.keys(knowledgeBindings))("binds only approved ID for %s and preserves profile fields", id => {
    const s = fixture(), before = JSON.parse(get(s, `PROFILE-${id}`).text);
    const oldBooks = s.documents.filter(d => d.id.startsWith("DOC-PC")).map(d => ({ ...d }));
    const commands = knowledgeAppendCommands(s, "bind_employee_knowledge_book", bindArgs(s, id)).commands;
    expect(commands.length).toBe(id.startsWith("secretary-") || id === "hint-call-prep-master" ? 2 : 1);
    const next = commands.reduce((state, c) => applyCommand(state, c, "owner"), s);
    expect(JSON.parse(get(next, `PROFILE-${id}`).text)).toEqual({
      ...before, version: 10, knowledgeBookDocumentId: knowledgeBindings[id as keyof typeof knowledgeBindings],
    });
    for (const d of oldBooks) expect(get(next, d.id)).toEqual(d);
    expect(() => knowledgeAppendCommands(next, "bind_employee_knowledge_book", bindArgs(next, id))).toThrow("уже привязана");
  });
  it.each([role, oldRole])("appends only proposed lessons for %s and keeps old material", id => {
    let s = fixture(); s = apply(s, "bind_employee_knowledge_book", bindArgs(s, id));
    s = apply(s, "append_journal_entries", journalArgs(s));
    const bookId = knowledgeBindings[id as keyof typeof knowledgeBindings], old = JSON.parse(get(s, bookId).text);
    const next = apply(s, "append_knowledge_lessons", lessonArgs(s, id));
    expect(JSON.parse(get(next, bookId).text)).toEqual({ ...old, proposedLessons: [lesson(id)] });
    expect(get(next, `PROFILE-${id}`)).toEqual(get(s, `PROFILE-${id}`));
    expect(() => apply(next, "append_knowledge_lessons", lessonArgs(next, id))).toThrow("ID уже существует");
  });
  it("rejects stale hashes, unknown roles, duplicates, foreign source and malformed legacy", () => {
    let s = fixture();
    expect(() => apply(s, "append_journal_entries", { ...journalArgs(s), documentHash: "0".repeat(64) })).toThrow("hash");
    expect(() => apply(s, "append_journal_entries", { ...journalArgs(s), entries: [entry(), entry()] })).toThrow("ID");
    expect(inputs.bind_employee_knowledge_book.safeParse({ ...bindArgs(s), roleId: "katya" }).success).toBe(false);
    const bad = structuredClone(s); get(bad, journalDocumentId).text += "\nOwner prose";
    expect(() => apply(bad, "append_journal_entries", journalArgs(bad))).toThrow("формат");
    s = apply(s, "bind_employee_knowledge_book", bindArgs(s));
    expect(() => apply(s, "append_knowledge_lessons", lessonArgs(s))).toThrow("Источник");
    s = apply(s, "append_journal_entries", journalArgs(s));
    expect(() => apply(s, "append_knowledge_lessons", { ...lessonArgs(s),
      lessons: [{ ...lesson(), roleId: oldRole }] })).toThrow("адресат");
  });
  it.each(["prompt", "permissions", "active", "accepted", "executorId", "documentId", "delete"])("rejects protected input %s", field => {
    const s = fixture();
    expect(inputs.append_journal_entries.safeParse({ ...journalArgs(s), [field]: "attack" }).success).toBe(false);
    expect(inputs.append_knowledge_lessons.safeParse({ ...common(s), roleId: role, bookHash: "a".repeat(64),
      lessons: [{ ...lesson(), [field]: "attack" }] }).success).toBe(false);
  });
  it("rejects active status/acceptance, missing old book hash and replacing accepted arrays", () => {
    const s = fixture();
    for (const change of [{ status: "active" }, { acceptedBy: "owner" }, { acceptedAt: "now" }])
      expect(inputs.append_knowledge_lessons.safeParse({ ...common(s), roleId: role, bookHash: "a".repeat(64),
        lessons: [{ ...lesson(), ...change }] }).success).toBe(false);
    expect(() => apply(s, "bind_employee_knowledge_book", { ...bindArgs(s, oldRole), bookHash: undefined })).toThrow("hash");
    expect(inputs.append_knowledge_lessons.safeParse({ ...common(s), roleId: role, bookHash: "a".repeat(64),
      lessons: [lesson()], acceptedLessons: [] }).success).toBe(false);
  });
  it("retains manual review provenance in journal supplements and refuses duplicate supplement IDs", () => {
    const s = fixture(), supplement = { id: "REVIEW-ONE", title: "Ручная сверка",
      text: "Не ответ агента, обязанности не изменены.", status: "proposed", actualAuthor: "Replit", agentExecution: false };
    const args = { ...journalArgs(s), supplements: [supplement] };
    const next = apply(s, "append_journal_entries", args);
    expect(JSON.parse(get(next, journalDocumentId).text).crewJournalSupplements).toEqual([supplement]);
    expect(() => apply(s, "append_journal_entries", { ...args, supplements: [supplement, supplement] })).toThrow("ID");
  });
  it("refuses oversized output, corrupt arrays, missing profiles, stale profile hash and book collisions", () => {
    const s = fixture();
    expect(() => apply(s, "bind_employee_knowledge_book", { ...bindArgs(s), profileHash: "0".repeat(64) })).toThrow("hash");
    const missing = structuredClone(s); missing.documents = missing.documents.filter(d => d.id !== `PROFILE-${role}`);
    expect(() => apply(missing, "bind_employee_knowledge_book", bindArgs(s))).toThrow("одна");
    const collision = structuredClone(s); collision.documents.push({ ...get(s, journalDocumentId), id: knowledgeBindings[role] });
    expect(() => apply(collision, "bind_employee_knowledge_book", bindArgs(collision))).toThrow("уже существует");
    const corrupt = structuredClone(s);
    get(corrupt, journalDocumentId).text = JSON.stringify({ format: "talkhint.improvement-journal", crewJournalEntries: {} });
    expect(() => apply(corrupt, "append_journal_entries", journalArgs(corrupt))).toThrow("формат раздела");
    const huge = structuredClone(s);
    get(huge, journalDocumentId).text = JSON.stringify({ format: "talkhint.improvement-journal", legacy: "x".repeat(499_900) });
    expect(() => apply(huge, "append_journal_entries", journalArgs(huge))).toThrow("заполнен");
  });
  it("passes the normalized projection without changing character or prompt data", () => {
    let s = fixture();
    for (const id of Object.keys(knowledgeBindings)) s = apply(s, "bind_employee_knowledge_book", bindArgs(s, id));
    s = apply(s, "append_journal_entries", journalArgs(s));
    for (const id of Object.keys(knowledgeBindings)) s = apply(s, "append_knowledge_lessons", lessonArgs(s, id));
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
    const projection = project(JSON.parse(JSON.stringify(s)), "offline", schema);
    expect(projection.tables).toBeInstanceOf(Map);
    for (const id of Object.keys(knowledgeBindings))
      expect(JSON.parse(get(s, `PROFILE-${id}`).text).prompt).toBe("DO NOT CHANGE");
  });
  it("uses real domain/batch guards, idempotent UUID, CAS, exact revision counts and readback", async () => {
    let state = fixture(), writes = 0;
    const service = new ProductCrewService({
      read: async () => state,
      updateMany: async (owner: string, rev: number, commands: ModelCommand[]) => {
        assertTransactionBatch(owner, rev, commands, "new-country");
        if (rev !== state.revision) throw new ModelError(409, "CAS");
        expect(commands.length).toBeLessThanOrEqual(3);
        state = commands.reduce((s, c) => applyCommand(s, c, "owner"), state);
        writes++; return state;
      },
    } as ModelRepository, { production: true });
    const a = bindArgs(state), before = state.revision;
    const result = await service.call("owner", "bind_employee_knowledge_book", a);
    expect(result.revision).toBe(before + 3); // create book + profile + receipt
    expect((await service.call("owner", "get_document", { documentId: knowledgeBindings[role] })).revision).toBe(result.revision);
    expect((await service.call("owner", "bind_employee_knowledge_book", a)).replayed).toBe(true);
    expect(writes).toBe(1);
    await expect(service.call("owner", "append_journal_entries", { ...journalArgs(state), revision: before }))
      .rejects.toMatchObject({ status: 409 });
    for (const name of ["append_journal_entries", "append_knowledge_lessons", "bind_employee_knowledge_book"] as const) {
      expect(productionTeamTools.has(name) && writeTools.has(name)).toBe(true);
    }
    await expect(new ProductCrewService({ read: async () => state } as ModelRepository)
      .call("owner", "append_journal_entries", journalArgs(state))).rejects.toMatchObject({ status: 403 });
  });
});
