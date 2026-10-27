import { randomUUID } from "node:crypto";
import { activeModelSize, modelSizeBudget } from "./sizeBudget";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { workKinds, workLinks, type SaveOperatingCommand } from "../../shared/operatingModel";
import type { ProjectModelState } from "../../shared/projectModel";
import { ModelError } from "./modelError";
import { strategyEntries } from "../../shared/projectStrategy";
const id = z.string().trim().min(1).max(120);
const text = z.string().max(12000);
const ref = id.nullable();
const node = z.object({
  metrics: z.array(z.object({
    id, name: text, formula: text, unit: text,
    plan: z.number().finite().nullable(), fact: z.number().finite().nullable(),
    numerator: z.number().finite().nonnegative().nullable(), denominator: z.number().finite().nonnegative().nullable(),
    scope: text, evidence: text,
  }).strict()).max(50).optional(),
  managerId: ref.optional(), level: z.enum(["strategy", "direction", "operation"]).optional(),
  detailState: z.enum(["outlined", "described"]).optional(),
  workNature: z.enum(["deterministic", "probabilistic", "mixed", "unspecified"]).optional(), marketEffect: text.optional(),
  id, code: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(500),
  kind: z.enum(workKinds), parentId: ref, status: z.enum(["agreed", "proposal"]),
  description: text, purpose: text, clientId: ref, roleId: ref, executorId: ref, recipientId: ref, acceptorId: ref, nextId: ref,
  resourceIds: z.array(id).max(500), inputs: z.array(z.object({ name: z.string().min(1).max(500), sourceId: ref, freshness: text }).strict()).max(500),
  schedule: z.object({
    days: z.array(z.number().int().min(1).max(7)).max(7).refine(a => new Set(a).size === a.length),
    hours: z.string().max(200), timezone: z.string().max(100).refine(t => {
      if (!t) return true;
      try { new Intl.DateTimeFormat("en", { timeZone: t }); return true; } catch { return false; }
    }, "Неизвестный часовой пояс"), trigger: text, deadline: text,
  }).strict(),
  procedure: text, rules: text, constraints: text, success: text, storage: text, delivery: text, exceptions: text, questions: text,
  resourceState: z.enum(["required", "approved", "connected"]).nullable(), referenceIds: z.array(id).max(500),
  reporting: z.object({
    required: z.boolean(), formName: text, templateDocumentId: ref, templateVersion: z.string().max(100),
    storage: text, formStatus: z.enum(["required", "draft", "discussion", "approved"]), approvalEvidence: text,
  }).strict().superRefine((r, ctx) => {
    if (r.formStatus === "approved" && (!r.templateDocumentId || !r.approvalEvidence.trim()))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Утверждение бланка требует шаблона и явного основания согласования" });
    if (r.required && r.formStatus !== "required" && !r.templateDocumentId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Подготовленный бланк должен ссылаться на документ" });
  }).optional(),
  register: z.object({
    availability: text, period: text,
    operationsPerPeriod: z.number().finite().min(0).max(1e9).nullable(),
    minutesPerOperation: z.number().finite().min(0).max(1e6).nullable(),
    estimateBasis: text, approval: z.enum(["draft", "discussion", "approved"]),
    source: text, proposalReason: text,
  }).strict().optional(),
}).strict();
export const saveOperatingModelSchema = z.object({
  type: z.literal("saveOperatingModel"), baseVersion: z.number().int().nonnegative(),
  data: z.object({
    companyStructureVersion: z.literal(1).optional(),
    customerPath: z.array(z.object({ id, name: text, processId: id, b2bProcessId: id.optional(), b2c: text, b2b: text, condition: text }).strict()).max(100).optional(),
    nodes: z.array(node).max(5000),
    links: z.array(z.object({ id, from: id, to: id, kind: z.enum(workLinks), reason: text,
      readiness: z.object({
        structure: z.enum(["unknown", "passed", "failed"]),
        resources: z.enum(["unknown", "passed", "failed"]),
        trial: z.enum(["unknown", "passed", "failed"]), evidence: text,
      }).strict().optional(),
    }).strict()).max(20000),
    stageReports: z.array(z.object({ pass: z.union([z.literal(1), z.literal(2), z.literal(3)]), described: text, boundary: text, dependencies: text, gaps: text, next: text }).strict()).max(100),
  }).strict(),
}).strict();
export function saveOperatingModel(old: ProjectModelState, command: SaveOperatingCommand, actor: string): ProjectModelState {
  const c = saveOperatingModelSchema.parse(command);
  const last = old.operatingModel?.revisions.at(-1);
  if ((last?.version ?? 0) !== c.baseVersion) throw new ModelError(409, "Модель работы уже изменена; перечитайте её. Черновик не подтверждён.");
  const map = new Map(c.data.nodes.map(n => [n.id, n]));
  if (map.size !== c.data.nodes.length || new Set(c.data.nodes.map(n => n.code)).size !== map.size)
    throw new ModelError(400, "Идентификаторы и коды объектов должны быть уникальны.");
  if (new Set(c.data.links.map(l => l.id)).size !== c.data.links.length) throw new ModelError(400, "Повтор идентификатора связи.");
  if (new Set(c.data.links.map(l => JSON.stringify([l.from, l.to, l.kind]))).size !== c.data.links.length)
    throw new ModelError(400, "Повтор одной типизированной связи.");
  const external = new Set([...old.elements.map(n => n.id), ...old.documents.map(n => n.id),
    ...(old.competitorDirectory?.records.map(n => n.id) ?? []), ...strategyEntries(old).map(n => n.key),
    ...(old.analystPreparation ? ["analyst-preparation"] : [])]);
  for (const n of c.data.nodes) {
    for (const r of [n.managerId, n.parentId, n.clientId, n.roleId, n.executorId, n.recipientId, n.acceptorId, n.nextId, ...n.resourceIds, ...n.inputs.map(i => i.sourceId)])
      if (r && !map.has(r)) throw new ModelError(400, "Связь с отсутствующим объектом в этой гипотезе.");
    for (const r of n.referenceIds) if (!map.has(r) && !external.has(r)) throw new ModelError(400, "Ссылка на материал недоступна в этой гипотезе.");
    if (n.reporting?.templateDocumentId && !old.documents.some(d => d.id === n.reporting!.templateDocumentId))
      throw new ModelError(400, "Шаблон отчёта не найден в документах этой гипотезы.");
    if (n.roleId && map.get(n.roleId)?.kind !== "role") throw new ModelError(400, "Ответственность назначается должности.");
    if (n.resourceIds.some(r => map.get(r)?.kind !== "resource")) throw new ModelError(400, "В ресурсах допустимы только ресурсы.");
    if (n.kind !== "resource" && n.resourceState !== null) throw new ModelError(400, "Статус подключения относится только к ресурсу.");
    const seen = new Set([n.id]); let parent = n.parentId;
    while (parent) {
      if (seen.has(parent)) throw new ModelError(400, "Цикл иерархии запрещён.");
      const ancestor = map.get(parent);
      if (!ancestor) throw new ModelError(400, "Связь с отсутствующим родителем в этой гипотезе.");
      seen.add(parent); parent = ancestor.parentId;
    }
    if (n.managerId && (n.kind !== "role" ||
      !(map.get(n.managerId)!.kind === "role" || (n.managerId === "owner" && map.get(n.managerId)!.kind === "client"))))
      throw new ModelError(400, "Руководитель задаётся должности и должен быть ролью или владельцем.");
    const managers = new Set([n.id]); let manager = n.managerId;
    while (manager) {
      if (managers.has(manager)) throw new ModelError(400, "Цикл подчинения запрещён.");
      const superior = map.get(manager);
      if (!superior) throw new ModelError(400, "Связь с отсутствующим руководителем в этой гипотезе.");
      managers.add(manager); manager = superior.managerId;
    }
    if (c.data.companyStructureVersion && n.kind === "role" && !n.managerId)
      throw new ModelError(400, "У каждой должности должен быть один непосредственный руководитель.");
    if (n.workNature && !["action", "process"].includes(n.kind)) throw new ModelError(400, "Характер выполнения относится к процессу или действию, не отделу.");
  }
  if (c.data.customerPath) {
    if (new Set(c.data.customerPath.map(s => s.id)).size !== c.data.customerPath.length) throw new ModelError(400, "Повтор этапа пути клиента.");
    for (const stage of c.data.customerPath) {
      if (map.get(stage.processId)?.kind !== "process" || (stage.b2bProcessId && map.get(stage.b2bProcessId)?.kind !== "process"))
        throw new ModelError(400, "Этап пути должен ссылаться на существующий процесс.");
    }
  }
  for (const l of c.data.links) if (!map.has(l.from) || !map.has(l.to)) throw new ModelError(400, "Конец связи отсутствует.");
  // Return/escalation loops are valid; only the containment hierarchy must be acyclic.
  if (last && isDeepStrictEqual(last.data, c.data)) return old;
  const next = structuredClone(old), at = new Date().toISOString();
  const revision = { version: c.baseVersion + 1, at, actor, data: c.data };
  (next.operatingModel ??= { revisions: [] }).revisions.push(revision);
  next.decisions.push({ id: `DEC-${randomUUID()}`, at, actor, action: "Обновлена модель организации через действия",
    reason: "Проектирование в Dev; сотрудники и расписания не запущены.", elementIds: [],
    // Full immutable snapshots already live in operatingModel.revisions.
    // Reference them rather than duplicating both payloads in every audit event.
    // Existing audit records remain untouched and readable.
    strategyChange: { command: c.type,
      before: { operatingModelVersion: last?.version ?? null },
      after: { operatingModelVersion: revision.version } } });
  next.revision++;
  if (activeModelSize(next) > modelSizeBudget(next)) throw new ModelError(413, "Актуальные данные модели превысили лимит размера; история сохранена. Это не лимит CPU/RAM.");
  return next;
}
