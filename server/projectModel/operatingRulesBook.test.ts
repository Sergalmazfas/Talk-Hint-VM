import { describe, it, expect } from "vitest";
import { rulesAppendixHeading, rulesBookText } from "../../scripts/lib/rules-book";
import { productBookText, readProductBook, type ProductBook } from "../../shared/productBook";
import type { ModelDocument } from "../../shared/projectModel";

const book: ProductBook = {
  version: 12, updatedAt: "2026-10-27", snapshotDate: "2026-10-25", status: "На согласовании",
  lifecycle: "В разработке", purpose: "TalkHint", vision: "Цель", b2c: "B2C", b2b: "B2B",
  current: "Факты", nextStage: "Проверки", completion: "Реальная приёмка", features: [],
  legal: "Не принято", finance: "Неизвестно", responsibilities: "Прежние роли",
  contradictions: "", roadmap: "Прежний план", previousPassport: "Полный исходный паспорт",
};
const doc: ModelDocument = {
  id: "DOC-TALKHINT-PRODUCT-PASSPORT", title: "Книга v12", text: productBookText(book),
  url: "", elementIds: ["TH-PRODUCT"], updatedAt: "2026-10-27",
};
describe("rules application uses the actual book reader", () => {
  it("round-trips the new version and preserves features and previous passport", () => {
    const saved = readProductBook({ ...doc, text: rulesBookText(doc, 13, "2026-10-27") })!;
    expect(saved.version).toBe(13);
    expect(saved.features).toEqual(book.features);
    expect(saved.previousPassport).toBe(book.previousPassport);
    expect(saved.responsibilities).toContain("DOC-TALKHINT-IMPROVEMENT-JOURNAL");
  });
  it("recovers only the known appended review text through the canonical formatter", () => {
    const broken = { ...doc, text: doc.text + rulesAppendixHeading + "Согласованная ссылка" };
    expect(readProductBook(broken)).toBeNull();
    const fixed = readProductBook({ ...doc, text: rulesBookText(broken, 14, "2026-10-27", true) })!;
    expect(fixed.version).toBe(14);
    expect(fixed.previousPassport).toBe(book.previousPassport);
  });
  it("refuses unknown malformed payload instead of dropping content", () => {
    expect(() => rulesBookText({ ...doc, text: doc.text + "\nUnknown payload" }, 14, "now", true)).toThrow();
  });
});
