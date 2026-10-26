import { z } from "zod";
import type { ModelDocument, ProjectModelState } from "./projectModel";
import { productBookDocument, productBookDocumentId, readProductBook } from "./productBook";

export const hintChapterDocumentId = "DOC-TALKHINT-CHAPTER-HINT";
export const chapterLayers = [
  ["product", "Как работает"], ["workflow", "Связка"], ["lab", "Лаборатория"],
  ["metrics", "Метрики"], ["bench", "Конкуренты"], ["design", "Экраны и дизайн"],
] as const;
const text = z.string().min(1);
const references = z.array(text);
const progressSchema = z.object({
  described: z.boolean().nullable(), implemented: z.boolean().nullable(),
  verified: z.boolean().nullable(), accepted: z.boolean().nullable(), planned: z.boolean(),
}).strict();
const layerSchema = z.object({
  title: text, summary: text, progress: progressSchema, leadRoleId: text.nullable(),
  participantRoleIds: references, assignment: text, actionIds: references,
  inputs: text, output: text, receiver: text, acceptance: text, next: text,
  sourceIds: references, unknown: references,
}).strict();
export const passportChapterSchema = z.object({
  format: z.literal("talkhint.passport-chapter"), version: z.number().int().positive(),
  mode: z.literal("hint"), title: text, status: z.literal("На согласовании"),
  bookDocumentId: z.literal(productBookDocumentId), relatedFeatureIds: references,
  snapshotDate: text, capturedAt: text, sourceRevision: z.number().int().nonnegative(),
  scope: text, identityNote: text,
  schedule: z.object({ startedOn: text, dueOn: text, basis: text }).strict(),
  layers: z.object({ product: layerSchema, workflow: layerSchema, lab: layerSchema,
    metrics: layerSchema, bench: layerSchema, design: layerSchema }).strict(),
  sources: z.array(z.object({
    id: text, type: text, title: text, location: text, date: z.string().nullable(),
    evidence: text, limitation: text,
  }).strict()),
  metrics: z.array(z.object({
    id: text, name: text, definition: text, unit: text, denominator: text,
    target: z.number().nullable(), actual: z.number().nullable(),
    status: z.literal("ждёт решения владельца"), method: text,
  }).strict()),
  labs: z.array(z.object({
    name: text, path: text, workflow: text, storage: text, retention: text,
    sourceIds: references, limitations: text,
  }).strict()),
  runs: z.array(z.object({
    id: text, createdAt: text, status: text, configuration: text,
    summary: text, source: text, metrics: z.record(z.unknown()),
    limitations: text,
  }).strict()),
  labHistory: z.object({ status: z.literal("предложение"), proposal: text,
    fields: references, noImplementation: text }).strict(),
  procedures: z.array(z.object({
    id: text, title: text, roleId: text, input: text, steps: references,
    resources: text, result: text, recipient: text, acceptance: text,
    returnTo: text, deadline: text, actionIds: references, limitations: text,
  }).strict()),
  requests: z.array(z.object({
    id: text, to: text, request: text, materials: references,
    receivingActionId: text.nullable(), status: text, response: z.string().nullable(),
  }).strict()),
  reviewProtocol: z.array(z.object({
    id: text, check: text, status: z.literal("не выполнено"),
    evidence: z.string().nullable(), blocker: z.string().nullable(), responsible: text,
  }).strict()),
  nextChapters: references, limitations: references,
  katyaDuration: z.object({ milliseconds: z.literal(300000), scope: text, evidence: text,
    remoteVerified: z.literal(false), separateSilenceTimeout: z.literal(true) }).strict(),
}).strict();
export type PassportChapter = z.infer<typeof passportChapterSchema>;
export type PassportLayer = typeof chapterLayers[number][0];

export function readPassportChapter(doc?: ModelDocument): PassportChapter | null {
  try {
    const result = passportChapterSchema.safeParse(JSON.parse(doc?.text ?? ""));
    return result.success ? result.data : null;
  } catch { return null; }
}

/** Resolve only the selected hypothesis's canonical book pointer. Never scan other owners or seed data. */
export function getPassportChapterPacket(state: ProjectModelState, mode: string) {
  const book = readProductBook(productBookDocument(state));
  const documentId = book?.chapterRefs?.[mode];
  if (!documentId) return null;
  const doc = state.documents.find(d => d.id === documentId);
  const chapter = readPassportChapter(doc);
  if (!chapter || chapter.mode !== mode || !doc || !book) return null;
  const nodes = state.operatingModel?.revisions.at(-1)?.data.nodes ?? [];
  const roleIds = new Set(Object.values(chapter.layers).flatMap(l => [l.leadRoleId, ...l.participantRoleIds]).filter(Boolean));
  chapter.procedures.forEach(p => roleIds.add(p.roleId));
  const actionIds = new Set([...Object.values(chapter.layers).flatMap(l => l.actionIds), ...chapter.procedures.flatMap(p => p.actionIds)]);
  return {
    format: "talkhint.passport-chapter-package" as const, version: 1,
    revision: state.revision, bookVersion: book.version,
    document: { id: doc.id, updatedAt: doc.updatedAt, title: doc.title },
    downloadPath: `/api/admin/product-crew/chapters/${chapter.mode}/download`,
    chapter,
    context: {
      features: book.features.filter(f => chapter.relatedFeatureIds.includes(f.id)),
      roles: nodes.filter(n => roleIds.has(n.id) && n.kind === "role"),
      actions: nodes.filter(n => actionIds.has(n.id) && n.kind === "action"),
      missingRoleIds: Array.from(roleIds).filter(id => !nodes.some(n => n.id === id && n.kind === "role")),
      missingActionIds: Array.from(actionIds).filter(id => !nodes.some(n => n.id === id && n.kind === "action")),
    },
    note: "Сохранённые сведения, не разрешение запускать звонки, агентов или платные проверки. Приёмка — только после ответа владельца.",
  };
}
export type PassportChapterPacket = NonNullable<ReturnType<typeof getPassportChapterPacket>>;
