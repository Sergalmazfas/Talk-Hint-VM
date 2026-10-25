import type { CompetitorResearch, QuarterlyCompetitorSnapshot, CaptureCompetitorQuarterCommand, SaveTalkHintResearchCommand } from "./competitorResearch";
import type { CompetitorDossier } from "./competitorDossier";
import type { CompetitorAssessments, SupportResearch } from "./competitorAssessments";
export type { CaptureCompetitorQuarterCommand, SaveTalkHintResearchCommand };
/** Internal research only; no connection to phone-agent capabilities or prices. */
export const competitorScenarios = {
  translation: "Перевод разговора",
  secretary_outgoing: "Звонок секретаря по поручению",
  incoming: "Входящие обращения секретарю",
  sms: "SMS",
  email: "Почта",
  calendar: "Календарь",
} as const;
export const competitorEvidenceStatuses = {
  official_claim: "Заявлено официально",
  independent_estimate: "Независимая оценка · не подтверждённая отчётность",
  code_present: "Есть в коде; не проверено этим сравнением",
  live_verified: "Проверено живым сценарием",
  planned: "Целевая концепция / план",
  unknown: "Не подтверждено",
  not_supported: "Не поддерживается по источнику",
} as const;
export interface CompetitorScenario {
  scenario: keyof typeof competitorScenarios;
  status: keyof typeof competitorEvidenceStatuses;
  note: string;
  sourceUrls: string[];
}
export interface CompetitorPlan {
  id: string;
  name: string;
  kind: "subscription" | "credit_pack";
  currency: string;
  region: string;
  period: "week" | "month" | "year" | "one_time" | "unknown";
  price: number | null;
  includedNumbers: string;
  includedMinutes: string;
  includedCredits: string;
  includedSms: string;
  overages: string;
  limitations: string;
  sourceUrl: string;
  purchaseChannel?: string;
  includedUnits?: { unit: "coins" | "credits" | "tokens"; amount: number | null };
  evidence?: import("./competitorResearch").ResearchEvidence;
}
export interface CompetitorSnapshot {
  name: string;
  developer: string;
  audience: string;
  website: string;
  appStore: string;
  checkedAt: string;
  verification: "provided" | "manual";
  offer: { features: string; languages: string; regions: string; numbers: string; channels: string };
  plans: CompetitorPlan[];
  scenarios: CompetitorScenario[];
  sources: { url: string; checkedAt: string; note: string }[];
  limitations: string;
  research?: CompetitorResearch;
  dossier?: CompetitorDossier;
  assessments?: CompetitorAssessments;
  supportResearch?: SupportResearch;
}
export interface CompetitorRevision {
  version: number;
  savedAt: string;
  reason: string;
  snapshot: CompetitorSnapshot;
}
export interface CompetitorRecord { id: string; revisions: CompetitorRevision[] }
export interface CompetitorDirectory {
  records: CompetitorRecord[];
  talkhint: {
    checkedAt: string; note: string; scenarios: CompetitorScenario[];
    research?: { current: CompetitorResearch; target: CompetitorResearch; checkedAt: string; reason: string };
    researchHistory?: { version: number; savedAt: string; research: NonNullable<CompetitorDirectory["talkhint"]["research"]> }[];
  };
  quarters?: QuarterlyCompetitorSnapshot[];
}
export interface SaveCompetitorCommand {
  type: "saveCompetitor";
  id?: string;
  baseVersion: number;
  reason: string;
  snapshot: CompetitorSnapshot;
}
export function emptyCompetitorSnapshot(): CompetitorSnapshot {
  return {
    name: "", developer: "", audience: "", website: "", appStore: "", checkedAt: "",
    verification: "manual",
    offer: { features: "", languages: "Не подтверждено", regions: "Не подтверждено", numbers: "Не подтверждено", channels: "Не подтверждено" },
    plans: [],
    scenarios: Object.keys(competitorScenarios).map(scenario => ({
      scenario: scenario as CompetitorScenario["scenario"], status: "unknown", note: "Не подтверждено", sourceUrls: [],
    })),
    sources: [], limitations: "",
  };
}
/** A compatibility projection for old readers. Structured features remain the sole editable truth. */
export function normalizeCompetitorSnapshot(value: CompetitorSnapshot): CompetitorSnapshot {
  const snapshot = structuredClone(value);
  if (snapshot.research) snapshot.scenarios = snapshot.scenarios.map(scenario => {
    const evidence = snapshot.research!.features[scenario.scenario];
    return evidence ? { scenario: scenario.scenario, status: evidence.status, note: evidence.note, sourceUrls: [...evidence.sourceUrls] } : scenario;
  });
  return snapshot;
}
/** Null is unknown, never a free price; credits never acquire a minute conversion. */
export function competitorPrice(plan: CompetitorPlan): string {
  if (plan.price === null) return "Цена не подтверждена";
  const amount = (n: number) => `${n.toFixed(2)} ${plan.currency}`;
  const period = { week: "неделю", month: "месяц", year: "год", one_time: "покупку", unknown: "неизвестный период" }[plan.period];
  return `${amount(plan.price)} / ${period}${plan.period === "year" ? ` (≈ ${amount(plan.price / 12)} / месяц при годовой оплате)` : ""}`;
}
export function competitorSnapshotDiff(previous: CompetitorSnapshot, current: CompetitorSnapshot) {
  const flatten = (value: unknown, prefix = "", result: Record<string, string> = {}) => {
    if (value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, result);
    } else result[prefix] = value === null ? "Не подтверждено" : String(value);
    return result;
  };
  const before = flatten(previous), after = flatten(current);
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter(field => before[field] !== after[field])
    .map(field => ({ field, before: before[field] ?? "Не было", after: after[field] ?? "Удалено из текущего снимка" }));
}
