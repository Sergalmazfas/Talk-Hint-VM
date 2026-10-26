import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { readHypothesis } from "./hypotheses";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import type { WorkNode } from "../../shared/operatingModel";
import { actionChainGaps } from "../../shared/actionChainCoverage";
import { caReused, prepareCaliforniaAcquisition } from "./research/californiaAcquisition";
import { caActions, caActionId, caDirectorId, caDocumentId, caResultId, caRoles } from "./research/californiaAcquisitionSpec";
import { ProductCrewService } from "../productCrew/service";
import type { ModelRepository } from "./repository";

function fixture() {
  const root = initialModel(), model = initialModel(), nodes: WorkNode[] = [];
  const add = (id: string, kind: WorkNode["kind"], roleId: string | null = null) => {
    if (!nodes.some(n => n.id === id)) nodes.push({ ...emptyWorkNode(id, id, id, kind, null), roleId });
  };
  add("owner", "client");
  for (const id of ["dir-acquisition", "b2c", "campaigns", "budget", "product-hypotheses", "audience-research", "competitor-monitor", "churn-review", "crew-equipment", "development"]) add(id, "process", "head-acquisition");
  const newRoles = new Set<string>(caRoles.map(([id]) => id));
  for (const id of new Set([...caActions.map(s => s.role), "head-acquisition", "head-product", "ai-ceo"])) {
    if (!newRoles.has(id)) {
      add(id, "role");
      nodes.find(n => n.id === id)!.managerId = "owner";
    }
  }
  add("model-resource", "resource");
  for (const k of caActions.flatMap(s => s.inputs).filter(k => k.startsWith("@")))
    add(k.slice(1), "result", "head-acquisition");
  for (const [id] of caReused) {
    add(id, "action", "head-acquisition");
    Object.assign(nodes.find(n => n.id === id)!, { procedure: "Прежняя обязанность.", nextId: "owner" });
  }
  model.operatingModel = { revisions: [{ version: 19, at: new Date().toISOString(), actor: "owner", data: { nodes, links: [], stageReports: [] } }] };
  model.documents = [
    { id: "DOC-TALKHINT-PRODUCT-PASSPORT", title: "Книга v2", text: "Книга v2 неизменна.", url: "", elementIds: ["TH-PRODUCT"], updatedAt: "2026-10-26" },
    { id: "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d", title: "Единый roadmap v12", text: "Предыдущие этапы.", url: "", elementIds: ["TH-PRODUCT"], updatedAt: "2026-10-26" },
  ];
  root.alternatives = [{ id: "new-country", title: "TalkHint", model }, { id: "other", title: "Иная гипотеза", model: initialModel() }];
  return root;
}
describe("California B2C planning cycle", () => {
  it("persists one linked chain, with every action contract, no execution or implied budget approval", () => {
    const before = fixture(), saved = prepareCaliforniaAcquisition(before, "owner"), model = readHypothesis(saved, "new-country");
    const data = model.operatingModel!.revisions.at(-1)!.data;
    const selected = new Set(caActions.map(s => caActionId(s.key)));
    expect(actionChainGaps(data, selected)).toEqual([]);
    for (const s of caActions) {
      const a = data.nodes.find(n => n.id === caActionId(s.key))!;
      expect(a.executorId).toBeNull();
      expect(a.roleId).toBe(s.role);
      expect(a.inputs.length).toBeGreaterThan(0);
      expect(a.reporting?.formStatus).toBe("required");
      expect(a.reporting?.templateDocumentId).toBeNull();
      expect(a.register?.operationsPerPeriod).toBeNull();
      expect(a.register?.minutesPerOperation).toBeNull();
      expect(a.register?.approval).toBe("discussion");
      expect(a.schedule.deadline).toContain("не согласован");
      expect(a.constraints).toContain("нет запуска");
      expect(data.links.some(l => l.from === caResultId(s.key) && l.to === a.nextId && l.kind === "handoff")).toBe(true);
    }
    expect(data.nodes.find(n => n.id === caDirectorId)).toMatchObject({ status: "proposal", managerId: "head-acquisition", executorId: null });
    expect(data.nodes.filter(n => n.id.startsWith("ca-b2c-resource-")).every(n => n.resourceState === "required")).toBe(true);
    expect(model.documents.find(d => d.id === caDocumentId)!.text).toContain("100 подписок — пример");
    expect(model.documents.find(d => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT")).toEqual(before.alternatives![0].model.documents[0]);
    expect(saved.alternatives![1]).toEqual(before.alternatives![1]);
    expect(saved.elements).toEqual(before.elements);
    expect(model.operatingModel!.revisions[0]).toEqual(before.alternatives![0].model.operatingModel!.revisions[0]);
    expect(prepareCaliforniaAcquisition(saved, "owner")).toBe(saved);
  });
  it("reuses aggregate actions and preserves their IDs, previous duties and next steps", () => {
    const model = readHypothesis(prepareCaliforniaAcquisition(fixture(), "owner"), "new-country");
    const data = model.operatingModel!.revisions.at(-1)!.data;
    for (const [id, from] of caReused) {
      expect(data.nodes.filter(n => n.id === id)).toHaveLength(1);
      const n = data.nodes.find(n => n.id === id)!;
      expect(n.procedure).toContain("Прежняя обязанность.");
      expect(n.nextId).toBe("owner");
      expect(n.inputs.some(i => i.sourceId === caResultId(from))).toBe(true);
    }
    expect(new Set(data.nodes.map(n => n.code)).size).toBe(data.nodes.length);
    expect(new Set(data.links.map(l => `${l.from}/${l.to}/${l.kind}`)).size).toBe(data.links.length);
  });
  it("rejects another namespace, missing prerequisites and ambiguous role identities", () => {
    expect(() => prepareCaliforniaAcquisition(initialModel(), "other-owner")).toThrow();
    const root = fixture();
    root.alternatives![0].model.operatingModel!.revisions[0].data.nodes.push(emptyWorkNode("another-director", "P.ACQ.CA", "Already present", "role", null));
    expect(() => prepareCaliforniaAcquisition(root, "owner")).toThrow("reconciliation");
    expect(root.alternatives![0].model.documents).toHaveLength(2);
  });
  it("exposes the same saved contracts through existing MCP reads without crossing owner scope", async () => {
    const root = prepareCaliforniaAcquisition(fixture(), "owner");
    const model = readHypothesis(root, "new-country");
    const repo = { read: async (owner: string, hypothesis: string) => {
      if (owner !== "owner" || hypothesis !== "new-country") return initialModel();
      return model;
    } } as ModelRepository;
    const service = new ProductCrewService(repo);
    const roadmap = await service.call("owner", "get_roadmap", {});
    const rows = roadmap.actionRegister.filter((a: { id: string }) => a.id.startsWith("ca-b2c-action-"));
    expect(rows).toHaveLength(caActions.length);
    expect(rows.every((a: { controllerIds: string[] }) => a.controllerIds.length > 0)).toBe(true);
    expect(roadmap.workers.autonomous).toBe(false);
    const doc = await service.call("owner", "get_document", { documentId: caDocumentId });
    expect(doc.text).toBe(model.documents.find(d => d.id === caDocumentId)!.text);
    const team = await service.call("owner", "get_team", {});
    expect(JSON.stringify(team)).toContain(caDirectorId);
    await expect(service.call("other-owner", "get_document", { documentId: caDocumentId })).rejects.toThrow();
  });
});
