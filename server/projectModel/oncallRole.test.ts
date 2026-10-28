import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { initialModel } from "./seed";
import { readHypothesis } from "./hypotheses";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import { prepareOncallRole, opsPacketId, opsFormId } from "./research/oncallRole";
const at = "2026-10-27T17:00:00Z";
function fixture() {
  const root = initialModel(), state = initialModel();
  const nodes = [
    ...[["ops", "P.OPS"], ["head-engineering", "HEAD.07"], ["head-team", "HEAD.09"]]
      .map(([id, code]) => emptyWorkNode(id, code, code, "role", null)),
    ...["engineering-chief-incident", "management-action-qa", "management-action-report-engineering-day",
      "management-action-operations", "management-action-release", "old-lab-mail"]
      .map(id => Object.assign(emptyWorkNode(id, id, id, "action", null), { roleId: "ops", procedure: "Keep original procedure" })),
    ...Array.from({ length: 10 }, (_, i) => Object.assign(
      emptyWorkNode(`day-${i}`, `T${String(i + 1).padStart(2, "0")}.REPORT.DAY`, "Daily", "action", null),
      { roleId: "head-engineering", nextId: "owner" })),
    emptyWorkNode("owner", "OWNER", "Owner", "client", null),
  ];
  state.documents = [
    { id: "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d", title: "Roadmap v21", text: "Keep roadmap", url: "", elementIds: [], updatedAt: at },
    { id: "DOC-TALKHINT-TECHNICAL-PASSPORT", title: "Tech", text: "Keep passport", url: "", elementIds: [], updatedAt: at },
  ];
  state.operatingModel = { revisions: [{ version: 1, at, actor: "fixture", data: { nodes, links: [], stageReports: [] } }] };
  root.alternatives = [{ id: "new-country", title: "Existing", model: state, createdAt: at }];
  return root;
}
describe("canonical P.OPS documentation-only work package", () => {
  it("checks the offline report consumer against canonical and proposed forms without a live snapshot", () => {
    const state = readHypothesis(prepareOncallRole(fixture(), at), "new-country");
    const contract = {
      packet: JSON.parse(state.documents.find(d => d.id === opsPacketId)!.text),
      form: JSON.parse(state.documents.find(d => d.id === opsFormId)!.text),
      data: state.operatingModel!.revisions.at(-1)!.data,
    };
    const result = spawnSync("python3", ["scripts/test_ops_report.py"], {
      input: JSON.stringify(contract), encoding: "utf8", timeout: 20_000,
    });
    expect(result.error, result.error?.message).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
  it("reuses the role, preserves old actions, history, passport and business daily chain", () => {
    const root = fixture(), before = readHypothesis(root, "new-country");
    const next = prepareOncallRole(root, at), after = readHypothesis(next, "new-country");
    const data = after.operatingModel!.revisions.at(-1)!.data;
    expect(data.nodes.filter(n => n.kind === "role")).toHaveLength(3);
    expect(data.nodes.find(n => n.id === "old-lab-mail")).toEqual(before.operatingModel!.revisions[0].data.nodes.find(n => n.id === "old-lab-mail"));
    expect(data.nodes.find(n => n.id === "management-action-operations")!.procedure).toContain("Keep original procedure");
    expect(after.operatingModel!.revisions[0]).toEqual(before.operatingModel!.revisions[0]);
    expect(after.documents.find(d => d.id === "DOC-TALKHINT-TECHNICAL-PASSPORT")!.text).toBe("Keep passport");
    expect(data.nodes.find(n => n.id === "day-0")!.nextId).toBe("owner");
    expect(after.elements).toEqual(before.elements);
    expect(after.documents.filter(d => d.id === opsPacketId)).toHaveLength(1);
    expect(prepareOncallRole(next, at)).toBe(next);
  });
  it("exports procedures, suppliers, resources, paired acceptance, forms and an unperformed trial", () => {
    const next = prepareOncallRole(fixture(), at), s = readHypothesis(next, "new-country");
    const doc = s.documents.find(d => d.id === opsPacketId)!;
    const packet = JSON.parse(doc.text);
    expect(doc.text.length).toBeLessThanOrEqual(50000);
    expect(packet.metadata.sourceRevision).toBe(s.revision);
    expect(packet.authorization.dailyScheduleEnabled).toBe(false);
    expect(packet.authorization.allDetailsApproved).toBe(false);
    expect(packet.documentationInputs).toHaveLength(10);
    expect(packet.resourceRequirements.every((r: any) => r.issuedToRole === false)).toBe(true);
    expect(packet.trialProtocol).toHaveLength(packet.actions.length);
    expect(packet.trialProtocol.every((p: any) => p.status === "не выполнено" && p.evidence === null)).toBe(true);
    expect(packet.actions.find((a: any) => a.id === "oncall-action-send").recipient).toBe("owner");
    expect(packet.receivingActions.some((a: any) => a.id === "oncall-action-receive-daily")).toBe(true);
    expect(s.documents.find(d => d.id === opsFormId)).toBeTruthy();
    expect(packet.dailyReportForm.delivery.sentConfirmed).toBeNull();
    expect(packet.manualPass.verdict).toBeNull();
    expect(packet.metrics.every((m: any) => m.target === null)).toBe(true);
    const resources = new Set(packet.resourceRequirements.map((r: any) => r.id));
    expect(packet.actions.every((a: any) => a.resources.every((id: string) => resources.has(id)))).toBe(true);
  });
  it("fails closed on missing/ambiguous identities or missing ten-direction suppliers", () => {
    const missing = fixture();
    missing.alternatives![0].model.operatingModel!.revisions[0].data.nodes =
      missing.alternatives![0].model.operatingModel!.revisions[0].data.nodes.filter(n => n.code !== "P.OPS");
    expect(() => prepareOncallRole(missing, at)).toThrow();
    const dup = fixture();
    dup.alternatives![0].model.operatingModel!.revisions[0].data.nodes.push(emptyWorkNode("duplicate", "P.OPS", "Duplicate", "role", null));
    expect(() => prepareOncallRole(dup, at)).toThrow();
    const directions = fixture();
    directions.alternatives![0].model.operatingModel!.revisions[0].data.nodes =
      directions.alternatives![0].model.operatingModel!.revisions[0].data.nodes.filter(n => n.id !== "day-1");
    expect(() => prepareOncallRole(directions, at)).toThrow();
  });
});
