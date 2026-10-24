import { randomUUID } from "node:crypto";
import { z } from "zod";
import { modelSections, elementKinds, detailFields, contentStatuses, implementationStatuses } from "../../shared/projectModel";
import type { ModelCommand, ProjectModelState, ModelElement, ModelDecision } from "../../shared/projectModel";

const str = (max = 12000) => z.string().max(max);
const nonempty = (max = 2000) => z.string().trim().min(1).max(max);
const id = nonempty(120);
const ids = z.array(id).max(200);
const detailShape = Object.fromEntries(Object.keys(detailFields).map(key => [key, str().optional()]));
export const elementSchema = z.object({
  title: nonempty(240), section: z.enum(modelSections), scope: z.enum(["talkhint", "salon_example"]), kind: z.enum(elementKinds),
  description: str(20000), contentStatus: z.enum(Object.keys(contentStatuses) as [keyof typeof contentStatuses, ...Array<keyof typeof contentStatuses>]),
  implementationStatus: z.enum(Object.keys(implementationStatuses) as [keyof typeof implementationStatuses, ...Array<keyof typeof implementationStatuses>]),
  details: z.object(detailShape).strict(),
}).strict();
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("saveElement"), id: id.optional(), element: elementSchema }).strict(),
  z.object({ type: z.literal("saveProposal"), id: id.optional(), targetId: id, source: nonempty(20000), rationale: nonempty(12000), relatedIds: ids, change: elementSchema }).strict(),
  z.object({ type: z.literal("approveProposal"), id }).strict(),
  z.object({ type: z.literal("clarifyProposal"), id, note: nonempty(12000) }).strict(),
  z.object({ type: z.literal("saveRelation"), id: id.optional(), from: id, to: id, label: nonempty(500) }).strict(),
  z.object({ type: z.literal("removeRelation"), id }).strict(),
  z.object({ type: z.literal("saveDocument"), id: id.optional(), title: nonempty(240), text: str(50000),
    url: str(2000).refine(s => !s || /^https?:\/\/[^\s]+$/.test(s) || /^\/admin(?:\/[^\s]*)?$/.test(s), "Unsafe document URL"), elementIds: ids }).strict(),
  z.object({ type: z.literal("reviewElement"), id, reason: nonempty(12000) }).strict(),
  z.object({ type: z.literal("prepareTask"), title: nonempty(240), elementIds: ids.min(1), acceptance: nonempty(20000) }).strict(),
]);
export const requestSchema = z.object({ revision: z.number().int().nonnegative(), command: commandSchema }).strict();
export class ModelError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(message: string, status = 400): never { throw new ModelError(status, message); }
const newId = (prefix: string) => `${prefix}-${randomUUID()}`;

