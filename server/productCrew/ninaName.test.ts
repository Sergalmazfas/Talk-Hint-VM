import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildTeamChange } from "./teamChanges";
import { businessTables, project, type Schema } from "../companyData/relational";
import { teamView } from "../team/view";
import type { ProjectModelState } from "../../shared/projectModel";

const roleId = "proposal-4fe46862-f07e-562b-b6d7-4ab34716a545";
const target = "DOC-PORG-OPERATING-PASSPORT";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture(status: unknown = "proposed", name: unknown = "Нина Кадрова") {
  const s = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  const data = s.operatingModel!.revisions.at(-1)!.data;
  data.nodes.push({ ...structuredClone(data.nodes.find(n => n.kind === "role")!),
    id: roleId, code: "P.ORG", name: "Руководитель отдела кадров", managerId: "owner", executorId: null });
  const nina = { format: "talkhint.employee.profile", version: 2, resolvedRoleId: roleId,
    activation: false, employee: { code: "P.ORG", name, nameStatus: status,
      position: "Руководитель отдела кадров", character: { traits: ["a", "b", "c"], motto: "m" } },
    duties: ["Учить, не менять личность"], clients: ["Владелец"], prohibitions: ["Не включать агентов"],
    promptDraft: { personality: "Не менять", skills: "Предлагать уроки", tasks: "От руководителей" } };
  s.documents.push({ id: "nina-source", title: "Nina v2 fixture", text: JSON.stringify({ documents: { "nina-v2": nina } }),
    url: "", elementIds: [], updatedAt: "" } as any);
  s.documents.push({ id: target, title: "existing P.ORG", text: "# Previous passport", url: "", elementIds: [], updatedAt: "" } as any);
  return s;
}
function replace(s: ProjectModelState) {
  const source = s.documents.find(d => d.id === "nina-source")!, old = s.documents.find(d => d.id === target)!;
  return buildTeamChange(s, "replace_employee_profile", { revision: s.revision, requestId: randomUUID(),
    reason: "Preserve proposal", ownerDecisionRef: "Profile transfer, not name acceptance",
    roleId, sourceDocumentId: source.id, sourceHash: sha(source.text), targetHash: sha(old.text) })
    .commands.reduce((state, command) => applyCommand(state, command, "owner"), s);
}
const profile = (s: ProjectModelState) => JSON.parse(s.documents.find(d => d.id === target)!.text);

// Focused schema fixture: use the real production projector's name/acceptance
// mapping, not handwritten employee-profile rows. No SQL or database writes.
function projection(s: ProjectModelState) {
  const schema = Object.fromEntries(businessTables.map(t =>
    [t, { columns: [], keys: t === "company_record_locations" ? ["source_pointer"] : [] }])) as Schema;
  schema.company_extra_fields = {
    keys: ["workspace_id", "revision", "hypothesis_id", "source_path"],
    columns: ["workspace_id", "revision", "hypothesis_id", "source_path", "value_type", "string_value"]
      .map(name => ({ name, type: "text", nullable: true, defaultValue: null })),
  };
  for (const table of ["company_roles", "company_employee_profiles"] as const) {
    const keys = ["workspace_id", "hypothesis_id", "operating_version", "entity_id"];
    const columns = table === "company_roles" ? [...keys, "mode", "mode_source"] :
      [...keys, "profile_version", "display_name", "trait_1", "trait_2", "trait_3", "motto",
        "portrait_file_url", "owner_selection_status", "source_document_id", "accepted_by", "accepted_at"];
    schema[table] = { keys: table === "company_roles" ? keys : [...keys, "profile_version"],
      columns: columns.map(name => ({ name, type: "text", nullable: true, defaultValue: null })) };
  }
  return project(s, "fixture", schema).tables;
}
describe("Nina v2 name approval stays separate from profile transfer", () => {
  it("preserves the complete source, draft, graph and proposed name without accepting or activating", () => {
    const before = fixture(), original = JSON.stringify(before), after = replace(before), p = profile(after);
    expect(p.visualPassport).toMatchObject({ selectedName: null, ownerSelectionStatus: "proposed",
      nameProposal: { value: "Нина Кадрова", status: "proposed" } });
    const source = JSON.parse(before.documents.find(d => d.id === "nina-source")!.text).documents["nina-v2"];
    expect(p.sourceProfile).toEqual(source); expect(p.promptDraft).toEqual(source.promptDraft);
    for (const key of ["duties", "clients", "prohibitions"]) expect(p[key]).toEqual(source[key]);
    expect(p.visualPassport.character).toEqual(source.employee.character);
    expect(p).toMatchObject({ runtimeChanged: false, status: "described_not_connected" });
    expect(p.prompt).toBeUndefined();
    expect(after.operatingModel).toEqual(before.operatingModel);
    expect(after.documents.find(d => d.id === "nina-source")).toEqual(before.documents.find(d => d.id === "nina-source"));
    expect(JSON.stringify(before)).toBe(original);
  });
  it("projects and displays proposed without owner acceptance; repeated transfer stays proposed", () => {
    const s = replace(replace(fixture())), p = profile(s), tables = projection(s);
    const physical = tables.get("company_employee_profiles")!.find(row => row.entity_id === roleId)!;
    expect(physical).toMatchObject({ display_name: null, owner_selection_status: "not_selected",
      accepted_by: null, accepted_at: null, source_document_id: target, profile_version: 2 });
    const c: any = { owner: "owner", revision: s.revision, workspace: "fixture", phase: "active", writesOpen: true,
      documents: s.documents, operating: { data: s.operatingModel!.revisions.at(-1)!.data },
      jobs: [], secretaryTasks: [], controls: [], revisions: [], prompts: [],
      profiles: tables.get("company_employee_profiles"), roles: tables.get("company_roles") };
    expect(teamView(c, "production").members.find(m => m.id === roleId))
      .toMatchObject({ name: "Нина Кадрова", nameStatus: "proposed", status: "disconnected" });
    expect(p.version).toBe(2);
  });
  it("keeps an explicitly accepted source name accepted, without a new proposal", () => {
    const s = replace(fixture("accepted")), p = profile(s);
    expect(p.visualPassport.selectedName).toBe("Нина Кадрова");
    expect(p.visualPassport.nameProposal).toBeUndefined();
    expect(projection(s).get("company_employee_profiles")!.find(row => row.entity_id === roleId))
      .toMatchObject({ display_name: "Нина Кадрова", owner_selection_status: "accepted", accepted_by: "owner" });
  });
  it.each([undefined, null, "", "not_selected", "unknown"])("refuses ambiguous source name status %s", status => {
    const s = fixture(status === undefined ? "remove-me" : status);
    if (status === undefined) {
      const d = s.documents.find(d => d.id === "nina-source")!, source = JSON.parse(d.text);
      delete source.documents["nina-v2"].employee.nameStatus; d.text = JSON.stringify(source);
    }
    const original = JSON.stringify(s);
    expect(() => replace(s)).toThrow("статус proposed/accepted");
    expect(JSON.stringify(s)).toBe(original);
  });
  it.each(["", "  ", null, 123])("refuses invalid name %s without a partial replacement", name => {
    const s = fixture("proposed", name), original = JSON.stringify(s);
    expect(() => replace(s)).toThrow(); expect(JSON.stringify(s)).toBe(original);
  });
});
