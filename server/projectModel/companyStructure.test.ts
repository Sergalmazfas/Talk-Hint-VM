import { describe, expect, it } from "vitest";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { companyCoverage } from "../../shared/operatingModel";
import { initialModel } from "./seed";
import { applyCommand, ModelError } from "./domain";
import { expandCompanyStructure } from "./research/expandCompanyStructure";
const makeRoot = () => {
  const root = initialModel();
  const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0, data: defaultOperatingModel() }, "owner");
  root.alternatives = [{ id: "new-country", title: "new", model }];
  return root;
};
describe("whole upper company structure", () => {
  it("has three upper levels, ten directions and substantive proposed processes without losing prior work", () => {
    const before = defaultOperatingModel(), snapshot = structuredClone(before), data = buildCompanyStructure(before);
    expect(before).toEqual(snapshot);
    expect(data.nodes.filter(n => n.level === "strategy")).toHaveLength(1);
    expect(data.nodes.filter(n => n.level === "direction")).toHaveLength(10);
    expect(data.nodes.filter(n => n.level === "operation").length).toBeGreaterThan(30);
    expect(companyCoverage(data)).toEqual([]);
    for (const n of before.nodes) {
      const after = data.nodes.find(row => row.id === n.id)!;
      expect(after.code).toBe(n.code); expect(after.name).toBe(n.name);
    }
    expect(data.links).toEqual(expect.arrayContaining(before.links));
    for (const id of ["criteria", "discover", "qualify", "review"])
      expect(data.nodes.find(n => n.id === id)).toEqual(before.nodes.find(n => n.id === id));
    expect(data.nodes.find(n => n.id === "search")!.parentId).toBe("dir-market");
    expect(data.nodes.find(n => n.id === "b2c")!.parentId).toBe("dir-acquisition");
    expect(data.nodes.some(n => n.id === "out-search")).toBe(false);
    expect(buildCompanyStructure(data)).toBe(data);
  });
  it("separates supervision from handoffs, covers conditional payment, B2B, finance and feedback", () => {
    const data = buildCompanyStructure(defaultOperatingModel());
    for (const n of data.nodes.filter(n => n.kind === "role")) expect(n.managerId).toBeTruthy();
    expect(data.nodes.find(n => n.id === "ai-ceo")!.managerId).toBe("owner");
    expect(data.nodes.find(n => n.id === "discovery-role")!.managerId).toBe("head-market");
    expect(data.customerPath).toHaveLength(9);
    expect(data.customerPath!.every(s => s.b2c && s.b2b)).toBe(true);
    const has = (from: string, to: string, kind: string) => data.links.some(l => l.from === from && l.to === to && l.kind === kind);
    expect(has("onboarding", "task-service", "handoff")).toBe(true);
    expect(has("b2b", "intake", "handoff")).toBe(true);
    expect(has("campaigns", "finance-reconcile", "finance_event")).toBe(true);
    expect(has("churn-review", "finance-reconcile", "finance_event")).toBe(true);
    for (const s of data.customerPath!) expect(has(s.processId, "finance-reconcile", "finance_event")).toBe(true);
    for (const id of ["support-intake", "usage-accounting", "budget", "competitor-monitor"])
      expect(has(id, "strategy-review", "feedback")).toBe(true);
    expect(data.nodes.filter(n => n.kind === "department").every(n => !n.workNature)).toBe(true);
  });
  it("saves compatible history, protects old hypotheses and is idempotent", () => {
    const root = makeRoot(), old = structuredClone(root);
    const next = expandCompanyStructure(root, "owner");
    expect(root).toEqual(old);
    expect(next.elements).toEqual(root.elements);
    expect(next.alternatives![0].model.operatingModel!.revisions).toHaveLength(2);
    expect(next.alternatives![0].model.operatingModel!.revisions[0]).toEqual(root.alternatives![0].model.operatingModel!.revisions[0]);
    expect(expandCompanyStructure(next, "owner")).toBe(next);
  });
  it("rejects management cycles, missing managers, foreign references and invalid journey processes", () => {
    const old = initialModel();
    const base = buildCompanyStructure(defaultOperatingModel());
    for (const mutate of [
      (d: typeof base) => { d.nodes.find(n => n.id === "ai-ceo")!.managerId = "head-market"; },
      (d: typeof base) => { delete d.nodes.find(n => n.id === "research-role")!.managerId; },
      (d: typeof base) => { d.nodes.find(n => n.id === "ai-ceo")!.managerId = "foreign-owner"; },
      (d: typeof base) => { d.customerPath![0].processId = "ai-ceo"; },
      (d: typeof base) => { d.nodes.find(n => n.id === "dir-market")!.workNature = "deterministic"; },
    ]) {
      const data = structuredClone(base); mutate(data);
      expect(() => applyCommand(old, { type: "saveOperatingModel", baseVersion: 0, data }, "owner")).toThrow(ModelError);
    }
  });
});
