import type { ProjectModelState } from "./projectModel";
import { researchFeatures, researchFor } from "./competitorResearch";
import { assessmentCategories, supportFields } from "./competitorAssessments";

export const strategyKinds = {
  mission: "Миссия", hypothesis: "Предположение", segment: "Сегмент", problem: "Проблема",
  scenario: "Сценарий", capability: "Функция / услуга", difference: "Отличие", economics: "Экономическое допущение",
  experiment: "Эксперимент", result: "Результат проверки", criterion: "Критерий сравнения",
  person: "Ответственный участник", skill: "Навык", action: "Действие",
} as const;
export const proofKinds = {
  unknown: "Не подтверждено", official_claim: "Заявление компании", verified: "Проверенное наблюдение",
  external_estimate: "Внешняя оценка", hypothesis: "Наше предположение",
} as const;
export interface StrategyEvidence {
  status: keyof typeof proofKinds; sourceUrls: string[]; sourceNote: string;
  checkedAt: string | null; period: string; versionLabel: string;
}
export interface StrategyNodeInput {
  kind: keyof typeof strategyKinds; title: string; description: string; evidence: StrategyEvidence;
  definition: string;
  assignment: { ownerRef: string | null; status: "planned" | "in_progress" | "done" | "deferred";
    expectedResult: string; skillRefs: string[]; dependencyRefs: string[] };
}
export interface StrategyRevision<T> { version: number; at: string; actor: string; data: T }
export interface StrategyNode { id: string; revisions: StrategyRevision<StrategyNodeInput>[] }
export const decisionStatuses = { proposed: "Предложено", accepted: "Принято", rejected: "Отклонено", superseded: "Заменено" } as const;
export interface StrategyDecisionInput {
  title: string; learned: string; basisRefs: string[]; affectedRefs: string[]; options: string[];
  choice: string; rationale: string; expectedResult: string; nextStep: string; ownerRef: string | null;
  date: string; status: keyof typeof decisionStatuses; supersedes: string | null;
}
export interface StrategyDecision { id: string; revisions: StrategyRevision<StrategyDecisionInput>[]; supersededBy?: string }
export interface StrategyLink { id: string; from: string; to: string; kind: "navigation" | "depends_on"; reason: string }
export interface StrategyImpact {
  id: string; eventId: string; source: string; target: string; before: unknown; after: unknown;
  sourceUrls: string[]; sourceNote: string; sourceCheckedAt: string | null; at: string; path: string[]; reason: string;
  effect: "review" | "recomputed"; targetFingerprint: string; actor: string;
  reviews: { actor: string; at: string; outcome: "revised" | "retained" | "deferred"; reason: string }[];
}
export interface StrategyAxis {
  name: string; definition: string; direction: string; scaleMin: number; scaleMax: number;
  criteria: string; basisRefs: string[];
}
export interface StrategyMapInput {
  title: string; mode: "scenario_v2" | "expert"; x: StrategyAxis; y: StrategyAxis;
  /** Expert points are never recalculated from competitor marketing. */
  points: { ref: string; x: number | null; y: number | null; rationale: string; basisRefs: string[] }[];
}
export interface StrategyMapVersion extends StrategyRevision<StrategyMapInput> {
  id: string;
  calculatedAt?: string;
  /** Immutable derived results at capture, not a second editable source of facts. */
  calculations?: { ref: string; name: string; x: number | null; y: number | null;
    lower: number; upper: number; reason: string }[];
  basisVersions?: { ref: string; version: number | string | null }[];
  calculationSourceRefs?: string[];
  calculationReason?: string;
}
export interface ProjectStrategy {
  nodes: StrategyNode[]; decisions: StrategyDecision[]; links: StrategyLink[]; impacts: StrategyImpact[];
  mapVersions: StrategyMapVersion[];
}
export type StrategyCommand =
  | { type: "saveStrategyNode"; id?: string; baseVersion: number; node: StrategyNodeInput }
  | { type: "saveStrategyDecision"; id?: string; baseVersion: number; decision: StrategyDecisionInput }
  | { type: "saveStrategyLink"; id?: string; from: string; to: string; kind: StrategyLink["kind"]; reason: string }
  | { type: "removeStrategyLink"; id: string }
  | { type: "reviewStrategyImpact"; id: string; outcome: "revised" | "retained" | "deferred"; reason: string }
  | { type: "saveStrategyMap"; baseVersion: number; map: StrategyMapInput };

