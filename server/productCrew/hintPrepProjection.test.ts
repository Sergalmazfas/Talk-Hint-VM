import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import canonical from "../../shared/hintCallPrepProfile.json";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { businessTables, project, type Schema } from "../companyData/relational";
import { assertTransactionBatch } from "../projectModel/transactionBatch";
import { ProductCrewService } from "./service";
import { hintPrepSourceHash, hintPrepDocumentId, hintPrepRoleId } from "./hintCallPrepRole";
import { PgModelRepository } from "../projectModel/repository";
import { CompanyModelRepository } from "../companyData/repository";
import { CommandCompanyRepository } from "../companyData/v3/commands";

function fixture() {
  const s = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  const nodes = s.operatingModel!.revisions.at(-1)!.data.nodes;
  let manager = nodes.find(n => n.id === "product-manager-specialist");
  if (!manager) {
    manager = { ...structuredClone(nodes.find(n => n.id === "head-product")!),
      id: "product-manager-specialist", code: "P.PRODUCT", managerId: "head-product" };
    nodes.push(manager);
  }
  if (!nodes.some(n => n.id === "lg-qa-role")) nodes.push({ ...structuredClone(manager),
    id: "lg-qa-role", code: "P.LG.QA", managerId: manager.id, executorId: null });
  return s;
}
function projection(s: ProjectModelState) {
  // Focused projection schema. The offline r1208 reproduction additionally uses
  // inspectSchema against the actual Dev schema; these unit tests need no DB.
  const schema: Schema = Object.fromEntries(businessTables.map(t =>
    [t, { keys: ["source_pointer"], columns: [] }]));
  schema.company_extra_fields = {
    keys: ["workspace_id", "revision", "hypothesis_id", "source_path"],
    columns: ["workspace_id", "revision", "hypothesis_id", "source_path", "value_type", "string_value"]
      .map(name => ({ name, type: "text", nullable: true, defaultValue: null })),
  };
  for (const table of ["company_roles", "company_employee_profiles"] as const) {
    const keys = ["workspace_id", "hypothesis_id", "operating_version", "entity_id"];
    const cols = table === "company_roles" ? [...keys, "mode", "mode_source"] :
      [...keys, "profile_version", "display_name", "trait_1", "trait_2", "trait_3", "motto",
        "owner_selection_status", "source_document_id", "accepted_by", "accepted_at"];
    schema[table] = { keys: table === "company_roles" ? keys : [...keys, "profile_version"],
      columns: cols.map(name => ({ name, type: "text", nullable: true, defaultValue: null })) };
  }
  return project(JSON.parse(JSON.stringify(s)), "offline", schema).tables;
}
async function created() {
  let state = fixture(), commands: ModelCommand[] = [];
  const input = { revision: state.revision, requestId: randomUUID(), sourceHash: hintPrepSourceHash,
    reason: "Fixed P.PREP", ownerDecisionRef: "Owner's original profile" };
  const service = new ProductCrewService({ read: async () => state,
    update: async () => { throw Error("unexpected single write"); },
    updateMany: async (owner, revision, batch, hypothesis) => {
      assertTransactionBatch(owner, revision, batch, hypothesis!);
      commands = batch;
      state = batch.reduce((s, c) => applyCommand(s, c, owner), state);
      return state;
    } }, { production: true });
  const before = state.revision;
  const result = await service.call("owner", "create_hint_call_prep_role", input);
  return { state, commands, result, before, service, input };
}
describe("fixed owner P.PREP profile crosses the real relational projector", () => {
  it.each(["pg", "normalized", "v3-update", "v3-write"])("actual %s guard admits three, rejects four without an exception", async kind => {
    const { commands } = await created(), marker = new Error("SQL boundary");
    const storage = vi.fn().mockRejectedValue(marker);
    const repo = kind === "pg" ? new PgModelRepository(storage) :
      kind === "normalized" ? new CompanyModelRepository(storage, "production") :
        new CommandCompanyRepository({ commitDelta: storage, pool: { query: storage },
          environment: "production" } as any);
    const call = kind === "v3-write" ? (repo as CommandCompanyRepository).writeMany.bind(repo) : repo.updateMany.bind(repo);
    await expect(call("owner", 1208, commands, "new-country")).rejects.toBe(marker);
    expect(storage).toHaveBeenCalledOnce();
    storage.mockClear();
    await expect(call("owner", 1208, [...commands, commands[0]], "new-country")).rejects.toMatchObject({ status: 400 });
    expect(storage).not.toHaveBeenCalled();
  });
  it("preserves the canonical JSON and projects deliberately unassigned character as NULL", async () => {
    const { state, commands, result, before, service, input } = await created();
    expect(commands.map(c => c.type)).toEqual(["saveOperatingModel", "createDocument", "createElement"]);
    expect(result).toMatchObject({ saved: true, launched: false, revision: before + 3 });
    const original = JSON.stringify(state);
    expect(projection(state).get("company_employee_profiles")!.find(r => r.entity_id === hintPrepRoleId))
      .toMatchObject({ trait_1: null, trait_2: null, trait_3: null, motto: null,
        display_name: null, owner_selection_status: "not_selected" });
    expect(JSON.stringify(state)).toBe(original);
    expect(JSON.parse(state.documents.find(d => d.id === hintPrepDocumentId)!.text)).toEqual(canonical);
    expect(await service.call("owner", "create_hint_call_prep_role", input)).toMatchObject({ replayed: true });
    expect(state.revision).toBe(before + 3);
  });
  it.each(["document", "role", "format", "status", "extraCharacter", "partialTraits"])
    ("does not extend the compatibility exception to %s", async variant => {
      const { state } = await created(), doc = state.documents.find(d => d.id === hintPrepDocumentId)!;
      const p = JSON.parse(doc.text);
      if (variant === "document") doc.id = "DOC-OTHER";
      if (variant === "role") p.visualPassport.roleId = "product-manager-specialist";
      if (variant === "format") p.format = "unrecognized";
      if (variant === "status") p.character.status = "different";
      if (variant === "extraCharacter") p.character.traits = ["not approved"];
      if (variant === "partialTraits") p.visualPassport.character = { traits: ["one", "two"] };
      doc.text = JSON.stringify(p);
      expect(() => projection(state)).toThrow("Profile must have exactly 3 traits");
    });
  it("still projects an explicitly supplied three-trait profile normally", async () => {
    const { state } = await created(), doc = state.documents.find(d => d.id === hintPrepDocumentId)!;
    const p = JSON.parse(doc.text);
    p.visualPassport.character = { traits: ["first", "second", "third"], motto: "approved elsewhere" };
    doc.text = JSON.stringify(p);
    expect(projection(state).get("company_employee_profiles")!.find(r => r.entity_id === hintPrepRoleId))
      .toMatchObject({ trait_1: "first", trait_2: "second", trait_3: "third", motto: "approved elsewhere" });
  });
  it("survives descriptive section/version updates without inventing character or enabling a model", async () => {
    const { state } = await created(), doc = state.documents.find(d => d.id === hintPrepDocumentId)!;
    const p = JSON.parse(doc.text);
    p.version++;
    p.workplace = { purpose: "descriptive only" };
    p.modelRecommendation = { model: "Claude Sonnet 5.5", enabled: false, status: "proposed" };
    doc.text = JSON.stringify(p);
    expect(() => projection(state)).not.toThrow();
    expect(JSON.parse(doc.text).character).toEqual(canonical.character);
    expect(state.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === hintPrepRoleId)!.executorId).toBeNull();
  });
});
