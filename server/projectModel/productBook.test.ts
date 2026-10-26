import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProductBookView from "../../client/src/components/project-model/ProductBookView";
// SSR assertions don't execute CSS; the real Vite build verifies the stylesheet.
vi.mock("../../client/src/components/project-model/ProductBookView.css", () => ({}));
vi.mock("../../client/src/components/project-model/PassportChapterView.css", () => ({}));
import { initialModel } from "./seed";
import { readHypothesis } from "./hypotheses";
import { prepareProductBook } from "./research/productBook";
import { bookChapters, productBookDocumentId, productBookText, readProductBook } from "../../shared/productBook";

function fixture() {
  const model = initialModel();
  model.elements = [{ id: "TH-PRODUCT", version: 1, title: "TalkHint", kind: "context", scope: "talkhint",
    section: "Обзор", description: "Исходное описание", contentStatus: "proposal", implementationStatus: "in_progress",
    details: {}, updatedAt: new Date().toISOString(), needsReview: false }];
  model.relations = [];
  model.documents = [
    { id: productBookDocumentId, title: "Паспорт v1", text: "Подтверждения владельца; исходная редакция v1.",
      url: "", elementIds: ["TH-PRODUCT"], updatedAt: new Date().toISOString() },
    { id: "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d", title: "Roadmap v12", text: "Сохранённый roadmap.",
      url: "", elementIds: ["TH-PRODUCT"], updatedAt: new Date().toISOString() },
  ];
  const root = initialModel();
  root.alternatives = [{ id: "new-country", title: "Помощница", model }];
  return root;
}
describe("living product book in the existing passport", () => {
  it("updates one passport, preserves original revision/history and other hypotheses, and is idempotent", () => {
    const root = fixture(), before = structuredClone(root);
    const saved = prepareProductBook(root, "test-owner");
    const model = readHypothesis(saved, "new-country");
    const doc = model.documents.find(d => d.id === productBookDocumentId)!;
    const book = readProductBook(doc)!;
    expect(book.version).toBe(2);
    expect(book.status).toBe("На согласовании");
    expect(book.previousPassport).toBe(before.alternatives![0].model.documents[0].text);
    expect(doc.text.length).toBeLessThan(50000);
    expect(model.documents).toHaveLength(2);
    expect(saved.elements).toEqual(before.elements);
    expect(model.elements.find(e => e.id === "TH-PRODUCT")).toMatchObject({
      id: "TH-PRODUCT", contentStatus: "proposal", version: 2, description: "Исходное описание",
    });
    expect(model.decisions.some(d => d.documentBefore?.id === doc.id && d.documentAfter?.id === doc.id)).toBe(true);
    expect(prepareProductBook(saved, "test-owner")).toBe(saved);
    expect(model.elements.filter(e => e.id.startsWith("PB-GAP-"))).toHaveLength(5);
    expect(model.elements.filter(e => e.id.startsWith("PB-GAP-")).every(e => e.contentStatus === "proposal")).toBe(true);
    expect(model.relations.filter(r => r.to === "TH-PRODUCT" && r.from.startsWith("PB-GAP-"))).toHaveLength(5);
    expect(book.features.every(f => f.deadline === "Не согласован." && f.acceptance.includes("Не принята"))).toBe(true);
  });
  it("round trips edits without losing feature IDs or inventing acceptance", () => {
    const saved = prepareProductBook(fixture(), "owner");
    const doc = readHypothesis(saved, "new-country").documents.find(d => d.id === productBookDocumentId)!;
    const book = readProductBook(doc)!;
    book.features[0].limitations = "Уточнение пользователя";
    const updated = readProductBook({ ...doc, text: productBookText(book) })!;
    expect(updated.features[0].id).toBe("secretary");
    expect(updated.features[0].limitations).toBe("Уточнение пользователя");
    expect(updated.status).toBe("На согласовании");
    expect(bookChapters).toHaveLength(10);
    expect(readProductBook({ ...doc, text: doc.text + "invalid" })).toBeNull();
  });
  it("requires an existing hypothesis/passport and cannot create another namespace", () => {
    expect(() => prepareProductBook(initialModel(), "other-owner")).toThrow();
    const root = fixture();
    root.alternatives![0].model.documents = [];
    expect(() => prepareProductBook(root, "owner")).toThrow("Existing passport");
    expect(root.alternatives).toHaveLength(1);
  });
  it("renders every chapter from the same document, including gap links and original history", () => {
    const saved = prepareProductBook(fixture(), "owner");
    const state = readHypothesis(saved, "new-country");
    try {
      for (const [chapter, title] of bookChapters) {
        vi.stubGlobal("window", { location: { search: `?view=book&chapter=${chapter}`, origin: "https://example.test", pathname: "/admin/project-model" } });
        const html = renderToStaticMarkup(React.createElement(ProductBookView, { state, saving: false, onSave: async () => false }));
        expect(html).toContain(title);
        expect(html).toContain(productBookDocumentId);
        expect(html).not.toContain("Запустить crew");
        if (chapter === "features") {
          expect(html).toContain("PB-GAP-TECH");
          expect(html).toContain("Переводчик");
        }
        if (chapter === "history") expect(html).toContain("Открыть исходный паспорт v1");
      }
    } finally { vi.unstubAllGlobals(); }
  });
});