export const emptyStrategy = (): ProjectStrategy => ({ nodes: [], decisions: [], links: [], impacts: [], mapVersions: [] });
export const emptyStrategyNode = (): StrategyNodeInput => ({
  kind: "hypothesis", title: "", description: "", definition: "",
  evidence: { status: "hypothesis", sourceUrls: [], sourceNote: "", checkedAt: null, period: "", versionLabel: "" },
  assignment: { ownerRef: null, status: "planned", expectedResult: "", skillRefs: [], dependencyRefs: [] },
});
export const emptyStrategyDecision = (): StrategyDecisionInput => ({
  title: "", learned: "", basisRefs: [], affectedRefs: [], options: [], choice: "", rationale: "",
  expectedResult: "", nextStep: "", ownerRef: null, date: new Date().toISOString().slice(0, 10), status: "proposed", supersedes: null,
});
export const defaultStrategyMap = (): StrategyMapInput => ({
  title: "Подтверждённые сценарии и самостоятельность", mode: "scenario_v2",
  x: { name: "Широта личных и рабочих сценариев", definition: "11 функций × личный и бизнес-контекст; только явные свидетельства.",
    direction: "Больше подтверждённых сценариев →", scaleMin: 0, scaleMax: 22,
    criteria: "По одному баллу за явно проверенную функцию в каждом контексте. Для целевой позиции отдельно допустим подтверждённый план. Неизвестное остаётся диапазоном.",
    basisRefs: [] },
  y: { name: "Самостоятельность выполнения поручений", definition: "0 — помощь человеку; 1 — подтверждаемые поручения; 2 — ограниченная самостоятельность.",
    direction: "Больше самостоятельности ↑", scaleMin: 0, scaleMax: 2,
    criteria: "Нужен источник, дата и проверенное описание режима. Заявление компании не является живой проверкой.", basisRefs: [] },
  points: [],
});

