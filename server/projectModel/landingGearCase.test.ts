import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { refineT01 } from "./research/refineT01";
import { defineMkt1Result } from "./research/defineMkt1Result";
import { prepareLandingGearCase } from "./research/landingGearCase";
import { landingGearCaseDocument, landingGearCaseId, landingGearDocumentTitle } from "./research/landingGearCaseContent";
import { readHypothesis } from "./hypotheses";

function fixture() {
  const root = initialModel();
  const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  model.analystPreparation = { revisions: [] };
  root.alternatives = [{ id: "new-country", title: "New", model }, { id: "other", title: "Other", model: initialModel() }];
  return defineMkt1Result(refineT01(root, "owner"), "owner");
}
describe("one landing gear case in existing owner model", () => {
  it("adds a linked document/process once, without changing prior organisation or history", () => {
    const root = fixture(), snapshot = structuredClone(root), next = prepareLandingGearCase(root, "owner");
    expect(root).toEqual(snapshot);
    expect(next.alternatives![1]).toEqual(root.alternatives![1]);
    expect(next.elements).toEqual(root.elements);
    expect(next.documents).toEqual(root.documents);
    const before = readHypothesis(root, "new-country"), after = readHypothesis(next, "new-country");
    expect(after.operatingModel!.revisions.slice(0, -1)).toEqual(before.operatingModel!.revisions);
    const oldData = before.operatingModel!.revisions.at(-1)!.data, data = after.operatingModel!.revisions.at(-1)!.data;
    expect(data.nodes.slice(0, oldData.nodes.length)).toEqual(oldData.nodes);
    expect(data.links.slice(0, oldData.links.length)).toEqual(oldData.links);
    const doc = after.documents.find(d => d.title === landingGearDocumentTitle)!;
    expect(doc.text).toBe(landingGearCaseDocument);
    expect(doc.text.length).toBeLessThan(50000);
    expect(data.nodes.find(n => n.id === landingGearCaseId)?.referenceIds).toContain(doc.id);
    expect(prepareLandingGearCase(next, "owner")).toBe(next);
    expect(data.nodes.find(n => n.code === "B2C.1")?.parentId).toBe(data.nodes.find(n => n.code === "B2B.1")?.parentId);
  });
  it("represents responsibilities, evidence, dependencies, return and acceptance without launching crew", () => {
    const next = prepareLandingGearCase(fixture(), "owner");
    const model = readHypothesis(next, "new-country"), data = model.operatingModel!.revisions.at(-1)!.data;
    const actions = data.nodes.filter(n => /^LG\.\d$/.test(n.code));
    expect(actions).toHaveLength(9);
    for (const action of actions) {
      expect(action.roleId).toBeTruthy();
      expect(action.executorId).toBeNull();
      expect(action.inputs.length).toBeGreaterThan(0);
      expect(action.procedure).toBeTruthy();
      expect(action.success).toBeTruthy();
      expect(action.recipientId).toBeTruthy();
      expect(data.links.some(l => l.from === action.id && l.kind === "produces")).toBe(true);
    }
    expect(data.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "lg-action-6", to: "lg-result-5", kind: "depends_on" }),
      expect.objectContaining({ from: "lg-discussion-report", to: "lg-action-6", kind: "return" }),
    ]));
    const text = model.documents.find(d => d.title === landingGearDocumentTitle)!.text;
    for (const phrase of ["Сообщение пользователя", "не доказанный дефект", "Kansas City/I-70", "Indiana/I-64",
      "Паспорт технического специалиста", "MMS", "DTMF", "S9", "CrewAI не запускался", "P1", "Критерии закрытия"])
      expect(text).toContain(phrase);
  });
  it("does not overwrite a modified owner document or incomplete case", () => {
    const next = prepareLandingGearCase(fixture(), "owner"), model = next.alternatives![0].model;
    model.documents.find(d => d.title === landingGearDocumentTitle)!.text += "\nOwner notes";
    expect(() => prepareLandingGearCase(next, "owner")).toThrow("preserve owner edits");
  });
  it("fails without required existing processes instead of creating a parallel organisation", () => {
    const root = fixture();
    const nodes = root.alternatives![0].model.operatingModel!.revisions.at(-1)!.data.nodes;
    nodes.find(n => n.code === "SUP.1")!.code = "OTHER";
    expect(() => prepareLandingGearCase(root, "owner")).toThrow("SUP.1");
  });
});