/** Pure transaction: errors leave the caller's old snapshot untouched. */
export function applyCommand(old: ProjectModelState, raw: ModelCommand, actor: string): ProjectModelState {
  const c = commandSchema.parse(raw) as ModelCommand;
  const s = structuredClone(old);
  const now = new Date().toISOString();
  const element = (id: string) => s.elements.find(e => e.id === id) ?? fail("Элемент не найден", 404);
  const checkIds = (ids: string[]) => Array.from(new Set(ids)).map(element);
  function log(action: string, reason: string, elementIds: string[], snapshots: Partial<Pick<ModelDecision,
    "before" | "after" | "proposalId" | "documentBefore" | "documentAfter" | "relationBefore" | "relationAfter" | "proposalBefore" | "proposalAfter">> = {}) {
    s.decisions.push({ id: newId("DEC"), at: now, actor, action, reason, elementIds, ...structuredClone(snapshots) });
  }
  function impact(target: string, related: string[] = []) {
    const affected = new Set(related);
    s.relations.forEach(r => { if (r.from === target) affected.add(r.to); if (r.to === target) affected.add(r.from); });
    affected.delete(target);
    affected.forEach(id => { element(id).needsReview = true; });
  }
  switch (c.type) {
    case "saveElement": {
      if (c.element.contentStatus === "confirmed") fail("Подтверждение сведений возможно только через предложение", 409);
      const existing = c.id ? element(c.id) : undefined;
      if (existing?.contentStatus === "confirmed") fail("Утверждённое описание меняется только через предложение", 409);
      if (!existing && s.elements.length >= 500) fail("Достигнут лимит элементов");
      const updated: ModelElement = { ...c.element, id: existing?.id ?? newId("TH"), version: (existing?.version ?? 0) + 1, updatedAt: now, needsReview: false };
      if (existing) { s.elements[s.elements.indexOf(existing)] = updated; impact(existing.id); }
      else s.elements.push(updated);
      log(existing ? "Изменён черновик" : "Создан элемент", "Ручное редактирование, не подтверждение", [updated.id], { before: existing, after: updated });
      break;
    }
    case "saveProposal": {
      const target = element(c.targetId);
      checkIds(c.relatedIds);
      const existing = c.id ? s.proposals.find(p => p.id === c.id) ?? fail("Предложение не найдено", 404) : undefined;
      if (existing?.status === "approved") fail("Решение уже принято; создайте новое предложение", 409);
      if (existing && existing.targetId !== target.id) fail("Нельзя менять цель предложения", 409);
      if (!existing && s.proposals.length >= 1000) fail("Достигнут лимит предложений");
      const proposal = { id: existing?.id ?? newId("PROP"), targetId: target.id, baseVersion: target.version,
        source: c.source, rationale: c.rationale, relatedIds: Array.from(new Set(c.relatedIds)), change: c.change,
        status: "pending" as const, clarification: existing?.clarification ?? "", createdAt: existing?.createdAt ?? now };
      if (existing) s.proposals[s.proposals.indexOf(existing)] = proposal;
      else s.proposals.push(proposal);
      log("Сохранено предложение", c.rationale, [target.id, ...proposal.relatedIds], { proposalId: proposal.id, proposalBefore: existing, proposalAfter: proposal });
      break;
    }
    case "approveProposal": {
      const proposal = s.proposals.find(p => p.id === c.id) ?? fail("Предложение не найдено", 404);
      if (proposal.status !== "pending") fail("Нужно актуальное предложение, ожидающее подтверждения", 409);
      const before = element(proposal.targetId);
      if (before.version !== proposal.baseVersion) fail("Описание изменилось. Пересмотрите и сохраните предложение заново", 409);
      const after: ModelElement = { ...proposal.change, id: before.id, version: before.version + 1, updatedAt: now, needsReview: false };
      s.elements[s.elements.indexOf(before)] = after;
      proposal.status = "approved";
      impact(before.id, proposal.relatedIds);
      log("Подтверждено изменение", `${proposal.rationale}\nИсточник: ${proposal.source}`, [before.id, ...proposal.relatedIds],
        { before, after, proposalId: proposal.id });
      break;
    }
    case "clarifyProposal": {
      const proposal = s.proposals.find(p => p.id === c.id) ?? fail("Предложение не найдено", 404);
      if (proposal.status === "approved") fail("Подтверждённое решение неизменно", 409);
      const before = structuredClone(proposal);
      proposal.status = "clarification"; proposal.clarification = c.note;
      log("Запрошено уточнение", c.note, [proposal.targetId], { proposalId: proposal.id, proposalBefore: before, proposalAfter: proposal });
      break;
    }
    case "saveRelation": {
      element(c.from); element(c.to);
      if (c.from === c.to) fail("Выберите два разных элемента");
      const oldLink = c.id ? s.relations.find(r => r.id === c.id) ?? fail("Связь не найдена", 404) : undefined;
      if (s.relations.some(r => r.id !== c.id && r.from === c.from && r.to === c.to && r.label === c.label)) fail("Такая связь уже существует", 409);
      if (!oldLink && s.relations.length >= 1500) fail("Достигнут лимит связей");
      const link = { id: oldLink?.id ?? newId("LINK"), from: c.from, to: c.to, label: c.label };
      if (oldLink) s.relations[s.relations.indexOf(oldLink)] = link; else s.relations.push(link);
      const affected = Array.from(new Set([c.from, c.to, ...(oldLink ? [oldLink.from, oldLink.to] : [])]));
      checkIds(affected).forEach(e => { e.needsReview = true; });
      log("Сохранена связь", c.label, affected, { relationBefore: oldLink, relationAfter: link }); break;
    }
    case "removeRelation": {
      const link = s.relations.find(r => r.id === c.id) ?? fail("Связь не найдена", 404);
      s.relations = s.relations.filter(r => r.id !== c.id);
      checkIds([link.from, link.to]).forEach(e => { e.needsReview = true; });
      log("Удалена связь", link.label, [link.from, link.to], { relationBefore: link }); break;
    }
    case "saveDocument": {
      const linked = checkIds(c.elementIds);
      const existing = c.id ? s.documents.find(d => d.id === c.id) ?? fail("Документ не найден", 404) : undefined;
      if (!existing && s.documents.length >= 500) fail("Достигнут лимит документов");
      const doc = { id: existing?.id ?? newId("DOC"), title: c.title, text: c.text, url: c.url, elementIds: Array.from(new Set(c.elementIds)), updatedAt: now };
      if (existing) s.documents[s.documents.indexOf(existing)] = doc; else s.documents.push(doc);
      const affected = Array.from(new Set([...linked.map(e => e.id), ...(existing?.elementIds ?? [])]));
      checkIds(affected).forEach(e => { e.needsReview = true; });
      log("Сохранён документ", c.title, affected, { documentBefore: existing, documentAfter: doc }); break;
    }
    case "reviewElement": {
      element(c.id).needsReview = false;
      log("Связанный элемент пересмотрен", c.reason, [c.id]); break;
    }
    case "prepareTask": {
      const chosen = checkIds(c.elementIds);
      if (chosen.some(e => e.contentStatus !== "confirmed" || e.needsReview)) fail("Задание допускает только утверждённые элементы без незавершённого пересмотра", 409);
      if (chosen.some(e => e.scope !== "talkhint")) fail("Демонстрационная модель клиента не является требованиями TalkHint", 409);
      if (s.taskDrafts.length >= 500) fail("Достигнут лимит черновиков заданий");
      const references = chosen.map(e => ({ id: e.id, version: e.version }));
      const text = `# ${c.title}\n\nЧерновик — не отправлен в Replit и не запущен.\n\n## Утверждённые основания\n` +
        chosen.map(e => `- ${e.id} v${e.version} [${e.title}](/admin/project-model?element=${encodeURIComponent(e.id)})\n${e.description}\n${Object.entries(e.details).filter(([,v]) => v).map(([k,v]) => `${detailFields[k as keyof typeof detailFields]}: ${v}`).join("\n")}`).join("\n\n") +
        `\n\n## Критерии приёмки\n${c.acceptance}\n\nПодтверждение правила не означает реализацию функции. Проверить актуальность версий перед выполнением.`;
      s.taskDrafts.push({ id: newId("TASK"), title: c.title, elementIds: references.map(r => r.id), references, acceptance: c.acceptance, text, createdAt: now });
      log("Подготовлен черновик задания", c.title, references.map(r => r.id)); break;
    }
  }
  s.revision++;
  if (JSON.stringify(s).length > 5_000_000) fail("Модель превысила допустимый размер; требуется архивирование", 413);
  return s;
}
