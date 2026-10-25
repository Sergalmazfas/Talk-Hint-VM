import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { initialModel } from "./seed";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "./competitorInitial";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";
import { requestSchema } from "./domain";
import { competitorSnapshotSchema } from "./competitorSchema";
import { newReview, latestAssessment, assessmentScore, type CompetitorReviewInput } from "../../shared/competitorAssessments";
import { publicSupportResearch } from "./research/publicSupport";
import { supportResearchSchema } from "./assessmentSchema";
import { quarterDirectory, researchRows } from "../../shared/competitorResearch";
import type { ProjectModelState } from "../../shared/projectModel";

export function assessmentFixture() {
  const root = initialModel(), model = initialModel();
  model.elements.push({ id: "TH-PILOT-COMPETITORS", title: "Конкуренты", section: "Бизнес-модель", scope: "talkhint", kind: "context",
    description: "", details: {}, version: 1, updatedAt: "2026-10-24", needsReview: false, contentStatus: "question", implementationStatus: "not_started" });
  model.competitorDirectory = { records: [], talkhint: structuredClone(initialTalkHintBaseline) };
  root.alternatives = [{ id: "new-country", title: "Альтернатива", model }]; root.primaryHypothesisId = null;
  return applyHypothesisCommand(root, "new-country", { type: "saveCompetitor", baseVersion: 0, reason: "fixture", snapshot: structuredClone(initialAIPhoneSnapshot) }, "owner");
}
export const assessmentRecord = (root: ProjectModelState) => readHypothesis(root, "new-country").competitorDirectory!.records[0];
export function testReview(category: CompetitorReviewInput["category"] = "design"): CompetitorReviewInput {
  return { ...newReview(category), author: "Тестировщик", platform: "iPhone, iOS", testedAt: "2026-10-24", appVersion: "1.2", rationale: "Личная проверка",
    observations: "Текст легко прочитать", impression: "Удобно" };
}
function append(root: ProjectModelState, review: CompetitorReviewInput, requestId = randomUUID()) {
  const record = assessmentRecord(root);
  return applyHypothesisCommand(root, "new-country", { type: "addCompetitorReview", id: record.id, baseVersion: record.revisions.at(-1)!.version, requestId, review }, "owner");
}
describe("personal competitor assessments", () => {
  it("keeps legacy snapshots unchanged and empty scores nonnumeric", () => {
    expect(competitorSnapshotSchema.parse(initialAIPhoneSnapshot)).toEqual(initialAIPhoneSnapshot);
    for (const category of ["design", "usability", "support"] as const) {
      expect(latestAssessment(initialAIPhoneSnapshot, category)).toBeUndefined();
      expect(assessmentScore(undefined, category)).toBe(category === "support" ? "Не проверено" : "Не оценено");
    }
  });
  it("persists independent manual scores, text-only checks and immutable history", () => {
    const initial = assessmentFixture(), original = structuredClone(initial);
    const design = append(initial, { ...testReview(), score: 8.5 });
    const usability = append(design, { ...testReview("usability"), score: 4 });
    const support = append(usability, testReview("support"));
    const textOnly = append(support, { ...testReview(), score: null, rationale: "Новый тест без балла" });
    const record = assessmentRecord(textOnly), snapshot = record.revisions.at(-1)!.snapshot;
    expect(snapshot.assessments?.design?.map(r => r.score)).toEqual([8.5, null]);
    expect(latestAssessment(snapshot, "usability")?.score).toBe(4);
    expect(latestAssessment(snapshot, "support")?.score).toBeNull();
    expect(assessmentScore(latestAssessment(snapshot, "design"), "design")).toBe("Не оценено");
    expect(record.revisions[0].snapshot).toEqual(initialAIPhoneSnapshot);
    expect(record.revisions[1].snapshot.assessments?.design).toHaveLength(1);
    expect(snapshot.assessments?.design?.[0].recordedBy).toBe("owner");
    expect(competitorSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(initial).toEqual(original);
    expect(textOnly.elements).toEqual(original.elements);
    expect(textOnly.documents).toEqual(original.documents);
    expect(textOnly.primaryHypothesisId).toBeNull();
    expect(readHypothesis(textOnly, "new-country").elements.filter(e => e.id !== "TH-PILOT-COMPETITORS"))
      .toEqual(readHypothesis(original, "new-country").elements.filter(e => e.id !== "TH-PILOT-COMPETITORS"));
    expect(researchRows(readHypothesis(textOnly, "new-country").competitorDirectory!)[0].snapshot.assessments).toEqual(snapshot.assessments);
  });
  it.each([0, -1, 10.1, NaN, Infinity])("rejects invalid score %s", score => {
    expect(() => append(assessmentFixture(), { ...testReview(), score })).toThrow();
  });
  it("requires rationale, valid date, author, platform and relevant distinct parameter keys", () => {
    for (const change of [{ author: "" }, { platform: "" }, { testedAt: "2999-01-01" }, { testedAt: "2026-02-30" }, { score: 9, rationale: "" }])
      expect(() => append(assessmentFixture(), { ...testReview(), ...change })).toThrow();
    const r = testReview();
    r.parameters.push(r.parameters[0]);
    expect(() => append(assessmentFixture(), r)).toThrow();
    r.parameters = [{ ...r.parameters[0], key: "evil" }];
    expect(() => append(assessmentFixture(), r)).toThrow();
  });
  it("does not score untested or inapplicable parameters and does not punish an absent avatar", () => {
    const r = testReview();
    r.parameters[0].score = 1;
    expect(() => append(assessmentFixture(), r)).toThrow();
    r.parameters[0].applicability = "applicable";
    expect(() => append(assessmentFixture(), r)).toThrow();
    r.parameters[0].observations = "Проверено";
    r.parameters.at(-1)!.applicability = "absent";
    const next = append(assessmentFixture(), r);
    expect(latestAssessment(assessmentRecord(next).revisions.at(-1)!.snapshot, "design")?.score).toBeNull();
  });
  it("requires actual support contact before any support number and never auto-resolves bot replies", () => {
    const r = { ...testReview("support"), score: 2 };
    expect(() => append(assessmentFixture(), r)).toThrow("реального обращения");
    r.supportExperience = { ...r.supportExperience!, issue: "Ошибка платежа", channel: "email", contactedAt: "2026-10-24T10:00:00Z",
      firstResponseAt: "2026-10-24T10:00:05Z", responder: "bot" };
    const first = append(assessmentFixture(), r);
    const saved = latestAssessment(assessmentRecord(first).revisions.at(-1)!.snapshot, "support")!;
    expect(saved.supportExperience?.outcome).toBe("unknown");
    expect(saved.supportExperience?.resolvedAt).toBeNull();
    r.supportExperience.outcome = "resolved";
    expect(() => append(first, r)).toThrow("Решение требует даты");
    r.supportExperience.resolvedAt = "2026-10-24T12:00:00Z";
    r.supportExperience.resolution = "Доступ восстановлен, проверено";
    expect(() => append(first, r)).not.toThrow();
    r.supportExperience.firstResponseAt = "2026-10-24T09:59:00Z";
    expect(() => append(first, r)).toThrow("раньше обращения");
  });
  it("rejects retries, stale versions, unknown cards and mutation through the legacy editor", () => {
    const initial = assessmentFixture(), id = randomUUID(), first = append(initial, testReview(), id), record = assessmentRecord(first);
    expect(() => append(first, testReview(), id)).toThrow("уже сохранена");
    expect(() => applyHypothesisCommand(first, "new-country", { type: "addCompetitorReview", id: record.id, baseVersion: 1, requestId: randomUUID(), review: testReview() }, "owner")).toThrow("Устаревшая");
    const snapshot = structuredClone(record.revisions.at(-1)!.snapshot);
    delete snapshot.assessments;
    expect(() => applyHypothesisCommand(first, "new-country", { type: "saveCompetitor", id: record.id, baseVersion: 2, reason: "overwrite", snapshot }, "owner")).toThrow("историю нельзя заменять");
    const valid = structuredClone(record.revisions.at(-1)!.snapshot);
    valid.audience = "Уточнение исследования";
    const edited = applyHypothesisCommand(first, "new-country", { type: "saveCompetitor", id: record.id, baseVersion: 2, reason: "manual research", snapshot: valid }, "owner");
    expect(assessmentRecord(edited).revisions.at(-1)!.snapshot.assessments).toEqual(record.revisions.at(-1)!.snapshot.assessments);
    expect(() => applyHypothesisCommand(first, "original", { type: "addCompetitorReview", id: record.id, baseVersion: 2, requestId: randomUUID(), review: testReview() }, "owner")).toThrow("new-country");
    expect(() => applyHypothesisCommand(first, "new-country", { type: "addCompetitorReview", id: "missing", baseVersion: 2, requestId: randomUUID(), review: testReview() }, "owner")).toThrow("не найдена");
  });
  it("rejects spoofed audit fields and unsafe material links; stores links without HTML execution", () => {
    const root = assessmentFixture(), record = assessmentRecord(root);
    expect(requestSchema.safeParse({ revision: root.revision, command: { type: "addCompetitorReview", id: record.id, baseVersion: 1,
      requestId: randomUUID(), review: { ...testReview(), recordedBy: "someone-else" } } }).success).toBe(false);
    for (const url of ["javascript:alert(1)", "http://example.com", "https://user:pass@example.com", "https://example.com/?token=private", "https://example.com/?X-Amz-Signature=private"])
      expect(() => append(root, { ...testReview(), materials: [{ title: "Скриншот", url }] })).toThrow();
    expect(() => append(root, { ...testReview(), materials: [{ title: "Скриншот", url: "https://example.com/screenshot.png" }] })).not.toThrow();
  });
  it("quarter snapshots retain the assessment version captured, not the newest score", () => {
    const root = append(assessmentFixture(), { ...testReview(), score: 8 });
    const d = new Date(), quarter = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    const captured = applyHypothesisCommand(root, "new-country", { type: "captureCompetitorQuarter", quarter, reason: "test", direction: "manual" }, "owner");
    const next = append(captured, { ...testReview(), score: 3 });
    const dir = readHypothesis(next, "new-country").competitorDirectory!;
    const old = quarterDirectory(dir, dir.quarters![0]);
    expect(latestAssessment(old.records[0].revisions.at(-1)!.snapshot, "design")?.score).toBe(8);
    expect(latestAssessment(dir.records[0].revisions.at(-1)!.snapshot, "design")?.score).toBe(3);
  });
  it("public support facts are sourced and cannot create personal scores", () => {
    expect(Object.keys(publicSupportResearch).sort()).toEqual(["6758815817", "1367461351", "6744344005", "6465173251", "6747626007"].sort());
    for (const support of Object.values(publicSupportResearch)) {
      expect(supportResearchSchema.safeParse(support).success).toBe(true);
      expect(support.crm?.value).toBeNull();
    }
    expect(publicSupportResearch["6758815817"].knowledgePlatform?.value).toContain("Featurebase");
    expect(publicSupportResearch["1367461351"].helpdesk?.status).toBe("observed_signal");
    expect(publicSupportResearch["6744344005"].responseTimes?.value).toContain("one business day");
    const root = assessmentFixture(), record = assessmentRecord(root);
    const updated = applyHypothesisCommand(root, "new-country", { type: "saveCompetitorSupport", id: record.id, baseVersion: 1, support: publicSupportResearch["6465173251"] }, "owner");
    expect(assessmentRecord(updated).revisions[0]).toEqual(record.revisions[0]);
    expect(assessmentRecord(updated).revisions.at(-1)!.snapshot.assessments).toBeUndefined();
    expect(supportResearchSchema.safeParse({ channels: { value: "24/7", status: "official_claim", sourceUrls: [], checkedAt: null, note: "" } }).success).toBe(false);
    expect(supportResearchSchema.safeParse({ crm: { value: "Unknown CRM", status: "unknown", sourceUrls: ["https://example.com"], checkedAt: "2026-10-24", note: "Нет доказательств" } }).success).toBe(false);
  });
});
