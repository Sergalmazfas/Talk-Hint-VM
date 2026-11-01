import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { ModelError } from "../projectModel/modelError";
import type { ModelRepository } from "../projectModel/repository";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel, emptyWorkNode } from "../../shared/operatingModelTemplate";
import { ProductCrewService, inputs, productionTeamTools } from "./service";
import { employeeSectionCommands } from "./employeeSections";
import { readEmployeeSections } from "../../shared/employeeSections";

const roleId = "laboratory-engineer-role", documentId = "DOC-TEST-EMPLOYEE";
const workplace = { description: "Разбор разрешённых материалов Hint",
  inputs: ["Снимок звонка"], outputs: ["Доказательный разбор"], sourceDocumentIds: [],
  laboratory: { title: "Hint", description: "Общая лаборатория, независимая QA", documentId: null },
  limitations: ["Описание не предоставляет доступ"] };
const recommendation = { modelId: "candidate", family: null, rationale: "Сначала стенд",
  source: "Решение владельца", enabled: false as const, status: "proposed" as const };
function fixture() {
  const data = buildCompanyStructure(defaultOperatingModel());
  for (const [id, code] of [[roleId, "P.LAB"], ["product-manager-specialist", "P.PRODUCT"],
    ["lab-video-analyst-role", "P.LAB.VIDEO"]]) {
    if (!data.nodes.some(n => n.id === id))
      data.nodes.push({ ...emptyWorkNode(id, code, code, "role"), managerId: "head-product" });
  }
  let s = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data }, "owner");
  s.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === roleId)!.managerId = "product-manager-specialist";
  s = applyCommand(s, { type: "createDocument", id: documentId, title: "Анкета", url: "", elementIds: [],
    text: JSON.stringify({ format: "talkhint.employee.profile", version: 7,
      mode: "hint", visualPassport: { roleId, selectedName: "Замир", position: "Инженер лаборатории",
        character: { traits: ["точный", "честный", "спокойный"], motto: "Источник прежде вывода" },
        reportsTo: { roleId: "head-engineering", customNote: "keep" } },
      prompt: { model: "unchanged", text: "ORIGINAL PROMPT" }, permissions: ["unchanged"],
      executorId: "unchanged", status: "unchanged", unrelated: { keep: true } }) }, "owner");
  return s;
}
const doc = (s: ProjectModelState) => s.documents.find(d => d.id === documentId)!;
const args = (s: ProjectModelState) => ({ revision: s.revision, requestId: randomUUID(), roleId,
  reason: "Только разрешённые описательные разделы", ownerDecisionRef: "Решение владельца",
  profileHash: createHash("sha256").update(doc(s).text).digest("hex"),
  sections: { workplace, modelRecommendation: recommendation }, repairReportsTo: true as const });

