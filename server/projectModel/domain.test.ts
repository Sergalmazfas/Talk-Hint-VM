import { describe, expect, it } from "vitest";
import { applyCommand, requestSchema } from "./domain";
import { initialModel } from "./seed";
import type { ElementInput, ModelCommand, ProjectModelState } from "../../shared/projectModel";

function input(s: ProjectModelState, id = "TH-PRODUCT"): ElementInput {
  const { version, updatedAt, needsReview, id: _, ...e } = s.elements.find(e => e.id === id)!;
  return e;
}
function proposal(s: ProjectModelState, id = "TH-PRODUCT", change: Partial<ElementInput> = {}) {
  return applyCommand(s, { type: "saveProposal", targetId: id, source: "Выдержка владельца", rationale: "Согласование после обсуждения",
    relatedIds: [], change: { ...input(s, id), contentStatus: "confirmed", ...change } }, "owner");
}
function approve(s: ProjectModelState) {
  return applyCommand(s, { type: "approveProposal", id: s.proposals[s.proposals.length - 1].id }, "owner");
}
describe("internal TalkHint project model", () => {
  it("separates positioning, implementation, customer demo and unknown market/prices", () => {
    const s = initialModel();
    expect(s.elements.find(e => e.id === "TH-PRODUCT")?.contentStatus).toBe("hypothesis");
    expect(s.elements.find(e => e.id === "TH-PRODUCT")?.implementationStatus).toBe("not_started");
    expect(s.elements.find(e => e.id === "TH-SEGMENT")?.description).toMatch(/Стационарный/);
    expect(s.elements.find(e => e.id === "SALON-FINANCE")?.scope).toBe("salon_example");
    expect(s.elements.find(e => e.id === "SALON-FINANCE")?.details.economics).toContain("не прибыль");
    expect(s.elements.find(e => e.id === "TH-MARKET")?.contentStatus).toBe("question");
  });
  it("only confirmation changes description; preserves version and source history", () => {
    const old = initialModel();
    const p = proposal(old, "TH-PRODUCT", { description: "Новая согласованная модель" });
    expect(p.elements).toEqual(old.elements);
    const next = approve(p);
    expect(next.elements.find(e => e.id === "TH-PRODUCT")?.description).toBe("Новая согласованная модель");
    expect(next.elements.find(e => e.id === "TH-PRODUCT")?.version).toBe(2);
    expect(next.decisions.at(-1)?.before?.description).toBe(old.elements.find(e => e.id === "TH-PRODUCT")?.description);
    expect(next.decisions.at(-1)?.reason).toContain("Выдержка владельца");
    expect(next.elements.find(e => e.id === "TH-PRODUCT")?.implementationStatus).toBe("not_started");
  });
  it("does not silently confirm or edit approved content", () => {
    const s = approve(proposal(initialModel()));
    expect(() => applyCommand(s, { type: "saveElement", id: "TH-PRODUCT", element: { ...input(s), contentStatus: "hypothesis" } }, "owner")).toThrow(/предложение/);
    expect(() => applyCommand(initialModel(), { type: "saveElement", element: { ...input(initialModel()), contentStatus: "confirmed" } }, "owner")).toThrow(/предложение/);
  });
  it("requires clarification to be reworked before approval; keeps proposal history", () => {
    const s = proposal(initialModel());
    const p = s.proposals[0];
    const clarified = applyCommand(s, { type: "clarifyProposal", id: p.id, note: "Уточнить регион" }, "owner");
    expect(clarified.elements).toEqual(s.elements);
    expect(() => approve(clarified)).toThrow(/актуальное/);
    const edited = applyCommand(clarified, { type: "saveProposal", targetId: p.targetId, source: "Новое основание",
      rationale: "Уточнено", id: p.id, relatedIds: p.relatedIds, change: p.change }, "owner");
    expect(approve(edited).proposals[0].status).toBe("approved");
    expect(edited.decisions.at(-1)?.proposalBefore?.status).toBe("clarification");
  });
  it("rejects stale proposal version and duplicate confirmation", () => {
    const p = proposal(initialModel());
    const edited = applyCommand(p, { type: "saveElement", id: "TH-PRODUCT", element: { ...input(p), description: "Другая версия" } }, "owner");
    expect(() => approve(edited)).toThrow(/Описание изменилось/);
    const done = approve(p);
    expect(() => approve(done)).toThrow(/актуальное/);
    expect(() => applyCommand(done, { type: "clarifyProposal", id: done.proposals[0].id, note: "x" }, "owner")).toThrow(/неизменно/);
  });
  it("marks only direct neighbors/explicit related as review, not a pretend full impact analysis", () => {
    const s = approve(proposal(initialModel()));
    expect(s.elements.find(e => e.id === "TH-PROBLEM")?.needsReview).toBe(true);
    expect(s.elements.find(e => e.id === "TH-PROCESS")?.needsReview).toBe(true);
    expect(s.elements.find(e => e.id === "TH-SEGMENT")?.needsReview).toBe(false);
    const next = applyCommand(s, { type: "reviewElement", id: "TH-PROBLEM", reason: "Проверил совместимость" }, "owner");
    expect(next.elements.find(e => e.id === "TH-PROBLEM")?.needsReview).toBe(false);
  });
  it("persists rich action fields and IDs and rejects dangling/duplicate relations", () => {
    let s = initialModel();
    s = applyCommand(s, { type: "saveElement", element: { ...input(s, "TH-ACTION"), title: "Действие 2", details: { trigger: "Запрос", accountable: "Владелец", executor: "AI", failure: "Вернуть ошибку" } } }, "owner");
    const last = s.elements.at(-1)!;
    s = applyCommand(s, { type: "saveRelation", from: "TH-ACTION", to: last.id, label: "Передача результата" }, "owner");
    expect(s.elements.at(-1)?.id).toBe(last.id);
    expect(s.elements.at(-1)?.details.accountable).toBe("Владелец");
    expect(() => applyCommand(s, { type: "saveRelation", from: "foreign", to: last.id, label: "x" }, "owner")).toThrow(/не найден/);
    expect(() => applyCommand(s, { type: "saveRelation", from: "TH-ACTION", to: last.id, label: "Передача результата" }, "owner")).toThrow(/существует/);
    const link = s.relations.at(-1)!;
    const removed = applyCommand(s, { type: "removeRelation", id: link.id }, "owner");
    expect(removed.decisions.at(-1)?.relationBefore).toEqual(link);
  });
  it("versions documents and records source/region/comparability, not fake research", () => {
    let s = applyCommand(initialModel(), { type: "saveDocument", title: "Исследование", text: "Регион неизвестен; источник требуется", url: "https://example.org", elementIds: ["TH-MARKET"] }, "owner");
    const doc = s.documents.at(-1)!;
    s = applyCommand(s, { type: "saveDocument", id: doc.id, title: doc.title, text: "Новая версия", url: doc.url, elementIds: doc.elementIds }, "owner");
    expect(s.decisions.at(-1)?.documentBefore?.text).toBe(doc.text);
    expect(s.decisions.at(-1)?.documentAfter?.text).toBe("Новая версия");
    expect(s.elements.find(e => e.id === "TH-MARKET")?.needsReview).toBe(true);
  });
  it("prepares only approved/current TalkHint references and criteria, not an external task", () => {
    let s = initialModel();
    const command = { type: "prepareTask", title: "Разработать", elementIds: ["TH-PRODUCT"], acceptance: "Проверить результат" } as const;
    expect(() => applyCommand(s, { ...command, elementIds: [...command.elementIds] }, "owner")).toThrow(/утверждённые/);
    s = approve(proposal(s));
    s = applyCommand(s, { ...command, elementIds: [...command.elementIds] }, "owner");
    expect(s.taskDrafts[0].references).toEqual([{ id: "TH-PRODUCT", version: 2 }]);
    expect(s.taskDrafts[0].text).toContain("/admin/project-model?element=TH-PRODUCT");
    expect(s.taskDrafts[0].text).toContain("не отправлен в Replit");
    const demo = approve(proposal(s, "SALON-CONTEXT"));
    expect(() => applyCommand(demo, { ...command, elementIds: ["SALON-CONTEXT"] }, "owner")).toThrow(/Демонстрационная/);
    const review = structuredClone(s); review.elements.find(e => e.id === "TH-PRODUCT")!.needsReview = true;
    expect(() => applyCommand(review, { ...command, elementIds: ["TH-PRODUCT"] }, "owner")).toThrow(/пересмотра/);
  });
  it("validates strict inputs, URL protocols, IDs and rejects client-edited history/revision", () => {
    expect(requestSchema.safeParse({ revision: 0, command: { type: "approveProposal", id: "x", actor: "someone" } }).success).toBe(false);
    expect(requestSchema.safeParse({ revision: 0, command: { type: "saveDocument", title: "x", text: "", url: "javascript:alert(1)", elementIds: [] } }).success).toBe(false);
    expect(() => applyCommand(initialModel(), { type: "saveProposal", targetId: "foreign", source: "x", rationale: "x", relatedIds: [], change: input(initialModel()) }, "owner")).toThrow(/не найден/);
  });
});
