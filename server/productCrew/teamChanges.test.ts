import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import type { ModelRepository } from "../projectModel/repository";
import { ProductCrewService, inputs, writeTools, productionTeamTools } from "./service";
import { buildTeamChange, projectionManagers, projectionManagersDocument } from "./teamChanges";
import { emptyCompetitorSnapshot } from "../../shared/projectCompetitors";
import { ModelError } from "../projectModel/modelError";

const ninaId = "proposal-4fe46862-f07e-562b-b6d7-4ab34716a545";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const base = () => ({ revision: 1, requestId: randomUUID(), reason: "Решение по структуре",
  ownerDecisionRef: "Владелец: сверенный документ" });
const planned = () => ({ ...base(), id: "planned-secretary-project-lead",
  title: "Руководитель проекта Секретарь", mode: "secretary", managerId: "head-product" });
function fixture() {
  const state = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  const data = state.operatingModel!.revisions.at(-1)!.data;
  state.elements.push({ id: "TH-PILOT-COMPETITORS", title: "Каталог конкурентов",
    description: "", section: "Продукт", scope: "talkhint", kind: "research",
    contentStatus: "proposal", implementationStatus: "planned", details: {},
    version: 1, updatedAt: "", needsReview: false } as any);
  const template = data.nodes.find(n => n.kind === "role")!;
  data.nodes.push({ ...structuredClone(template), id: ninaId, code: "P.ORG", name: "Методолог",
    managerId: "owner", executorId: null });
  return state;
}
function apply(state: ProjectModelState, name: keyof typeof inputs, a: any) {
  const parsed = (inputs[name] as any).parse(a);
  return buildTeamChange(state, name as any, parsed).commands.reduce((s, c) => applyCommand(s, c, "owner"), state);
}
function profile(state: ProjectModelState, id: string) {
  return state.documents.map(d => { try { return JSON.parse(d.text); } catch { return null; } })
    .find(p => p?.visualPassport?.roleId === id);
}
function validCompetitor() {
  return { ...emptyCompetitorSnapshot(), name: "Otter.ai", developer: "Не проверено",
    audience: "Онлайн-встречи", website: "https://otter.ai", checkedAt: "2026-10-31",
    verification: "provided", sources: [{ url: "https://otter.ai", checkedAt: "2026-10-31",
      note: "Передано владельцем; не проверено" }] };
}
describe("five narrow production model operations", () => {
  it("creates one empty role and profile, without employee, tasks, resource, schedule or activation", () => {
    const original = fixture(), result = apply(original, "create_planned_role", planned());
    const node = result.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === planned().id)!;
    expect(node).toMatchObject({ managerId: "head-product", executorId: null, roleId: null,
      resourceIds: [], inputs: [], status: "proposal", procedure: "" });
    expect(node.schedule).toEqual({ days: [], hours: "", timezone: "", trigger: "", deadline: "" });
    expect(profile(result, node.id)).toMatchObject({ plannedRole: true, mode: "secretary",
      visualPassport: { selectedName: null, portrait: { asset: null }, character: { traits: [null, null, null] } } });
    expect(original.operatingModel!.revisions.at(-1)!.data.nodes.some(n => n.id === node.id)).toBe(false);
    expect(() => apply(result, "create_planned_role", planned())).toThrow();
    expect(() => apply(result, "create_planned_role", { ...planned(), id: "another-empty-role" })).toThrow();
    expect(inputs.create_planned_role.safeParse({ ...planned(), executorId: "agent" }).success).toBe(false);
  });
  it("rejects duplicate graph IDs, codes, document IDs, and a manager other than Maria", () => {
    const state = fixture();
    for (const a of [{ ...planned(), id: "head-product" }, { ...planned(), managerId: "head-engineering" }])
      expect(() => apply(state, "create_planned_role", a)).toThrow();
    state.documents.push({ id: `DOC-PLANNED-${planned().id}`, title: "collision", text: "", url: "",
      elementIds: [], updatedAt: "", version: 1 } as any);
    expect(() => apply(state, "create_planned_role", planned())).toThrow();
  });
  it("updates only the title/mode and profile version, preserving prompt/personality/permissions", () => {
    const state = apply(fixture(), "create_planned_role", planned());
    const doc = state.documents.find(d => d.id === `DOC-PLANNED-${planned().id}`)!;
    const p = JSON.parse(doc.text);
    p.prompt = { exact: "Do not rewrite", permissions: ["no money"] }; doc.text = JSON.stringify(p);
    const result = apply(state, "update_role_title", { ...base(), roleId: planned().id,
      title: "Руководитель Секретаря", mode: "secretary" });
    expect(profile(result, planned().id).prompt).toEqual(p.prompt);
    expect(profile(result, planned().id).visualPassport.character).toEqual(p.visualPassport.character);
    expect(profile(result, planned().id)).toMatchObject({ version: 2,
      visualPassport: { position: "Руководитель Секретаря" } });
    expect(inputs.update_role_title.safeParse({ ...base(), roleId: planned().id,
      title: "x", mode: "secretary", prompt: "overwrite" }).success).toBe(false);
  });
  it("sets only Katya's projection manager, never creates another Katya or changes runtime prompts", () => {
    const state = apply(fixture(), "create_planned_role", planned());
    const before = state.operatingModel!.revisions.at(-1)!.data.nodes.length;
    const result = apply(state, "set_projection_manager", { ...base(), projectionId: "employee-katya", managerId: planned().id });
    expect(projectionManagers(result.documents)).toEqual([{ projectionId: "employee-katya", managerId: planned().id }]);
    expect(result.operatingModel!.revisions.at(-1)!.data.nodes).toHaveLength(before);
    expect(() => apply(result, "update_role_title", { ...base(), roleId: planned().id, title: "x", mode: "hint" })).toThrow();
    expect(() => apply(result, "set_projection_manager", { ...base(), projectionId: "employee-katya", managerId: "owner" })).toThrow();
    expect(inputs.set_projection_manager.safeParse({ ...base(), projectionId: "other-person", managerId: planned().id }).success).toBe(false);
  });
  it("fails closed on malformed saved projection links", () => {
    expect(() => projectionManagers([{ id: projectionManagersDocument, text: "{}" }] as any)).toThrow();
  });
  it("replaces Nina from a pinned saved v2 into the same document/role, never installing promptDraft", () => {
    const state = fixture();
    const nina = { format: "talkhint.employee.profile", version: 2, resolvedRoleId: ninaId,
      activation: false, employee: { code: "P.ORG", name: "Нина Кадрова", nameStatus: "proposed",
        position: "Руководитель отдела кадров", character: { traits: ["a", "b", "c"], motto: "m" } },
      promptDraft: { forbidden: "No changing personality" }, prohibitions: ["no activation"] };
    state.documents.push({ id: "source", text: JSON.stringify({ documents: { "nina-v2": nina } }),
      title: "source", url: "", elementIds: [], updatedAt: "" } as any);
    state.documents.push({ id: "DOC-PORG-OPERATING-PASSPORT", text: "# Old Markdown",
      title: "Old", url: "", elementIds: [], updatedAt: "" } as any);
    const a = { ...base(), roleId: ninaId, sourceDocumentId: "source",
      sourceHash: sha(state.documents.at(-2)!.text), targetHash: sha(state.documents.at(-1)!.text) };
    const result = apply(state, "replace_employee_profile", a);
    expect(profile(result, ninaId)).toMatchObject({ sourceProfile: nina,
      status: "described_not_connected", runtimeChanged: false, promptDraft: nina.promptDraft });
    expect(profile(result, ninaId).prompt).toBeUndefined();
    expect(result.documents).toHaveLength(state.documents.length);
    expect(() => apply(state, "replace_employee_profile", { ...a, sourceHash: "0".repeat(64) })).toThrow();
    expect(() => apply(state, "replace_employee_profile", { ...a, targetHash: "0".repeat(64) })).toThrow();
    expect(() => apply(state, "replace_employee_profile", { ...a, roleId: "head-product" })).toThrow();
    expect(state.documents.at(-1)!.text).toBe("# Old Markdown");
  });
  it("adds to the actual competitorDirectory without replacing old records or manufacturing live evidence", () => {
    const state = fixture(), snapshot = validCompetitor();
    const result = apply(state, "add_competitor", { ...base(), snapshotJson: JSON.stringify(snapshot) });
    expect(result.competitorDirectory!.records.at(-1)!.revisions[0].snapshot.verification).toBe("provided");
    expect(result.competitorDirectory!.records.at(-1)!.revisions[0].snapshot.name).toBe("Otter.ai");
    expect(() => apply(result, "add_competitor", { ...base(), snapshotJson: JSON.stringify({ ...snapshot,
      name: "Different name", website: "https://www.otter.ai/" }) })).toThrow();
    expect(() => apply(state, "add_competitor", { ...base(), snapshotJson: JSON.stringify({ ...snapshot, verification: "manual" }) })).toThrow();
    snapshot.scenarios[0].status = "live_verified";
    expect(() => apply(state, "add_competitor", { ...base(), snapshotJson: JSON.stringify(snapshot) })).toThrow();
  });
});

