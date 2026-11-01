import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { ModelError } from "../projectModel/modelError";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import type { ModelRepository } from "../projectModel/repository";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { secretaryDepartmentRoles, SECRETARY_DEPARTMENT_DOCUMENT } from "../../shared/secretaryDepartment";
import { ProductCrewService, inputs } from "./service";
import { buildTeamChange, projectionManagersDocument } from "./teamChanges";

const args = (s: ProjectModelState, roleId: string, title: string, mode = "secretary") => ({
  revision: s.revision, requestId: randomUUID(), roleId, title, mode,
  reason: "Только название", ownerDecisionRef: "Решение владельца: единые названия должностей",
});
const nodes = (s: ProjectModelState) => s.operatingModel!.revisions.at(-1)!.data.nodes;
const document = (s: ProjectModelState, id: string) => s.documents.find(d => d.id === `DOC-PLANNED-${id}`)!;
const profile = (s: ProjectModelState, id: string) => JSON.parse(document(s, id).text);
function apply(s: ProjectModelState, name: keyof typeof inputs, raw: unknown) {
  const a = inputs[name].parse(raw);
  return buildTeamChange(s, name as any, a).commands.reduce((v, c) => applyCommand(v, c, "owner"), s);
}
function fixture() {
  let s = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  nodes(s).find(n => n.id === "head-product")!.managerId = "owner";
  s = apply(s, "create_secretary_department_structure", {
    revision: s.revision, requestId: randomUUID(), reason: "Структура", ownerDecisionRef: "Владелец",
  });
  for (const r of secretaryDepartmentRoles) {
    const p = profile(s, r.id);
    p.promptDraft = "Fixture only: do not change personality or activate.";
    p.duties = [{ id: "fixture-duty", text: "Preserve this description" }];
    p.prohibitions = ["No money", "No self-acceptance"];
    document(s, r.id).text = JSON.stringify(p);
  }
  return s;
}

