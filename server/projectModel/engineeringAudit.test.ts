import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import type { ProductBook, ProductBookFeature } from "../../shared/productBook";
import { readProductBook, productBookText, productBookDocumentId } from "../../shared/productBook";
import type { OperatingData } from "../../shared/operatingModel";
import { prepareEngineeringAudit } from "./research/engineeringAudit";
import { chiefActions, engineeringDoc, engineeringFacts, engineeringRequests, engineeringRole, engineeringRoadmap } from "./research/engineeringAuditSpec";
import { readHypothesis } from "./hypotheses";
import { actionChainGaps } from "../../shared/actionChainCoverage";

const evidence = { at: "2026-10-26T06:00:00Z", commit: "test-code-snapshot",
  tests: "Synthetic fixture baseline; not actual public/device/phone tests." };
function fixture() {
  const root = initialModel(), m = initialModel();
  const data: OperatingData = { nodes: [], links: [], stageReports: [] };
  function add(id: string, kind: "action" | "role" | "process" | "client" | "crew" | "resource" | "result" = "action") {
    if (!data.nodes.some(n => n.id === id)) data.nodes.push(emptyWorkNode(id, id, id, kind, null));
    return data.nodes.find(n => n.id === id)!;
  }
  for (const id of ["head-product", "product-manager-specialist", engineeringRole, "ai-ceo", "head-finance", "crew-channel-specialist",
    "lg-technical-role", "management-role-app-architect", "management-role-backend-specialist", "management-role-frontend-specialist",
    "management-role-mobile-specialist", "lg-qa-role", "management-role-operations-specialist", "crew-product-developer"]) {
    add(id, "role").managerId = id === "ai-ceo" ? null : "ai-ceo";
  }
  add("owner", "client"); add("model-resource", "resource"); add("replit-current-dev-session", "crew");
  add("development", "process");
  add(engineeringRole, "role").executorId = "replit-current-dev-session";
  const ids = Array.from(new Set([...chiefActions.flatMap(s => [s.next, s.supplier]),
    ...engineeringRequests.map(r => r.process), "company-action-technical-facts", "company-action-technical-assessment",
    "company-action-technical-control", "company-action-product-reference", "management-action-frontend",
    "management-action-mobile", "management-action-backend", "management-action-release", "benchmark-ready-storage"]));
  for (const id of ids.filter(id => !id.startsWith("engineering-chief-"))) {
    const n = add(id, id.endsWith("-result") ? "result" : "action");
    n.roleId = "lg-technical-role"; n.clientId = engineeringRole; n.acceptorId = engineeringRole;
    n.nextId = "company-action-product-reference";
  }
  const control = add("company-action-technical-control");
  control.code = "ENG.1.3"; control.roleId = engineeringRole;
  control.nextId = "company-action-product-reference";
  m.operatingModel = { revisions: [{ at: evidence.at, actor: "owner", version: 22, data }] };
  const features = engineeringFacts.map(f => ({
    ...Object.fromEntries(["behavior","actual","platform","evidence","implementation","verification","availability","acceptance","errors","limitations",
      "dependencies","requests","responsible","receiver","resources","next","priority","rationale","deadline"].map(k => [k, "Existing"])),
    id: f.id, name: f.name,
  })) as unknown as ProductBookFeature[];
  const book: ProductBook = { version: 2, updatedAt: evidence.at, snapshotDate: "2026-10-25", lifecycle: "В разработке",
    status: "На согласовании", purpose: "Existing purpose", vision: "Existing vision", b2c: "Existing", b2b: "Existing",
    current: "Existing", nextStage: "Existing", completion: "Existing", features, legal: "Existing", finance: "Existing",
    responsibilities: "Existing", contradictions: "Existing", roadmap: "Existing", previousPassport: "Existing original" };
  m.documents.push({ id: productBookDocumentId, title: "Existing book v2", text: productBookText(book), url: "", updatedAt: evidence.at, elementIds: ["TH-PRODUCT"] },
    { id: engineeringRoadmap, title: "Roadmap — v15 — existing", text: "Existing roadmap", url: "", updatedAt: evidence.at, elementIds: ["TH-PRODUCT"] });
  m.elements.push({ ...m.elements[0], id: "PB-GAP-TECH", title: "Existing request", version: 2, details: {},
    coordination: { kind: "work", state: "blocked", origin: "owner_chatgpt", roleId: "lg-technical-role",
      processId: "benchmark-ready-storage", nextStep: "Existing", relatedIds: [], operations: [{ id: "00000000-0000-4000-8000-000000000001", at: evidence.at, fingerprint: "a".repeat(64) }] } });
  root.alternatives = [{ id: "new-country", title: "New country", model: m }, { id: "old", title: "Other", model: initialModel() }];
  return root;
}

