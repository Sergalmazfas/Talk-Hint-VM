import { expect, it } from "vitest";
import { initialModel } from "./seed";
import { modelSizeBudget } from "./sizeBudget";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";
it("keeps each hypothesis bounded while permitting the shared independent-hypothesis envelope", () => {
  const root = initialModel(), selected = initialModel();
  expect(modelSizeBudget(root)).toBe(5_000_000);
  root.alternatives = [{ id: "new-country", title: "New", model: selected }];
  expect(modelSizeBudget(root)).toBe(8_000_000);
  expect(modelSizeBudget(readHypothesis(root, "new-country"))).toBe(6_500_000);
});
it("extends only new-country, keeps original guard and does not persist scope metadata", () => {
  const root = initialModel();
  root.alternatives = [{ id: "new-country", title: "New", model: initialModel() }];
  const documentCount = root.alternatives[0].model.documents.length;
  (root.alternatives[0].model as any).payload = "x".repeat(5_100_000);
  const next = applyHypothesisCommand(root, "new-country",
    { type: "saveDocument", title: "Small", text: "ok", url: "", elementIds: [] }, "owner");
  expect(next.alternatives![0].model.documents).toHaveLength(documentCount + 1);
  expect(next.alternatives![0].model.hypothesisContext).toBeUndefined();
  expect(root.alternatives[0].model.documents).toHaveLength(documentCount);
  (root as any).payload = "x".repeat(5_000_001);
  expect(() => applyHypothesisCommand(root, "original",
    { type: "saveDocument", title: "Small", text: "ok", url: "", elementIds: [] }, "owner")).toThrow("размер");
});
it("rejects over-budget envelope atomically and preserves original and alternative history", () => {
  const root = initialModel();
  root.alternatives = [{ id: "new-country", title: "New", model: initialModel() }];
  // Legacy data may exceed one envelope even though this single incoming edit is small.
  (root as any).legacyPayload = "x".repeat(8_000_001);
  const prior = structuredClone(root);
  expect(() => applyHypothesisCommand(root, "new-country", { type: "saveDocument", title: "Tiny", text: "Input", url: "", elementIds: [] }, "owner")).toThrow("размер");
  expect(root).toEqual(prior);
});
it("still rejects a new-country working set above 6.5M even below the 8M envelope", () => {
  const root = initialModel();
  root.alternatives = [{ id: "new-country", title: "New", model: initialModel() }];
  (root.alternatives[0].model as any).payload = "x".repeat(6_500_001);
  const prior = structuredClone(root);
  expect(() => applyHypothesisCommand(root, "new-country",
    { type: "saveDocument", title: "Small", text: "ok", url: "", elementIds: [] }, "owner")).toThrow("размер");
  expect(root).toEqual(prior);
});
