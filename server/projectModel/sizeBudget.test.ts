import { expect, it } from "vitest";
import { initialModel } from "./seed";
import { modelSizeBudget } from "./sizeBudget";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";
it("keeps each hypothesis bounded while permitting the shared independent-hypothesis envelope", () => {
  const root = initialModel(), selected = initialModel();
  expect(modelSizeBudget(root)).toBe(5_000_000);
  root.alternatives = [{ id: "new-country", title: "New", model: selected }];
  expect(modelSizeBudget(root)).toBe(8_000_000);
  expect(modelSizeBudget(readHypothesis(root, "new-country"))).toBe(5_000_000);
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
