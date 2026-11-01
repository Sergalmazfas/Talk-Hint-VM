import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import type { ModelRepository } from "../projectModel/repository";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel, emptyWorkNode } from "../../shared/operatingModelTemplate";
import { ProductCrewService, inputs } from "./service";

const actionId = "test-transfer-action", pasha = "product-manager-specialist";
function fixture(roleId = pasha, code = "PRD.TEST", acceptorId: string | null = "owner", executorId: string | null = null) {
  const data = buildCompanyStructure(defaultOperatingModel());
  for (const [id, roleCode] of [[pasha, "P.PRODUCT"], ["lg-qa-role", "P.LG.QA"]]) {
    if (!data.nodes.some(n => n.id === id))
      data.nodes.push({ ...emptyWorkNode(id, roleCode, roleCode, "role"), managerId: "head-product" });
  }
  if (executorId && !data.nodes.some(n => n.id === executorId))
    data.nodes.push({ ...emptyWorkNode(executorId, "TEST.EXECUTOR", "Существующее назначение", "role"),
      managerId: "head-product" });
  data.nodes.push({ ...emptyWorkNode(actionId, code, "Существующее действие", "action", roleId),
    roleId, acceptorId, executorId, questions: "Прежний вопрос" });
  return applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0, data }, "owner");
}
function host(initial: ProjectModelState) {
  let state = initial;
  const repo = { read: async () => state,
    updateMany: async (_: string, revision: number, commands: ModelCommand[]) => {
      expect(revision).toBe(state.revision);
      expect(commands).toHaveLength(2);
      state = commands.reduce((s, c) => applyCommand(s, c, "owner"), state);
      return state;
    } } as unknown as ModelRepository;
  return { service: new ProductCrewService(repo, { production: true }),
    read: () => state, action: () => state.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === actionId)! };
}
const args = (s: ProjectModelState, more: Record<string, unknown>) => ({
  revision: s.revision, requestId: randomUUID(), nodeId: actionId,
  reason: "Согласованная пометка или адресная передача", ownerDecisionRef: "Решение владельца", ...more,
});
describe("staged action handoff", () => {
  it("marks transfer without deleting/reassigning work, retains questions and exposes the note on reread", async () => {
    const h = host(fixture()), before = structuredClone(h.action());
    await h.service.call("owner", "update_structure", args(h.read(), { handoffTo: "head-product" }));
    expect(h.action()).toEqual({ ...before, questions: before.questions + "\nПередача: передать Марии (HEAD.06)." });
    const team = await h.service.call("owner", "get_team", { roleId: pasha });
    expect(team.roles[0].linkedWork.find((a: any) => a.id === actionId).handoffNotes)
      .toEqual(["Передача: передать Марии (HEAD.06)."]);
    await h.service.call("owner", "update_structure", args(h.read(), { handoffTo: "head-product" }));
    expect(h.action().questions.match(/Передача:/g)).toHaveLength(1);
  });
  it("keeps outside checks temporarily with Foma and does not create a future reviewer", async () => {
    const h = host(fixture("lg-qa-role", "ENG.TEST"));
    const count = h.read().operatingModel!.revisions.at(-1)!.data.nodes.length;
    await h.service.call("owner", "update_structure", args(h.read(), { handoffTo: "future-general-reviewer" }));
    expect(h.action().roleId).toBe("lg-qa-role");
    expect(h.action().questions).toContain("пока временно у Фомы");
    expect(h.read().operatingModel!.revisions.at(-1)!.data.nodes).toHaveLength(count);
  });
  it.each([[pasha, "LAB.PRODUCT.RECEIVE", "head-product"], ["lg-qa-role", "LAB.QA", "future-general-reviewer"]])(
    "never marks Hint work for outside transfer %s", async (roleId, code, handoffTo) => {
      const h = host(fixture(roleId, code)), before = structuredClone(h.read());
      await expect(h.service.call("owner", "update_structure", args(h.read(), { handoffTo }))).rejects.toThrow("Hint");
      expect(h.read()).toEqual(before);
    });
  it("transfers one unbound action to an existing role, without assigning an executor or changing its content", async () => {
    const h = host(fixture()), before = structuredClone(h.action());
    await h.service.call("owner", "update_structure", args(h.read(), { roleId: "head-product" }));
    expect(h.action()).toEqual({ ...before, roleId: "head-product" });
  });
  it("blocks self-acceptance when transferring to Maria; never replaces an existing executor", async () => {
    for (const state of [fixture(pasha, "PRD.TEST", "head-product"), fixture(pasha, "PRD.TEST", "owner", "bound-executor")]) {
      const h = host(state), before = structuredClone(h.read());
      await expect(h.service.call("owner", "update_structure", args(h.read(), { roleId: "head-product" })))
        .rejects.toMatchObject({ status: 409 });
      expect(h.read()).toEqual(before);
    }
  });
  it("requires a named independent acceptor and permits a coordinated valid recipient change", async () => {
    const missing = host(fixture(pasha, "PRD.TEST", null));
    await expect(missing.service.call("owner", "update_structure", args(missing.read(), { roleId: "head-product" })))
      .rejects.toMatchObject({ status: 409 });
    const valid = host(fixture());
    await valid.service.call("owner", "update_structure", args(valid.read(), {
      roleId: "head-product", acceptorId: pasha,
    }));
    expect(valid.action().acceptorId).toBe(pasha);
    expect(valid.action().roleId).toBe("head-product");
  });
  it("checks the resulting graph: changing role cannot hide self-acceptance through the same action", async () => {
    const h = host(fixture()), before = structuredClone(h.read());
    await expect(h.service.call("owner", "update_structure", args(h.read(), {
      roleId: "head-product", acceptorId: actionId,
    }))).rejects.toMatchObject({ status: 409 });
    expect(h.read()).toEqual(before);
  });
  it("rejects arbitrary annotations, forged executor configuration and role changes on role nodes", async () => {
    const h = host(fixture());
    expect(inputs.update_structure.safeParse(args(h.read(), { executorId: "new" })).success).toBe(false);
    expect(inputs.update_structure.safeParse(args(h.read(), { handoffTo: "arbitrary-role" })).success).toBe(false);
    await expect(h.service.call("owner", "update_structure", {
      ...args(h.read(), { roleId: "head-product" }), nodeId: pasha,
    })).rejects.toMatchObject({ status: 400 });
  });
});
