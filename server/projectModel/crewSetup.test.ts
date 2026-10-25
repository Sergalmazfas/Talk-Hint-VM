import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { refineT01 } from "./research/refineT01";
import { defineMkt1Result } from "./research/defineMkt1Result";
import { prepareLandingGearCase } from "./research/landingGearCase";
import { prepareCrewRoadmap } from "./research/crewRoadmap";
import { prepareCrewSetup, crewPositions, crewSetupTitle } from "./research/crewSetup";
import { crewRoadmapTitle } from "./research/crewRoadmapContent";
import { readHypothesis } from "./hypotheses";
function fixture() {
  const root = initialModel();
  const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  model.analystPreparation = { revisions: [] };
  root.alternatives = [{ id: "new-country", title: "New", model }, { id: "other", title: "Other", model: initialModel() }];
  return prepareCrewRoadmap(prepareLandingGearCase(defineMkt1Result(refineT01(root, "owner"), "owner"), "owner"), "owner");
}
describe("crew setup linked to one roadmap", () => {
  it("preserves previous documents, cases, other hypotheses and revisions; imports once", () => {
    const before = fixture(), snapshot = structuredClone(before), after = prepareCrewSetup(before, "owner");
    expect(before).toEqual(snapshot);
    expect(after.alternatives![1]).toEqual(before.alternatives![1]);
    expect(after.elements).toEqual(before.elements);
    const a = readHypothesis(before, "new-country"), b = readHypothesis(after, "new-country");
    expect(b.documents.slice(0, a.documents.length)).toEqual(a.documents);
    expect(b.documents.some(d => d.title === crewRoadmapTitle)).toBe(true);
    expect(b.operatingModel!.revisions.slice(0, -1)).toEqual(a.operatingModel!.revisions);
    expect(b.decisions.slice(0, a.decisions.length)).toEqual(a.decisions);
    const audit = b.decisions.at(-1)!.strategyChange!;
    expect(audit.after).toEqual({ operatingModelVersion: b.operatingModel!.revisions.at(-1)!.version });
    expect(b.operatingModel!.revisions.at(-1)!.data.nodes.length).toBeGreaterThan(a.operatingModel!.revisions.at(-1)!.data.nodes.length);
    expect(b.operatingModel!.revisions.at(-1)!.data.nodes.filter(n => n.id === "crew-product-roadmap")).toHaveLength(1);
    expect(prepareCrewSetup(after, "owner")).toBe(after);
  });
  it("reuses specialisms, attaches required rather than connected resources and fixes benchmarking ownership", () => {
    const m = readHypothesis(prepareCrewSetup(fixture(), "owner"), "new-country"), data = m.operatingModel!.revisions.at(-1)!.data;
    for (const p of crewPositions) {
      expect(data.nodes.filter(n => n.id === p.id)).toHaveLength(1);
      const resource = data.nodes.find(n => n.id === `resource-profile-${p.id}`)!;
      expect(resource.resourceState).toBe("required");
      expect(resource.procedure.length).toBeGreaterThan(20);
      expect(data.nodes.find(n => n.id === p.id)!.resourceIds).toContain(resource.id);
    }
    for (const n of data.nodes.filter(n => /^RM\.W\.(VOC|LING|QUO)$/.test(n.code))) {
      expect(n.roleId).toBe("benchmark-role-reference");
      expect(n.executorId).toBeNull();
    }
    expect(data.nodes.find(n => n.id === "qualification-role")!.managerId).toBe("head-market");
    const doc = m.documents.find(d => d.title === crewSetupTitle)!;
    expect(doc.text.length).toBeLessThan(50000);
    expect(doc.text).toContain("не реализованы и не установлены");
    expect(doc.text).toContain("не измеренное минимальное требование");
  });
});
