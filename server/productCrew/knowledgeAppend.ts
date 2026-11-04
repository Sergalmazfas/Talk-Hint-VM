import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCommand, ProjectModelState, ModelDocument } from "../../shared/projectModel";
import { ModelError } from "../projectModel/modelError";
import { documentTextLimit } from "../projectModel/documentVolumes";
import { expectedResultSchema } from "../../shared/journalExpectation";

export const journalDocumentId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
export const knowledgeBindings = {
  "secretary-project-head": "DOC-KNOWLEDGE-SECRETARY-HEAD",
  "secretary-lab-engineer": "DOC-KNOWLEDGE-SECRETARY-LAB",
  "secretary-qa": "DOC-KNOWLEDGE-SECRETARY-QA",
  "hint-call-prep-master": "DOC-KNOWLEDGE-HINT-PREP",
  "laboratory-engineer-role": "DOC-PC-11c0b66c-e5c7-49d3-9e5f-2cef5621b47f",
  "lg-qa-role": "DOC-PC-1d862fd6-7ab5-4d37-ba1d-11d33609b4bf",
  "management-role-operations-specialist": "DOC-PC-865b30c5-199a-4066-8610-d779678fa93e",
} as const;
const newBookRoles = new Set(Object.keys(knowledgeBindings).slice(0, 4));
const roleId = z.enum(Object.keys(knowledgeBindings) as [keyof typeof knowledgeBindings, ...Array<keyof typeof knowledgeBindings>]);
const text = (max = 3000) => z.string().trim().min(1).max(max);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const base = { revision: z.number().int().nonnegative(), requestId: z.string().uuid(),
  reason: text(), ownerDecisionRef: text(1000) };
