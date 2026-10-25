import { emptyCompetitorSnapshot, type CompetitorDirectory, type CompetitorSnapshot, type CompetitorScenario } from "./projectCompetitors";

export const researchFeatures = {
  secretary_outgoing: "Исходящие поручения AI-секретарю",
  incoming: "Автономный входящий AI-секретарь",
  dedicated_number: "Отдельный рабочий / личный номер",
  translation: "Перевод разговора",
  live_hints: "Генерация подсказок ответа в реальном времени",
  sms: "SMS",
  email: "Почта",
  calendar: "Календарь / запись",
  contacts_history: "Контакты / история общения",
} as const;
export type ResearchFeature = keyof typeof researchFeatures;
export interface ResearchEvidence {
  status: CompetitorScenario["status"];
  note: string;
  sourceUrls: string[];
  checkedAt: string | null;
  /** Optional in legacy data; no inference from an audience label or marketing copy. */
  contexts?: ("personal" | "business")[];
}
export interface ResearchCoverage {
  region: string;
  evidence: ResearchEvidence;
}
export interface ResearchLanguage {
  feature: ResearchFeature;
  count: number | null;
  russian: "yes" | "no" | "unknown";
  spanish: "yes" | "no" | "unknown";
  evidence: ResearchEvidence;
}
export interface CompetitorResearch {
  geography: { service: ResearchCoverage[]; phoneNumbers: ResearchCoverage[]; customers: ResearchCoverage[] };
  languages: ResearchLanguage[];
  features: Partial<Record<ResearchFeature, ResearchEvidence>>;
  companySize: { metric: string; value: string; evidence: ResearchEvidence } | null;
  autonomy: {
    mode: "unknown" | "assist_only" | "confirmed_tasks" | "bounded_autonomy";
    evidence: ResearchEvidence;
  };
}
export interface QuarterlyCompetitorSnapshot {
  id: string;
  quarter: string;
  capturedAt: string;
  reason: string;
  direction: string;
  methodologyVersion: 1;
  competitorVersions: { id: string; version: number }[];
  talkhint: CompetitorDirectory["talkhint"];
}
export interface CaptureCompetitorQuarterCommand {
  type: "captureCompetitorQuarter";
  quarter: string;
  reason: string;
  direction: string;
}
export interface SaveTalkHintResearchCommand {
  type: "saveTalkHintResearch";
  current: CompetitorResearch;
  target: CompetitorResearch;
  checkedAt: string;
  reason: string;
}
export const unknownResearchEvidence = (): ResearchEvidence => ({
  status: "unknown", note: "Не подтверждено", sourceUrls: [], checkedAt: null,
});
export function emptyCompetitorResearch(): CompetitorResearch {
  return {
    geography: { service: [], phoneNumbers: [], customers: [] }, languages: [],
    features: {}, companySize: null,
    autonomy: { mode: "unknown", evidence: unknownResearchEvidence() },
  };
}
/** Read compatibility: legacy snapshots stay byte-for-byte unchanged in storage. */
export function researchFor(snapshot: CompetitorSnapshot): CompetitorResearch {
  const result = emptyCompetitorResearch();
  for (const scenario of snapshot.scenarios) {
    result.features[scenario.scenario] = {
      status: scenario.status, note: scenario.note, sourceUrls: [...scenario.sourceUrls],
      checkedAt: snapshot.checkedAt || null,
    };
  }
  const saved = snapshot.research;
  if (!saved) return result;
  return {
    ...result, ...saved,
    geography: structuredClone(saved.geography),
    languages: structuredClone(saved.languages),
    features: { ...result.features, ...structuredClone(saved.features) },
  };
}
export interface ResearchRow {
  id: string;
  kind: "competitor" | "talkhint_current" | "talkhint_target";
  version: number | null;
  snapshot: CompetitorSnapshot;
}
export function researchRows(directory: CompetitorDirectory): ResearchRow[] {
  const rows: ResearchRow[] = directory.records.flatMap(record => {
    const revision = record.revisions.at(-1);
    return revision ? [{ id: record.id, kind: "competitor" as const, version: revision.version, snapshot: revision.snapshot }] : [];
  });
  for (const mode of ["current", "target"] as const) {
    const snapshot = emptyCompetitorSnapshot();
    snapshot.name = mode === "current" ? "TalkHint — текущая позиция" : "TalkHint — целевая позиция";
    snapshot.checkedAt = directory.talkhint.research?.checkedAt ?? directory.talkhint.checkedAt;
    snapshot.limitations = directory.talkhint.note;
    snapshot.scenarios = mode === "current" ? structuredClone(directory.talkhint.scenarios) : snapshot.scenarios;
    snapshot.research = directory.talkhint.research?.[mode];
    rows.push({
      id: `talkhint-${mode}`, kind: mode === "current" ? "talkhint_current" : "talkhint_target",
      version: null, snapshot,
    });
  }
  return rows;
}
export function featureFor(row: ResearchRow, key: ResearchFeature): ResearchEvidence {
  return researchFor(row.snapshot).features[key] ?? unknownResearchEvidence();
}
export function featureStatusLabel(row: ResearchRow, key: ResearchFeature): string {
  const status = featureFor(row, key).status;
  if (row.kind !== "competitor") return ({
    live_verified: "Работает — проверено", code_present: "Проверяется — есть в коде",
    planned: "Запланировано", official_claim: "Заявлено, ещё проверяется",
    unknown: "Не подтверждено", not_supported: "Не поддерживается по источнику",
  })[status];
  return ({
    live_verified: "Проверено нами", official_claim: "Официально заявлено",
    code_present: "Не подтверждено — есть сведения о коде", planned: "Не подтверждено — заявлен план",
    unknown: "Не подтверждено", not_supported: "Не поддерживается по источнику",
  })[status];
}
/** Unknown coverage is not evidence of absence; geography categories never substitute for each other. */
export function matchesResearchFilters(row: ResearchRow, region: string, language: "" | "russian" | "spanish",
  geographyKind: keyof CompetitorResearch["geography"] = "service"): boolean {
  const research = researchFor(row.snapshot);
  if (region.trim() && !research.geography[geographyKind].some(item =>
    item.region.toLocaleLowerCase().includes(region.trim().toLocaleLowerCase()) &&
    ["official_claim", "live_verified"].includes(item.evidence.status) && item.evidence.sourceUrls.length > 0)) return false;
  if (language && !research.languages.some(item => item[language] === "yes" &&
    ["official_claim", "live_verified"].includes(item.evidence.status) && item.evidence.sourceUrls.length > 0)) return false;
  return true;
}
export const proximityWeights: Record<ResearchFeature, number> = {
  secretary_outgoing: 3, incoming: 3, dedicated_number: 1, translation: 1,
  live_hints: 2, sms: 2, email: 2, calendar: 2, contacts_history: 1,
};
const verified = (evidence: ResearchEvidence) => evidence.status === "live_verified" &&
  evidence.sourceUrls.length > 0 && !!evidence.checkedAt && !!evidence.note.trim();
