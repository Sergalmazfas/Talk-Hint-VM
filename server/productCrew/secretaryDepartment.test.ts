import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import type { ModelRepository } from "../projectModel/repository";
import { ProductCrewService, inputs, productionTeamTools, writeTools } from "./service";
import { buildTeamChange, projectionManagers, projectionManagersDocument } from "./teamChanges";
import { SECRETARY_DEPARTMENT_DOCUMENT, secretaryDepartmentRoles, secretaryDepartmentSchema } from "../../shared/secretaryDepartment";
import { secretaryDepartment } from "./secretaryDepartment";
import { teamView } from "../team/view";
import { withTeamRuntime } from "../team/runtime";
import { DIRECTORY } from "../team/plan";
import { ModelError } from "../projectModel/modelError";

const name = "create_secretary_department_structure";
const args = (revision: number) => ({ revision, requestId: randomUUID(), reason: "Только структура",
  ownerDecisionRef: "Решение владельца: Сева, Лёва, Тома, каталог. Имена proposed." });
function fixture() {
  const s = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  const maria = s.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === "head-product")!;
  maria.managerId = "owner";
  return s;
}
function apply(s: ProjectModelState) {
  const a = inputs[name].parse(args(s.revision));
  return buildTeamChange(s, name, a).commands.reduce((v, c) => applyCommand(v, c, "owner"), s);
}
const nodes = (s: ProjectModelState) => s.operatingModel!.revisions.at(-1)!.data.nodes;
describe("Secretary department structure-only macro", () => {
  it("creates exactly three empty graph roles with proposed names, no tasks, agents, expenses or prompts", () => {
    const before = fixture(), immutable = JSON.stringify(before), after = apply(before);
    expect(nodes(after).filter(n => n.kind === "role")).toHaveLength(nodes(before).filter(n => n.kind === "role").length + 3);
    expect(nodes(after).filter(n => n.kind === "action")).toEqual(nodes(before).filter(n => n.kind === "action"));
    expect(nodes(after).some(n => n.id === "employee-katya")).toBe(false);
    for (const r of secretaryDepartmentRoles) {
      const node = nodes(after).find(n => n.id === r.id)!;
      expect(node.managerId).toBe(r.managerId);
      expect(node.executorId).toBeNull(); expect(node.resourceIds).toEqual([]);
      expect(node.inputs).toEqual([]); expect(node.procedure).toBe(""); expect(node.acceptorId).toBeNull();
      expect(node.schedule).toEqual({ days: [], hours: "", timezone: "", trigger: "", deadline: "" });
      const p = JSON.parse(after.documents.find(d => d.id === `DOC-PLANNED-${r.id}`)!.text);
      expect(p.visualPassport.selectedName).toBeNull();
      expect(p.visualPassport.nameProposal).toEqual({ value: r.proposedName, status: "proposed" });
      expect(p).toMatchObject({ plannedRole: true, knowledgeBookDocumentId: null, promptDocumentId: null });
      expect(p.prompt).toBeUndefined();
    }
    for (const n of nodes(before)) expect(nodes(after).find(v => v.id === n.id)).toEqual(n);
    expect(JSON.stringify(before)).toBe(immutable);
  });
  it("references the existing Katya once, uses two vacancies, preserves shared roles and never guesses provider IDs", () => {
    const s = apply(fixture()), d = secretaryDepartment(s.documents, nodes(s))!;
    expect(d.catalog.source).toBe("existing_secretary_personalities");
    expect(d.catalog.members).toHaveLength(1);
    expect(d.catalog.members[0]).toMatchObject({ runtimeProjectionId: "employee-katya",
      personaRef: null, ownerReportedPersonaVersion: 2, referencesStatus: "unresolved" });
    expect(d.catalog.vacancies.map(v => v.usage)).toEqual(["work_phone", "personal_phone"]);
    expect(projectionManagers(s.documents)).toEqual([{ projectionId: "employee-katya", managerId: d.managerId }]);
    expect(s.documents.filter(d => d.id === projectionManagersDocument)).toHaveLength(1);
    expect(s.documents.some(d => { try {
      return JSON.parse(d.text).visualPassport?.roleId === "employee-katya";
    } catch { return false; } })).toBe(false);
    expect(s.documents.filter(d => d.id.startsWith("DOC-PLANNED-"))).toHaveLength(3);
  });
  it("can describe more catalog members with isolated books/prompts, but rejects aliases and duplicate personas", () => {
    const s = apply(fixture()), d = structuredClone(secretaryDepartment(s.documents, nodes(s))!);
    d.catalog.members.push({ key: "zhanna", label: "Жанна", runtimeProjectionId: null,
      personaRef: { id: "existing-persona-id", version: 1 }, ownerReportedPersonaVersion: null,
      referencesStatus: "linked", knowledgeBookDocumentId: "BOOK-ZHANNA", promptDocumentId: "PROMPT-ZHANNA" });
    expect(secretaryDepartmentSchema.safeParse(d).success).toBe(true);
    d.catalog.members[0].knowledgeBookDocumentId = "BOOK-ZHANNA";
    expect(secretaryDepartmentSchema.safeParse(d).success).toBe(false);
  });
  it("stops on existing department/head, ID/code conflicts, wrong Maria or native Katya; never merges silently", () => {
    expect(() => apply(apply(fixture()))).toThrow();
    for (const conflict of ["node", "profile", "head", "code", "maria", "katya"]) {
      const s = fixture(), template = nodes(s).find(n => n.kind === "role")!;
      if (conflict === "node") nodes(s).push({ ...template, id: "secretary-qa" });
      if (conflict === "code") nodes(s).push({ ...template, id: "other", code: "PLAN.SECRETARY.QA" });
      if (conflict === "katya") nodes(s).push({ ...template, id: "employee-katya" });
      if (conflict === "maria") nodes(s).find(n => n.id === "head-product")!.managerId = null;
      if (conflict === "profile" || conflict === "head") s.documents.push({ id: conflict === "profile"
        ? "DOC-PLANNED-secretary-qa" : "existing-secretary-head", title: "existing", text: conflict === "head"
          ? JSON.stringify({ mode: "secretary", visualPassport: { roleId: "old-secretary-head" } }) : "{}" } as any);
      if (conflict === "head") nodes(s).push({ ...template, id: "old-secretary-head", managerId: "head-product" });
      const before = JSON.stringify(s);
      expect(() => apply(s)).toThrow(); expect(JSON.stringify(s)).toBe(before);
    }
  });
  it("version-updates only manager metadata, preserving the old snapshot and rejecting malformed versions", () => {
    let s = fixture();
    s = applyCommand(s, { type: "createDocument", id: projectionManagersDocument, title: "existing manager",
      text: JSON.stringify({ format: "talkhint.team.projection-managers", version: 2,
        assignments: [{ projectionId: "employee-katya", managerId: "owner" }] }), url: "", elementIds: [] }, "owner");
    const updated = apply(s);
    expect(JSON.parse(updated.documents.find(d => d.id === projectionManagersDocument)!.text).version).toBe(3);
    expect(JSON.parse(s.documents.find(d => d.id === projectionManagersDocument)!.text).version).toBe(2);
    s.documents.find(d => d.id === projectionManagersDocument)!.text = "{}";
    expect(() => apply(s)).toThrow();
  });
  it("is production-only, write-scoped and rejects activation/task/schedule/provider/prompt payloads", () => {
    expect(writeTools.has(name)).toBe(true); expect(productionTeamTools.has(name)).toBe(true);
    for (const forbidden of ["tasks", "schedule", "executorId", "expenses", "prompt", "model", "voice", "personaId",
      "managerId", "department", "delete", "namesAccepted"])
      expect(inputs[name].safeParse({ ...args(1), [forbidden]: "not allowed" }).success).toBe(false);
  });
});