export const journalEntrySchema = z.object({
  id: text(160), title: text(240), eventDatePrecision: z.literal("range-only"),
  eventPeriod: z.array(z.string().date()).min(2).max(2), registeredAt: z.string().datetime(),
  actualAuthor: z.literal("Replit"),
  classification: z.enum(["reported_fact", "owner_decision"]),
  source: z.literal("owner"), fact: text(6000), evidenceRefs: z.array(text(500)).max(20),
  targetRoleIds: z.array(roleId).min(1).max(7), verification: text(),
  productChangeAuthorized: z.literal(false), newRuntimeExecution: z.literal(false),
  before: text(), learned: text(), next: text(),
  expectedResult: expectedResultSchema,
}).strict();
export const knowledgeLessonSchema = z.object({
  id: text(160), roleId, name: text(160), status: z.literal("proposed"),
  proposedBy: z.object({ roleCode: z.literal("P.ORG"), name: z.literal("Нина Кадрова"),
    execution: z.literal("не запускалась; проект подготовлен вручную Replit по решению владельца") }).strict(),
  actualAuthor: z.literal("Replit"), reviewerRoleId: text(120), acceptorId: z.literal("owner"),
  acceptedAt: z.null(), acceptedBy: z.null(), before: text(), learned: text(), next: text(),
  sourceEntryId: text(160), registeredAt: z.string().datetime(),
}).strict();
export const knowledgeAppendInputs = {
  append_journal_entries: z.object({ ...base, documentHash: digest,
    entries: z.array(journalEntrySchema).min(1).max(20),
    supplements: z.array(z.object({ id: text(160), title: text(240),
      text: text(12000), status: z.literal("proposed"), actualAuthor: z.literal("Replit"),
      agentExecution: z.literal(false), expectedResult: expectedResultSchema }).strict()).min(1).max(10).optional() }).strict(),
  append_knowledge_lessons: z.object({ ...base, roleId, bookHash: digest,
    lessons: z.array(knowledgeLessonSchema).min(1).max(20) }).strict(),
  bind_employee_knowledge_book: z.object({ ...base, roleId, profileHash: digest,
    bookHash: digest.optional() }).strict(),
};
export const textHash = (s: string) => createHash("sha256").update(s).digest("hex");
const fail = (status: number, message: string): never => { throw new ModelError(status, message); };
function parse(doc: ModelDocument): Record<string, any> {
  try {
    const value = JSON.parse(doc.text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* Never silently replace legacy or malformed text. */ }
  return fail(409, "Неизвестный формат документа; история не изменена.");
}
function checkedDocument(state: ProjectModelState, id: string, expectedHash: string) {
  const doc = state.documents.find(d => d.id === id) ?? fail(404, "Документ не найден.");
  if (textHash(doc.text) !== expectedHash) fail(409, "Документ изменился; нужна новая сверка hash.");
  return doc;
}
function profileFor(state: ProjectModelState, id: string) {
  if (!state.operatingModel?.revisions.at(-1)?.data.nodes.some(n => n.id === id && n.kind === "role"))
    fail(404, "Роль не найдена.");
  const matches = state.documents.flatMap(doc => {
    try { const profile = JSON.parse(doc.text); return profile?.visualPassport?.roleId === id ? [{ doc, profile }] : []; }
    catch { return []; }
  });
  if (matches.length !== 1) fail(409, "Нужна ровно одна существующая анкета.");
  if (!["talkhint.employee.profile", "talkhint.role-prompt-proposal"].includes(matches[0].profile.format))
    fail(409, "Неизвестный формат анкеты; ссылка не изменена.");
  return matches[0];
}
function save(doc: ModelDocument, value: object): ModelCommand {
  const serialized = JSON.stringify(value);
  if (serialized.length > documentTextLimit) fail(409, "Документ заполнен; история не обрезается.");
  return { type: "saveDocument", id: doc.id, title: doc.title, text: serialized,
    url: doc.url, elementIds: doc.elementIds };
}
function append(value: Record<string, any>, field: string, items: { id: string }[]) {
  if (value[field] !== undefined && !Array.isArray(value[field]))
    fail(409, "Неизвестный формат раздела; история не изменена.");
  const previous = value[field] ?? [];
  const ids = new Set(previous.map((x: any) => x?.id));
  for (const item of items) {
    if (ids.has(item.id)) fail(409, "ID уже существует; дубликаты не добавлены.");
    ids.add(item.id);
  }
  // Preserve all legacy keys, cases/history, prompts and accepted material.
  return { ...value, [field]: [...previous, ...items] };
}
export function knowledgeAppendCommands(state: ProjectModelState, name: keyof typeof knowledgeAppendInputs, raw: unknown) {
  const commands: ModelCommand[] = [];
  if (name === "append_journal_entries") {
    const a = knowledgeAppendInputs[name].parse(raw);
    const doc = checkedDocument(state, journalDocumentId, a.documentHash), value = parse(doc);
    if (value.format !== "talkhint.improvement-journal") fail(409, "Неизвестный формат журнала.");
    const recordedAt = new Date().toISOString();
    let next = append(value, "crewJournalEntries", a.entries.map(e => ({ ...e, expectedResultRecordedAt: recordedAt })));
    if (a.supplements) next = append(next, "crewJournalSupplements", a.supplements.map(e => ({ ...e, expectedResultRecordedAt: recordedAt })));
    commands.push(save(doc, next));
    return { commands, roleId: "head-product", targetId: "head-product" };
  }
  const a = knowledgeAppendInputs[name].parse(raw);
  const { doc: profileDoc, profile } = profileFor(state, a.roleId);
  const bookId = knowledgeBindings[a.roleId];
  if (name === "bind_employee_knowledge_book") {
    const binding = knowledgeAppendInputs[name].parse(raw);
    checkedDocument(state, profileDoc.id, binding.profileHash);
    if (profile.knowledgeBookDocumentId != null) fail(409, "Книжка уже привязана; переназначение запрещено.");
    if (!Number.isSafeInteger(profile.version) || profile.version < 1 || profile.version >= Number.MAX_SAFE_INTEGER)
      fail(409, "Версия анкеты не определена.");
    if (newBookRoles.has(a.roleId)) {
      if (state.documents.some(d => d.id === bookId) || binding.bookHash !== undefined)
        fail(409, "Новая книжка уже существует или указан лишний hash; дубликат не создаётся.");
      commands.push({ type: "createDocument", id: bookId, title: `Книжка знаний: ${profile.visualPassport.nameProposal?.value ?? a.roleId}`,
        url: "", elementIds: [], text: JSON.stringify({ format: "talkhint.employee.knowledge-book",
          version: 1, roleId: a.roleId, proposedLessons: [], acceptedLessons: [],
          runtimeChanged: false }) });
    } else {
      const bookHash = binding.bookHash ?? fail(400, "Нужен hash найденной старой книжки.");
      const old = parse(checkedDocument(state, bookId, bookHash));
      if (old.format !== "talkhint.stage.review-result") fail(409, "Неизвестный формат старой книжки.");
      // Binding an old book does not save or reformat its bytes.
    }
    commands.push(save(profileDoc, { ...profile, version: profile.version + 1, knowledgeBookDocumentId: bookId }));
  } else {
    const incoming = knowledgeAppendInputs.append_knowledge_lessons.parse(raw);
    if (profile.knowledgeBookDocumentId !== bookId) fail(409, "Сначала требуется согласованная привязка книжки.");
    const doc = checkedDocument(state, bookId, incoming.bookHash), value = parse(doc);
    if (newBookRoles.has(a.roleId) ? value.format !== "talkhint.employee.knowledge-book" || value.roleId !== a.roleId :
        value.format !== "talkhint.stage.review-result") fail(409, "Книжка другого или неизвестного формата.");
    if (incoming.lessons.some(l => l.roleId !== a.roleId || l.reviewerRoleId === a.roleId))
      fail(400, "Неверный адресат урока или самопроверка.");
    const journal = state.documents.find(d => d.id === journalDocumentId) ?? fail(409, "Сначала нужен журнал.");
    const entries = parse(journal).crewJournalEntries;
    if (!Array.isArray(entries) || incoming.lessons.some(l =>
      !entries.some((e: any) => e.id === l.sourceEntryId && e.targetRoleIds?.includes(a.roleId))))
      fail(409, "Источник урока отсутствует в журнале или относится к другой роли.");
    commands.push(save(doc, append(value, "proposedLessons", incoming.lessons)));
  }
  return { commands, roleId: a.roleId, targetId: a.roleId };
}