const knownAbsent = (evidence: ResearchEvidence) => evidence.status === "not_supported" &&
  evidence.sourceUrls.length > 0 && !!evidence.checkedAt;
export function researchProximity(row: ResearchRow) {
  let lower = 0, upper = 0, confirmed = 0;
  for (const key of Object.keys(researchFeatures) as ResearchFeature[]) {
    const evidence = featureFor(row, key), weight = proximityWeights[key];
    if (verified(evidence)) { lower += weight; upper += weight; confirmed++; }
    else if (!knownAbsent(evidence)) upper += weight;
  }
  return {
    score: confirmed ? lower : null, lower, upper, confirmed,
    explanation: "Нижняя граница взвешенного совпадения действий; баллы только за живую проверку с источником и датой. Заявления, размер компании и неизвестное не дают баллов. Это не рейтинг качества.",
  };
}
export function positioningFor(row: ResearchRow) {
  const target = row.kind === "talkhint_target";
  let lower = 0, unresolved = 0;
  for (const key of Object.keys(researchFeatures) as ResearchFeature[]) {
    const evidence = featureFor(row, key);
    const supported = target
      ? ["planned", "live_verified"].includes(evidence.status) && evidence.sourceUrls.length > 0 && !!evidence.checkedAt && !!evidence.note.trim()
      : verified(evidence);
    for (const context of ["personal", "business"] as const) {
      if (evidence.contexts?.includes(context) && supported) lower++;
      else if (!(evidence.contexts?.includes(context) && knownAbsent(evidence))) unresolved++;
    }
  }
  const autonomy = researchFor(row.snapshot).autonomy;
  const autonomyKnown = autonomy.mode !== "unknown" && (target
    ? ["planned", "live_verified"].includes(autonomy.evidence.status) &&
      autonomy.evidence.sourceUrls.length > 0 && !!autonomy.evidence.checkedAt && !!autonomy.evidence.note.trim()
    : verified(autonomy.evidence));
  const yValues = { unknown: null, assist_only: 0, confirmed_tasks: 1, bounded_autonomy: 2 };
  return {
    x: unresolved === 0 ? lower : null, y: autonomyKnown ? yValues[autonomy.mode] : null,
    lower, upper: lower + unresolved, target,
    plottable: unresolved === 0 && autonomyKnown,
    reason: unresolved || !autonomyKnown
      ? "Недостаточно подтверждений: показываем диапазон и пробелы, а не уверенную точку."
      : target ? "Согласованная цель, не достигнутая позиция." : "Позиция по проверенным сценариям и свидетельству самостоятельных действий.",
  };
}
export function quarterDirectory(directory: CompetitorDirectory, snapshot: QuarterlyCompetitorSnapshot): CompetitorDirectory {
  return {
    records: snapshot.competitorVersions.map(reference => {
      const revision = directory.records.find(record => record.id === reference.id)?.revisions.find(rev => rev.version === reference.version);
      if (!revision) throw new Error(`Невозможно прочитать снимок: отсутствует сохранённая версия ${reference.id}/${reference.version}`);
      return { id: reference.id, revisions: [structuredClone(revision)] };
    }),
    talkhint: structuredClone(snapshot.talkhint),
  };
}
export function quarterChanges(directory: CompetitorDirectory, before: QuarterlyCompetitorSnapshot, after: QuarterlyCompetitorSnapshot) {
  const oldRows = researchRows(quarterDirectory(directory, before));
  const newRows = researchRows(quarterDirectory(directory, after));
  const ids = Array.from(new Set([...oldRows, ...newRows].map(row => row.id)));
  return ids.map(id => {
    const row = newRows.find(item => item.id === id);
    const previous = oldRows.find(item => item.id === id)!;
    if (!row) return { id, name: previous.snapshot.name, added: false, removed: true, features: true, languages: true, coverage: true, prices: true };
    const old = oldRows.find(item => item.id === row.id);
    const a = old ? researchFor(old.snapshot) : null, b = researchFor(row.snapshot);
    const canonical = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
      return value;
    };
    const changed = (oldValue: unknown, newValue: unknown) => JSON.stringify(canonical(oldValue)) !== JSON.stringify(canonical(newValue));
    const featureFacts = (research: CompetitorResearch | null) => Object.keys(researchFeatures).map(key =>
      [key, research?.features[key as ResearchFeature]?.status ?? "unknown",
        [...research?.features[key as ResearchFeature]?.contexts ?? []].sort()]);
    const languageFacts = (research: CompetitorResearch | null) => research?.languages.map(item =>
      ({ feature: item.feature, count: item.count, russian: item.russian, spanish: item.spanish })).sort((a, b) => a.feature.localeCompare(b.feature)) ?? [];
    const geographyFacts = (research: CompetitorResearch | null) => Object.fromEntries(
      ["service", "phoneNumbers", "customers"].map(key => [key,
        research?.geography[key as keyof CompetitorResearch["geography"]].map(item =>
          ({ region: item.region, status: item.evidence.status })).sort((a, b) => a.region.localeCompare(b.region)) ?? []]));
    const tariffFacts = (snapshot?: CompetitorSnapshot) => snapshot?.plans.map(({ sourceUrl, ...plan }) => plan).sort((a, b) => a.id.localeCompare(b.id)) ?? [];
    return {
      id: row.id, name: row.snapshot.name, added: !old, removed: false,
      features: changed(featureFacts(a), featureFacts(b)),
      languages: changed(languageFacts(a), languageFacts(b)),
      coverage: changed(geographyFacts(a), geographyFacts(b)),
      prices: changed(tariffFacts(old?.snapshot), tariffFacts(row.snapshot)),
    };
  });
}
