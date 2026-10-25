import { z } from "zod";
import { competitorEvidenceStatuses, competitorScenarios } from "../../shared/projectCompetitors";
import { researchFeatures } from "../../shared/competitorResearch";

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
const featureKeys = Object.keys(researchFeatures) as [keyof typeof researchFeatures, ...Array<keyof typeof researchFeatures>];
const evidence = z.object({
  status: z.enum(statuses), note: text, sourceUrls: z.array(url).max(20), checkedAt: date.nullable(),
  contexts: z.array(z.enum(["personal", "business"])).max(2).refine(values => new Set(values).size === values.length).optional(),
}).strict();
const sourcedEvidence = evidence.refine(value => value.sourceUrls.length > 0 && value.checkedAt !== null &&
  value.status !== "unknown" && !!value.note.trim(), "У подтверждённого сведения нужны источник, дата и пояснение");
const coverage = z.array(z.object({ region: required, evidence: sourcedEvidence }).strict()).max(200);
export const competitorResearchSchema = z.object({
  geography: z.object({ service: coverage, phoneNumbers: coverage, customers: coverage }).strict(),
  languages: z.array(z.object({
    feature: z.enum(featureKeys), count: z.number().int().min(0).max(10000).nullable(),
    russian: z.enum(["yes", "no", "unknown"]), spanish: z.enum(["yes", "no", "unknown"]),
    evidence,
  }).strict().refine(row => (row.count === null && row.russian === "unknown" && row.spanish === "unknown") ||
    (row.evidence.sourceUrls.length > 0 && row.evidence.checkedAt !== null && row.evidence.status !== "unknown"),
  "Для числа языков и ответа да/нет нужны источник, дата и статус")).max(featureKeys.length)
    .refine(rows => new Set(rows.map(row => row.feature)).size === rows.length, "Одна строка языков на функцию"),
  features: z.object(Object.fromEntries(featureKeys.map(key => [key, evidence.optional()]))).strict(),
  companySize: z.object({ metric: required, value: required, evidence: sourcedEvidence }).strict().nullable(),
  autonomy: z.object({
    mode: z.enum(["unknown", "assist_only", "confirmed_tasks", "bounded_autonomy"]), evidence,
  }).strict().refine(row => row.mode === "unknown" || (row.evidence.sourceUrls.length > 0 &&
    row.evidence.checkedAt !== null && row.evidence.status !== "unknown" && !!row.evidence.note.trim()),
  "У уровня самостоятельности нужны основание, источник, дата и статус"),
}).strict();
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
  research: competitorResearchSchema.optional(),
}).strict();
export const captureCompetitorQuarterSchema = z.object({
  type: z.literal("captureCompetitorQuarter"),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/), reason: required, direction: z.string().trim().min(1).max(12000),
}).strict();
export const saveTalkHintResearchSchema = z.object({
  type: z.literal("saveTalkHintResearch"), current: competitorResearchSchema, target: competitorResearchSchema,
  checkedAt: date, reason: required,
}).strict();
export const saveCompetitorSchema = z.object({
  type: z.literal("saveCompetitor"), id: required.optional(),
  baseVersion: z.number().int().min(0), reason: required,
  snapshot: competitorSnapshotSchema,
}).strict();
