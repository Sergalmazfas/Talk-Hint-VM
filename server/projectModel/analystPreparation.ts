import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { ProjectModelState } from "../../shared/projectModel";
import { analystCompetitors, analystSourceKinds, analystSourceAvailability, type AnalystPreparationCommand } from "../../shared/competitiveAnalyst";
import { ModelError } from "./modelError";

const text = z.string().trim().min(1).max(12000);
const id = z.string().min(1).max(250);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
export const publicAnalystUrl = z.string().max(2000).url().refine(s => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password &&
      !/^(localhost|.*\.localhost|.*\.local|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*)$/i.test(u.hostname) &&
      !u.hostname.includes(":") && u.hostname.includes(".") &&
      !Array.from(u.searchParams.keys()).some(k => /token|secret|signature|password|api.?key|authorization/i.test(k));
  } catch { return false; }
}, "Нужна публичная HTTPS-ссылка без секретов. Это валидация записи, не разрешение сетевого доступа.");
const source = z.object({
  id, competitorId: id, url: publicAnalystUrl.nullable(),
  kind: z.enum(Object.keys(analystSourceKinds) as [keyof typeof analystSourceKinds, ...Array<keyof typeof analystSourceKinds>]),
  ownership: z.enum(["documented", "unverified"]), ownershipEvidence: text,
  approval: z.literal("pending"), recommendation: z.enum(["include", "hold", "exclude"]),
  checkedAt: date.nullable(),
  availability: z.enum(Object.keys(analystSourceAvailability) as [keyof typeof analystSourceAvailability, ...Array<keyof typeof analystSourceAvailability>]),
  note: text,
}).strict().superRefine((s, ctx) => {
  if ((!s.url || s.ownership !== "documented") && s.recommendation === "include")
    ctx.addIssue({ code: "custom", message: "Для включения нужны ссылка и подтверждение принадлежности" });
  if (s.availability !== "unchecked" && !s.checkedAt)
    ctx.addIssue({ code: "custom", message: "Для проверки доступа укажите дату" });
});
export const saveAnalystPreparationSchema = z.object({
  type: z.literal("saveAnalystPreparation"), baseVersion: z.number().int().nonnegative(),
  preparation: z.object({
    passport: z.object({ purpose: text, duties: text, inputs: text, outputs: text, frequency: text, quality: text, handoff: text }).strict(),
    limits: z.object({
      maxMinutes: z.number().int().min(1).max(30), maxEstimatedUsd: z.number().finite().min(0.1).max(10),
      maxSources: z.number().int().min(1).max(20), maxSearches: z.number().int().min(0).max(10),
      maxAttempts: z.number().int().min(1).max(3), maxOutputTokens: z.number().int().min(128).max(8000),
      maxVideoSeconds: z.number().int().min(0).max(600),
    }).strict(),
    sources: z.array(source).max(250),
    pilot: z.object({ competitorId: id.nullable(), sourceIds: z.array(id).max(20), questions: text, rationale: text }).strict(),
    approvalNotes: text, toolResearchVersion: z.literal("2026-10-25"),
  }).strict(),
}).strict();

/** Saving a preparation does not grant tools, network access, or a pilot capability. */
export function saveAnalystPreparation(old: ProjectModelState, raw: AnalystPreparationCommand, actor: string) {
  const c = saveAnalystPreparationSchema.parse(raw), data = c.preparation;
  const last = old.analystPreparation?.revisions.at(-1);
  if ((last?.version ?? 0) !== c.baseVersion) throw new ModelError(409, "Паспорт изменён. Перечитайте версию, не теряя свой черновик.");
  const products = analystCompetitors(old), allowed = new Set(products.flatMap(p => p.record ? [p.record.id] : []));
  const ids = data.sources.map(s => s.id);
  if (new Set(ids).size !== ids.length) throw new ModelError(409, "Повторный ID источника.");
  const urls = data.sources.filter(s => s.url).map(s => `${s.competitorId}:${s.url!.replace(/\/$/, "")}`);
  if (new Set(urls).size !== urls.length) throw new ModelError(409, "Источник уже есть у этого конкурента.");
  if (data.sources.some(s => !allowed.has(s.competitorId)) ||
    (data.pilot.competitorId && !allowed.has(data.pilot.competitorId)))
    throw new ModelError(404, "Конкурент не найден среди пяти разрешённых карточек этого владельца.");
  if (new Set(data.pilot.sourceIds).size !== data.pilot.sourceIds.length ||
    data.pilot.sourceIds.some(id => !data.sources.some(s => s.id === id &&
      s.competitorId === data.pilot.competitorId && s.url && s.recommendation === "include" && s.ownership === "documented")))
    throw new ModelError(409, "Источники пилота должны относиться к выбранному конкуренту и быть рекомендованы.");
  if (data.pilot.sourceIds.length > data.limits.maxSources) throw new ModelError(409, "Источников пилота больше предложенного лимита.");
  if (isDeepStrictEqual(last?.data, data)) return old;
  if ((old.analystPreparation?.revisions.length ?? 0) >= 100) throw new ModelError(413, "Достигнут лимит версий; история сохранена.");
  const next = structuredClone(old), at = new Date().toISOString();
  const revision = {
    version: c.baseVersion + 1, at, actor, status: "awaiting_approval" as const, data: structuredClone(data),
    basisVersions: products.flatMap(p => p.record ? [{
      competitorId: p.record.id, version: p.record.revisions.at(-1)!.version,
    }] : []),
  };
  (next.analystPreparation ??= { revisions: [] }).revisions.push(revision);
  next.decisions.push({ id: `DEC-${randomUUID()}`, at, actor,
    action: "Подготовлен паспорт AI-аналитика", reason: "Ожидает согласования; рабочий запуск и расписание не включены.",
    elementIds: [], strategyChange: { command: c.type, before: structuredClone(last ?? null), after: revision } });
  next.revision++;
  if (JSON.stringify(next).length > 5_000_000) throw new ModelError(413, "Модель превысила допустимый размер; история не удалена.");
  return next;
}