export interface StrategyEntry {
  key: string; title: string; kind: string; version: number | string | null; value: unknown;
  sourceUrls: string[]; sourceNote: string; checkedAt: string | null; href: string;
}
const base = "/admin/project-model?hypothesis=new-country";
/** Read projections only. IDs never depend on array offsets; no research is copied into strategy storage. */
export function strategyEntries(state: ProjectModelState): StrategyEntry[] {
  const entries: StrategyEntry[] = [];
  const add = (key: string, title: string, kind: string, value: unknown, version: StrategyEntry["version"] = null,
    sourceUrls: string[] = [], sourceNote = "", checkedAt: string | null = null, href?: string) =>
    entries.push({ key, title, kind, value, version, sourceUrls, sourceNote, checkedAt,
      href: href ?? `${base}&strategyRef=${encodeURIComponent(key)}#project-strategy` });
  for (const e of state.elements) {
    if (e.scope !== "talkhint") continue;
    add(`element:${e.id}`, e.title, "Элемент проекта", {
      title: e.title, description: e.description, kind: e.kind, details: e.details,
      contentStatus: e.contentStatus, implementationStatus: e.implementationStatus,
    }, e.version, [], e.details.source ?? "", e.details.sourceDate ?? null);
  }
  for (const d of state.documents) add(`document:${d.id}`, d.title, "Источник / документ",
    { title: d.title, text: d.text, url: d.url, elementIds: d.elementIds }, d.updatedAt,
    /^https:\/\//.test(d.url) ? [d.url] : [], d.title, d.updatedAt);
  for (const t of state.taskDrafts) add(`draft:${t.id}`, t.title, "Черновик действия — не запущен", t);
  for (const n of state.strategy?.nodes ?? []) {
    const rev = n.revisions.at(-1)!;
    add(`node:${n.id}`, rev.data.title, strategyKinds[rev.data.kind], rev.data, rev.version,
      rev.data.evidence.sourceUrls, rev.data.evidence.sourceNote, rev.data.evidence.checkedAt);
  }
  for (const d of state.strategy?.decisions ?? []) {
    const rev = d.revisions.at(-1)!;
    add(`decision:${d.id}`, rev.data.title, `Решение: ${decisionStatuses[rev.data.status]}`, rev.data, rev.version);
  }
  const dir = state.competitorDirectory;
  for (const record of dir?.records ?? []) {
    const rev = record.revisions.at(-1)!; if (!rev) continue;
    const s = rev.snapshot, href = `${base}&view=benchmark&competitor=${encodeURIComponent(record.id)}`;
    add(`competitor:${record.id}`, s.name, "Карточка конкурента", s, rev.version, s.sources.map(x => x.url), rev.reason, s.checkedAt, href);
    for (const [key, e] of Object.entries(researchFor(s).features)) {
      if (e) add(`fact:${record.id}:feature:${key}`, `${s.name}: ${researchFeatures[key as keyof typeof researchFeatures] ?? key}`,
        "Публичный факт / проверка функции", e, rev.version, e.sourceUrls, e.note, e.checkedAt);
    }
    for (const p of s.plans) add(`fact:${record.id}:plan:${p.id}`, `${s.name}: ${p.name}`, "Тариф", p, rev.version,
      p.sourceUrl ? [p.sourceUrl] : [], p.limitations, s.checkedAt);
    // Remaining structured research and dossier fields keep stable section identities.
    const r = researchFor(s);
    for (const key of ["languages", "geography", "autonomy", "companySize"] as const)
      add(`fact:${record.id}:research:${key}`, `${s.name}: ${key}`, "Исследование", r[key], rev.version, s.sources.map(x => x.url), "", s.checkedAt);
    for (const [section, value] of Object.entries(s.dossier ?? {})) {
      if (Array.isArray(value)) for (const fact of value) {
        if (fact && typeof fact.id === "string") add(`fact:${record.id}:dossier:${section}:${fact.id}`,
          `${s.name}: ${fact.title ?? section}`, "Факт досье", fact, rev.version,
          fact.evidence?.sourceUrls ?? [], fact.evidence?.note ?? "", fact.evidence?.checkedAt ?? s.checkedAt);
      } else add(`fact:${record.id}:dossier:${section}`, `${s.name}: ${section}`, "Раздел досье", value, rev.version,
        s.sources.map(x => x.url), "", s.checkedAt);
    }
    for (const category of Object.keys(assessmentCategories) as (keyof typeof assessmentCategories)[]) {
      const reviews = s.assessments?.[category] ?? [], last = reviews.at(-1);
      if (last) add(`review:${record.id}:${category}`, `${s.name}: ${assessmentCategories[category]} — последняя личная проверка`,
        "Личная проверка, не публичное заявление", last, last.id, last.materials.map(x => x.url), last.rationale, last.testedAt);
      for (const review of reviews) add(`review:${record.id}:${category}:${review.id}`,
        `${s.name}: ${assessmentCategories[category]} (${review.testedAt}, ${review.author})`, "Историческая личная проверка",
        review, review.id, review.materials.map(x => x.url), review.rationale, review.testedAt);
    }
    for (const [key, fact] of Object.entries(s.supportResearch ?? {})) {
      if (fact) add(`support:${record.id}:${key}`, `${s.name}: ${supportFields[key as keyof typeof supportFields]}`,
        "Публичные сведения поддержки", fact, rev.version, fact.sourceUrls, fact.note, fact.checkedAt);
    }
  }
  if (dir) for (const mode of ["current", "target"] as const)
    add(`talkhint:${mode}`, mode === "current" ? "Текущие возможности TalkHint" : "Целевая концепция TalkHint",
      "Исследовательская карточка TalkHint", dir.talkhint.research?.[mode] ?? (mode === "current" ? dir.talkhint.scenarios : null),
      dir.talkhint.researchHistory?.at(-1)?.version ?? null, [], dir.talkhint.research?.reason ?? dir.talkhint.note, dir.talkhint.checkedAt);
  const maps = state.strategy?.mapVersions ?? [];
  if (maps.length) for (const m of maps) add(`map:${m.id}`, `${m.data.title} · методика v${m.version}`,
    "Версия карты", m.data, m.version);
  // The current identity changes meaning as a methodology is superseded.
  add("map:current", maps.at(-1)?.data.title ?? "Карта: действующая методика v2",
    "Методика карты", maps.at(-1)?.data ?? defaultStrategyMap(), maps.at(-1)?.version ?? 0);
  return entries;
}
export function strategyHref(key: string) { return `${base}&strategyRef=${encodeURIComponent(key)}#project-strategy`; }
/** Stable across server/browser locale; identifiers, not list order, define keyed facts. */
export function meaningfulStrategyValue(value: unknown, parent = ""): unknown {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(value)) {
    const result = value.map(item => meaningfulStrategyValue(item));
    if (["sourceUrls", "contexts", "skillRefs", "dependencyRefs", "basisRefs", "affectedRefs"].includes(parent) ||
      (value.length > 0 && value.every(item => item && typeof item === "object" && (typeof item.id === "string" || typeof item.key === "string"))))
      return result.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
    return result;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => item !== undefined && !["updatedAt", "savedAt", "checkedAt", "recordedBy", "version", "needsReview"].includes(key))
    .sort(([a], [b]) => compare(a, b)).map(([key, item]) => [key, meaningfulStrategyValue(item, key)]));
  return value;
}
export function latestImpactOutcome(impact: StrategyImpact) { return impact.reviews.at(-1)?.outcome ?? "pending"; }
export function strategyLinks(state: ProjectModelState): StrategyLink[] {
  // Legacy links remain navigation, never silently promoted to causal dependencies.
  const links: StrategyLink[] = state.relations.map(r => ({ id: `legacy:${r.id}`, from: `element:${r.from}`, to: `element:${r.to}`,
    kind: "navigation" as const, reason: r.label }));
  const chain = ["TH-CLIENT", "TH-PROBLEM", "TH-PILOT-VALUE", "TH-DIFFERENTIATION", "TH-ECONOMICS", "TH-TEAM"];
  chain.slice(1).forEach((id, i) => {
    if (state.elements.some(e => e.id === id) && state.elements.some(e => e.id === chain[i]))
      links.push({ id: `structure:${id}`, from: `element:${chain[i]}`, to: `element:${id}`, kind: "navigation",
        reason: "Структура пакета; не доказательство зависимости" });
  });
  for (const draft of state.taskDrafts)
    for (const reference of draft.references)
      links.push({ id: `draft-basis:${draft.id}:${reference.id}`, from: `draft:${draft.id}`,
        to: `element:${reference.id}`, kind: "depends_on",
        reason: `Утверждённое основание черновика v${reference.version}; сам черновик не запущен` });
  for (const doc of state.documents)
    for (const elementId of doc.elementIds)
      links.push({ id: `document-link:${doc.id}:${elementId}`, from: `document:${doc.id}`,
        to: `element:${elementId}`, kind: "navigation", reason: "Прежняя связь документа; причинная зависимость не установлена" });
  for (const n of state.strategy?.nodes ?? []) {
    const d = n.revisions.at(-1)!.data, ref = `node:${n.id}`;
    for (const to of [...d.assignment.dependencyRefs, ...d.assignment.skillRefs])
      links.push({ id: `assignment:${n.id}:${to}`, from: ref, to, kind: "depends_on", reason: "Указанная зависимость / необходимый навык" });
    if (d.assignment.ownerRef) links.push({ id: `owner:${n.id}`, from: ref, to: d.assignment.ownerRef, kind: "navigation", reason: "Указанный ответственный" });
  }
  for (const d of state.strategy?.decisions ?? []) {
    const input = d.revisions.at(-1)!.data;
    for (const to of input.basisRefs) links.push({ id: `basis:${d.id}:${to}`, from: `decision:${d.id}`, to, kind: "depends_on", reason: "Основание решения" });
    for (const from of input.affectedRefs) links.push({ id: `decision-applies:${d.id}:${from}`, from, to: `decision:${d.id}`, kind: "depends_on", reason: "Решение относится к этой записи" });
  }
  const method = state.strategy?.mapVersions.at(-1)?.data ?? defaultStrategyMap();
  const mapBases = [...method.x.basisRefs, ...method.y.basisRefs, ...method.points.flatMap(p => p.basisRefs)];
  if (method.mode === "scenario_v2") for (const e of strategyEntries(state))
    if (/^fact:[^:]+:(feature:|research:autonomy$)/.test(e.key) || /^talkhint:/.test(e.key)) mapBases.push(e.key);
  for (const to of Array.from(new Set(mapBases))) links.push({ id: `map-basis:${to}`, from: "map:current", to, kind: "depends_on", reason: "Основание действующей методики карты" });
  return [...links, ...(state.strategy?.links ?? [])];
}
export function strategyGaps(state: ProjectModelState): { ref: string; message: string }[] {
  const result: { ref: string; message: string }[] = [], links = strategyLinks(state);
  for (const n of state.strategy?.nodes ?? []) {
    const d = n.revisions.at(-1)!.data, ref = `node:${n.id}`;
    if (!links.some(l => l.from === ref && l.kind === "depends_on") && !d.evidence.sourceUrls.length && !d.evidence.sourceNote)
      result.push({ ref, message: "Не связано с основанием или проверкой" });
    if (d.kind === "action") {
      if (!d.assignment.ownerRef) result.push({ ref, message: "Нет ответственного" });
      if (!d.assignment.skillRefs.length) result.push({ ref, message: "Не определены необходимые навыки" });
      if (!d.assignment.expectedResult.trim()) result.push({ ref, message: "Не указан ожидаемый результат" });
      if (!d.assignment.dependencyRefs.some(key => state.strategy?.decisions.some(dec =>
        `decision:${dec.id}` === key && dec.revisions.at(-1)?.data.status === "accepted")))
        result.push({ ref, message: "Действие не связано с принятым решением" });
      for (const skill of d.assignment.skillRefs)
        if (!links.some(l => l.from === d.assignment.ownerRef && l.to === skill)) result.push({ ref, message: "Не подтверждён навык ответственного" });
    }
    if (d.kind === "criterion" && !d.definition.trim()) result.push({ ref, message: "Не определён критерий оценки" });
  }
  for (const decision of state.strategy?.decisions ?? []) {
    const d = decision.revisions.at(-1)!.data, ref = `decision:${decision.id}`;
    if (d.status === "accepted" && !d.ownerRef) result.push({ ref, message: "У принятого решения нет ответственного" });
    if (d.status === "accepted" && !d.nextStep.trim()) result.push({ ref, message: "Не определён следующий шаг принятого решения" });
  }
  return result;
}
