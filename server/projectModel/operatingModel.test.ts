import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { applyHypothesisCommand } from "./hypotheses";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { workGaps } from "../../shared/operatingModel";
import { prepareOperatingModel } from "./research/prepareOperatingModel";
const command = () => ({ type: "saveOperatingModel" as const, baseVersion: 0, data: defaultOperatingModel() });
describe("action-derived organisation", () => {
  it("persists immutable versions, exact retries and code changes keep links", () => {
    const old = initialModel(), before = structuredClone(old), c = command();
    const one = applyCommand(old, c, "owner");
    expect(old).toEqual(before);
    expect(one.elements).toEqual(old.elements);
    expect(one.strategy).toEqual(old.strategy);
    const data = structuredClone(one.operatingModel!.revisions[0].data);
    expect(applyCommand(one, { ...c, baseVersion: 1, data }, "owner")).toBe(one);
    data.nodes.find(n => n.id === "criteria")!.code = "NEW-100";
    const two = applyCommand(one, { ...c, baseVersion: 1, data }, "owner");
    expect(two.operatingModel!.revisions).toHaveLength(2);
    expect(two.operatingModel!.revisions[0].data.nodes.find(n => n.id === "criteria")!.code).toBe("B2C.1.1");
    expect(two.operatingModel!.revisions[1].data.links).toEqual(c.data.links);
    expect(() => applyCommand(two, { ...c, baseVersion: 1 }, "owner")).toThrow(/уже изменена/);
  });
  it("rejects foreign refs, duplicate codes, hierarchy cycles and actor spoofing", () => {
    for (const mutate of [
      (c: ReturnType<typeof command>) => { c.data.nodes[0].clientId = "foreign-owner"; },
      (c: ReturnType<typeof command>) => { c.data.nodes[0].referenceIds = ["other-hypothesis"]; },
      (c: ReturnType<typeof command>) => { c.data.nodes[0].code = c.data.nodes[1].code; },
      (c: ReturnType<typeof command>) => { c.data.nodes[0].parentId = "b2c"; },
      (c: ReturnType<typeof command>) => { c.data.nodes[0].schedule.timezone = "Bad/Zone"; },
    ]) { const c = command(); mutate(c); expect(() => applyCommand(initialModel(), c, "owner")).toThrow(); }
    expect(() => applyCommand(initialModel(), { ...command(), actor: "spoof" } as any, "owner")).toThrow();
  });
  it("rejects original writes and preserves root, old hypothesis and preparation", () => {
    const root = initialModel(); root.alternatives = [{ id: "new-country", title: "new", model: initialModel() }];
    expect(() => applyHypothesisCommand(root, "original", command(), "owner")).toThrow();
    const updated = applyHypothesisCommand(root, "new-country", command(), "owner");
    expect(updated.elements).toEqual(root.elements);
    expect(updated.alternatives![0].model.operatingModel!.revisions).toHaveLength(1);
    expect(root.alternatives[0].model.operatingModel).toBeUndefined();
  });
  it("finds incomplete inputs, acceptance, responsibility and resources without running anything", () => {
    const data = defaultOperatingModel();
    expect(workGaps(data).some(g => g.message.includes("Вход без источника"))).toBe(true);
    expect(workGaps(data).some(g => g.message === "Нет ответственной должности")).toBe(true);
    expect(workGaps(data).some(g => g.message === "Ресурс не подключён")).toBe(true);
    expect(new Set(data.links.map(l => l.kind))).toEqual(new Set(["handoff", "produces", "acceptance", "return", "escalation", "accountable_to", "depends_on"]));
    expect(data.nodes.filter(n => n.kind === "crew")).toHaveLength(3);
  });
  it("explicit preparation preserves all unrelated content and never overwrites a saved draft", () => {
    const root = initialModel();
    root.alternatives = [{ id: "new-country", title: "new", model: initialModel() }];
    const next = prepareOperatingModel(root, "owner");
    expect(prepareOperatingModel(next, "owner")).toBe(next);
    expect(next.elements).toEqual(root.elements);
    expect(next.alternatives![0].model.documents).toEqual(root.alternatives[0].model.documents);
    expect(next.alternatives![0].model.competitorDirectory).toEqual(root.alternatives[0].model.competitorDirectory);
  });
});
