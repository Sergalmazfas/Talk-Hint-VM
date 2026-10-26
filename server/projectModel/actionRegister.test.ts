import { describe, it, expect } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { refineT01 } from "./research/refineT01";
import { defineMkt1Result } from "./research/defineMkt1Result";
import { prepareLandingGearCase } from "./research/landingGearCase";
import { prepareCrewRoadmap } from "./research/crewRoadmap";
import { prepareCrewSetup } from "./research/crewSetup";
import { prepareStructureFirst } from "./research/structureFirst";
import { prepareActionRegister, registerRoadmapTitle } from "./research/actionRegister";
import { readHypothesis } from "./hypotheses";
import { actionDirection, actionOutputs, effortMinutes } from "../../shared/actionRegister";
import { saveOperatingModelSchema } from "./operatingModel";
import { ProductCrewService } from "../productCrew/service";
import type { ModelRepository } from "./repository";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ActionRegister from "../../client/src/components/project-model/ActionRegister";
function fixture() {
  const root = initialModel();
  const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  model.analystPreparation = { revisions: [] };
  root.alternatives = [{ id: "new-country", title: "New", model }, { id: "other", title: "Other", model: initialModel() }];
  return prepareStructureFirst(prepareCrewSetup(prepareCrewRoadmap(prepareLandingGearCase(
    defineMkt1Result(refineT01(root, "owner"), "owner"), "owner"), "owner"), "owner"), "owner");
}
describe("single company action register", () => {
  it("exposes the same register and next action to ChatGPT, and renders the responsive register without fabricated estimates", async () => {
    const m = readHypothesis(prepareActionRegister(fixture(), "owner", "2026-10-26"), "new-country");
    const service = new ProductCrewService({ read: async () => m } as ModelRepository);
    const roadmap = await service.call("owner", "get_roadmap", {});
    expect(roadmap.next).toContain("MKT.2.1");
    expect(roadmap.actionRegister.find((n: any) => n.id === "company-action-scan").estimatedMinutes).toBeNull();
    const team = await service.call("owner", "get_team", { roleId: "benchmark-role-reference" });
    expect(team.roles[0].linkedWork.filter((n: any) => n.id.startsWith("company-action-"))).toHaveLength(6);
    const html = renderToStaticMarkup(React.createElement(ActionRegister, {
      data: m.operatingModel!.revisions.at(-1)!.data, search: "MKT.2.", selectedId: null, onSelect() {},
    }));
    expect(html).toContain("Реестр действий");
    expect(html).toContain("Предложения Replit с причиной");
    expect(html).toContain("MKT.2.1");
    expect(html).toContain("om-action-mobile-list");
    expect(html).toContain("Не оценено");
  });
  it("preserves previous identities, history, roles and other hypotheses, updates only the existing roadmap and is idempotent", () => {
    const root = fixture(), snapshot = structuredClone(root), next = prepareActionRegister(root, "owner", "2026-10-26");
    expect(root).toEqual(snapshot);
    expect(next.alternatives![1]).toEqual(root.alternatives![1]);
    expect(next.elements).toEqual(root.elements);
    const a = readHypothesis(root, "new-country"), b = readHypothesis(next, "new-country");
    expect(b.documents).toHaveLength(a.documents.length);
    const doc = b.documents.find(d => d.title === registerRoadmapTitle)!;
    expect(a.documents.some(d => d.id === doc.id)).toBe(true);
    expect(doc.text.length).toBeLessThanOrEqual(50000);
    expect(b.operatingModel!.revisions.slice(0, -1)).toEqual(a.operatingModel!.revisions);
    const before = a.operatingModel!.revisions.at(-1)!.data, after = b.operatingModel!.revisions.at(-1)!.data;
    for (const n of before.nodes.filter(n => !["crew-product-roadmap", "crew-roadmap-phase-2"].includes(n.id)))
      expect(after.nodes.find(x => x.id === n.id)).toEqual(n);
    expect(after.nodes.filter(n => n.kind === "role")).toEqual(before.nodes.filter(n => n.kind === "role"));
    expect(prepareActionRegister(next, "owner", "2027-01-01")).toBe(next);
  });
  it("keeps six benchmark duties and two explicitly reasoned suggestions proposed, with alternative independent incoming routes", () => {
    const b = readHypothesis(prepareActionRegister(fixture(), "owner", "2026-10-26"), "new-country");
    const data = b.operatingModel!.revisions.at(-1)!.data;
    const fresh = data.nodes.filter(n => n.kind === "action" && n.id.startsWith("company-action-"));
    expect(fresh).toHaveLength(8);
    for (const n of fresh) {
      expect(n.status).toBe("proposal");
      expect(n.executorId).toBeNull();
      expect(n.register!.approval).not.toBe("approved");
      expect(n.register!.operationsPerPeriod).toBeNull();
      expect(n.register!.minutesPerOperation).toBeNull();
      expect(effortMinutes(n)).toBeNull();
      expect(actionOutputs(data, n.id)).toHaveLength(1);
      expect(actionDirection(data, n)?.code).toBeTruthy();
    }
    expect(fresh.filter(n => n.roleId === "benchmark-role-reference")).toHaveLength(6);
    expect(fresh.filter(n => n.register?.proposalReason)).toHaveLength(2);
    const product = data.nodes.find(n => n.id === "company-action-product")!;
    expect(product.inputs).toHaveLength(2);
    expect(product.procedure).toContain("Входы альтернативные");
    expect(data.nodes.find(n => n.id === "company-action-verify")!.description).toContain("Не доказаны одновременная");
    expect(data.nodes.find(n => n.id === "crew-product-roadmap")!.nextId).toBe("company-action-scan");
  });
  it("round-trips optional estimates, validates nonnegative finite numbers, and distinguishes unknown from a real zero estimate", () => {
    const data = defaultOperatingModel(), node = data.nodes.find(n => n.kind === "action")!;
    expect(effortMinutes(node)).toBeNull();
    node.register = { availability: "", period: "неделя", operationsPerPeriod: 3, minutesPerOperation: 10,
      estimateBasis: "Предположение, не измерение", approval: "discussion", source: "owner proposal", proposalReason: "" };
    const parsed = saveOperatingModelSchema.parse({ type: "saveOperatingModel", baseVersion: 0, data });
    expect(parsed.data.nodes.find(n => n.id === node.id)?.register).toEqual(node.register);
    expect(effortMinutes(node)).toBe(30);
    node.register.operationsPerPeriod = 0;
    expect(effortMinutes(node)).toBe(0);
    node.register.period = "";
    expect(effortMinutes(node)).toBeNull();
    node.register.operationsPerPeriod = -1;
    expect(saveOperatingModelSchema.safeParse({ type: "saveOperatingModel", baseVersion: 0, data }).success).toBe(false);
  });
});
