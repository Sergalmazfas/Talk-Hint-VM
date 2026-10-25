import { describe, it, expect } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { refineT01 } from "./research/refineT01";
import { defineMkt1Result } from "./research/defineMkt1Result";

function fixture() {
  const root = initialModel();
  root.alternatives = [{ id: "new-country", title: "New", model: applyCommand(initialModel(), {
    type: "saveOperatingModel", baseVersion: 0, data: buildCompanyStructure(defaultOperatingModel()),
  }, "owner") }, { id: "other", title: "Other", model: initialModel() }];
  return refineT01(root, "owner");
}
describe("MKT.1 result standard", () => {
  it("saves the eight-part standard once on the existing result with all acceptance and delivery rules", () => {
    const root = fixture(), snapshot = structuredClone(root), next = defineMkt1Result(root, "owner");
    expect(root).toEqual(snapshot);
    const old = root.alternatives![0].model.operatingModel!.revisions;
    const revisions = next.alternatives![0].model.operatingModel!.revisions;
    expect(revisions.slice(0, -1)).toEqual(old);
    const data = revisions.at(-1)!.data, result = data.nodes.find(n => n.id === "decision")!;
    for (const label of ["Сегмент", "Задача клиента", "Проблема", "Нынешнее решение",
      "Основания", "Связь с TalkHint", "Неизвестное", "Предложение следующей проверки"]) expect(result.description).toContain(label);
    expect(result.rules).toContain("пользователя, покупателя и принимающего решение");
    expect(result.rules).toContain("заполняются отдельно");
    expect(result.success).toContain("при недостатке доказательств");
    expect(result.success).toContain("не означает доказанность");
    for (const to of ["Маркетингу", "Продукту", "На стратегическое рассмотрение"]) expect(result.delivery).toContain(to);
    expect(data.nodes).toHaveLength(old.at(-1)!.data.nodes.length);
    expect(data.links).toEqual(expect.arrayContaining(old.at(-1)!.data.links));
    expect(data.links.some(l => l.from === "decision" && l.to === "strategy-review" && l.kind === "feedback")).toBe(true);
    expect(next.alternatives![1]).toEqual(root.alternatives![1]); expect(next.elements).toEqual(root.elements);
    expect(defineMkt1Result(next, "owner")).toBe(next);
  });
  it("preserves all actions, role assignments, resources and schedules", () => {
    const root = fixture(), next = defineMkt1Result(root, "owner");
    const old = root.alternatives![0].model.operatingModel!.revisions.at(-1)!.data;
    const data = next.alternatives![0].model.operatingModel!.revisions.at(-1)!.data;
    for (const node of old.nodes.filter(n => !["decision", "audience-research"].includes(n.id)))
      expect(data.nodes.find(n => n.id === node.id)).toEqual(node);
  });
  it("refuses to overwrite intervening owner edits", () => {
    const root = fixture();
    root.alternatives![0].model.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === "decision")!.description = "Owner draft";
    expect(() => defineMkt1Result(root, "owner")).toThrow("owner edits");
  });
});
