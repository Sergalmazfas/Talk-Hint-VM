import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import canonical from "../../shared/hintCallPrepProfile.json";
import { createHintPrepRole, createHintPrepRoleInput, hintPrepSourceHash, hintPrepRoleId,
  hintPrepDocumentId } from "./hintCallPrepRole";
import { inputs, productionTeamTools, writeTools, ProductCrewService } from "./service";
import type { ModelCommand } from "../../shared/projectModel";
import { ModelError } from "../projectModel/modelError";

function fixture() {
  const state = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  const nodes = state.operatingModel!.revisions.at(-1)!.data.nodes;
  if (!nodes.some(n => n.id === "product-manager-specialist"))
    nodes.push({ ...structuredClone(nodes.find(n => n.id === "head-product")!),
      id: "product-manager-specialist", code: "P.PRODUCT", managerId: "head-product" });
  if (!nodes.some(n => n.id === "lg-qa-role")) {
    const template = nodes.find(n => n.id === "product-manager-specialist")!;
    nodes.push({ ...structuredClone(template), id: "lg-qa-role", code: "P.LG.QA",
      name: "Проверяющий", managerId: "product-manager-specialist", executorId: null });
  }
  return state;
}
const args = () => ({ revision: 1, requestId: randomUUID(), sourceHash: hintPrepSourceHash,
  reason: "Добавить только предложенную P.PREP", ownerDecisionRef: "Анкета владельца v1" });

