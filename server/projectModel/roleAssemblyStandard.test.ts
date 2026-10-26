import { expect, it } from "vitest";
import { initialModel } from "./seed";
import { prepareProductBook } from "./research/productBook";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";
import { saveRoleAssemblyStandard, roleAssemblyStandard, standardHeading } from "./research/roleAssemblyStandard";
import { productBookDocumentId, readProductBook, productBookText } from "../../shared/productBook";

const now = "2026-10-26T23:00:00.000Z";
function fixture() {
  const root = initialModel(), state = initialModel();
  state.documents = [
    { id: productBookDocumentId, title: "Passport v1", text: "Original", url: "", elementIds: [], updatedAt: now },
    { id: "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d", title: "Roadmap", text: "Original roadmap", url: "", elementIds: [], updatedAt: now },
  ];
  root.alternatives = [{ id: "new-country", title: "TalkHint", model: state }, { id: "other", title: "Other", model: initialModel() }];
  return prepareProductBook(root, "fixture");
}
it("updates only the existing book, preserves every other field and history, and is idempotent", () => {
  const before = fixture(), original = structuredClone(before);
  const after = saveRoleAssemblyStandard(before, now);
  const state = readHypothesis(after, "new-country"), old = readHypothesis(before, "new-country");
  const saved = readProductBook(state.documents.find(d => d.id === productBookDocumentId))!;
  const previous = readProductBook(old.documents.find(d => d.id === productBookDocumentId))!;
  expect(saved.version).toBe(previous.version + 1);
  expect(saved.responsibilities).toContain(roleAssemblyStandard);
  expect({ ...saved, version: previous.version, updatedAt: previous.updatedAt, responsibilities: previous.responsibilities }).toEqual(previous);
  expect(state.operatingModel).toEqual(old.operatingModel);
  expect(state.elements).toEqual(old.elements);
  expect(state.relations).toEqual(old.relations);
  expect(state.documents).toHaveLength(old.documents.length);
  expect(state.decisions.some(d => d.documentBefore?.id === productBookDocumentId)).toBe(true);
  expect(before).toEqual(original);
  expect(saveRoleAssemblyStandard(after, now)).toBe(after);
});
it("replaces a prior section without duplicating it or deleting following sections", () => {
  const root = fixture(), s = root.alternatives![0].model;
  const doc = s.documents.find(d => d.id === productBookDocumentId)!;
  const book = readProductBook(doc)!;
  book.responsibilities += `\n${standardHeading}\nOld rule\n## Following section\nKeep it`;
  doc.text = productBookText(book);
  const updated = saveRoleAssemblyStandard(root, now);
  const text = readProductBook(readHypothesis(updated, "new-country").documents.find(d => d.id === doc.id))!.responsibilities;
  expect(text.split(standardHeading)).toHaveLength(2);
  expect(text).toContain("## Following section\nKeep it");
  expect(text).not.toContain("Old rule");
});
it("requires an existing canonical book rather than creating an alternate catalogue", () => {
  expect(() => saveRoleAssemblyStandard(initialModel(), now)).toThrow();
});
it("round-trips an ordinary UI edit of a near-limit book after inserting the standard", () => {
  const root = fixture(), state = root.alternatives![0].model;
  const doc = state.documents.find(d => d.id === productBookDocumentId)!;
  const book = readProductBook(doc)!;
  // A generated Markdown preamble duplicates this field. Fill the previous
  // ordinary representation to exactly the size of the real pre-change book.
  const currentLength = productBookText(book).length;
  book.current += "x".repeat(Math.floor((49938 - currentLength) / 2));
  doc.text = productBookText(book);
  expect(doc.text.length).toBeGreaterThanOrEqual(49937);
  expect(doc.text.length).toBeLessThanOrEqual(49938);
  const saved = saveRoleAssemblyStandard(root, now);
  const updatedState = readHypothesis(saved, "new-country");
  const updatedDoc = updatedState.documents.find(d => d.id === doc.id)!;
  const edited = readProductBook(updatedDoc)!;
  edited.features[0].limitations += "\nОбычное уточнение из веб-редактора.";
  edited.version += 1;
  const text = productBookText(edited);
  expect(text.length).toBeLessThanOrEqual(50000);
  const roundTrip = applyHypothesisCommand(saved, "new-country", { type: "saveDocument",
    id: doc.id, title: updatedDoc.title, text, url: doc.url, elementIds: doc.elementIds }, "UI round trip");
  expect(readProductBook(readHypothesis(roundTrip, "new-country").documents.find(d => d.id === doc.id))).toEqual(edited);
  expect(readHypothesis(roundTrip, "new-country").operatingModel).toEqual(state.operatingModel);
  expect(edited.responsibilities).toContain(roleAssemblyStandard);
});
it("keeps every field even when responsibilities themselves require the minimal preamble", () => {
  const root = fixture(), doc = root.alternatives![0].model.documents.find(d => d.id === productBookDocumentId)!;
  const book = readProductBook(doc)!;
  book.responsibilities = "";
  book.responsibilities = "r".repeat(45000 - JSON.stringify(book).length);
  const text = productBookText(book);
  expect(text.length).toBeLessThanOrEqual(50000);
  expect(readProductBook({ ...doc, text })).toEqual(book);
});
