import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { projectPackageBlocks, type ElementInput, type ModelElement, type ProjectModelState } from "../../shared/projectModel";
import PackageViews from "../../client/src/components/project-model/PackageViews";
import { applyHypothesisCommand, readHypothesis, splitProductHypotheses } from "./hypotheses";

function fixture(): ProjectModelState {
  const elements: ModelElement[] = projectPackageBlocks.map(block => ({
    id: block.id, title: block.title, section: "Бизнес-модель", scope: "talkhint",
    kind: "context", description: `ORIGINAL ${block.id}`, contentStatus: "hypothesis",
    implementationStatus: "not_started", details: {}, version: 3, updatedAt: "2026-10-23", needsReview: true,
  }));
  const original = { ...elements[0], description: "TalkHint — AI-управляющий малого бизнеса, исходный текст.", contentStatus: "confirmed" as const };
  const changed = { ...original, description: "TalkHint — многоязычный AI-помощник для жизни в новой стране. Целевая концепция; WhatsApp позже.",
    version: 4, updatedAt: "2026-10-25", needsReview: false };
  elements[0] = changed;
  return { schema: 1, revision: 600, elements, relations: [],
    documents: [{ id: "DOC-RESEARCH", title: "Клининг и массажисты", text: "Old research", url: "", elementIds: ["TH-MARKET"], updatedAt: "2026-10-23" }],
    proposals: [], taskDrafts: [],
    decisions: [{ id: "DEC-PRIOR", at: "2026-10-25", actor: "owner", action: "Подтверждено изменение",
      reason: "Earlier request", elementIds: ["TH-PRODUCT"], before: original, after: changed }] };
}

describe("independent project hypotheses", () => {
  it("restores actual historical content and retains all other blocks and materials", () => {
    const before = fixture(), copy = structuredClone(before);
    const next = splitProductHypotheses(before, "owner", "2026-10-25");
    const { version, updatedAt, ...restored } = next.elements[0];
    const { version: _v, updatedAt: _t, ...historical } = before.decisions[0].before!;
    expect(restored).toEqual(historical);
    expect(version).toBe(5);
    expect(next.elements.slice(1)).toEqual(before.elements.slice(1));
    for (const key of ["documents", "relations", "proposals", "taskDrafts"] as const) expect(next[key]).toEqual(before[key]);
    expect(next.decisions.slice(0, -1)).toEqual(before.decisions);
    expect(next.decisions.at(-1)?.before).toEqual(before.elements[0]);
    expect(before).toEqual(copy);
    expect(next.primaryHypothesisId).toBeNull();
  });
  it("creates exactly ten independent blocks, one filled, with no borrowed research", () => {
    const root = splitProductHypotheses(fixture(), "owner");
    const alternative = readHypothesis(root, "new-country");
    expect(alternative.elements.map(e => e.id)).toEqual(projectPackageBlocks.map(b => b.id));
    expect(alternative.elements.filter(e => e.description.trim())).toHaveLength(1);
    expect(alternative.elements.slice(1).every(e => e.contentStatus === "question" && !Object.keys(e.details).length)).toBe(true);
    expect(alternative.documents).toEqual([]);
    expect(alternative.relations).toEqual([]);
    expect(alternative.proposals).toEqual([]);
    expect(alternative.hypothesisContext?.primaryId).toBeNull();
    expect(alternative.hypothesisContext?.options).toHaveLength(2);
    expect(alternative.elements[0].description).toContain("многоязычная AI-помощница");
  });
  it("never fabricates a recovery or overwrites intervening work", () => {
    const lost = fixture(); lost.decisions = [];
    expect(() => splitProductHypotheses(lost, "owner")).toThrow("не найдена");
    const edited = fixture(); edited.elements[0] = { ...edited.elements[0], description: "Intervening work" };
    expect(() => splitProductHypotheses(edited, "owner")).toThrow("менялся");
  });
  it("is idempotent and preserves independent histories and global concurrency revision", () => {
    const root = splitProductHypotheses(fixture(), "owner");
    expect(splitProductHypotheses(root, "owner")).toBe(root);
    const { id, version: _v, updatedAt: _t, needsReview: _r, ...input } = root.alternatives![0].model.elements[1];
    const element: ElementInput = { ...input, description: "New hypothesis client — not the old pilot" };
    const updated = applyHypothesisCommand(root, "new-country", { type: "saveElement", id, element }, "owner");
    expect(updated.elements).toEqual(root.elements);
    expect(updated.documents).toEqual(root.documents);
    expect(updated.decisions).toEqual(root.decisions);
    expect(updated.revision).toBe(root.revision + 1);
    expect(readHypothesis(updated, "new-country").revision).toBe(updated.revision);
    expect(readHypothesis(updated, "new-country").elements[1].description).toBe(element.description);
    expect(readHypothesis(updated).elements[1].description).not.toBe(element.description);
    expect(updated.alternatives![0].model.decisions).toHaveLength(2);
  });
  it("does not leak a stale alternative or silently fall back to the original", () => {
    const root = fixture();
    expect(readHypothesis(root).hypothesisContext?.options).toHaveLength(1);
    expect(root.hypothesisContext).toBeUndefined();
    expect(() => readHypothesis(root, "missing")).toThrow("не найдена");
    expect(() => applyHypothesisCommand(root, "missing", { type: "reviewElement", id: "TH-PRODUCT", reason: "test" }, "owner")).toThrow("не найдена");
  });
  it("renders one filled section and honest empty blocks, without old segment claims", () => {
    const root = splitProductHypotheses(fixture(), "owner");
    const html = renderToStaticMarkup(createElement(PackageViews, {
      state: readHypothesis(root, "new-country"), view: "overview", openElement: () => {},
    }));
    expect(html).toContain("1<small>/ 10 заполнено");
    expect(html).toContain("Ещё не проработано");
    expect(html).not.toContain("ORIGINAL");
    expect(html).not.toContain("Old research");
  });
});
