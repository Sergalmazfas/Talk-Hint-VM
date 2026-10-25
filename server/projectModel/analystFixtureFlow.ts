/**
 * Offline Stage A adapter contract, NOT a running CrewAI integration.
 * No HTTP client, model, credentials, scheduler, or route imports. Tests provide
 * synthetic adapters; future Flows must use the same owner-scoped model journal.
 */
import { createHash } from "node:crypto";
import { dossierSections } from "../../shared/competitorDossier";
import type { AnalystPreparationInput } from "../../shared/competitiveAnalyst";

export interface FixtureSource { id: string; url: string }
export interface FixtureMaterial { sourceId: string; url: string; kind: "page" | "transcript" | "video_observation" | "metadata"; content: string }
export interface FixtureClaim {
  section: typeof dossierSections[number]; field: string; before: string | null; after: string | null;
  milestone: "announced" | "demonstrated" | "released_claim" | "inference" | "corrected" | "discontinued";
  evidence: string; publishedAt: string | null; releasedAt: string | null;
  platform: string; country: string; plan: string;
}
export interface FixtureFinding extends FixtureClaim {
  id: string; competitorId: string; sourceIds: string[]; sourceUrls: string[];
  detectedAt: string; recipient: "Сергей"; destinations: string[];
  interpretation: string; question: string;
}
export interface FixtureCheckpoint {
  mode: "offline_fixture"; owner: string; hypothesis: "new-country"; runId: string; competitorId: string;
  version: number; startedAt: number; cursor: number; phase: "collect" | "extract" | "complete" | "limited";
  limits: AnalystPreparationInput["limits"]; sources: FixtureSource[];
  attempts: Record<string, number>; material: FixtureMaterial | null; findings: FixtureFinding[];
  checkedSourceIds: string[]; unavailableSourceIds: string[]; contradictions: { field: string; values: (string | null)[]; sourceIds: string[] }[];
  estimatedUsd: number; summary: string;
}
export interface FixtureAdapters {
  mode: "offline_fixture";
  now(): number;
  /** Upper bound before a fixture operation; unknown cost must fail closed. */
  estimateUsd(source: FixtureSource, phase: "collect" | "extract"): number | null;
  collect(source: FixtureSource): Promise<FixtureMaterial>;
  extract(material: FixtureMaterial): Promise<FixtureClaim[]>;
}
export interface FixtureJournal {
  read(owner: string, runId: string): Promise<FixtureCheckpoint | null>;
  /** CAS in the same owner model. On duplicate create/stale write, reject, never append. */
  write(owner: string, runId: string, expectedVersion: number | null, checkpoint: FixtureCheckpoint): Promise<void>;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validFixtureUrl = (value: string) => {
  try { const u = new URL(value); return u.protocol === "https:" && (u.hostname === "example.test" || u.hostname.endsWith(".example.test")) && !u.username && !u.password; }
  catch { return false; }
};
function scope(s: FixtureCheckpoint, owner: string, runId: string) {
  if (s.mode !== "offline_fixture" || s.owner !== owner || s.runId !== runId || s.hypothesis !== "new-country")
    throw new Error("Fixture journal scope mismatch");
}
export async function createFixtureRun(journal: FixtureJournal, owner: string, runId: string, competitorId: string,
  sources: FixtureSource[], limits: FixtureCheckpoint["limits"], now: number) {
  if (!sources.length || sources.length > limits.maxSources || new Set(sources.map(s => s.id)).size !== sources.length ||
    sources.some(s => !validFixtureUrl(s.url))) throw new Error("Only bounded synthetic example.test inputs are allowed");
  const checkpoint: FixtureCheckpoint = { mode: "offline_fixture", owner, runId, competitorId, hypothesis: "new-country",
    version: 0, startedAt: now, cursor: 0, phase: "collect", limits: structuredClone(limits), sources: structuredClone(sources),
    attempts: {}, material: null, findings: [], checkedSourceIds: [], unavailableSourceIds: [], contradictions: [],
    estimatedUsd: 0, summary: "" };
  await journal.write(owner, runId, null, checkpoint);
  return checkpoint;
}
async function timed<T>(operation: () => Promise<T>, remainingMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Fixture operation timeout")), Math.max(1, remainingMs));
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
/** One bounded step. Persistence failure propagates, no next operation runs. */
export async function advanceFixtureRun(journal: FixtureJournal, adapters: FixtureAdapters, owner: string, runId: string) {
  if (adapters.mode !== "offline_fixture") throw new Error("Live provider is not connected");
  const stored = await journal.read(owner, runId);
  if (!stored) throw new Error("Unknown checkpoint; never silently restart a run");
  scope(stored, owner, runId);
  if (stored.phase === "complete" || stored.phase === "limited") return stored;
  const s = structuredClone(stored), source = s.sources[s.cursor];
  const remaining = s.limits.maxMinutes * 60000 - (adapters.now() - s.startedAt);
  const estimate = adapters.estimateUsd(source, s.phase === "extract" ? "extract" : "collect");
  if (remaining <= 0 || estimate === null || !Number.isFinite(estimate) || estimate < 0 ||
    s.estimatedUsd + estimate > s.limits.maxEstimatedUsd) {
    s.phase = "limited"; s.summary = "ТЕСТ: остановлено по времени/оценочному бюджету или неизвестной цене; не рабочий пилот.";
  } else {
    const operation = `${source.id}:${s.phase}`, attempt = s.attempts[operation] ?? 0;
    s.attempts[operation] = attempt + 1;
    s.estimatedUsd += estimate;
    try {
      if (s.phase === "collect") {
        const material = await timed(() => adapters.collect(source), Math.min(remaining, 5000));
        if (material.url !== source.url || material.sourceId !== source.id || material.content.length > 100000)
          throw new Error("Invalid fixture material");
        s.material = structuredClone(material); s.phase = "extract";
      } else {
        const claims = await timed(() => adapters.extract(s.material!), Math.min(remaining, 5000));
        if (claims.length > 100) throw new Error("Too many fixture claims");
        let chars = 0;
        for (const c of claims) {
          if (!dossierSections.includes(c.section) || !c.field || !c.evidence.trim() || c.field.length > 200 ||
            !["announced", "demonstrated", "released_claim", "inference", "corrected", "discontinued"].includes(c.milestone))
            throw new Error("Invalid public finding; no private scores or strategic decisions");
          if (s.material?.kind === "metadata" && c.milestone === "demonstrated")
            throw new Error("Search metadata is not video analysis");
          chars += JSON.stringify(c).length;
          if (chars > s.limits.maxOutputTokens * 4) throw new Error("Fixture output bound exceeded");
          if (c.before === c.after) continue;
          // One content identity with multiple evidence links, not a copy per recipient.
          const id = hash([s.runId, s.competitorId, c.section, c.field, c.before, c.after]);
          const previous = s.findings.find(f => f.id === id);
          if (previous) {
            if (!previous.sourceIds.includes(source.id)) { previous.sourceIds.push(source.id); previous.sourceUrls.push(source.url); }
          } else {
            s.findings.push({ ...structuredClone(c), id, competitorId: s.competitorId,
              sourceIds: [source.id], sourceUrls: [source.url], detectedAt: new Date(adapters.now()).toISOString(),
              recipient: "Сергей", destinations: c.section === "Цены" ? ["finance", "product"] : ["product"],
              interpretation: "ТЕСТ: возможное значение требует рассмотрения, не стратегическое решение.",
              question: "Сергей, нужно ли пересмотреть связанные выводы?" });
          }
        }
        if (!s.checkedSourceIds.includes(source.id)) s.checkedSourceIds.push(source.id);
        s.cursor++; s.material = null; s.phase = "collect";
      }
    } catch {
      // A failed extraction must not leave partially applied proposals.
      s.findings = structuredClone(stored.findings);
      if (attempt + 1 >= s.limits.maxAttempts) {
        s.unavailableSourceIds.push(source.id); s.cursor++; s.material = null; s.phase = "collect";
      }
    }
    if (s.cursor >= s.sources.length) {
      s.phase = "complete";
      const keys = new Set(s.findings.map(f => `${f.section}:${f.field}`));
      for (const field of Array.from(keys)) {
        const group = s.findings.filter(f => `${f.section}:${f.field}` === field);
        const values = Array.from(new Set(group.map(f => f.after)));
        if (values.length > 1) s.contradictions.push({ field, values, sourceIds: Array.from(new Set(group.flatMap(f => f.sourceIds))) });
      }
      s.summary = s.findings.length
        ? `ТЕСТ: ${s.findings.length} предложений изменений; противоречий ${s.contradictions.length}. Рабочие карточки не изменены.`
        : `ТЕСТ: Изменений в проверенных источниках не обнаружено. Проверено ${s.checkedSourceIds.length}, недоступно ${s.unavailableSourceIds.length}. Это не вывод об отсутствии изменений у конкурента.`;
    }
  }
  s.version++;
  await journal.write(owner, runId, stored.version, s);
  return s;
}