describe("Manual chief engineering documentation without changing the product", () => {
  it("preserves roles, existing duties, history, other hypotheses and passport user meaning", () => {
    const before = fixture(), old = readHypothesis(before, "new-country");
    const saved = prepareEngineeringAudit(before, "owner", evidence), m = readHypothesis(saved, "new-country");
    expect(saved.alternatives![1]).toEqual(before.alternatives![1]);
    expect(saved.elements).toEqual(before.elements);
    expect(m.operatingModel!.revisions.slice(0, -1)).toEqual(old.operatingModel!.revisions);
    const data = m.operatingModel!.revisions.at(-1)!.data;
    expect(data.nodes.filter(n => n.kind === "role").map(n => n.id)).toEqual(old.operatingModel!.revisions[0].data.nodes.filter(n => n.kind === "role").map(n => n.id));
    expect(data.nodes.find(n => n.id === "company-action-technical-control")!.roleId).toBe(engineeringRole);
    const prior = readProductBook(old.documents.find(d => d.id === productBookDocumentId))!;
    const updated = readProductBook(m.documents.find(d => d.id === productBookDocumentId))!;
    expect(updated.version).toBe(3); expect(updated.previousPassport).toBe(prior.previousPassport);
    expect(updated.snapshotDate).toBe(prior.snapshotDate); expect(updated.status).toBe("На согласовании");
    expect(updated.features.map(f => [f.id, f.actual, f.behavior, f.acceptance])).toEqual(prior.features.map(f => [f.id, f.actual, f.behavior, f.acceptance]));
    expect(prepareEngineeringAudit(saved, "owner", evidence)).toBe(saved);
  });
  it("ties actions to real receivers and criteria without invented deadlines, approvals, workers or costs", () => {
    const m = readHypothesis(prepareEngineeringAudit(fixture(), "owner", evidence), "new-country"), d = m.operatingModel!.revisions.at(-1)!.data;
    const owned = d.nodes.filter(n => n.kind === "action" && n.roleId === engineeringRole);
    expect(owned).toHaveLength(chiefActions.length + 1);
    expect(actionChainGaps(d, new Set(owned.map(n => n.id)))).toEqual([]);
    for (const a of owned) { expect(a.schedule.deadline).toContain("не согласован"); expect(a.register!.minutesPerOperation).toBeNull(); }
    expect(d.nodes.find(n => n.id === "engineering-resource-native-proof")!.resourceState).toBe("required");
    expect(d.nodes.find(n => n.id === "engineering-resource-source")!.resourceState).toBe("connected");
    expect(m.elements.find(e => e.id === "PB-GAP-TECH")!.coordination!.state).toBe("blocked");
    expect(m.elements.find(e => e.id === "PB-GAP-TECH")!.coordination!.resultDocumentId).toBe(engineeringDoc);
    expect(m.elements.find(e => e.id === "ENG-REVIEW-2026-10-26")!.coordination!.state).toBe("awaiting_review");
    for (const r of engineeringRequests) expect(m.elements.find(e => e.id === r.id)!.coordination!.state).toBe("blocked");
  });
  it("refuses missing canonical book or changed role assignment instead of making another catalogue", () => {
    const before = fixture(); before.alternatives![0].model.documents = [];
    expect(() => prepareEngineeringAudit(before, "owner", evidence)).toThrow("Existing book");
    const changed = fixture(); changed.alternatives![0].model.operatingModel!.revisions[0].data.nodes.find(n => n.id === engineeringRole)!.managerId = null;
    expect(() => prepareEngineeringAudit(changed, "owner", evidence)).toThrow("assignment changed");
  });
});
