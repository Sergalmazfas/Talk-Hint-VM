import { z } from "zod";
import { strategyKinds, proofKinds } from "../../shared/projectStrategy";

const text = (max = 12000) => z.string().max(max);
const required = (max = 240) => z.string().trim().min(1).max(max);
const ref = required(250);
const refs = z.array(ref).max(200).refine(v => new Set(v).size === v.length, "Повторяющиеся ссылки");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Некорректная дата");
const url = z.string().max(2000).url().refine(value => {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password &&
    !Array.from(u.searchParams.keys()).some(k => /token|secret|signature|password|api.?key|authorization/i.test(k)); } catch { return false; }
}, "Нужна публичная HTTPS-ссылка без секретов");
export const strategyEvidenceSchema = z.object({
  status: z.enum(Object.keys(proofKinds) as [keyof typeof proofKinds, ...Array<keyof typeof proofKinds>]),
  sourceUrls: z.array(url).max(30), sourceNote: text(), checkedAt: date.nullable(), period: text(500), versionLabel: text(500),
}).strict().superRefine((v, ctx) => {
  if (["official_claim", "verified", "external_estimate"].includes(v.status) &&
    (!v.checkedAt || (!v.sourceUrls.length && !v.sourceNote.trim())))
    ctx.addIssue({ code: "custom", message: "Для факта нужны источник / результат проверки и дата", path: ["sourceNote"] });
});
const node = z.object({
  kind: z.enum(Object.keys(strategyKinds) as [keyof typeof strategyKinds, ...Array<keyof typeof strategyKinds>]),
  title: required(), description: text(20000), definition: text(), evidence: strategyEvidenceSchema,
  assignment: z.object({ ownerRef: ref.nullable(), status: z.enum(["planned", "in_progress", "done", "deferred"]),
    expectedResult: text(), skillRefs: refs, dependencyRefs: refs }).strict(),
}).strict();
const decision = z.object({
  title: required(), learned: required(12000), basisRefs: refs, affectedRefs: refs, options: z.array(required(4000)).max(30),
  choice: text(), rationale: text(), expectedResult: text(), nextStep: text(), ownerRef: ref.nullable(),
  date, status: z.enum(["proposed", "accepted", "rejected"]), supersedes: ref.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.status === "accepted" && (!v.basisRefs.length || !v.affectedRefs.length || !v.choice.trim() || !v.rationale.trim()))
    ctx.addIssue({ code: "custom", message: "Принятому решению нужны основания, затронутая запись, выбор и обоснование" });
  if (v.status === "rejected" && !v.rationale.trim()) ctx.addIssue({ code: "custom", message: "Укажите причину отклонения" });
});
const axis = z.object({
  name: required(), definition: required(12000), direction: required(1000), scaleMin: z.number().finite(),
  scaleMax: z.number().finite(), criteria: required(12000), basisRefs: refs,
}).strict().refine(a => a.scaleMax > a.scaleMin, "Максимум шкалы должен быть больше минимума");
const map = z.object({
  title: required(), mode: z.enum(["scenario_v2", "expert"]), x: axis, y: axis,
  points: z.array(z.object({ ref, x: z.number().finite().nullable(), y: z.number().finite().nullable(),
    rationale: text(), basisRefs: refs }).strict()).max(1000),
}).strict().superRefine((m, ctx) => {
  if (new Set(m.points.map(p => p.ref)).size !== m.points.length) ctx.addIssue({ code: "custom", message: "Точка уже существует" });
  for (const p of m.points) {
    if ((p.x === null) !== (p.y === null)) ctx.addIssue({ code: "custom", message: "Неопределённая точка требует обе координаты null" });
    if (p.x !== null && p.y !== null && (!p.rationale.trim() || !p.basisRefs.length ||
      p.x < m.x.scaleMin || p.x > m.x.scaleMax || p.y < m.y.scaleMin || p.y > m.y.scaleMax))
      ctx.addIssue({ code: "custom", message: "Координаты требуют основания, объяснения и соответствия шкалам" });
  }
});
export const strategyCommandSchemas = [
  z.object({ type: z.literal("saveStrategyNode"), id: ref.optional(), baseVersion: z.number().int().nonnegative(), node }).strict(),
  z.object({ type: z.literal("saveStrategyDecision"), id: ref.optional(), baseVersion: z.number().int().nonnegative(), decision }).strict(),
  z.object({ type: z.literal("saveStrategyLink"), id: ref.optional(), from: ref, to: ref, kind: z.enum(["navigation", "depends_on"]), reason: required(2000) }).strict(),
  z.object({ type: z.literal("removeStrategyLink"), id: ref }).strict(),
  z.object({ type: z.literal("reviewStrategyImpact"), id: ref, outcome: z.enum(["revised", "retained", "deferred"]), reason: required(12000) }).strict(),
  z.object({ type: z.literal("saveStrategyMap"), baseVersion: z.number().int().nonnegative(), map }).strict(),
] as const;
export const strategyCommandTypes = new Set(strategyCommandSchemas.map(s => s.shape.type.value));
