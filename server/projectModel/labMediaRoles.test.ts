import { describe, expect, it } from "vitest";
import type { OperatingData, WorkNode } from "../../shared/operatingModel";
import { mediaProtocol, mediaProtocolId, mediaRoles, prepareLabMediaRoles } from "./research/labMediaRoles";

function fixture(): OperatingData {
  const ids = ["laboratory-engineer-role", "lg-qa-role", "head-engineering", "dir-engineering",
    "lab-action-intake", "lab-action-qa", "lab-action-request", "lab-action-supply",
    "lab-action-analyze", "lab-action-period", "lab-resource-materials", "lab-resource-private-store",
    "lab-resource-qa"];
  return { nodes: ids.map(id => ({ id, code: id, name: id, kind: "action", description: "",
    referenceIds: [], executorId: null, status: "proposal" }) as WorkNode), links: [], stageReports: [] };
}
describe("existing crew media extension, description only", () => {
  it("adds two subordinate roles, eight actions each and paired receiving actions without mutating input", () => {
    const initial = fixture(), old = structuredClone(initial);
    const p = prepareLabMediaRoles(initial, "2026-10-27T00:00:00Z");
    expect(initial).toEqual(old);
    expect(p.documents).toHaveLength(2);
    for (const spec of mediaRoles) {
      const role = p.data.nodes.find(n => n.id === spec.id)!;
      expect(role.managerId).toBe("laboratory-engineer-role");
      expect(role).not.toHaveProperty("workNature");
      expect(role.executorId).toBeNull();
      const actions = p.data.nodes.filter(n => n.kind === "action" && n.roleId === role.id);
      expect(actions).toHaveLength(8);
      for (const a of actions) {
        expect(a.inputs[0].sourceId).toBeTruthy();
        expect(a.rules).toContain("HEAD.07");
        expect(a.acceptorId).toBeTruthy();
        expect(a.reporting?.formStatus).toBe("draft");
        expect(a.resourceIds.length).toBeGreaterThan(0);
        expect(a.metrics?.every(m => m.plan === null && m.fact === null)).toBe(true);
      }
      expect(p.data.links.some(l => l.from === `lab-${spec.mode}-action-report` && l.to === "lab-action-qa")).toBe(true);
      expect(p.data.links.some(l => l.from === "lab-action-qa" && l.to === `lab-${spec.mode}-action-rework`)).toBe(true);
      expect(p.data.links.some(l => l.from === `lab-${spec.mode}-action-period` && l.to === "lab-av-accept-period")).toBe(true);
      expect(JSON.stringify(p.documents.find(d => d.id === spec.documentId)!.packet).length).toBeLessThan(50000);
    }
  });
  it("reuses stable identities and never claims issued Gemini, recordings, execution or acceptance", () => {
    const first = prepareLabMediaRoles(fixture(), "2026-10-27T00:00:00Z");
    const again = prepareLabMediaRoles(first.data, "2026-10-27T00:00:00Z");
    expect(again.data).toEqual(first.data);
    expect(new Set(again.data.nodes.map(n => n.id)).size).toBe(again.data.nodes.length);
    expect(new Set(again.data.nodes.map(n => n.code)).size).toBe(again.data.nodes.length);
    expect(new Set(again.data.links.map(n => n.id)).size).toBe(again.data.links.length);
    const gemini = again.data.nodes.find(n => n.id === "lab-av-resource-gemini")!;
    expect(gemini).not.toHaveProperty("workNature");
    expect(gemini.resourceState).toBe("required");
    expect(gemini.description).toContain("не проверены");
    expect(mediaProtocol.execution).toMatchObject({ crewStarted: false, modelRequestsMade: 0, recordingEnabled: false });
    expect(mediaProtocol.requests.every(r => r.answer === null)).toBe(true);
    for (const d of again.documents) {
      const packet = d.packet as any;
      expect(packet.trialProtocol.every((p: any) => p.status === "не выполнено" && p.qaAcceptance === null)).toBe(true);
      expect(packet.protocolDocumentId).toBe(mediaProtocolId);
    }
  });
  it("all edges, action inputs and resources resolve to existing or added identities", () => {
    const p = prepareLabMediaRoles(fixture(), "2026-10-27T00:00:00Z");
    const ids = new Set(p.data.nodes.map(n => n.id));
    const materials = new Set([...p.documents.map(d => d.id), mediaProtocolId]);
    for (const l of p.data.links) { expect(ids.has(l.from)).toBe(true); expect(ids.has(l.to)).toBe(true); }
    for (const n of p.data.nodes) for (const ref of n.referenceIds)
      expect(ids.has(ref) || materials.has(ref), `missing material: ${ref}`).toBe(true);
    for (const n of p.data.nodes.filter(n => n.id.startsWith("lab-video-") || n.id.startsWith("lab-audio-"))) {
      for (const r of n.resourceIds) expect(ids.has(r), r).toBe(true);
      for (const i of n.inputs) expect(ids.has(i.sourceId!), i.name).toBe(true);
    }
  });
  it("fails instead of inventing a missing QA or lab counterpart", () => {
    const f = fixture();
    f.nodes = f.nodes.filter(n => n.id !== "lab-action-qa");
    expect(() => prepareLabMediaRoles(f, "2026-10-27T00:00:00Z")).toThrow("Missing existing counterpart");
  });
});
