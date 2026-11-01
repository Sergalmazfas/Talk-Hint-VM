import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { productBookDocumentId, productBookMarker, readProductBook } from "../../shared/productBook";
import { ownerProductPolicyDocumentId, ownerProductPolicyText, ownerProductProhibition } from "../../shared/ownerProductPolicy";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { assertTransactionBatch } from "../projectModel/transactionBatch";
import { ownerProductPolicyCommands, applyOwnerProductPolicyInput, aiCrewRulesDocumentId,
  effectiveOwnerProductPolicy, inheritOwnerProductPolicy } from "./ownerProductPolicy";
import { ProductCrewService } from "./service";
import { ModelError } from "../projectModel/modelError";
import { withTeamRuntime, emptyMember } from "../team/runtime";

const owner = "owner", employeeId = "DOC-EMPLOYEE-POLICY-TEST";
const book = () => ({ version: 2, updatedAt: "unchanged", snapshotDate: "unchanged",
  status: "not accepted", lifecycle: "existing", purpose: "", vision: "", b2c: "", b2b: "",
  current: "", nextStage: "", completion: "", features: [], legal: "", finance: "",
  responsibilities: "", contradictions: "", roadmap: "", previousPassport: `Old ${productBookMarker} "[{]}"`,
  unknown: { keep: ["source", "unchanged"] } });
function add(s: ProjectModelState, id: string, text: string) {
  return applyCommand(s, { type: "createDocument", id, title: id, text, url: "https://example.org/source", elementIds: [] }, owner);
}
function fixture() {
  let s = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, owner);
  s = add(s, productBookDocumentId, `Owner preface\n${productBookMarker}\n${JSON.stringify(book())}\nOwner suffix: do not remove.`);
  s = add(s, employeeId, JSON.stringify({ format: "talkhint.employee.profile", version: 3,
    visualPassport: { roleId: "head-product", traits: ["A", "B", "C"] }, plannedRole: true,
    prompt: { text: "Keep this prompt", enabled: false }, permissions: { spend: false },
    prohibitions: ["old restriction"], extra: { nested: "keep" } }));
  return add(s, aiCrewRulesDocumentId, JSON.stringify({ format: "talkhint.stage.review-result",
    accepted: false, documents: { "company-rules-addendum": {
      format: "talkhint.company-passport.addendum", version: 1, targetDocumentId: productBookDocumentId,
      rules: { status: "proposed", rules: ["existing rule"] }, promptLayers: { unchanged: true },
    }, other: { retain: true } } }));
}
const input = (s: ProjectModelState, target = "company_passport", documentId = productBookDocumentId) => ({
  revision: s.revision, requestId: randomUUID(), reason: "Exact owner decision",
  ownerDecisionRef: "Owner message, company rule", target, documentId,
  documentHash: createHash("sha256").update(s.documents.find(d => d.id === documentId)!.text).digest("hex"),
});
function apply(s: ProjectModelState, target?: string, documentId?: string) {
  return ownerProductPolicyCommands(s, input(s, target, documentId)).commands
    .reduce((next, c) => applyCommand(next, c, owner), s);
}
const document = (s: ProjectModelState, id: string) => s.documents.find(d => d.id === id)!;

