import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { businessTables, project, type Schema } from "../companyData/relational";
import { teamView } from "../team/view";
import { assertTransactionBatch } from "../projectModel/transactionBatch";
import { buildTeamChange, projectionManagersDocument } from "./teamChanges";
import { ProductCrewService, inputs, productionTeamTools, writeTools } from "./service";
import type { ProjectModelState, ModelCommand } from "../../shared/projectModel";
import { approveSecretaryNameCommands, approveSecretaryNameInput } from "./approveSecretaryName";

const roles = ["secretary-project-head", "secretary-lab-engineer", "secretary-qa"] as const;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  let s = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  s.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === "head-product")!.managerId = "owner";
  s = buildTeamChange(s, "create_secretary_department_structure", {}).commands
    .reduce((state, command) => applyCommand(state, command, "owner"), s);
  return s;
}
const doc = (s: ProjectModelState, roleId: string) => s.documents.find(d => d.id === `DOC-PLANNED-${roleId}`)!;
const args = (s: ProjectModelState, roleId: typeof roles[number]) => ({
  revision: s.revision, requestId: randomUUID(), roleId, profileHash: sha(doc(s, roleId).text),
  reason: "Утвердить уже предложенное имя, не включать",
  ownerDecisionRef: "Явное решение владельца: Сева, Лёва, Тома утверждены",
});
function projection(s: ProjectModelState) {
  const schema = Object.fromEntries(businessTables.map(t =>
    [t, { columns: [], keys: t === "company_record_locations" ? ["source_pointer"] : [] }])) as Schema;
  schema.company_extra_fields = { keys: ["workspace_id", "revision", "hypothesis_id", "source_path"],
    columns: ["workspace_id", "revision", "hypothesis_id", "source_path", "value_type", "string_value"]
      .map(name => ({ name, type: "text", nullable: true, defaultValue: null })) };
  for (const table of ["company_roles", "company_employee_profiles"] as const) {
    const keys = ["workspace_id", "hypothesis_id", "operating_version", "entity_id"];
    const columns = table === "company_roles" ? [...keys, "mode", "mode_source"] :
      [...keys, "profile_version", "display_name", "trait_1", "trait_2", "trait_3", "motto",
        "portrait_file_url", "owner_selection_status", "source_document_id", "accepted_by", "accepted_at"];
    schema[table] = { keys: table === "company_roles" ? keys : [...keys, "profile_version"],
      columns: columns.map(name => ({ name, type: "text", nullable: true, defaultValue: null })) };
  }
  // Domain creation audits can contain before:undefined; the real repository
  // crosses this JSON boundary before projecting the normalized columns.
  return project(JSON.parse(JSON.stringify(s)), "fixture", schema).tables;
}
describe("Fixed Secretary name approval", () => {
  it.each(roles)("changes only name approval source fields and version: %s", roleId => {
    const s = fixture(), original = JSON.stringify(s), d = doc(s, roleId), before = JSON.parse(d.text);
    const change = approveSecretaryNameCommands(s, args(s, roleId));
    expect(change.commands).toHaveLength(1);
    expect(change.commands[0].type).toBe("saveDocument");
    const after = change.commands.reduce((v, c) => applyCommand(v, c, "owner"), s);
    const expected = structuredClone(before);
    expected.version++;
    expected.visualPassport.selectedName = expected.visualPassport.nameProposal.value;
    expected.visualPassport.nameProposal.status = "accepted";
    expected.visualPassport.ownerSelectionStatus = "accepted";
    expect(JSON.parse(doc(after, roleId).text)).toEqual(expected);
    expect(after.operatingModel).toEqual(s.operatingModel);
    expect(after.documents.filter(x => x.id !== d.id)).toEqual(s.documents.filter(x => x.id !== d.id));
    expect(JSON.stringify(s)).toBe(original);
    const tables = projection(after);
    const context: any = { owner: "owner", revision: after.revision, workspace: "fixture",
      phase: "active", writesOpen: true, documents: after.documents,
      operating: { data: after.operatingModel!.revisions.at(-1)!.data },
      jobs: [], secretaryTasks: [], controls: [], revisions: [], prompts: [],
      profiles: tables.get("company_employee_profiles"), roles: tables.get("company_roles") };
    const member = teamView(context, "production").members.find(m => m.id === roleId)!;
    expect(member.nameStatus).toBe("accepted");
    expect(member.name).toBe(expected.visualPassport.selectedName);
    expect(member.status).not.toBe("running");
  });
  it("rejects arbitrary roles, names, activation, prompts or graph edits", () => {
    const s = fixture(), a = args(s, roles[0]);
    for (const extra of [{ roleId: "employee-katya" }, { roleId: "hint-call-prep-master" },
      { name: "Another" }, { enabled: true }, { prompt: "x" }, { managerId: "x" }])
      expect(() => approveSecretaryNameInput.parse({ ...a, ...extra })).toThrow();
    expect(inputs.approve_secretary_name).toBe(approveSecretaryNameInput);
    expect(productionTeamTools.has("approve_secretary_name")).toBe(true);
    expect(writeTools.has("approve_secretary_name")).toBe(true);
  });
  it("refuses stale hash, duplicate profile, altered proposal, unknown format, or an already accepted name", () => {
    for (const mutate of [
      (s: ProjectModelState) => { doc(s, roles[0]).text += " "; },
      (s: ProjectModelState) => { s.documents.push({ ...doc(s, roles[0]), id: "duplicate" }); },
      (s: ProjectModelState) => { const p = JSON.parse(doc(s, roles[0]).text); p.visualPassport.nameProposal.value = "Other"; doc(s, roles[0]).text = JSON.stringify(p); },
      (s: ProjectModelState) => { const p = JSON.parse(doc(s, roles[0]).text); p.format = "unknown"; doc(s, roles[0]).text = JSON.stringify(p); },
      (s: ProjectModelState) => { const p = JSON.parse(doc(s, roles[0]).text); p.visualPassport.nameProposal.status = "accepted"; doc(s, roles[0]).text = JSON.stringify(p); },
    ]) {
      const s = fixture(), a = args(s, roles[0]); mutate(s);
      expect(() => approveSecretaryNameCommands(s, a)).toThrow();
    }
  });
  it("uses the real two-command size guard including receipt; same UUID replays with no write", async () => {
    let s = fixture(), writes = 0;
    const repo = { read: async () => structuredClone(s), update: async () => { throw Error("single write forbidden"); },
      updateMany: async (owner: string, revision: number, commands: ModelCommand[]) => {
        assertTransactionBatch(owner, revision, commands, "new-country");
        expect(commands).toHaveLength(2); writes++;
        s = commands.reduce((state, c) => applyCommand(state, c, owner), s);
        return structuredClone(s);
      } };
    const service = new ProductCrewService(repo, { production: true });
    const a = args(s, roles[0]), before = s.revision;
    expect(await service.call("owner", "approve_secretary_name", a))
      .toMatchObject({ saved: true, launched: false, revision: before + 2 });
    expect(await service.call("owner", "approve_secretary_name", a)).toMatchObject({ replayed: true });
    expect(writes).toBe(1);
    await expect(new ProductCrewService(repo).call("owner", "approve_secretary_name", args(s, roles[1])))
      .rejects.toMatchObject({ status: 403 });
    expect(s.documents.some(d => d.id === projectionManagersDocument)).toBe(true);
  });
});
