import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { refineT01 } from "./research/refineT01";
import { defineMkt1Result } from "./research/defineMkt1Result";
import { prepareLandingGearCase } from "./research/landingGearCase";
import { prepareCrewRoadmap } from "./research/crewRoadmap";
import { prepareCrewSetup, crewSetupTitle } from "./research/crewSetup";
import { readHypothesis } from "./hypotheses";
import { prepareStructureFirst } from "./research/structureFirst";
import { descriptionMissing, structureFirstTitle, technicalScope } from "./research/structureFirstContent";
function fixture() {
  const root = initialModel();
  const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  model.analystPreparation = { revisions: [] };
  root.alternatives = [{ id: "new-country", title: "New", model }, { id: "other", title: "Other", model: initialModel() }];
  return prepareCrewSetup(prepareCrewRoadmap(prepareLandingGearCase(defineMkt1Result(refineT01(root, "owner"), "owner"), "owner"), "owner"), "owner");
}
describe("structure first in the existing roadmap", () => {
  it("updates one existing document, preserves identities, prior content/history and other hypotheses", () => {
    const root = fixture(), snapshot = structuredClone(root);
    const before = readHypothesis(root, "new-country");
    const next = prepareStructureFirst(root, "owner");
    const after = readHypothesis(next, "new-country");
    expect(root).toEqual(snapshot);
    expect(next.elements).toEqual(root.elements);
    expect(next.alternatives![1]).toEqual(root.alternatives![1]);
    expect(after.documents).toHaveLength(before.documents.length);
    const oldDoc = before.documents.find(d => d.title === crewSetupTitle)!;
    const doc = after.documents.find(d => d.title === structureFirstTitle)!;
    expect(doc.id).toBe(oldDoc.id);
    expect(doc.text.length).toBeLessThanOrEqual(50000);
    expect(after.decisions.some(d => d.documentBefore?.id === oldDoc.id && d.documentBefore.text === oldDoc.text)).toBe(true);
    expect(after.operatingModel!.revisions.slice(0, -1)).toEqual(before.operatingModel!.revisions);
    const a = after.operatingModel!.revisions.at(-1)!.data, b = before.operatingModel!.revisions.at(-1)!.data;
    expect(a.nodes.map(n => n.id)).toEqual(b.nodes.map(n => n.id));
    expect(prepareStructureFirst(next, "owner")).toBe(next);
  });
  it("covers ten directions, leadership, customer path and all technical specialisations without approval or launch", () => {
    const m = readHypothesis(prepareStructureFirst(fixture(), "owner"), "new-country");
    const d = m.operatingModel!.revisions.at(-1)!.data;
    const text = m.documents.find(d => d.title === structureFirstTitle)!.text;
    for (const n of d.nodes.filter(n => n.level === "direction" || n.level === "operation" || n.kind === "role"))
      expect(text).toContain(n.id);
    for (const [name] of technicalScope) expect(text).toContain(name);
    for (const s of d.customerPath!) expect(text).toContain(s.name);
    expect(d.nodes.find(n => n.id === "crew-roadmap-phase-4")!.description).toContain("Отложен");
    expect(d.links.some(l => l.from === "crew-roadmap-phase-4" && l.to === "crew-roadmap-output-5" && l.kind === "depends_on")).toBe(true);
    expect(d.nodes.find(n => n.id === "crew-product-roadmap")!.nextId).toBe("criteria");
  });
  it("prepares only the first action and result, keeps B2B separate, and ignores absent live executors for description readiness", () => {
    const root = fixture(), before = readHypothesis(root, "new-country").operatingModel!.revisions.at(-1)!.data;
    const m = readHypothesis(prepareStructureFirst(root, "owner"), "new-country");
    const d = m.operatingModel!.revisions.at(-1)!.data;
    const card = d.nodes.find(n => n.id === "criteria")!;
    expect(card.status).toBe("proposal");
    expect(descriptionMissing({ ...card, executorId: null })).toEqual([]);
    expect(card.questions).toContain("или другую");
    expect(card.acceptorId).toBe("owner");
    expect(card.roleId).toBe("research-role");
    expect(card.nextId).toBe("discover");
    for (const id of ["business-search", "discover", "qualify", "review"]) {
      expect(d.nodes.find(n => n.id === id)).toEqual(before.nodes.find(n => n.id === id));
    }
  });
});