describe("fixed owner product-change policy", () => {
  it("matches the owner's exact decision in replit.md, not a weaker substitute", () => {
    expect(readFileSync("replit.md", "utf8")).toContain(`«${ownerProductPolicyText}».`);
  });
  it("links the passport, creates one fixed rule, and fits the real transaction cap with a receipt", () => {
    const s = fixture(), before = structuredClone(s);
    const result = ownerProductPolicyCommands(s, input(s));
    expect(result.commands).toHaveLength(2);
    const receipt: ModelCommand = { type: "createElement", title: "receipt", section: "Продукт", scope: "talkhint", kind: "procedure" };
    expect(() => assertTransactionBatch(owner, s.revision, [...result.commands, receipt], "new-country")).not.toThrow();
    expect(() => assertTransactionBatch(owner, s.revision, [...result.commands, receipt, receipt], "new-country")).toThrow();
    const after = apply(s);
    expect(effectiveOwnerProductPolicy(after.documents)?.text).toBe(ownerProductPolicyText);
    const oldBook = readProductBook(document(s, productBookDocumentId))!;
    const newBook = readProductBook(document(after, productBookDocumentId))!;
    const { ownerProductChangePolicyRef, version, ...rest } = newBook;
    expect(rest).toEqual((({ version: _, ...r }) => r)(oldBook));
    expect(ownerProductChangePolicyRef).toBe(ownerProductPolicyDocumentId);
    expect(version).toBe(oldBook.version + 1);
    expect(document(after, productBookDocumentId).text).toMatch(/^Owner preface\n/);
    expect(document(after, productBookDocumentId).text).toMatch(/\nOwner suffix: do not remove\.$/);
    expect(s).toEqual(before);
    expect(ownerProductPolicyCommands(after, input(after)).commands).toEqual([]);
  });
  it("preserves a nearly full passport without embedding or duplicating the full rule", () => {
    const s = fixture(), d = document(s, productBookDocumentId);
    d.text = d.text.replace('"purpose":""', `"purpose":"${"x".repeat(49000 - d.text.length)}"`);
    const after = apply(s), text = document(after, productBookDocumentId).text;
    expect(text.length).toBeLessThan(50000);
    expect(text).not.toContain(ownerProductPolicyText);
    expect(readProductBook(document(after, productBookDocumentId))?.previousPassport).toBe(book().previousPassport);
    d.text = d.text.replace('"purpose":"', `"purpose":"${"x".repeat(1200)}`);
    expect(() => ownerProductPolicyCommands(s, input(s))).toThrow("не помещается");
    expect(s.documents.some(d => d.id === ownerProductPolicyDocumentId)).toBe(false);
  });
  it("updates only the fixed AI Crew rule; proposals and other layers are not accepted or changed", () => {
    const s = apply(fixture()), after = apply(s, "ai_crew_rules", aiCrewRulesDocumentId);
    const a = JSON.parse(document(after, aiCrewRulesDocumentId).text);
    expect(a.accepted).toBe(false);
    expect(a.documents.other).toEqual({ retain: true });
    expect(a.documents["company-rules-addendum"]).toMatchObject({
      version: 2, rules: { status: "proposed", rules: ["existing rule", ownerProductPolicyText] },
      promptLayers: { unchanged: true }, ownerProductChangePolicyRef: ownerProductPolicyDocumentId,
    });
    expect(ownerProductPolicyCommands(after, input(after, "ai_crew_rules", aiCrewRulesDocumentId)).commands).toEqual([]);
  });
  it.each(["talkhint.employee.profile", "talkhint.role-prompt-proposal"])("only adds the prohibition/reference to %s", format => {
    const s = apply(fixture()), d = document(s, employeeId), p = JSON.parse(d.text);
    p.format = format; d.text = JSON.stringify(p);
    const after = apply(s, "employee_profile", employeeId), next = JSON.parse(document(after, employeeId).text);
    expect(next).toEqual({ ...p, version: p.version + 1,
      prohibitions: [...p.prohibitions, ownerProductProhibition], ownerProductChangePolicyRef: ownerProductPolicyDocumentId });
    expect(ownerProductPolicyCommands(after, input(after, "employee_profile", employeeId)).commands).toEqual([]);
  });
  it.each([undefined, null, "", "legacy prohibition"])("preserves existing prohibition representation: %s", value => {
    const s = apply(fixture()), d = document(s, employeeId), p = JSON.parse(d.text);
    p.prohibitions = value; d.text = JSON.stringify(p);
    const next = JSON.parse(document(apply(s, "employee_profile", employeeId), employeeId).text);
    expect(typeof value === "string" ? typeof next.prohibitions : Array.isArray(next.prohibitions))
      .toBe(typeof value === "string" ? "string" : true);
    if (value) expect(next.prohibitions).toContain(value);
    expect(next.prohibitions).toContain(ownerProductProhibition);
  });
  it.each(["text", "prohibitions", "prompt", "enabled", "permissions", "executorId", "hypothesis", "commands"])("rejects extra capability %s", field => {
    const s = fixture();
    expect(applyOwnerProductPolicyInput.safeParse({ ...input(s), [field]: "forbidden" }).success).toBe(false);
  });
  it("rejects a stale document hash, an arbitrary document, malformed prohibitions/version, and conflicting policy", () => {
    const s = apply(fixture());
    expect(() => ownerProductPolicyCommands(s, { ...input(s), documentHash: "0".repeat(64) })).toThrow("изменился");
    expect(() => ownerProductPolicyCommands(s, input(s, "company_passport", employeeId))).toThrow("канонический");
    const d = document(s, employeeId);
    for (const value of [{ format: "not-profile" }, { prohibitions: { discard: "no" } }, { version: 0 }]) {
      const original = d.text; d.text = JSON.stringify({ ...JSON.parse(original), ...value });
      expect(() => ownerProductPolicyCommands(s, input(s, "employee_profile", employeeId))).toThrow();
      d.text = original;
    }
    document(s, ownerProductPolicyDocumentId).text = JSON.stringify({ text: "weaker rule" });
    expect(() => ownerProductPolicyCommands(s, input(s))).toThrow("конфликтует");
    expect(effectiveOwnerProductPolicy(s.documents)).toBeNull();
  });
  it("requires the canonical rule first and only inherits a valid linked fixed policy", () => {
    const s = fixture(), members = [{ prohibitions: ["keep"] }];
    expect(() => ownerProductPolicyCommands(s, input(s, "employee_profile", employeeId))).toThrow("Сначала");
    inheritOwnerProductPolicy(members, s.documents);
    expect(members[0].prohibitions).toEqual(["keep"]);
    const after = apply(s);
    inheritOwnerProductPolicy(members, after.documents); inheritOwnerProductPolicy(members, after.documents);
    expect(members[0].prohibitions).toEqual(["keep", ownerProductProhibition]);
    const policy = document(after, ownerProductPolicyDocumentId);
    policy.text = policy.text.replace("nonOverridableByEmployees\": true", "nonOverridableByEmployees\": false");
    expect(effectiveOwnerProductPolicy(after.documents)).toBeNull();
  });
  it("inherits the restriction on the final runtime cards, without changing their prompts or status", () => {
    const s = apply(fixture());
    const card = { ...emptyMember("external-efim"), name: "External", prohibitions: ["old"] };
    const view: any = { members: [card], feed: [] };
    const context: any = { documents: s.documents, operating: s.operatingModel!.revisions.at(-1),
      owner, jobs: [], secretaryTasks: [], controls: [] };
    const result = withTeamRuntime(view, context);
    expect(result.members.every(m => m.prohibitions.includes(ownerProductProhibition))).toBe(true);
    expect(result.members.find(m => m.id === card.id)).toMatchObject({ status: card.status, prompt: card.prompt });
  });
  it("does not write or silently skip storage refusal when writing is closed", async () => {
    const s = fixture(), before = structuredClone(s);
    const service = new ProductCrewService({ read: async () => structuredClone(s),
      updateMany: async () => { throw new ModelError(423, "Запись закрыта"); } } as any, { production: true });
    await expect(service.call(owner, "apply_owner_product_change_policy", input(s))).rejects.toThrow("Запись закрыта");
    expect(s).toEqual(before);
  });
  it("uses the service's atomic receipt, rejects stale revision, and replays without another update", async () => {
    let s = fixture(); let writes = 0;
    const repo: any = { read: async () => structuredClone(s), updateMany: async (_o: string, r: number, cs: ModelCommand[]) => {
      expect(r).toBe(s.revision); assertTransactionBatch(owner, r, cs, "new-country");
      s = cs.reduce((next, c) => applyCommand(next, c, owner), s); writes++; return structuredClone(s);
    } };
    const service = new ProductCrewService(repo, { production: true });
    const args = input(s), result = await service.call(owner, "apply_owner_product_change_policy", args);
    expect(result.saved).toBe(true); expect(writes).toBe(1);
    expect((await service.call(owner, "apply_owner_product_change_policy", args)).replayed).toBe(true);
    expect(writes).toBe(1);
    await expect(service.call(owner, "apply_owner_product_change_policy", { ...args, requestId: randomUUID() })).rejects.toThrow("Модель изменилась");
    // Even preserved, unknown role metadata cannot override the company restriction.
    (s.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.kind === "role") as any).inheritedProhibitions = [];
    const read = await service.call(owner, "get_team", {});
    expect(read.companyProductChangePolicy.text).toBe(ownerProductPolicyText);
    expect(read.roles.every((r: any) => r.inheritedProhibitions.includes(ownerProductProhibition))).toBe(true);
    expect(s.elements.filter(e => e.coordination?.kind === "decision")).toHaveLength(1);
  });
});
