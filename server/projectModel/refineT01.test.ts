import { describe, it, expect } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { refineT01 } from "./research/refineT01";
import { companyCoverage } from "../../shared/operatingModel";
function fixture() {
  const root = initialModel();
  root.alternatives = [
    { id: "new-country", title: "New", model: applyCommand(initialModel(), {
      type: "saveOperatingModel", baseVersion: 0, data: buildCompanyStructure(defaultOperatingModel()),
    }, "owner") },
    { id: "untouched", title: "Other", model: initialModel() },
  ];
  return root;
}
describe("approved T01 correction", () => {
  it("makes B2C/B2B siblings without changing IDs, codes, mini-actions, old links or history", () => {
    const root = fixture(), snapshot = structuredClone(root), next = refineT01(root, "owner");
    const before = root.alternatives![0].model.operatingModel!.revisions[0];
    const revisions = next.alternatives![0].model.operatingModel!.revisions, data = revisions.at(-1)!.data;
    expect(root).toEqual(snapshot); expect(revisions[0]).toEqual(before); expect(revisions).toHaveLength(2);
    const get = (id: string) => data.nodes.find(n => n.id === id)!;
    expect(get("search").name).toBe("Исследование аудитории и потребностей");
    expect(get("search").code).toBe("B2C.1");
    expect(get("search").parentId).toBe("audience-research");
    expect(get("business-search").parentId).toBe("audience-research");
    expect(data.nodes.filter(n => n.parentId === "dir-market" && n.level === "operation")).toHaveLength(3);
    expect(data.nodes.filter(n => n.level === "operation")).toHaveLength(33);
    for (const id of ["criteria", "discover", "qualify", "review", "benchmark-role-reference"])
      expect(get(id)).toEqual(before.data.nodes.find(n => n.id === id));
    expect(data.links).toEqual(expect.arrayContaining(before.data.links));
    expect(next.alternatives![1]).toEqual(root.alternatives![1]);
    expect(next.elements).toEqual(root.elements);
    expect(companyCoverage(data)).toEqual([]);
    expect(refineT01(next, "owner")).toBe(next);
  });
  it("uses the existing three outputs and records all customers without claiming completed research or powers", () => {
    const data = refineT01(fixture(), "owner").alternatives![0].model.operatingModel!.revisions.at(-1)!.data;
    const get = (id: string) => data.nodes.find(n => n.id === id)!;
    expect(get("decision").name).toBe("Потребности и сегменты с основаниями");
    expect(get("out-competitor-monitor").name).toBe("Проверенные изменения и сравнение конкурентов");
    expect(get("out-offer-development").name).toBe("Варианты предложения и план проверки");
    for (const [id, customers] of [["decision", ["dir-acquisition", "dir-product"]],
      ["out-competitor-monitor", ["dir-acquisition", "dir-product", "dir-finance"]],
      ["out-offer-development", ["offer-decision-customer"]]] as const)
      for (const to of customers) expect(data.links.some(l => l.from === id && l.to === to && l.kind === "handoff")).toBe(true);
    expect(get("offer-decision-customer").questions).toContain("согласовать");
  });
  it("rejects conflicting saved identities rather than duplicating or overwriting", () => {
    const root = fixture();
    root.alternatives![0].model.operatingModel!.revisions[0].data.nodes[0].code = "MKT.1";
    expect(() => refineT01(root, "owner")).toThrow("collision");
  });
});
