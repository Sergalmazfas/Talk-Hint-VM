import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mariaResponsibilities, mariaResponsibilitiesSchema, mariaProfileCommands } from "./mariaPassport";
import { inputs, productionTeamTools, writeTools } from "./service";
import { teamView } from "../team/view";

const roles = [
  { id: "head-product", code: "HEAD.06", managerId: "owner" },
  { id: "pasha", code: "P.PRODUCT", managerId: "head-product" },
  { id: "nina", code: "P.ORG", managerId: "owner" },
  { id: "tikhon", code: "P.OPS", managerId: "head-engineering" },
  { id: "benchmark", code: "P-BENCH", managerId: "head-market" },
];
function fixture() {
  const responsibilities = mariaResponsibilities(roles);
  const profile = { version: 1, format: "talkhint.employee.profile", mode: "company",
    visualPassport: { roleId: "head-product", selectedName: "Мария Соболь",
      position: "Руководитель продукта", character: { traits: ["видит целиком", "смелая", "по фактам"], motto: "m" },
      portrait: { asset: "/portrait" } },
    prompt: { text: "unchanged prompt" }, permissions: { money: false } };
  const doc = { id: "DOC-TEAM-HEAD06", title: "Мария", text: JSON.stringify(profile),
    url: "", elementIds: ["TH-PRODUCT"] };
  const state: any = { operatingModel: { revisions: [{ data: { nodes: roles.map(r => ({ ...r, kind: "role" })) } }] },
    documents: [doc], elements: [{ id: "PC-PASSPORT-MARIA", version: 3,
      coordination: { kind: "role_passport", roleId: "head-product" },
      details: { procedure: JSON.stringify(responsibilities) } }] };
  const args = { sourceVersion: 3, profileHash: createHash("sha256").update(doc.text).digest("hex") };
  return { state, args, responsibilities, profile };
}
describe("Maria's complete description, not activation", () => {
  it("resolves real roles, leaves future project IDs null, and includes all clients/inputs/urgent copy", () => {
    const p = mariaResponsibilities(roles);
    expect(p.clients).toHaveLength(6); expect(p.inputs).toHaveLength(7);
    expect(p.clients.find(c => c.key === "hr")?.roleId).toBe("nina");
    expect(p.inputs.find(c => c.key === "benchmark")?.roleId).toBe("benchmark");
    expect(p.clients.filter(c => c.planned).map(c => c.roleId)).toEqual([null, null, null]);
    expect(p.urgentRule).toContain("Копия не приёмка");
    expect(roles.find(r => r.id === "benchmark")?.managerId).toBe("head-market");
  });
  it("defines five duties with triggers, results, one client and one independent acceptor; no fabricated metrics", () => {
    const p = mariaResponsibilities(roles);
    expect(p.duties.map(d => d.code)).toEqual(["PRD.1", "PRD.2", "PRD.3", "PRD.4", "PRD.5"]);
    for (const d of p.duties) {
      expect(d.trigger.length).toBeGreaterThan(10); expect(d.result.length).toBeGreaterThan(10);
      expect(d.clientId).toBe("owner"); expect(d.acceptorId).toBe("owner");
    }
    expect(p.prohibitions).toHaveLength(6);
    expect(p.metrics).toEqual({ plan: null, fact: null, planStatus: "не задан владельцем", factStatus: "не измерено" });
    const self = structuredClone(p); (self.duties[0] as any).acceptorId = "head-product";
    expect(mariaResponsibilitiesSchema.safeParse(self).success).toBe(false);
    const duplicate = structuredClone(p); duplicate.duties[4].code = "PRD.1";
    expect(mariaResponsibilitiesSchema.safeParse(duplicate).success).toBe(false);
  });
  it("copies the pinned native passport only into Maria's existing document; preserves personality, prompt, permissions and graph", () => {
    const f = fixture(), before = JSON.stringify(f.state);
    const change = mariaProfileCommands(f.state, f.args);
    expect(change.commands).toHaveLength(1);
    const command = change.commands[0] as any;
    expect(command).toMatchObject({ type: "saveDocument", id: "DOC-TEAM-HEAD06" });
    const next = JSON.parse(command.text);
    expect(next.version).toBe(2);
    expect(next.visualPassport).toEqual(f.profile.visualPassport);
    expect(next.prompt).toEqual(f.profile.prompt); expect(next.permissions).toEqual(f.profile.permissions);
    expect(next.productResponsibilities).toEqual(f.responsibilities);
    expect(JSON.stringify(f.state)).toBe(before);
  });
  it("rejects stale source version/hash, wrong head, incomplete duties and invented future IDs", () => {
    const f = fixture();
    expect(() => mariaProfileCommands(f.state, { ...f.args, sourceVersion: 2 })).toThrow();
    expect(() => mariaProfileCommands(f.state, { ...f.args, profileHash: "0".repeat(64) })).toThrow();
    f.state.elements[0].details.procedure = "{}";
    expect(() => mariaProfileCommands(f.state, f.args)).toThrow();
    const g = fixture(); g.state.operatingModel.revisions[0].data.nodes[0].managerId = "someone";
    expect(() => mariaProfileCommands(g.state, g.args)).toThrow();
    const h = fixture(); h.responsibilities.clients[2].roleId = "invented";
    h.state.elements[0].details.procedure = JSON.stringify(h.responsibilities);
    expect(() => mariaProfileCommands(h.state, h.args)).toThrow();
  });
  it("classifies the operation as production-only/write-scoped, forbids arbitrary payload fields", () => {
    expect(writeTools.has("update_maria_profile")).toBe(true);
    expect(productionTeamTools.has("update_maria_profile")).toBe(true);
    expect(inputs.update_maria_profile.safeParse({ revision: 1, requestId: "00000000-0000-4000-8000-000000000000",
      roleId: "head-product", sourceVersion: 1, profileHash: "0".repeat(64),
      reason: "r", ownerDecisionRef: "owner", prompt: "replace" }).success).toBe(false);
  });
  it("shows the five duties, clients and unknown metrics from the pinned profile without changing the live agent", () => {
    const f = fixture();
    const updated = JSON.parse((mariaProfileCommands(f.state, f.args).commands[0] as any).text);
    const c: any = { owner: "owner", revision: 1, workspace: "fixture", phase: "active", writesOpen: true,
      documents: [{ ...f.state.documents[0], text: JSON.stringify(updated) }],
      operating: { data: { nodes: [{ ...roles[0], kind: "role", name: "Мария", resourceIds: [] },
        { id: "owner", code: "C-01", name: "Владелец", kind: "client" },
        ...roles.slice(1).map(r => ({ ...r, kind: "client", name: r.code }))], links: [] } },
      profiles: [{ entity_id: "head-product", source_document_id: "DOC-TEAM-HEAD06", profile_version: 2,
        display_name: "Мария Соболь", trait_1: "видит целиком", trait_2: "смелая", trait_3: "по фактам",
        motto: "m", portrait_file_url: "/portrait" }],
      roles: [{ entity_id: "head-product", mode_source: "document:DOC-TEAM-HEAD06", mode: "company" }],
      prompts: [], jobs: [], revisions: [], controls: [] };
    const m = teamView(c, "production").members.find(m => m.id === "head-product")!;
    expect(m.duties).toHaveLength(5);
    expect(m.relations).toContainEqual({ kind: "Получает от", id: "benchmark", name: "P-BENCH" });
    expect(m.metrics.fact).toBe("не измерено"); expect(m.metrics.plan).toBe("не задан владельцем");
    expect(m.status).toBe("disconnected");
  });
});
