import { describe, it, expect, afterEach, vi } from "vitest";
import {
  emptyCompetitorResearch, researchFor, researchRows, featureFor, featureStatusLabel,
  matchesResearchFilters, researchProximity, positioningFor, quarterChanges, quarterDirectory,
  researchFeatures, type ResearchEvidence, type ResearchRow,
} from "../../shared/competitorResearch";
import { emptyCompetitorSnapshot, type CompetitorDirectory, type SaveCompetitorCommand } from "../../shared/projectCompetitors";
import { competitorResearchSchema } from "./competitorSchema";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "./competitorInitial";
import { initialModel } from "./seed";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";
import { requestSchema } from "./domain";

const verified = (): ResearchEvidence => ({
  status: "live_verified", note: "Фиктивное свидетельство только для теста схемы",
  sourceUrls: ["https://example.test/check"], checkedAt: "2026-10-24",
  contexts: ["personal", "business"],
});
const row = (): ResearchRow => ({
  id: "AI", kind: "competitor", version: 1, snapshot: structuredClone(initialAIPhoneSnapshot),
});
function fixture() {
  const root = initialModel(), model = initialModel();
  model.elements.push({
    id: "TH-PILOT-COMPETITORS", title: "Конкуренты", section: "Бизнес-модель", scope: "talkhint",
    kind: "context", description: "", details: {}, version: 1, updatedAt: "2026-10-24",
    needsReview: false, contentStatus: "question", implementationStatus: "not_started",
  });
  model.competitorDirectory = {
    records: [{ id: "AI", revisions: [{ version: 1, savedAt: "2026-10-25", reason: "Переданные данные", snapshot: structuredClone(initialAIPhoneSnapshot) }] }],
    talkhint: structuredClone(initialTalkHintBaseline),
  };
  root.alternatives = [{ id: "new-country", title: "Новая", model }];
  return root;
}
const directory = (root: ReturnType<typeof fixture>) => readHypothesis(root, "new-country").competitorDirectory!;
const quarter = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
};
describe("three-level competitor research, without new researched claims", () => {
  afterEach(() => vi.useRealTimers());
  it("reads old AI Phone exactly; does not turn captions, App Store region or unknowns into evidence", () => {
    const current = row(), saved = structuredClone(current);
    current.snapshot.offer.features += " Subtitles, Type to Speak";
    const research = researchFor(current.snapshot);
    expect(research.features.translation?.status).toBe("official_claim");
    expect(featureFor(current, "live_hints").status).toBe("unknown");
    expect(research.geography).toEqual({ service: [], phoneNumbers: [], customers: [] });
    expect(research.languages).toEqual([]);
    expect(research.companySize).toBeNull();
    expect(current.snapshot.plans).toEqual(saved.snapshot.plans);
    expect(matchesResearchFilters(current, "US", "")).toBe(false);
    expect(researchProximity(current).score).toBeNull();
    expect(positioningFor(current).plottable).toBe(false);
    expect(positioningFor(current).x).toBeNull();
    expect(emptyCompetitorSnapshot().name).toBe("");
  });
  it("filters each geography independently and requires a sourced language function", () => {
    const current = row(), research = emptyCompetitorResearch();
    current.snapshot.research = research;
    research.geography.phoneNumbers.push({ region: "US", evidence: verified() });
    expect(matchesResearchFilters(current, "us", "", "phoneNumbers")).toBe(true);
    expect(matchesResearchFilters(current, "US", "", "service")).toBe(false);
    expect(matchesResearchFilters(current, "US", "", "customers")).toBe(false);
    research.languages.push({ feature: "translation", count: null, russian: "yes", spanish: "unknown", evidence: verified() });
    expect(matchesResearchFilters(current, "", "russian")).toBe(true);
    expect(matchesResearchFilters(current, "", "spanish")).toBe(false);
    expect(research.languages[0].count).toBeNull();
    research.languages[0].evidence.sourceUrls = [];
    expect(matchesResearchFilters(current, "", "russian")).toBe(false);
    expect(matchesResearchFilters(current, " ", "")).toBe(true);
  });
  it("ranks only checked actions, not official marketing or company size", () => {
    const current = row(), research = researchFor(current.snapshot);
    current.snapshot.research = research;
    research.features.secretary_outgoing = verified();
    expect(researchProximity(current)).toMatchObject({ score: 3, confirmed: 1 });
    research.companySize = { metric: "Сотрудники", value: "100000", evidence: verified() };
    expect(researchProximity(current).score).toBe(3);
    research.features.secretary_outgoing.status = "official_claim";
    expect(researchProximity(current).score).toBeNull();
  });
  it("plots only complete evidenced positions and separates a goal from current readiness", () => {
    const current = row(), research = emptyCompetitorResearch();
    current.snapshot.research = research;
    for (const key of Object.keys(researchFeatures) as Array<keyof typeof researchFeatures>)
      research.features[key] = { ...verified(), status: "not_supported" };
    research.features.secretary_outgoing = verified();
    research.autonomy = { mode: "confirmed_tasks", evidence: verified() };
    expect(positioningFor(current)).toMatchObject({ x: 2, y: 1, plottable: true, target: false });
    delete research.features.live_hints;
    expect(positioningFor(current).plottable).toBe(false);
    research.features.live_hints = { ...verified(), status: "not_supported" };
    research.features.secretary_outgoing = { ...verified(), status: "planned" };
    research.autonomy.evidence.status = "planned";
    expect(positioningFor(current).plottable).toBe(false);
    current.kind = "talkhint_target";
    expect(positioningFor(current)).toMatchObject({ x: 2, y: 1, plottable: true, target: true });
    expect(featureStatusLabel(current, "secretary_outgoing")).toBe("Запланировано");
  });
  it("validates structured sources, per-function languages and company size, leaving an empty template valid", () => {
    const research = emptyCompetitorResearch();
    expect(competitorResearchSchema.safeParse(research).success).toBe(true);
    research.companySize = { metric: "Клиенты", value: "100", evidence: { ...verified(), sourceUrls: [] } };
    expect(competitorResearchSchema.safeParse(research).success).toBe(false);
    research.companySize = null;
    research.languages.push({ feature: "translation", count: 0, russian: "unknown", spanish: "unknown", evidence: { ...verified(), sourceUrls: [] } });
    expect(competitorResearchSchema.safeParse(research).success).toBe(false);
    research.languages[0].count = null;
    expect(competitorResearchSchema.safeParse(research).success).toBe(true);
    research.languages.push(structuredClone(research.languages[0]));
    expect(competitorResearchSchema.safeParse(research).success).toBe(false);
  });
  it("saves additions as a new canonical card revision, deriving legacy views without altering history or other blocks", () => {
    const root = fixture(), old = structuredClone(root);
    const snapshot = structuredClone(initialAIPhoneSnapshot);
    snapshot.research = researchFor(snapshot);
    snapshot.research.features.translation = verified();
    const command: SaveCompetitorCommand = { type: "saveCompetitor", id: "AI", baseVersion: 1, reason: "Тест схемы", snapshot };
    expect(requestSchema.safeParse({ revision: root.revision, command }).success).toBe(true);
    const updated = applyHypothesisCommand(root, "new-country", command, "tester");
    expect(root).toEqual(old);
    expect(updated.elements).toEqual(old.elements);
    const revisions = directory(updated).records[0].revisions;
    expect(revisions[0].snapshot).toEqual(initialAIPhoneSnapshot);
    expect(revisions[1].snapshot.scenarios.find(item => item.scenario === "translation")?.status).toBe("live_verified");
    expect(revisions[1].snapshot.plans).toEqual(initialAIPhoneSnapshot.plans);
  });
  it("captures manual immutable quarterly references, reopens old prices and compares all four categories", () => {
    const root = fixture();
    const captured = applyHypothesisCommand(root, "new-country", {
      type: "captureCompetitorQuarter", quarter: quarter(), reason: "Ручное сохранение", direction: "Вывод исследователя, не автоматическое исследование",
    }, "tester");
    const first = directory(captured).quarters![0];
    const snapshot = structuredClone(initialAIPhoneSnapshot);
    snapshot.plans[1].price = 19.99;
    snapshot.research = researchFor(snapshot);
    snapshot.research.geography.service.push({ region: "US", evidence: verified() });
    snapshot.research.languages.push({ feature: "translation", count: 3, russian: "yes", spanish: "yes", evidence: verified() });
    snapshot.research.features.live_hints = verified();
    const edited = applyHypothesisCommand(captured, "new-country", {
      type: "saveCompetitor", id: "AI", baseVersion: 1, reason: "Синтетическое изменение только в тесте", snapshot,
    }, "tester");
    const next = applyHypothesisCommand(edited, "new-country", {
      type: "captureCompetitorQuarter", quarter: quarter(), reason: "Повторный ручной снимок", direction: "Изменилась полнота сведений; это не доказательство даты запуска функций",
    }, "tester");
    const data = directory(next), second = data.quarters![1];
    expect(data.quarters![0]).toEqual(first);
    expect(quarterDirectory(data, first).records[0].revisions[0].snapshot.plans[1].price).toBe(14.99);
    expect(quarterDirectory(data, second).records[0].revisions[0].snapshot.plans[1].price).toBe(19.99);
    expect(quarterChanges(data, first, second).find(item => item.id === "AI"))
      .toMatchObject({ features: true, languages: true, coverage: true, prices: true });
    expect(researchRows(data)).toHaveLength(3);
    expect(() => quarterDirectory(data, { ...first, competitorVersions: [{ id: "missing", version: 1 }] })).toThrow("отсутствует");
  });
  it("does not report a source/date refresh as a changed function, language, coverage or price", () => {
    const capture = { type: "captureCompetitorQuarter" as const, quarter: quarter(), reason: "Ручной", direction: "Проверка свидетельств" };
    const firstRoot = applyHypothesisCommand(fixture(), "new-country", capture, "tester");
    const snapshot = structuredClone(initialAIPhoneSnapshot);
    snapshot.checkedAt = "2026-10-25";
    snapshot.sources[0].note += " Перепроверено";
    snapshot.plans[0].sourceUrl += "?source=refreshed";
    const changed = applyHypothesisCommand(firstRoot, "new-country", {
      type: "saveCompetitor", id: "AI", baseVersion: 1, reason: "Только свидетельство", snapshot,
    }, "tester");
    const next = applyHypothesisCommand(changed, "new-country", capture, "tester"), data = directory(next);
    expect(quarterChanges(data, data.quarters![0], data.quarters![1]).find(item => item.id === "AI"))
      .toMatchObject({ features: false, languages: false, coverage: false, prices: false });
    const readonly = quarterDirectory(data, data.quarters![0]);
    readonly.records[0].revisions[0].snapshot.plans[1].price = 0;
    expect(data.records[0].revisions[0].snapshot.plans[1].price).toBe(14.99);
  });
  it("keeps TalkHint current/target edits and history isolated from phone data and the old hypothesis", () => {
    const root = fixture(), current = emptyCompetitorResearch(), target = emptyCompetitorResearch();
    target.features.secretary_outgoing = { ...verified(), status: "planned" };
    const command = { type: "saveTalkHintResearch" as const, current, target, checkedAt: "2026-10-24", reason: "Сверка только исследовательской карточки" };
    const next = applyHypothesisCommand(root, "new-country", command, "tester");
    expect(directory(next).records).toEqual(directory(root).records);
    expect(directory(next).talkhint.scenarios).toEqual(initialTalkHintBaseline.scenarios);
    expect(directory(next).talkhint.researchHistory).toHaveLength(1);
    const again = applyHypothesisCommand(next, "new-country", command, "tester");
    expect(directory(again).talkhint.researchHistory).toHaveLength(2);
    expect(directory(next).talkhint.researchHistory).toHaveLength(1);
    for (const type of ["saveTalkHintResearch", "captureCompetitorQuarter"] as const) {
      const request = type === "saveTalkHintResearch" ? command : { type, quarter: quarter(), reason: "Тест", direction: "Тест" };
      expect(() => applyHypothesisCommand(root, "original", request, "tester")).toThrow("new-country");
    }
  });
  it("does not accept forged captures, future/backdated quarters or client-supplied histories", () => {
    const root = fixture();
    const command = { type: "captureCompetitorQuarter", quarter: quarter(), reason: "Ручной", direction: "Не проверено" };
    expect(requestSchema.safeParse({ revision: 0, command: { ...command, competitorVersions: [] } }).success).toBe(false);
    expect(() => applyHypothesisCommand(root, "new-country", { ...command, type: "captureCompetitorQuarter", quarter: "2001-Q1" }, "tester")).toThrow("текущ");
    expect(directory(root).quarters).toBeUndefined();
  });
});
