import { describe, it, expect } from "vitest";
import { competitorSnapshotSchema, competitorDossierSchema } from "./competitorSchema";
import { lingvanexSnapshot } from "./competitorLingvanex";
import { vocalingoSnapshot } from "./competitorVocalingo";
import { initialModel } from "./seed";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "./competitorInitial";
import { applyApprovedCompetitors } from "./approvedCompetitorUpdate";
import { readHypothesis, applyHypothesisCommand } from "./hypotheses";
import { normalizeCompetitorSnapshot } from "../../shared/projectCompetitors";
import { emptyCompetitorDossier, dossierSections } from "../../shared/competitorDossier";
import { emptyCompetitorResearch, positioningFor, featureFor, quarterChanges } from "../../shared/competitorResearch";

function fixture() {
  const root = initialModel(), model = initialModel();
  model.elements.push({
    id: "TH-PILOT-COMPETITORS", title: "Конкуренты", section: "Бизнес-модель", scope: "talkhint",
    kind: "context", description: "Существующая карточка", details: {}, version: 1, updatedAt: "2026-10-24",
    needsReview: false, contentStatus: "hypothesis", implementationStatus: "not_started",
  });
  model.competitorDirectory = {
    records: [{ id: "existing-ai-phone", revisions: [{ version: 1, savedAt: "2026-10-24", reason: "Сохранённое исследование", snapshot: structuredClone(initialAIPhoneSnapshot) }] }],
    talkhint: structuredClone(initialTalkHintBaseline),
  };
  root.alternatives = [{ id: "new-country", title: "Новая гипотеза", model }];
  return root;
}
describe("six-section company dossiers and two explicitly approved competitors", () => {
  it("keeps an empty template unknown and accepts the bounded, sourced public datasets", () => {
    expect(dossierSections).toHaveLength(6);
    expect(competitorDossierSchema.parse(emptyCompetitorDossier()).revenueKind).toBe("unknown");
    for (const snapshot of [lingvanexSnapshot(), vocalingoSnapshot()]) {
      expect(competitorSnapshotSchema.safeParse(snapshot).success).toBe(true);
      expect(snapshot.dossier!.funding).toEqual([]);
      expect(Object.values(snapshot.dossier!.avatar).every(fact => fact!.value === null)).toBe(true);
      expect(Object.values(snapshot.dossier!.scale).every(fact => fact!.value === null)).toBe(true);
      expect(snapshot.sources.some(source => source.checkedAt === "2026-10-24")).toBe(true);
      expect(snapshot.sources.some(source => source.checkedAt === "2026-10-25")).toBe(true);
      expect(positioningFor({ id: "test", kind: "competitor", version: 1, snapshot }).plottable).toBe(false);
    }
  });
  it("does not merge Lingvanex destination claims, coins/credits or autonomous inbound with translation", () => {
    const snapshot = lingvanexSnapshot(), research = snapshot.research!;
    expect(snapshot.plans.map(plan => plan.price)).toEqual([9.99, 69.99, 14.99, 29.99, 74.99]);
    expect(snapshot.plans[2].includedUnits).toEqual({ unit: "coins", amount: 10 });
    expect(snapshot.dossier!.pricingNotes[0].value).toContain("0.08 credits/мин");
    expect(snapshot.dossier!.pricingNotes[1].value).toContain("0.19 credits/мин");
    expect(snapshot.dossier!.coverageFacts.map(fact => fact.value)).toEqual(["150+ стран", "160 стран"]);
    expect(research.geography.service).toEqual([]);
    expect(research.geography.customers).toEqual([]);
    expect(research.geography.phoneNumbers.map(entry => entry.region)).toEqual(["US", "Canada"]);
    expect(research.languages[0]).toMatchObject({ count: 70, countQualifier: "at_least", russian: "yes", spanish: "yes" });
    expect(research.features.secretary_outgoing?.status).toBe("official_claim");
    expect(research.features.incoming?.status).toBe("unknown");
    expect(research.features.live_hints?.status).toBe("unknown");
    expect(research.features.history?.status).toBe("unknown");
  });
  it("keeps VocaLingo website and App Store prices and included volumes separate", () => {
    const snapshot = vocalingoSnapshot();
    expect(snapshot.plans).toHaveLength(14);
    const byId = (id: string) => snapshot.plans.find(plan => plan.id === id)!;
    expect(byId("voca-web-year")).toMatchObject({ price: 99, purchaseChannel: "Сайт", includedUnits: { unit: "tokens", amount: 12000 } });
    expect(byId("voca-store-year")).toMatchObject({ price: 99.99, purchaseChannel: "US App Store" });
    expect(byId("voca-store-year").includedUnits).toBeUndefined();
    expect(byId("voca-web-500").price).toBe(13.99);
    expect(byId("voca-store-500").price).toBe(10.99);
    expect(byId("voca-store-10000").price).toBe(300);
    expect(snapshot.dossier!.pricingNotes.find(fact => fact.id === "number-verify")!.value).toContain("SMS + 10");
  });
  it("does not transfer media languages, providers or video lipsync to live calls/avatars", () => {
    const snapshot = vocalingoSnapshot(), research = snapshot.research!;
    expect(research.languages.find(item => item.feature === "media")).toMatchObject({ count: 100, countQualifier: "at_least" });
    expect(research.languages.find(item => item.feature === "translation")).toMatchObject({ count: null, russian: "unknown", spanish: "unknown" });
    expect(research.features.live_hints?.status).toBe("official_claim");
    expect(research.features.secretary_outgoing?.status).toBe("unknown");
    expect(research.features.incoming?.status).toBe("unknown");
    expect(research.features.contacts?.status).toBe("official_claim");
    expect(research.features.history?.status).toBe("official_claim");
    expect(research.features.chat?.status).toBe("official_claim");
    expect(snapshot.dossier!.technical.filter(row => row.scope === "live_call").every(row => row.provider === null)).toBe(true);
    expect(snapshot.dossier!.technical.find(row => row.id === "video-text")).toMatchObject({ scope: "file_tool", layer: "stt", provider: "ElevenLabs Scribe v2" });
    expect(snapshot.dossier!.avatar.presence?.value).toBeNull();
  });
  it("validates evidence and revenue scenarios without treating missing amounts as zero", () => {
    const dossier = emptyCompetitorDossier();
    dossier.avatar.presence = { value: "Да", evidence: { status: "unknown", checkedAt: null, sourceUrls: [], note: "Только иконка" } };
    expect(competitorDossierSchema.safeParse(dossier).success).toBe(false);
    const valid = vocalingoSnapshot().dossier!;
    valid.scale.revenue = { value: "Сценарий, не фактическая выручка", evidence: {
      status: "official_claim", checkedAt: "2026-10-24", sourceUrls: ["https://example.test/basis"], note: "Только тест схемы",
    } };
    valid.revenueKind = "scenario";
    expect(competitorDossierSchema.safeParse(valid).success).toBe(false);
    valid.revenueAssumptions = "Только синтетический тест; никаких вычислений и сохранения в пользовательском исследовании";
    expect(competitorDossierSchema.safeParse(valid).success).toBe(true);
    const old = normalizeCompetitorSnapshot(initialAIPhoneSnapshot);
    expect(old).toEqual(initialAIPhoneSnapshot);
  });
  it("upserts by stable product identity without duplicates or touching AI Phone, other blocks or the old hypothesis", () => {
    const root = fixture(), before = structuredClone(root);
    const result = applyApprovedCompetitors(root, [lingvanexSnapshot(), vocalingoSnapshot()], "owner");
    const model = readHypothesis(result.state, "new-country"), directory = model.competitorDirectory!;
    expect(directory.records).toHaveLength(3);
    expect(directory.records[0]).toEqual(before.alternatives![0].model.competitorDirectory!.records[0]);
    expect(result.state.elements).toEqual(before.elements);
    expect(result.state.documents).toEqual(before.documents);
    expect(model.elements.filter(item => item.id !== "TH-PILOT-COMPETITORS"))
      .toEqual(before.alternatives![0].model.elements.filter(item => item.id !== "TH-PILOT-COMPETITORS"));
    expect(root).toEqual(before);
    const repeated = applyApprovedCompetitors(result.state, [lingvanexSnapshot(), vocalingoSnapshot()], "owner");
    expect(repeated.results.every(item => item.action === "unchanged")).toBe(true);
    expect(repeated.state).toEqual(result.state);
    expect(directory.records[1].revisions).toHaveLength(1);
  });
  it("keeps v1 methodology readable without inferring contacts/history from an old combined metric", () => {
    const snapshot = structuredClone(initialAIPhoneSnapshot);
    snapshot.research = emptyCompetitorResearch();
    snapshot.research.features.contacts_history = {
      status: "live_verified", sourceUrls: ["https://example.test/evidence"], checkedAt: "2026-10-24",
      note: "Синтетический тест старой схемы", contexts: ["personal", "business"],
    };
    const row = { id: "legacy", kind: "competitor" as const, version: 1, snapshot };
    expect(featureFor(row, "contacts").status).toBe("unknown");
    expect(featureFor(row, "history").status).toBe("unknown");
    expect(positioningFor(row, 1)).toMatchObject({ lower: 2, upper: 18 });
    expect(positioningFor(row, 2)).toMatchObject({ lower: 0, upper: 22 });
  });
  it("preserves new dossier fields in quarterly history and does not confuse source refresh with tariff changes", () => {
    const seeded = applyApprovedCompetitors(fixture(), [vocalingoSnapshot()], "owner").state;
    const now = new Date(), quarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
    const capture = { type: "captureCompetitorQuarter" as const, quarter, reason: "Тест", direction: "Только тест архива" };
    const first = applyHypothesisCommand(seeded, "new-country", capture, "owner");
    const records = readHypothesis(first, "new-country").competitorDirectory!.records;
    const record = records.find(item => item.revisions[0].snapshot.name === "VocaLingo")!;
    const updated = structuredClone(record.revisions[0].snapshot);
    updated.plans[0].evidence!.note += " Обновление пояснения";
    updated.dossier!.avatar.presence!.evidence.note += " По-прежнему не подтверждено";
    const second = applyHypothesisCommand(first, "new-country", {
      type: "saveCompetitor", id: record.id, baseVersion: 1, reason: "Только метаданные", snapshot: updated,
    }, "owner");
    const captured = applyHypothesisCommand(second, "new-country", capture, "owner");
    const data = readHypothesis(captured, "new-country").competitorDirectory!;
    expect(data.quarters![0].methodologyVersion).toBe(2);
    expect(quarterChanges(data, data.quarters![0], data.quarters![1]).find(item => item.id === record.id))
      .toMatchObject({ features: false, prices: false });
    expect(data.records.find(item => item.id === record.id)!.revisions[0].snapshot.dossier!.technical).toHaveLength(13);
  });
});
