import { describe, expect, it } from "vitest";
import { auditStructure } from "./structureAudit";
import { initialState } from "./domain";
import { ownerProductProhibition } from "../../shared/ownerProductPolicy";
import { secretaryDepartmentRoles } from "../../shared/secretaryDepartment";
const at = "2026-11-01T18:00:00Z";
function fixture() {
  const ids = ["head-product", "product-manager-specialist", "laboratory-engineer-role", "lg-qa-role",
    ...secretaryDepartmentRoles.map(r => r.id)];
  const nodes: any[] = [{ id: "owner", kind: "client", executorId: "human-owner" }];
  ids.forEach((id, i) => nodes.push({ id, kind: "role", code: ["HEAD.06", "P.PRODUCT", "P.LAB", "P.LG.QA"][i] ?? "PLAN.SECRETARY",
    executorId: "executor-" + i, managerId: i === 0 ? "owner" : [1, 4].includes(i) ? "head-product" :
      i < 4 ? "product-manager-specialist" : secretaryDepartmentRoles[0].id }));
  ids.forEach(id => nodes.push({ id: "action-" + id, kind: "action", roleId: id,
    schedule: { trigger: "event" }, success: "document", clientId: "owner",
    acceptorId: nodes.find(n => n.id === id).managerId }));
  const documents = ids.map(id => ({ id: "profile-" + id, text: JSON.stringify({
    visualPassport: { roleId: id }, prohibitions: [ownerProductProhibition],
    employeeSections: {
      workplace: { description: "Read-only", inputs: [], outputs: [], sourceDocumentIds: [], laboratory: null, limitations: [] },
      modelRecommendation: { modelId: null, family: "Claude", rationale: "description", source: "owner", enabled: false, status: "proposed" },
    },
  }) }));
  return { revision: 1, operatingModel: { revisions: [{ data: { nodes } }] }, documents } as any;
}
describe("free read-only structural audit", () => {
  it("reports healthy declared fields and hierarchy, never mutates company or Crew", () => {
    const m = fixture(), s = initialState(), before = JSON.stringify({ m, s });
    const r = auditStructure(m, s, at);
    expect(r.summary.problems).toBe(0);
    expect(r.modelWrites).toBe(0); expect(r.modelsCalled).toBe(0);
    expect(JSON.stringify({ m, s })).toBe(before);
  });
  it("finds missing profiles/workplace, enabled model, prohibition, trigger/result/customer/acceptor gaps", () => {
    const m = fixture(), nodes = m.operatingModel.revisions[0].data.nodes;
    m.documents.shift();
    const p = JSON.parse(m.documents[0].text); p.employeeSections.modelRecommendation.enabled = true;
    delete p.employeeSections.workplace; p.prohibitions = []; m.documents[0].text = JSON.stringify(p);
    Object.assign(nodes.find((n: any) => n.kind === "action"), { schedule: { trigger: "" }, success: "", clientId: null, acceptorId: null });
    const codes = auditStructure(m, initialState(), at).findings.filter(f => f.status === "problem").map(f => f.check);
    expect(codes).toEqual(expect.arrayContaining(["exactly_one_profile", "workplace", "model_recommendation_disabled",
      "owner_product_prohibition", "duty_trigger", "duty_result", "duty_customer", "duty_acceptor"]));
  });
  it("finds orphan, loop, depth excess and same executor through different roles", () => {
    const m = fixture(), nodes = m.operatingModel.revisions[0].data.nodes;
    const lab = nodes.find((n: any) => n.id === "laboratory-engineer-role");
    lab.managerId = "missing";
    const qa = nodes.find((n: any) => n.id === "lg-qa-role");
    qa.managerId = qa.id;
    nodes.find((n: any) => n.id === "secretary-lab-engineer").managerId = "lg-qa-role";
    nodes.find((n: any) => n.id === "product-manager-specialist").executorId = qa.executorId;
    const codes = auditStructure(m, initialState(), at).findings.filter(f => f.status === "problem").map(f => f.check);
    expect(codes).toContain("hierarchy_loop");
    expect(codes).toContain("hierarchy_to_maria_owner_depth_le_3");
    expect(codes).toContain("no_self_acceptance");
  });
  it("flags unknown executor identity and stale task with holder/hours; no borrowed caller data", () => {
    const m = fixture(), s = initialState();
    m.operatingModel.revisions[0].data.nodes.forEach((n: any) => delete n.executorId);
    s.tasks.push({ id: "stale", title: "no call content", phase: "analysis", closed: false,
      steps: [{ holder: "role-id", actor: "owner", updatedAt: "2026-10-30T18:00:00Z", phase: "analysis", note: "" }] });
    const r = auditStructure(m, s, at);
    expect(r.stale[0]).toMatchObject({ holder: "role-id", hours: 48, stale: true });
    expect(r.findings.some(f => f.check === "executor_identity_not_established" && f.status === "problem")).toBe(true);
    expect(r.findings.some(f => f.where === "stale" && f.status === "problem")).toBe(true);
  });
});