class Repo implements ModelRepository {
  state = fixture(); open = true; calls = 0; failTransaction = false;
  async read(owner: string, workspace?: string) {
    expect(owner).toBe("owner"); expect(workspace).toBe("new-country"); return structuredClone(this.state);
  }
  async update(owner: string, revision: number, c: ModelCommand, workspace?: string) {
    return this.updateMany(owner, revision, [c], workspace);
  }
  async updateMany(owner: string, revision: number, cs: ModelCommand[], workspace?: string) {
    expect(owner).toBe("owner"); expect(workspace).toBe("new-country");
    if (!this.open) throw new ModelError(423, "writes closed");
    if (revision !== this.state.revision) throw new ModelError(409, "stale");
    const candidate = cs.reduce((s, c) => applyCommand(s, c, owner), this.state);
    if (this.failTransaction) throw new ModelError(503, "transaction failed");
    this.state = candidate; this.calls++; return structuredClone(this.state);
  }
}
describe("Secretary MCP atomic write and readback", () => {
  it("stores graph, profiles, catalog, Katya manager and a non-accepted receipt in one call; rereads and deduplicates", async () => {
    const repo = new Repo(), service = new ProductCrewService(repo, { production: true }), a = args(repo.state.revision);
    const saved = await service.call("owner", name, a);
    expect(saved).toMatchObject({ saved: true, launched: false });
    expect(repo.calls).toBe(1);
    const read = await service.call("owner", "get_team", {});
    expect(read.secretaryDepartment.roles.projectHeadId).toBe("secretary-project-head");
    expect(read.roles.filter((r: any) => secretaryDepartmentRoles.some(p => p.id === r.id))).toHaveLength(3);
    expect(read.roles.find((r: any) => r.id === "secretary-qa").employeeProfiles[0].nameProposal.status).toBe("proposed");
    expect(read.projectionManagers).toEqual([{ projectionId: "employee-katya", managerId: "secretary-project-head" }]);
    const receipt = repo.state.elements.find(e => e.coordination?.operations.some(o => o.id === a.requestId))!;
    expect(receipt.coordination?.state).toBe("received");
    expect((await service.call("owner", name, a)).replayed).toBe(true); expect(repo.calls).toBe(1);
    await expect(service.call("owner", name, { ...a, reason: "different" })).rejects.toMatchObject({ status: 409 });
    await expect(service.call("owner", name, args(a.revision))).rejects.toMatchObject({ status: 409 });
  });
  it("refuses closed writes and Dev, and transaction failure leaves no half-department", async () => {
    const repo = new Repo(), service = new ProductCrewService(repo, { production: true }), a = args(repo.state.revision);
    const before = JSON.stringify(repo.state);
    repo.open = false;
    await expect(service.call("owner", name, a)).rejects.toMatchObject({ status: 423 });
    repo.open = true; repo.failTransaction = true;
    await expect(service.call("owner", name, a)).rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify(repo.state)).toBe(before);
    await expect(new ProductCrewService(repo).call("owner", name, a)).rejects.toMatchObject({ status: 403 });
  });
  it("projects three empty proposed-name cards and two slots; no duplicate Katya or old placeholder", () => {
    let s = applyCommand(fixture(), { type: "createDocument", id: DIRECTORY, title: "directory", text: JSON.stringify({
      teams: [{ id: "planned-secretary", name: "Катя", status: "planned", mode: "secretary", portrait: "katya" }],
      portraits: { katya: { url: "/katya.png" } } }), url: "", elementIds: [] }, "owner");
    s = apply(s);
    const data = s.operatingModel!.revisions.at(-1)!.data;
    const docs = s.documents.filter(d => d.id.startsWith("DOC-PLANNED-"));
    const c: any = { owner: "owner", revision: s.revision, workspace: "fixture", phase: "active", writesOpen: true,
      documents: s.documents, operating: { data }, jobs: [], controls: [], revisions: [], prompts: [],
      profiles: docs.map(d => { const p = JSON.parse(d.text); return { entity_id: p.visualPassport.roleId,
        source_document_id: d.id, profile_version: 1, display_name: null, trait_1: null, trait_2: null, trait_3: null,
        motto: null, portrait_file_url: null, owner_selection_status: "not_selected" }; }),
      roles: docs.map(d => ({ entity_id: JSON.parse(d.text).visualPassport.roleId,
        mode_source: `document:${d.id}`, mode: "secretary" })) };
    const view = teamView(c, "production");
    for (const r of secretaryDepartmentRoles) expect(view.members.find(m => m.id === r.id))
      .toMatchObject({ name: r.proposedName, nameStatus: "proposed", status: "planned", duties: [], portrait: null });
    expect(view.members.filter(m => m.id.startsWith("secretary-slot-"))).toHaveLength(2);
    expect(view.members.filter(m => m.id === "employee-katya")).toHaveLength(0); // Existing runtime supplies her once.
    expect(view.members.some(m => m.id === "planned-secretary")).toBe(false);
    expect(view.secretaryDepartment?.catalog.members).toHaveLength(1);
    c.secretaryTasks = [{ id: "task-fixture", call_sid: "call-fixture", user_id: "owner",
      instruction: "TEST only", voice_provider: "retell", dial_started_at: "2026-10-31T00:00:00Z",
      updated_at: "2026-10-31T00:00:00Z" }];
    const live = withTeamRuntime(view, c);
    expect(live.members.filter(m => m.id === "employee-katya")).toHaveLength(1);
    expect(live.members.find(m => m.id === "employee-katya")?.relations)
      .toContainEqual(expect.objectContaining({ kind: "Подчиняется", id: "secretary-project-head" }));
    const broken = structuredClone(c);
    broken.documents.find((d: any) => d.id === SECRETARY_DEPARTMENT_DOCUMENT).text = "{}";
    expect(() => teamView(broken, "production")).toThrow();
  });
});
