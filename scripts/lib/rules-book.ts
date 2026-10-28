import assert from "node:assert/strict";
import { productBookMarker, productBookText, readProductBook, type ProductBook } from "../../shared/productBook";
import type { ModelDocument } from "../../shared/projectModel";

export const rulesAppendixHeading = "\n\n## Правила v3 и единый журнал улучшений\n";
export function rulesBookText(document: ModelDocument, version: number, at: string, repair = false) {
  let book = readProductBook(document);
  if (!book && repair) {
    const raw = document.text.split(productBookMarker)[1];
    assert(raw, "Missing original book payload");
    const end = raw.lastIndexOf(rulesAppendixHeading);
    assert(end > 0, "Expected only the known review appendix");
    book = JSON.parse(raw.slice(0, end).trim()) as ProductBook;
    assert(book.version === 12 && Array.isArray(book.features), "Unexpected source");
  }
  assert(book, "Existing book must be readable");
  const beforeFeatures = JSON.stringify(book.features), beforePassport = book.previousPassport;
  const updated = structuredClone(book);
  updated.version = version; updated.updatedAt = at;
  updated.responsibilities += "\nОбщий регламент — replit.md v3. Единый журнал: " +
    "DOC-TALKHINT-IMPROVEMENT-JOURNAL. Роли и полномочия владельца — §2; " +
    "согласование правил не приёмка результатов случаев.";
  updated.roadmap += "\nЖурнал связан с прежней структурой и roadmap. P.OPS и бланки исключены " +
    "из этого применения; отдельная доработка по проходу rev800. 08:00 America/Denver — " +
    "согласованный час, не запущенное расписание.";
  const text = productBookText(updated);
  assert(text.length <= 50000);
  const parsed = readProductBook({ ...document, text });
  assert(parsed && parsed.version === version);
  assert.equal(JSON.stringify(parsed.features), beforeFeatures);
  assert.equal(parsed.previousPassport, beforePassport);
  return text;
}
