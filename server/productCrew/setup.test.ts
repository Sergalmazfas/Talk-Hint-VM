import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { readHypothesis } from "../projectModel/hypotheses";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel, emptyWorkNode } from "../../shared/operatingModelTemplate";
import { prepareProductCrewConnection, productCrewGuideTitle } from "./setup";
describe("technical responsibility and plugin guide", () => {
  it("assigns the existing engineering roles without claiming a remotely callable worker; preserves history", () => {
    const root = initialModel(), data = buildCompanyStructure(defaultOperatingModel());
    const head = data.nodes.find(n => n.id === "head-engineering")!;
    data.nodes.push({ ...emptyWorkNode("lg-technical-role", "P.LG.TECH", "Technical specialist", "role", head.parentId), managerId: head.id });
    data.nodes.push(emptyWorkNode("crew-product-roadmap", "ROADMAP.CREW", "Roadmap", "report", null));
    const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0, data }, "owner");
    root.alternatives = [{ id: "new-country", title: "New", model }, { id: "other", title: "Other", model: initialModel() }];
    const before = structuredClone(root), after = prepareProductCrewConnection(root, "owner", "https://crew.example.test");
    expect(root).toEqual(before); expect(after.elements).toEqual(before.elements); expect(after.alternatives![1]).toEqual(before.alternatives![1]);
    const updated = readHypothesis(after, "new-country"), v = updated.operatingModel!.revisions.at(-1)!;
    expect(v.data.nodes.find(n => n.id === "head-engineering")!.managerId).toBe(head.managerId);
    expect(v.data.nodes.find(n => n.id === "head-engineering")!.executorId).toBe("replit-current-dev-session");
    expect(v.data.nodes.find(n => n.id === "replit-current-dev-session")!.description).toContain("Фонового worker/API");
    expect(updated.documents.find(d => d.title === productCrewGuideTitle)!.text).toContain("https://crew.example.test/api/product-crew/mcp");
    expect(updated.operatingModel!.revisions.slice(0, -1)).toEqual(model.operatingModel!.revisions);
    expect(prepareProductCrewConnection(after, "owner", "https://crew.example.test")).toBe(after);
  });
});