describe("fixed P.PREP creation", () => {
  it("preserves every supplied profile field and requires its canonical hash", () => {
    // Digest of the original owner attachment after JSON serialization; no CI
    // dependency on an untracked/private attached_assets directory.
    expect(hintPrepSourceHash).toBe("0c9f2acc375d1c1069cead29a54dc257b18f69da7447b8a888ccea3a68edbb91");
    expect(hintPrepSourceHash).toBe(createHash("sha256").update(JSON.stringify(canonical)).digest("hex"));
    expect(createHintPrepRoleInput.safeParse({ ...args(), sourceHash: "0".repeat(64) }).success).toBe(false);
  });
  it("uses existing production-only write guards, not a general importer", () => {
    expect(inputs.create_hint_call_prep_role).toBe(createHintPrepRoleInput);
    expect(productionTeamTools.has("create_hint_call_prep_role")).toBe(true);
    expect(writeTools.has("create_hint_call_prep_role")).toBe(true);
    for (const injection of [{ roleId: "head-product" }, { profile: {} }, { enabled: true },
      { executorId: "owner" }, { modelId: "other" }, { managerId: "owner" }])
      expect(createHintPrepRoleInput.safeParse({ ...args(), ...injection }).success).toBe(false);
  });
  it("atomically prepares exactly two model commands; no activation or parent edits", () => {
    const before = fixture(), snapshot = structuredClone(before);
    const result = createHintPrepRole(before, args());
    expect(before).toEqual(snapshot);
    expect(result.commands.map(c => c.type)).toEqual(["saveOperatingModel", "createDocument"]);
    const after = result.commands.reduce((s, c) => applyCommand(s, c, "owner"), before);
    const data = after.operatingModel!.revisions.at(-1)!.data;
    expect(data.nodes.filter(n => n.id !== hintPrepRoleId)).toEqual(snapshot.operatingModel!.revisions.at(-1)!.data.nodes);
    expect(data.nodes.find(n => n.id === hintPrepRoleId)).toMatchObject({
      status: "proposal", executorId: null, managerId: "product-manager-specialist",
      acceptorId: "product-manager-specialist", resourceIds: [],
      schedule: { days: [], trigger: "", hours: "" },
    });
    expect(data.links.find(l => l.id === "review-hint-call-prep-master")).toMatchObject({ to: "lg-qa-role" });
    expect(JSON.parse(after.documents.find(d => d.id === hintPrepDocumentId)!.text)).toEqual(canonical);
    expect(after.revision - before.revision).toBe(2);
    expect(() => createHintPrepRole(after, args())).toThrow(/уже существует/);
  });
  it.each(["product-manager-specialist", "lg-qa-role"])("refuses missing required role %s without changes", id => {
    const state = fixture(), data = state.operatingModel!.revisions.at(-1)!.data;
    data.nodes = data.nodes.filter(n => n.id !== id);
    const before = structuredClone(state);
    expect(() => createHintPrepRole(state, args())).toThrow(/Нужны существующие/);
    expect(state).toEqual(before);
  });
  it.each(["node", "code", "document", "profile", "link"])("refuses %s collisions without overwrite", kind => {
    const state = fixture(), data = state.operatingModel!.revisions.at(-1)!.data;
    if (kind === "node" || kind === "code") data.nodes.push({ ...data.nodes[0],
      id: kind === "node" ? hintPrepRoleId : "another-role", code: kind === "code" ? "P.PREP" : "OTHER" });
    if (kind === "document" || kind === "profile") state.documents.push({
      id: kind === "document" ? hintPrepDocumentId : "another-profile", title: "Existing",
      text: JSON.stringify(canonical), url: "", elementIds: [], version: 1, updatedAt: "" } as any);
    if (kind === "link") data.links.push({ id: "line-hint-call-prep-master",
      from: "owner", to: "head-product", kind: "feedback", reason: "Existing" });
    const before = structuredClone(state);
    expect(() => createHintPrepRole(state, args())).toThrow(/уже существует/);
    expect(state).toEqual(before);
  });
  it("uses one atomic three-command transaction including receipt, reads back, never replays a changed request", async () => {
    let state = fixture(), writes = 0;
    const repo: any = {
      read: async () => structuredClone(state),
      updateMany: async (_owner: string, revision: number, commands: ModelCommand[]) => {
        if (revision !== state.revision) throw new ModelError(409, "stale");
        expect(commands).toHaveLength(3);
        writes++;
        state = commands.reduce((s, c) => applyCommand(s, c, "owner"), state);
        return structuredClone(state);
      },
    };
    const service = new ProductCrewService(repo, { production: true });
    const before = state.revision, input = { ...args(), revision: before };
    const receipt = await service.call("owner", "create_hint_call_prep_role", input);
    expect(receipt).toMatchObject({ saved: true, launched: false, revision: before + 3 });
    const team = await service.call("owner", "get_team", { roleId: hintPrepRoleId });
    expect(team.revision).toBe(before + 3);
    expect(team.roles[0].employeeProfiles).toHaveLength(1);
    expect(await service.call("owner", "create_hint_call_prep_role", input)).toMatchObject({ replayed: true });
    await expect(service.call("owner", "create_hint_call_prep_role", { ...input, reason: "changed" }))
      .rejects.toMatchObject({ status: 409 });
    expect(writes).toBe(1);
  });
  it("rejects Dev, stale revision and closed writes without persisting any role", async () => {
    const state = fixture();
    let writes = 0;
    const repo: any = { read: async () => structuredClone(state),
      updateMany: async () => { writes++; throw new ModelError(423, "writes closed"); } };
    await expect(new ProductCrewService(repo).call("owner", "create_hint_call_prep_role", args()))
      .rejects.toMatchObject({ status: 403 });
    const service = new ProductCrewService(repo, { production: true });
    await expect(service.call("owner", "create_hint_call_prep_role", { ...args(), revision: state.revision + 1 }))
      .rejects.toMatchObject({ status: 409 });
    expect(writes).toBe(0);
    await expect(service.call("owner", "create_hint_call_prep_role", { ...args(), revision: state.revision }))
      .rejects.toMatchObject({ status: 423 });
    expect(state.operatingModel!.revisions.at(-1)!.data.nodes.some(n => n.id === hintPrepRoleId)).toBe(false);
  });
});
