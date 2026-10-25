import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";
import { competitorSnapshotSchema } from "./competitorSchema";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "./competitorInitial";
import { competitorPrice, competitorSnapshotDiff, type SaveCompetitorCommand } from "../../shared/projectCompetitors";
import type { ProjectModelState } from "../../shared/projectModel";
import { requestSchema } from "./domain";

function fixture(): ProjectModelState {
  const root = initialModel();
  const model = initialModel();
  if (!model.elements.some(e => e.id === "TH-PILOT-COMPETITORS")) {
    model.elements.push({
      id: "TH-PILOT-COMPETITORS", title: "Конкуренты", section: "Бизнес-модель", scope: "talkhint",
      kind: "context", description: "", details: {}, version: 1, updatedAt: "2026-10-24",
      needsReview: false, contentStatus: "question", implementationStatus: "not_started",
    });
  }
  model.competitorDirectory = { records: [], talkhint: structuredClone(initialTalkHintBaseline) };
  root.alternatives = [{ id: "new-country", title: "Новая гипотеза", model }];
  root.primaryHypothesisId = null;
  return root;
}
const create = (): SaveCompetitorCommand => ({
  type: "saveCompetitor", baseVersion: 0, reason: "Проверка переданного снимка", snapshot: structuredClone(initialAIPhoneSnapshot),
});
describe("Independent competitor directory", () => {
  it("accepts the seven supplied purchases without inventing included units", () => {
    const snapshot = competitorSnapshotSchema.parse(initialAIPhoneSnapshot);
    expect(snapshot.plans.map(plan => plan.price)).toEqual([8.99, 14.99, 59.99, 5.99, 12.99, 29.99, 69.99]);
    expect(snapshot.plans.every(plan => plan.includedMinutes.includes("Не подтверждено"))).toBe(true);
    expect(competitorPrice(snapshot.plans[2])).toContain("59.99 USD / год");
    expect(competitorPrice(snapshot.plans[2])).toContain("5.00 USD / месяц");
    expect(competitorPrice({ ...snapshot.plans[0], price: null })).toBe("Цена не подтверждена");
    expect(competitorPrice({ ...snapshot.plans[0], price: 0 })).toContain("0.00 USD");
  });
  it("persists snapshots, exact dates and differences; never mutates the old snapshot", () => {
    const root = fixture(), untouched = structuredClone(root);
    const first = applyHypothesisCommand(root, "new-country", create(), "owner");
    const firstModel = readHypothesis(first, "new-country");
    const record = firstModel.competitorDirectory!.records[0];
    const replacement = structuredClone(initialAIPhoneSnapshot);
    replacement.plans[1].price = 19.99;
    replacement.verification = "manual";
    const updated = applyHypothesisCommand(first, "new-country", {
      type: "saveCompetitor", id: record.id, baseVersion: 1, reason: "Цена изменилась после ручной проверки",
      snapshot: replacement,
    }, "owner");
    const revisions = readHypothesis(updated, "new-country").competitorDirectory!.records[0].revisions;
    expect(revisions).toHaveLength(2);
    expect(revisions[0].snapshot.plans[1].price).toBe(14.99);
    expect(revisions[1].snapshot.plans[1].price).toBe(19.99);
    expect(revisions[0].snapshot.checkedAt).toBe("2026-10-24");
    expect(competitorSnapshotDiff(revisions[0].snapshot, revisions[1].snapshot))
      .toContainEqual({ field: "plans.1.price", before: "14.99", after: "19.99" });
    expect(root).toEqual(untouched);
    expect(updated.elements).toEqual(root.elements);
    expect(updated.documents).toEqual(root.documents);
    expect(updated.primaryHypothesisId).toBeNull();
    expect(readHypothesis(updated, "new-country").competitorDirectory!.talkhint).toEqual(initialTalkHintBaseline);
  });
  it("rejects stale edits and wrong hypotheses without touching original research", () => {
    const root = fixture();
    expect(() => applyHypothesisCommand(root, "original", create(), "owner")).toThrow("отдельной гипотезе");
    const first = applyHypothesisCommand(root, "new-country", create(), "owner");
    const record = readHypothesis(first, "new-country").competitorDirectory!.records[0];
    expect(() => applyHypothesisCommand(first, "new-country", create(), "owner")).toThrow("уже существует");
    expect(() => applyHypothesisCommand(first, "new-country", { ...create(), id: record.id }, "owner")).toThrow("Устаревшая");
    expect(() => applyHypothesisCommand(first, "new-country", { ...create(), id: "missing" }, "owner")).toThrow("не найдена");
    expect(first.elements).toEqual(root.elements);
  });
  it("rejects unsafe sources, invalid prices, incomplete scenarios and altered history payloads", () => {
    const command = create();
    expect(requestSchema.safeParse({ revision: 0, command }).success).toBe(true);
    command.snapshot.website = "javascript:alert(1)";
    expect(requestSchema.safeParse({ revision: 0, command }).success).toBe(false);
    const negative = create(); negative.snapshot.plans[0].price = -1;
    expect(requestSchema.safeParse({ revision: 0, command: negative }).success).toBe(false);
    const incomplete = create(); incomplete.snapshot.scenarios.pop();
    expect(requestSchema.safeParse({ revision: 0, command: incomplete }).success).toBe(false);
    const duplicate = create(); duplicate.snapshot.plans.push(duplicate.snapshot.plans[0]);
    expect(requestSchema.safeParse({ revision: 0, command: duplicate }).success).toBe(false);
    expect(requestSchema.safeParse({ revision: 0, command: { ...create(), revisions: [] } }).success).toBe(false);
  });
});
