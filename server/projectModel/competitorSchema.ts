import { z } from "zod";
import { competitorEvidenceStatuses, competitorScenarios } from "../../shared/projectCompetitors";

const text = z.string().max(12000);
const required = z.string().trim().min(1).max(1000);
const url = z.string().max(2000).url().refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password;
}, "Требуется HTTPS URL источника без учётных данных");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10);
}, "Нужна действительная дата проверки, не в будущем");
const scenarioKeys = Object.keys(competitorScenarios) as [keyof typeof competitorScenarios, ...Array<keyof typeof competitorScenarios>];
const statuses = Object.keys(competitorEvidenceStatuses) as [keyof typeof competitorEvidenceStatuses, ...Array<keyof typeof competitorEvidenceStatuses>];
export const competitorSnapshotSchema = z.object({
  name: required, developer: required, audience: required,
  website: url, appStore: z.union([url, z.literal("")]),
  checkedAt: date, verification: z.enum(["provided", "manual"]),
  offer: z.object({ features: text, languages: text, regions: text, numbers: text, channels: text }).strict(),
  plans: z.array(z.object({
    id: required, name: required, kind: z.enum(["subscription", "credit_pack"]),
    currency: z.string().regex(/^[A-Z]{3}$/), region: required,
    period: z.enum(["week", "month", "year", "one_time", "unknown"]),
    price: z.number().finite().min(0).max(100000000).nullable(),
    includedNumbers: text, includedMinutes: text, includedCredits: text, includedSms: text,
    overages: text, limitations: text, sourceUrl: z.union([url, z.literal("")]),
  }).strict()).max(100).refine(plans => new Set(plans.map(plan => plan.id)).size === plans.length, "ID тарифов должны быть уникальными"),
  scenarios: z.array(z.object({
    scenario: z.enum(scenarioKeys), status: z.enum(statuses), note: text, sourceUrls: z.array(url).max(20),
  }).strict()).length(scenarioKeys.length).refine(rows => new Set(rows.map(row => row.scenario)).size === scenarioKeys.length, "Нужны все шесть разных сценариев"),
  sources: z.array(z.object({ url, checkedAt: date, note: text }).strict()).min(1).max(40),
  limitations: text,
}).strict();
export const saveCompetitorSchema = z.object({
  type: z.literal("saveCompetitor"), id: required.optional(),
  baseVersion: z.number().int().min(0), reason: required,
  snapshot: competitorSnapshotSchema,
}).strict();
