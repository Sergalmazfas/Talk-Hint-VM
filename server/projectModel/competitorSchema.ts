import { z } from "zod";
import { competitorEvidenceStatuses, competitorScenarios } from "../../shared/projectCompetitors";
import { researchFeatures, languageFeatures, type ResearchFeature, type LanguageFeature } from "../../shared/competitorResearch";
import { avatarFields, scaleFields } from "../../shared/competitorDossier";

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
const featureKeys: [ResearchFeature, ...ResearchFeature[]] = ["contacts_history", ...Object.keys(researchFeatures) as ResearchFeature[]];
const languageKeys: [LanguageFeature, ...LanguageFeature[]] = ["contacts_history", ...Object.keys(languageFeatures) as LanguageFeature[]];
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
    feature: z.enum(languageKeys), count: z.number().int().min(0).max(10000).nullable(),
    countQualifier: z.enum(["exact", "at_least"]).optional(),
    russian: z.enum(["yes", "no", "unknown"]), spanish: z.enum(["yes", "no", "unknown"]),
    evidence,
  }).strict().refine(row => (row.count === null && row.russian === "unknown" && row.spanish === "unknown") ||
    (row.evidence.sourceUrls.length > 0 && row.evidence.checkedAt !== null && row.evidence.status !== "unknown"),
  "Для числа языков и ответа да/нет нужны источник, дата и статус")).max(languageKeys.length)
    .refine(rows => new Set(rows.map(row => row.feature)).size === rows.length, "Одна строка языков на функцию"),
  features: z.object(Object.fromEntries(featureKeys.map(key => [key, evidence.optional()]))).strict(),
  companySize: z.object({ metric: required, value: required, evidence: sourcedEvidence }).strict().nullable(),
  autonomy: z.object({
    mode: z.enum(["unknown", "assist_only", "confirmed_tasks", "bounded_autonomy"]), evidence,
  }).strict().refine(row => row.mode === "unknown" || (row.evidence.sourceUrls.length > 0 &&
    row.evidence.checkedAt !== null && row.evidence.status !== "unknown" && !!row.evidence.note.trim()),
  "У уровня самостоятельности нужны основание, источник, дата и статус"),
}).strict();
const fact = z.object({ value: z.string().trim().min(1).max(12000).nullable(), evidence }).strict()
  .refine(item => item.value === null || (item.evidence.sourceUrls.length > 0 && !!item.evidence.checkedAt &&
    item.evidence.status !== "unknown" && !!item.evidence.note.trim()), "У известного факта нужны источник, дата, статус и пояснение");
const titledFact = z.object({
  id: required, title: required, value: z.string().trim().min(1).max(12000).nullable(), evidence,
}).strict().refine(item => item.value === null || (item.evidence.sourceUrls.length > 0 && !!item.evidence.checkedAt &&
  item.evidence.status !== "unknown" && !!item.evidence.note.trim()), "У известного факта нужны источник, дата и статус");
export const competitorDossierSchema = z.object({
  offerFacts: z.array(titledFact).max(100),
  avatar: z.object(Object.fromEntries(Object.keys(avatarFields).map(key => [key, fact.optional()]))).strict(),
  pricingNotes: z.array(titledFact).max(100),
  coverageFacts: z.array(titledFact).max(100),
  technical: z.array(z.object({
    id: required, layer: z.enum(["telephony", "stt", "llm", "translation", "tts", "technology"]),
    scope: z.enum(["live_call", "file_tool", "chat", "platform"]), tool: text,
    provider: z.string().trim().min(1).max(1000).nullable(), evidence,
  }).strict().refine(item => item.provider === null || (item.evidence.sourceUrls.length > 0 && !!item.evidence.checkedAt &&
    item.evidence.status !== "unknown" && !!item.evidence.note.trim()), "У названного провайдера нужны источник, дата и область применения")).max(100),
  funding: z.array(z.object({
    id: required, round: text, investors: text, announcedAt: date.nullable(),
    amount: z.number().finite().min(0).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    evidence: sourcedEvidence,
  }).strict().refine(item => item.amount === null || item.currency !== null, "Для известной суммы нужна валюта")).max(100),
  scale: z.object(Object.fromEntries(Object.keys(scaleFields).map(key => [key, fact.optional()]))).strict(),
  revenueKind: z.enum(["unknown", "official", "scenario"]), revenueAssumptions: text,
}).strict().refine(value => {
  const revenue = value.scale.revenue;
  if (!revenue?.value) return value.revenueKind === "unknown";
  return value.revenueKind === "official" ? revenue.evidence.status === "official_claim" || revenue.evidence.status === "live_verified"
    : value.revenueKind === "scenario" && !!value.revenueAssumptions.trim();
}, "Выручка — официальная с источником либо явно сценарная с основаниями; неизвестное не считать нулём")
  .refine(value => [value.offerFacts, value.pricingNotes, value.coverageFacts, value.technical, value.funding].every(rows =>
    new Set(rows.map(row => row.id)).size === rows.length), "ID строк в разделе должны быть уникальными");
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
    purchaseChannel: text.optional(),
    includedUnits: z.object({ unit: z.enum(["coins", "credits", "tokens"]), amount: z.number().int().min(0).nullable() }).strict().optional(),
    evidence: evidence.optional(),
  }).strict().refine(plan => {
    if (plan.price === null && plan.includedUnits?.amount == null) return true;
    if (!plan.sourceUrl && !plan.evidence?.sourceUrls.length) return false;
    return !plan.evidence || (!!plan.evidence.checkedAt && !!plan.evidence.note.trim() &&
      plan.evidence.status !== "unknown" && plan.evidence.sourceUrls.length > 0);
  }, "Для известной цены или количества единиц нужен источник и датированный статус")
  ).max(100).refine(plans => new Set(plans.map(plan => plan.id)).size === plans.length, "ID тарифов должны быть уникальными"),
  scenarios: z.array(z.object({
    scenario: z.enum(scenarioKeys), status: z.enum(statuses), note: text, sourceUrls: z.array(url).max(20),
  }).strict()).length(scenarioKeys.length).refine(rows => new Set(rows.map(row => row.scenario)).size === scenarioKeys.length, "Нужны все шесть разных сценариев"),
  sources: z.array(z.object({ url, checkedAt: date, note: text }).strict()).min(1).max(40),
  limitations: text,
  research: competitorResearchSchema.optional(),
  dossier: competitorDossierSchema.optional(),
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
