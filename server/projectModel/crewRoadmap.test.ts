import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { refineT01 } from "./research/refineT01";
import { defineMkt1Result } from "./research/defineMkt1Result";
import { prepareLandingGearCase } from "./research/landingGearCase";
import { readHypothesis } from "./hypotheses";
import { prepareCrewRoadmap } from "./research/crewRoadmap";
import { crewIntakeFindings, crewRoadmapId, crewRoadmapTitle } from "./research/crewRoadmapContent";
function fixture() {
  const root = initialModel();
  const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  model.analystPreparation = { revisions: [] };
  root.alternatives = [{ id: "new-country", title: "New", model }, { id: "other", title: "Other", model: initialModel() }];
  return prepareLandingGearCase(defineMkt1Result(refineT01(root, "owner"), "owner"), "owner");
}
describe("one sequential crew roadmap in the existing model", () => {
  it("preserves root, other hypotheses, prior revisions, case and documents; replay is idempotent", () => {
    const root = fixture(), snapshot = structuredClone(root);
    const next = prepareCrewRoadmap(root, "owner");
    expect(root).toEqual(snapshot);
    const before = readHypothesis(root, "new-country"), after = readHypothesis(next, "new-country");
    expect(next.alternatives![1]).toEqual(root.alternatives![1]);
    expect(next.elements).toEqual(root.elements);
    expect(after.documents.slice(0, before.documents.length)).toEqual(before.documents);
    expect(after.operatingModel!.revisions.slice(0, -1)).toEqual(before.operatingModel!.revisions);
    expect(after.operatingModel!.revisions.at(-1)!.data.nodes.filter(n => n.id === "case-landing-gear-2026-10-25")).toHaveLength(1);
    for (const old of before.operatingModel!.revisions.at(-1)!.data.nodes) {
      const changed = after.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === old.id)!;
      expect({ ...changed, referenceIds: old.referenceIds }).toEqual(old);
      expect(changed.referenceIds).toEqual(expect.arrayContaining(old.referenceIds));
    }
    expect(prepareCrewRoadmap(next, "owner")).toBe(next);
    const editableDoc = after.documents.find(d => d.title === crewRoadmapTitle)!;
    editableDoc.text += "\nСогласованное уточнение владельца";
    expect(prepareCrewRoadmap(next, "owner")).toBe(next);
  });
  it("saves traceable findings as unconfirmed, with responsibility and no phantom execution", () => {
    const model = readHypothesis(prepareCrewRoadmap(fixture(), "owner"), "new-country");
    for (const record of crewIntakeFindings) {
      const saved = model.elements.find(e => e.id === record.id)!;
      expect(saved.contentStatus).toBe("hypothesis");
      for (const key of ["benchmarkType", "provenance", "source", "sourceDate", "recheckedAt", "evidence", "proofStatus", "client", "accountable", "recipient", "nextStep", "unknown"] as const)
        expect(saved.details[key]?.length, `${record.id}.${key}`).toBeGreaterThan(2);
      expect(model.relations.some(r => r.from === record.id && r.to === "TH-PROBLEM")).toBe(true);
    }
    const data = model.operatingModel!.revisions.at(-1)!.data;
    for (const code of ["RM.W.VOC", "RM.W.LING", "RM.W.QUO"]) {
      const action = data.nodes.find(n => n.code === code)!;
      expect(action.executorId).toBeNull();
      expect(action.roleId).toBe("qualification-role");
      expect(data.links.some(l => l.from === action.id && l.kind === "produces")).toBe(true);
    }
    expect(model.taskDrafts).toHaveLength(0); // Research planning must not launch a development task.
  });
  it("separates pre-run acceptance design from post-run acceptance; all phases are visible", () => {
    const model = readHypothesis(prepareCrewRoadmap(fixture(), "owner"), "new-country");
    const data = model.operatingModel!.revisions.at(-1)!.data;
    for (let i = 0; i <= 6; i++) {
      const phase = data.nodes.find(n => n.code === `RM.${i}`)!;
      expect(phase.parentId).toBe(crewRoadmapId);
      expect(phase.description).toContain("Следующий конкретный шаг");
      expect(phase.success).not.toBe("");
    }
    expect(data.links.some(l => l.from === "crew-roadmap-phase-4" && l.to === "crew-pilot-acceptance-contract")).toBe(true);
    expect(data.links.some(l => l.from === "crew-roadmap-phase-4" && l.to === "crew-roadmap-phase-5")).toBe(false);
    expect(data.links.some(l => l.from === "crew-roadmap-phase-5" && l.to === "crew-roadmap-output-4" && l.kind === "depends_on")).toBe(true);
    const doc = model.documents.find(d => d.title === crewRoadmapTitle)!;
    expect(doc.text.length).toBeGreaterThan(15000);
    expect(doc.text.length).toBeLessThan(50000);
    for (const text of ["Не запущен", "SMS / MMS", "INFO-LG-QUO", "CrewAI-библиотека", "ручной документальный подцикл", "Продуктовая оценка"])
      expect(doc.text).toContain(text);
    for (const role of ["Ответственный за Twilio", "Менеджер продукта", "Бенчмаркинг", "Разработка", "QA", "Технический специалист", "Поддержка"])
      expect(doc.text).toContain(role);
  });
  it("refuses a fresh model instead of recreating the already-started case", () => {
    expect(() => prepareCrewRoadmap(initialModel(), "owner")).toThrow();
  });
});