describe("bounded employee sections", () => {
  it("only saves sections, canonical reportsTo and profile version; graph and protected fields stay intact", () => {
    const s = fixture(), before = structuredClone(s), a = args(s);
    expect(productionTeamTools.has("update_employee_sections")).toBe(true);
    const result = employeeSectionCommands(s, a);
    expect(s).toEqual(before);
    expect(result.commands).toHaveLength(1);
    const next = result.commands.reduce((v, c) => applyCommand(v, c, "owner"), s);
    const expected = JSON.parse(doc(s).text);
    expected.version++;
    expected.employeeSections = a.sections;
    expected.visualPassport.reportsTo = { ...expected.visualPassport.reportsTo,
      roleId: "product-manager-specialist", roleCode: "P.PRODUCT", kind: "manager",
      source: "operatingModel.nodes.managerId", status: "model_declared" };
    expect(JSON.parse(doc(next).text)).toEqual(expected);
    expect(next.operatingModel).toEqual(s.operatingModel);
  });
  it.each(["prompt", "personality", "permissions", "executorId", "visualPassport", "name", "status", "accepted", "duties"])(
    "rejects protected top-level input %s", field => {
      expect(inputs.update_employee_sections.safeParse({ ...args(fixture()), [field]: "attack" }).success).toBe(false);
    });
  it.each([
    { enabled: true }, { modelId: "x", enabled: true }, { currentModel: "x" },
    { tools: ["browser"] }, { permissions: ["all"] }, { executorId: "new" }, { prompt: "changed" },
  ])("rejects nested activation/configuration %#", attack => {
    const a = args(fixture());
    expect(inputs.update_employee_sections.safeParse({ ...a,
      sections: { ...a.sections, modelRecommendation: { ...recommendation, ...attack } } }).success).toBe(false);
  });
  it("rejects injected workplace access, external link, target manager and empty updates", () => {
    const a = args(fixture());
    for (const extra of [{ tools: ["browser"] }, { permissions: ["all"] }, { executorId: "x" }])
      expect(inputs.update_employee_sections.safeParse({ ...a, sections: { workplace: { ...workplace, ...extra } } }).success).toBe(false);
    expect(inputs.update_employee_sections.safeParse({ ...a, reportsTo: "owner" }).success).toBe(false);
    expect(inputs.update_employee_sections.safeParse({ ...a, sections: {}, repairReportsTo: undefined }).success).toBe(false);
    expect(inputs.update_employee_sections.safeParse({ ...a, sections: {
      workplace: { ...workplace, laboratory: { ...workplace.laboratory, documentId: "https://attacker.test" } } } }).success).toBe(false);
  });
  it("rejects missing/duplicate profiles, stale hashes and foreign resource references", () => {
    const s = fixture(), a = args(s);
    expect(() => employeeSectionCommands(s, { ...a, profileHash: "0".repeat(64) })).toThrow("Анкета изменилась");
    const missing = structuredClone(s); missing.documents = [];
    expect(() => employeeSectionCommands(missing, a)).toThrow("одна существующая");
    const duplicate = structuredClone(s); duplicate.documents.push({ ...doc(s), id: "DUPLICATE" });
    expect(() => employeeSectionCommands(duplicate, a)).toThrow("одна существующая");
    expect(() => employeeSectionCommands(s, { ...a, sections: {
      workplace: { ...workplace, sourceDocumentIds: ["FOREIGN-DOC"] } } })).toThrow("выбранной модели");
  });
  it("does not create an analyst profile, invent a manager or change versionless data", () => {
    const s = fixture(), a = args(s);
    expect(() => employeeSectionCommands(s, { ...a, roleId: "lab-video-analyst-role" })).toThrow("одна существующая");
    const bad = structuredClone(s); bad.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === roleId)!.managerId = "missing";
    expect(() => employeeSectionCommands(bad, a)).toThrow("Руководитель");
    const p = JSON.parse(doc(s).text); delete p.version; doc(s).text = JSON.stringify(p);
    expect(() => employeeSectionCommands(s, args(s))).toThrow("Версия");
  });
  it("merges only requested sections and does not repair reportsTo implicitly", () => {
    const s = fixture(), original = JSON.parse(doc(s).text);
    original.employeeSections = { workplace, futureExtension: { keep: "yes" } };
    doc(s).text = JSON.stringify(original);
    const a = args(s);
    const cmd = employeeSectionCommands(s, { ...a, repairReportsTo: undefined,
      sections: { modelRecommendation: recommendation } }).commands[0] as any;
    const saved = JSON.parse(cmd.text);
    expect(saved.employeeSections.workplace).toEqual(workplace);
    expect(saved.employeeSections.futureExtension).toEqual({ keep: "yes" });
    expect(saved.visualPassport.reportsTo).toEqual(original.visualPassport.reportsTo);
  });
  it("safe view reader rejects enabled recommendations and malformed sections without throwing", () => {
    expect(readEmployeeSections({ workplace, modelRecommendation: recommendation })).not.toBeNull();
    expect(readEmployeeSections({ modelRecommendation: { ...recommendation, enabled: true } })).toBeNull();
    expect(readEmployeeSections({ workplace: "bad" })).toBeNull();
    expect(readEmployeeSections(undefined)).toBeNull();
  });
  it("production service persists within two commands, rereads and replays once; stale/dev writes denied", async () => {
    let state = fixture(), writes = 0;
    const repo = { read: async () => state,
      updateMany: async (_: string, revision: number, commands: ModelCommand[]) => {
        if (state.revision !== revision) throw new ModelError(409, "CAS");
        expect(commands).toHaveLength(2);
        state = commands.reduce((v, c) => applyCommand(v, c, "owner"), state);
        writes++; return state;
      } } as unknown as ModelRepository;
    const service = new ProductCrewService(repo, { production: true }), a = args(state);
    const r = await service.call("owner", "update_employee_sections", a);
    const reread = await service.call("owner", "get_document", { documentId });
    expect(reread.revision).toBe(r.revision);
    expect(JSON.parse(reread.text).employeeSections).toEqual(a.sections);
    expect((await service.call("owner", "update_employee_sections", a)).replayed).toBe(true);
    expect(writes).toBe(1);
    await expect(service.call("owner", "update_employee_sections", {
      ...args(state), revision: state.revision - 1,
    })).rejects.toMatchObject({ status: 409 });
    await expect(new ProductCrewService(repo).call("owner", "update_employee_sections", args(state)))
      .rejects.toMatchObject({ status: 403 });
    expect(writes).toBe(1);
  });
});
