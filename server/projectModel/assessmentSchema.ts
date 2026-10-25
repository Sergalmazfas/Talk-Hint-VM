import { z } from "zod";
import { assessmentParameters, supportFields, supportEvidenceLabels } from "../../shared/competitorAssessments";
import type { CompetitorAssessments } from "../../shared/competitorAssessments";
const text = z.string().max(12000);
const required = z.string().trim().min(1).max(1000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
});
const timestamp = z.string().datetime({ offset: true }).refine(value => Date.parse(value) <= Date.now()).nullable();
const score = z.number().finite().min(1).max(10).nullable();
const url = z.string().max(2000).url().refine(value => {
  const u = new URL(value);
  return u.protocol === "https:" && !u.username && !u.password &&
    !Array.from(u.searchParams.keys()).some(key => /token|secret|signature|api.?key|credential/i.test(key));
}, "Нужна HTTPS-ссылка без учётных данных, токенов или подписи");
const experience = z.object({
  issue: text, channel: text, contactedAt: timestamp, firstResponseAt: timestamp,
  responder: z.enum(["unknown", "bot", "human"]), resolvedAt: timestamp,
  outcome: z.enum(["unknown", "unresolved", "partial", "resolved"]),
  resolution: text, usefulness: text, repeatContacts: z.number().int().min(0).max(10000).nullable(),
}).strict().superRefine((v, ctx) => {
  for (const key of ["firstResponseAt", "resolvedAt"] as const)
    if (v[key] && (!v.contactedAt || Date.parse(v[key]!) < Date.parse(v.contactedAt)))
      ctx.addIssue({ code: "custom", message: "Ответ/решение не могут быть раньше обращения", path: [key] });
  if (v.outcome === "resolved" && (!v.resolvedAt || !v.resolution.trim()))
    ctx.addIssue({ code: "custom", message: "Решение требует даты и описания; ответ бота сам по себе не решение" });
});
export const reviewInputSchema = z.object({
  category: z.enum(["design", "usability", "support"]),
  author: required, testedAt: date, platform: required, appVersion: z.string().max(200),
  score, rationale: text, observations: text, impression: text, likes: text, problems: text, examples: text,
  parameters: z.array(z.object({
    key: required, score, applicability: z.enum(["not_tested", "applicable", "not_applicable", "absent"]),
    steps: z.number().int().min(0).max(10000).nullable(), observations: text, impression: text,
    statuses: text, issues: text, result: text,
  }).strict()).max(20),
  materials: z.array(z.object({ title: required, url }).strict()).max(20),
  supportExperience: experience.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.score !== null && !v.rationale.trim()) ctx.addIssue({ code: "custom", message: "Для балла нужно обоснование" });
  const keys = Object.keys(assessmentParameters[v.category]);
  if (new Set(v.parameters.map(p => p.key)).size !== v.parameters.length || v.parameters.some(p => !keys.includes(p.key)))
    ctx.addIssue({ code: "custom", message: "Параметры должны относиться к выбранной категории и не повторяться" });
  if (v.parameters.some(p => p.score !== null && (p.applicability !== "applicable" || !(p.observations.trim() || p.impression.trim()))))
    ctx.addIssue({ code: "custom", message: "Баллы параметров требуют применимого проверенного сценария и пояснения" });
  const anyScore = v.score !== null || v.parameters.some(p => p.score !== null);
  if (v.category === "support" && anyScore && (!v.supportExperience?.contactedAt ||
    !v.supportExperience.issue.trim() || !v.supportExperience.channel.trim()))
    ctx.addIssue({ code: "custom", message: "Оценка поддержки возможна только после реального обращения с проблемой, каналом и датой" });
  if (v.category !== "support" && v.supportExperience)
    ctx.addIssue({ code: "custom", message: "Опыт поддержки не относится к этой категории" });
});
// Validate input separately so server audit fields cannot be supplied by a client.
const storedReview = z.object({ id: z.string().uuid(), recordedBy: required, savedAt: z.string().datetime(), input: reviewInputSchema }).strict();
export const assessmentsSchema = z.object({
  design: z.array(z.unknown()).max(100).optional(), usability: z.array(z.unknown()).max(100).optional(), support: z.array(z.unknown()).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const [category, items] of Object.entries(value)) for (const [index, item] of Array.from((items ?? []).entries())) {
    const { id, recordedBy, savedAt, ...input } = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const result = storedReview.safeParse({ id, recordedBy, savedAt, input });
    if (!result.success || input.category !== category || typeof id !== "string" || ids.has(id))
      ctx.addIssue({ code: "custom", message: "Некорректная сохранённая проверка", path: [category, index] });
    if (typeof id === "string") ids.add(id);
  }
}).transform(value => value as CompetitorAssessments);
const supportFact = z.object({
  value: z.string().trim().min(1).max(12000).nullable(),
  status: z.enum(Object.keys(supportEvidenceLabels) as [keyof typeof supportEvidenceLabels, ...Array<keyof typeof supportEvidenceLabels>]),
  sourceUrls: z.array(url).max(20), checkedAt: date.nullable(), note: text,
}).strict().refine(v => v.value === null ? v.status === "unknown" : (v.status !== "unknown" && v.sourceUrls.length > 0 && !!v.checkedAt && !!v.note.trim()),
  "У публичного сведения нужны источник, дата, статус и пояснение");
export const supportResearchSchema = z.object(Object.fromEntries(Object.keys(supportFields).map(key => [key, supportFact.optional()]))).strict();
export const addCompetitorReviewSchema = z.object({
  type: z.literal("addCompetitorReview"), id: required, baseVersion: z.number().int().min(1), requestId: z.string().uuid(), review: reviewInputSchema,
}).strict();
export const saveCompetitorSupportSchema = z.object({
  type: z.literal("saveCompetitorSupport"), id: required, baseVersion: z.number().int().min(1), support: supportResearchSchema,
}).strict();