describe("planned-role title changes inside an existing department", () => {
  it.each([
    ["secretary-lab-engineer", "Инженер лаборатории"],
    ["secretary-qa", "Проверяющий"],
    ["secretary-project-head", "Руководитель проекта Секретарь"],
  ])("renames %s with sibling planned roles, preserving all other content", (id, title) => {
    const s = fixture(), immutable = JSON.stringify(s);
    const a = args(s, id, title);
    const commands = buildTeamChange(s, "update_role_title", inputs.update_role_title.parse(a)).commands;
    expect(commands.map(c => c.type)).toEqual(["saveOperatingModel", "saveDocument"]);
    const after = apply(s, "update_role_title", a);
    const expectedGraph = structuredClone(s.operatingModel!.revisions.at(-1)!.data);
    expectedGraph.nodes.find(n => n.id === id)!.name = title;
    expect(after.operatingModel!.revisions.at(-1)!.data).toEqual(expectedGraph);
    const expectedProfile = profile(s, id);
    expectedProfile.version++;
    expectedProfile.visualPassport.position = title;
    expect(profile(after, id)).toEqual(expectedProfile);
    expect(after.documents).toHaveLength(s.documents.length);
    for (const d of s.documents.filter(d => d.id !== document(s, id).id))
      expect(after.documents.find(v => v.id === d.id)).toEqual(d);
    expect(after.elements).toEqual(s.elements);
    expect(JSON.stringify(s)).toBe(immutable);
    expect(profile(after, id).visualPassport.nameProposal.status).toBe("proposed");
    expect(nodes(after).find(n => n.id === id)?.executorId).toBeNull();
  });

  it("still rejects creation of another Secretary lead after a title change", () => {
    const s = apply(fixture(), "update_role_title", args(fixture(), "secretary-qa", "Проверяющий"));
    expect(() => apply(s, "create_planned_role", {
      revision: s.revision, requestId: randomUUID(), id: "another-secretary-head",
      title: "Дубль", mode: "secretary", managerId: "head-product",
      reason: "Fixture", ownerDecisionRef: "Fixture",
    })).toThrow("Пустая должность этого режима уже существует.");
  });

  it("still rejects a mode change into an already occupied planned mode", () => {
    let s = fixture();
    s = apply(s, "create_planned_role", {
      revision: s.revision, requestId: randomUUID(), id: "planned-copilot-head",
      title: "Copilot", mode: "copilot", managerId: "head-product",
      reason: "Fixture", ownerDecisionRef: "Fixture",
    });
    const before = JSON.stringify(s);
    expect(() => apply(s, "update_role_title", args(s, "secretary-lab-engineer", "Engineer", "copilot")))
      .toThrow("Пустая должность этого режима уже существует.");
    expect(JSON.stringify(s)).toBe(before);
  });

  it("still protects Katya's manager from losing Secretary mode", () => {
    const s = fixture(), before = JSON.stringify(s);
    expect(() => apply(s, "update_role_title", args(s, "secretary-project-head", "Hint", "hint")))
      .toThrow("Нельзя убрать режим Секретарь у руководителя Кати.");
    expect(JSON.stringify(s)).toBe(before);
  });

  it.each(["prompt", "duties", "managerId", "executorId", "selectedName"])(
    "does not accept an extra %s field through the title tool", field => {
      const s = fixture();
      expect(inputs.update_role_title.safeParse({
        ...args(s, "secretary-qa", "Проверяющий"), [field]: "overwrite",
      }).success).toBe(false);
    },
  );

  it("refuses an unknown role or an ambiguous profile without modifying state", () => {
    const s = fixture(), before = JSON.stringify(s);
    expect(() => apply(s, "update_role_title", args(s, "missing-role", "Title"))).toThrow();
    expect(JSON.stringify(s)).toBe(before);
    s.documents.push({ ...document(s, "secretary-qa"), id: "duplicate-profile" });
    const ambiguous = JSON.stringify(s);
    expect(() => apply(s, "update_role_title", args(s, "secretary-qa", "Проверяющий")))
      .toThrow("Нужна одна существующая анкета роли.");
    expect(JSON.stringify(s)).toBe(ambiguous);
  });

  it("supports both renames through the production service, reread and idempotent receipt within three commands", async () => {
    let state = fixture(), writes = 0;
    const repo = {
      read: async () => state,
      updateMany: async (owner: string, revision: number, commands: ModelCommand[]) => {
        expect(owner).toBe("owner");
        if (revision !== state.revision) throw new ModelError(409, "CAS");
        expect(commands).toHaveLength(3); // graph + profile + receipt; no larger-batch exception
        state = commands.reduce((s, c) => applyCommand(s, c, owner), state);
        writes++;
        return state;
      },
    } as unknown as ModelRepository;
    const service = new ProductCrewService(repo, { production: true });
    const catalog = structuredClone(state.documents.find(d => d.id === SECRETARY_DEPARTMENT_DOCUMENT));
    const katya = structuredClone(state.documents.find(d => d.id === projectionManagersDocument));
    for (const [id, title] of [["secretary-lab-engineer", "Инженер лаборатории"], ["secretary-qa", "Проверяющий"]]) {
      const a = args(state, id, title);
      const result = await service.call("owner", "update_role_title", a);
      const team = await service.call("owner", "get_team", {});
      expect(team.revision).toBe(result.revision);
      expect(team.roles.find((r: any) => r.id === id).name).toBe(title);
      const saved = await service.call("owner", "get_document", { documentId: document(state, id).id });
      expect(saved.revision).toBe(result.revision);
      expect(JSON.parse(saved.text).visualPassport.position).toBe(title);
      const version = profile(state, id).version, count = writes;
      expect((await service.call("owner", "update_role_title", a)).replayed).toBe(true);
      expect(writes).toBe(count);
      expect(profile(state, id).version).toBe(version);
    }
    expect(writes).toBe(2);
    expect(state.documents.find(d => d.id === SECRETARY_DEPARTMENT_DOCUMENT)).toEqual(catalog);
    expect(state.documents.find(d => d.id === projectionManagersDocument)).toEqual(katya);
    await expect(service.call("owner", "update_role_title", {
      ...args(state, "secretary-qa", "Проверяющий"), revision: state.revision - 1,
    })).rejects.toMatchObject({ status: 409 });
    await expect(new ProductCrewService(repo).call("owner", "update_role_title",
      args(state, "secretary-qa", "Проверяющий"))).rejects.toMatchObject({ status: 403 });
    expect(writes).toBe(2);
  });
});
