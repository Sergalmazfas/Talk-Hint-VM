import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import { refinePbench, finishPbenchHandoff, pbenchRequests, pbenchRoadmap } from "./research/pbenchRefinement";
import { analystActions, dutyMapping, pbenchDocs, pbenchRole } from "./research/pbenchRefinementSpec";
import { actionChainGaps } from "../../shared/actionChainCoverage";
import { readHypothesis } from "./hypotheses";
import type { OperatingData } from "../../shared/operatingModel";
import { ProductCrewService } from "../productCrew/service";
import type { ModelRepository } from "./repository";

function fixture() {
  const root = initialModel(), m = initialModel();
  const data: OperatingData = { nodes: [], links: [], stageReports: [] };
  const add = (id: string, kind: "action" | "role" | "resource" | "process" | "result" | "client" = "action") => {
    if (!data.nodes.some(n => n.id === id)) data.nodes.push(emptyWorkNode(id, id, id, kind, null));
    return data.nodes.find(n => n.id === id)!;
  };
  for (const id of ["head-product", "head-market", "head-engineering", "head-finance", "lg-technical-role", "product-manager-specialist", pbenchRole]) add(id, "role");
  add("owner", "client"); add("competitor-monitor", "process");
  for (const id of ["model-resource", "search-resource", "resource-profile-benchmark-role-reference", "benchmark-resource-stores"]) {
    const n = add(id, "resource"); n.resourceState = "required";
  }
  for (const id of ["company-action-product", "company-action-product-sufficiency", "company-action-product-notify",
    "company-action-weekly-receive", "company-action-product-reference", "company-action-list-review",
    "company-action-monthly-prepare", "benchmark-ready-storage", "management-action-economics", "crew-product-roadmap"]) {
    const n = add(id); n.roleId = "head-product";
  }
  for (const id of ["company-action-product-reference-result", "company-action-criteria-result"]) {
    add(id, "result").roleId = "head-product";
  }
  for (const spec of analystActions) {
    const n = add(spec.id);
    Object.assign(n, { code: spec.code, roleId: pbenchRole, clientId: "product-manager-specialist",
      acceptorId: "product-manager-specialist", nextId: "company-action-product",
      inputs: [{ name: "База", sourceId: "company-action-product-reference-result", freshness: "Проверить версию" }] });
    const r = add(spec.id + "-result", "result"); r.roleId = pbenchRole; r.recipientId = "product-manager-specialist";
    data.links.push({ id: spec.id + ":out", from: n.id, to: r.id, kind: "produces", reason: "existing" });
  }
  m.operatingModel = { revisions: [{ version: 20, actor: "owner", at: "2026-10-26T00:00:00Z", data }] };
  m.analystPreparation = { revisions: [{ version: 3, actor: "owner", at: "2026-10-26T00:00:00Z",
    status: "awaiting_approval", basisVersions: [], data: {
      passport: { purpose: "Existing", duties: "Existing", inputs: "Existing", outputs: "Existing", frequency: "Existing", quality: "Existing", handoff: "Existing" },
      limits: { maxMinutes: 10, maxSources: 6, maxSearches: 3, maxAttempts: 2, maxOutputTokens: 4000, maxEstimatedUsd: 1, maxVideoSeconds: 180 },
      sources: [], pilot: { competitorId: null, sourceIds: [], questions: "Unknown", rationale: "Not approved" },
      approvalNotes: "Pending", toolResearchVersion: "2026-10-25",
    } }] };
  for (const [id, title] of [[pbenchRoadmap, "Roadmap v13"], ["DOC-BENCHMARK-OWNERSHIP-HANDOFF", "Ownership v1"], ["DOC-TALKHINT-PRODUCT-PASSPORT", "Book v2"]])
    m.documents.push({ id, title, text: "Existing material", url: "/admin/project-model", updatedAt: "2026-10-26T00:00:00Z", elementIds: ["TH-PRODUCT"] });
  root.alternatives = [{ id: "new-country", title: "New", model: m }, { id: "other", title: "Other", model: initialModel() }];
  return root;
}
describe("P-BENCH content refinement without execution or duplicate catalogues", () => {
  it("maps sixteen duties to all eighteen existing actions and retains ownership/identity/history", () => {
    const before = fixture(), old = readHypothesis(before, "new-country");
    const saved = refinePbench(before, "owner"), m = readHypothesis(saved, "new-country");
    const d = m.operatingModel!.revisions.at(-1)!.data;
    expect(dutyMapping).toHaveLength(16);
    expect(d.nodes.filter(n => n.kind === "action" && n.roleId === pbenchRole).map(n => n.id))
      .toEqual(analystActions.map(s => s.id));
    expect(m.operatingModel!.revisions.slice(0, -1)).toEqual(old.operatingModel!.revisions);
    expect(m.analystPreparation!.revisions.slice(0, -1)).toEqual(old.analystPreparation!.revisions);
    expect(m.analystPreparation!.revisions.at(-1)!.version).toBe(4);
    expect(m.analystPreparation!.revisions.at(-1)!.data.limits).toEqual(old.analystPreparation!.revisions.at(-1)!.data.limits);
    expect(saved.alternatives![1]).toEqual(before.alternatives![1]);
    expect(saved.elements).toEqual(before.elements);
    expect(m.documents.find(d => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT")).toEqual(old.documents.find(d => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT"));
    expect(refinePbench(saved, "owner")).toBe(saved);
  });
  it("describes contracts and paired receivers without accepting any result or giving resources", () => {
    const m = readHypothesis(refinePbench(fixture(), "owner"), "new-country"), d = m.operatingModel!.revisions.at(-1)!.data;
    expect(actionChainGaps(d, new Set(analystActions.map(s => s.id)))).toEqual([]);
    for (const s of analystActions) {
      const n = d.nodes.find(n => n.id === s.id)!;
      expect(n.schedule.deadline).toContain("не согласован");
      expect(n.procedure).toContain("Необходимые данные");
      expect(n.reporting!.templateDocumentId).toBeTruthy();
      expect(n.executorId).toBeNull();
    }
    expect(d.nodes.filter(n => n.kind === "resource" && n.resourceState === "connected")).toHaveLength(0);
    expect(d.nodes.find(n => n.id === "company-action-product-reference")!.roleId).toBe("head-product");
    for (const q of pbenchRequests) {
      const e = m.elements.find(e => e.id === q.id)!;
      expect(e.coordination!.state).toBe("blocked");
      expect(e.details.evidence).toContain("не подтверждены");
    }
    expect(m.documents.find(d => d.id === pbenchDocs.trial)!.text).toContain("полные неизменяемые копии 16 страниц не архивировались");
    expect(m.elements.find(e => e.id === "BENCH-PASS-2026-10-26")!.coordination!.state).toBe("awaiting_review");
    expect(m.documents.find(d => d.id === pbenchDocs.weekly)!.text).toContain("0/0 → нет данных");
  });
  it("reads documents and pending work through existing MCP service without cross-owner fallback", async () => {
    const m = readHypothesis(refinePbench(fixture(), "owner"), "new-country");
    const service = new ProductCrewService({ read: async (owner: string, hypothesis: string) => {
      if (owner !== "owner" || hypothesis !== "new-country") throw Error("Scope denied");
      return m;
    }} as unknown as ModelRepository);
    expect((await service.call("owner", "get_document", { documentId: pbenchDocs.daily })).id).toBe(pbenchDocs.daily);
    expect((await service.call("owner", "get_work", { recordId: pbenchRequests[0].id })).record.coordination.state).toBe("blocked");
    await expect(service.call("different-owner", "get_document", { documentId: pbenchDocs.daily })).rejects.toThrow("Scope denied");
    await expect(service.call("owner", "get_document", { documentId: "nonexistent" })).rejects.toThrow("Документ не найден");
  });
  it("refuses changed action sets or partial earlier imports instead of overwriting", () => {
    const root = fixture(), m = root.alternatives![0].model;
    m.operatingModel!.revisions.at(-1)!.data.nodes = m.operatingModel!.revisions.at(-1)!.data.nodes.filter(n => n.id !== analystActions[0].id);
    expect(() => refinePbench(root, "owner")).toThrow("action set changed");
    const partial = fixture();
    partial.alternatives![0].model.documents.push({ id: pbenchDocs.daily, title: "Prior", text: "Prior", url: "", updatedAt: "", elementIds: [] });
    expect(() => refinePbench(partial, "owner")).toThrow("Partial prior");
  });
  it("does not invent a manager or infer new authority for the older case receiver", () => {
    const saved = refinePbench(fixture(), "owner");
    expect(finishPbenchHandoff(saved, "owner")).toBe(saved);
    const receiver = emptyWorkNode("lg-action-6", "LG.6", "Existing case receiver", "action", null);
    receiver.roleId = "head-product";
    saved.alternatives![0].model.operatingModel!.revisions.at(-1)!.data.nodes.push(receiver);
    expect(() => finishPbenchHandoff(saved, "owner")).toThrow("Existing LG.6 manager required");
  });
});