class Repo implements ModelRepository {
  state = fixture(); open = true; calls: unknown[] = [];
  async read(owner: string, h?: string) {
    expect(owner).toBe("owner"); expect(h).toBe("new-country"); return structuredClone(this.state);
  }
  async update(owner: string, v: number, c: ModelCommand, h?: string) { return this.updateMany(owner, v, [c], h); }
  async updateMany(owner: string, v: number, cs: ModelCommand[], h?: string) {
    expect(owner).toBe("owner"); expect(h).toBe("new-country");
    if (!this.open) throw new ModelError(423, "writes closed");
    if (v !== this.state.revision) throw new ModelError(409, "stale");
    this.calls.push(cs);
    this.state = cs.reduce((s, c) => applyCommand(s, c, owner), this.state);
    return structuredClone(this.state);
  }
}
describe("new tools use the common authorization/CAS/atomic receipt path", () => {
  it("classifies every new operation as production-only and write-scoped with strict inputs", () => {
    for (const name of ["create_planned_role", "update_role_title", "set_projection_manager", "replace_employee_profile", "add_competitor"] as const) {
      expect(writeTools.has(name)).toBe(true); expect(productionTeamTools.has(name)).toBe(true);
      expect(inputs[name].safeParse({ ...base(), delete: true }).success).toBe(false);
    }
  });
  it("atomically stores commands plus receipt, permits identical replay, rejects changed replay and stale revision", async () => {
    const repo = new Repo(), service = new ProductCrewService(repo, { production: true });
    const a = { ...planned(), revision: repo.state.revision };
    const first = await service.call("owner", "create_planned_role", a);
    expect(first).toMatchObject({ saved: true, launched: false });
    expect(repo.calls).toHaveLength(1);
    expect(await service.call("owner", "create_planned_role", a)).toMatchObject({ replayed: true });
    expect(repo.calls).toHaveLength(1);
    await expect(service.call("owner", "create_planned_role", { ...a, title: "changed" })).rejects.toMatchObject({ status: 409 });
    await expect(service.call("owner", "create_planned_role", { ...planned(), id: "another-role" })).rejects.toMatchObject({ status: 409 });
    expect((await service.call("owner", "get_team", {})).roles.find((r: any) => r.id === a.id).employeeProfiles)
      .toEqual([expect.objectContaining({ mode: "secretary", planned: true })]);
  });
  it("rejects closed writes and Dev; does not write if validation fails", async () => {
    const repo = new Repo(); repo.open = false;
    await expect(new ProductCrewService(repo, { production: true }).call("owner", "create_planned_role", planned()))
      .rejects.toMatchObject({ status: 423 });
    await expect(new ProductCrewService(repo).call("owner", "create_planned_role", planned()))
      .rejects.toMatchObject({ status: 403 });
    expect(repo.calls).toHaveLength(0);
  });
});
