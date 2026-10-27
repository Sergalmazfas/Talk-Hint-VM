import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { readHypothesis } from "./hypotheses";
import { prepareLabRole, buildLabPacket, labRoleId, labPacketId, labFormId } from "./research/labRole";
import { productBookDocumentId, productBookText, readProductBook, type ProductBook } from "../../shared/productBook";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import { saveOperatingModelSchema } from "./operatingModel";
const now = "2026-10-27T00:20:00Z";
function fixture() {
  const root = initialModel(), state = initialModel();
  const roles = [
    ["head-engineering", "HEAD.07"], ["qa-test", "P.LG.QA"], ["tech-test", "P.LG.TECH"],
    ["product-test", "P.PRODUCT"], ["ops-test", "P.OPS"], ["coord-test", "P.COORD"], ["legal-test", "P.LEGAL"],
  ];
  const book: ProductBook = { version: 8, updatedAt: now, snapshotDate: "2026-10-25", status: "На согласовании",
    lifecycle: "В разработке", purpose: "Keep purpose", vision: "Keep vision", b2c: "B2C", b2b: "B2B", current: "Keep",
    nextStage: "Keep next", completion: "Keep criterion", features: [], legal: "Not a legal conclusion",
    finance: "Unknown", responsibilities: "Existing standard", contradictions: "", roadmap: "Existing",
    previousPassport: "Original" };
  state.documents = [
    { id: productBookDocumentId, title: "Book v8", text: productBookText(book), url: "", elementIds: [], updatedAt: now },
    { id: "DOC-TALKHINT-CHAPTER-HINT", title: "Hint", text: "Original chapter", url: "", elementIds: [], updatedAt: now },
    { id: "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d", title: "Roadmap", text: "Original roadmap", url: "", elementIds: [], updatedAt: now },
  ];
  state.operatingModel = { revisions: [{ version: 1, at: now, actor: "fixture", data: {
    nodes: [
      emptyWorkNode("dir", "T07", "Engineering", "department"),
      ...roles.map(([id, code]) => emptyWorkNode(id, code, code, "role", "dir")),
      emptyWorkNode("weekly", "T07.REPORT.WEEK", "Weekly", "action", "dir"),
    ], links: [], stageReports: [],
  } }] };
  root.alternatives = [{ id: "new-country", title: "TalkHint", model: state }, { id: "other", title: "Keep", model: initialModel() }];
  return root;
}
describe("P.LAB documentation stage — no executor", () => {
  it("preserves existing identities, other hypothesis, chapter and history and is idempotent", () => {
    const before = fixture(), original = structuredClone(before), old = readHypothesis(before, "new-country");
    const after = prepareLabRole(before, now), saved = readHypothesis(after, "new-country");
    expect(before).toEqual(original);
    expect(after.alternatives!.find(h => h.id === "other")).toEqual(before.alternatives!.find(h => h.id === "other"));
    expect(saved.elements).toEqual(old.elements);
    expect(saved.relations).toEqual(old.relations);
    expect(saved.operatingModel!.revisions[0]).toEqual(old.operatingModel!.revisions[0]);
    expect(saved.operatingModel!.revisions.at(-1)!.data.nodes.filter(n => n.kind === "role")).toHaveLength(8);
    for (const n of old.operatingModel!.revisions[0].data.nodes)
      expect(saved.operatingModel!.revisions.at(-1)!.data.nodes.find(x => x.id === n.id)).toEqual(n);
    expect(saved.documents.find(d => d.id === "DOC-TALKHINT-CHAPTER-HINT")).toEqual(old.documents.find(d => d.id === "DOC-TALKHINT-CHAPTER-HINT"));
    expect(readProductBook(saved.documents.find(d => d.id === productBookDocumentId))!.version).toBe(9);
    expect(saved.decisions.some(d => d.documentBefore?.id === productBookDocumentId)).toBe(true);
    expect(prepareLabRole(after, now)).toBe(after);
  });
  it("exports saved data with explicit gates, independent acceptance, complete references and null facts", () => {
    const saved = readHypothesis(prepareLabRole(fixture(), now), "new-country");
    const doc = saved.documents.find(d => d.id === labPacketId)!;
    const p = JSON.parse(doc.text);
    expect(doc.text.length).toBeLessThanOrEqual(50000);
    expect(p.metadata.sourceRevision).toBe(saved.revision);
    expect(p.gate).toMatchObject({ jsonManualPass: "не выполнен", installationAllowed: false, workerStarted: false, mailEnabled: false });
    expect(p.actions).toHaveLength(14);
    expect(p.resources).toHaveLength(6);
    const ids = new Set([...p.actions, ...p.results, ...p.resources, p.role, ...p.recipients].map(n => n.id));
    for (const action of p.actions) {
      expect(action.roleId).not.toBe(action.acceptorId);
      expect(action.schedule.deadline).toBe("");
      expect(action.schedule.days).toEqual([]);
      for (const id of [action.roleId, action.acceptorId, action.nextId, action.resultId, ...action.resourceIds]) expect(ids.has(id)).toBe(true);
      expect(p.metricDefinitions.find((m: any) => m.id === action.metricIds[0]).fact).toBeNull();
    }
    expect(p.trialProtocol.every((t: any) => t.status === "не выполнено" && t.evidence === null)).toBe(true);
    expect(p.resources.every((r: any) => r.state === "required" && r.proof === null)).toBe(true);
    expect(p.role.metricIds).toHaveLength(17);
    expect(doc.text).not.toMatch(/@gmail\.com|\$25|USD\/|до 1 часа|2 рабочих дня|по пятницам/);
    expect(saved.documents.find(d => d.id === labFormId)).toBeDefined();
    const data = saved.operatingModel!.revisions.at(-1)!.data;
    data.nodes.find(n => n.id === "lab-action-analyze")!.procedure = "Updated canonical procedure";
    expect(buildLabPacket(saved).actions.find(n => n.id === "lab-action-analyze")!.procedure).toBe("Updated canonical procedure");
  });
  it("round-trips optional metrics/readiness and rejects invalid observations without affecting legacy nodes", () => {
    const saved = readHypothesis(prepareLabRole(fixture(), now), "new-country");
    const last = saved.operatingModel!.revisions.at(-1)!;
    const command = { type: "saveOperatingModel", baseVersion: last.version, data: last.data };
    expect(saveOperatingModelSchema.parse(command).data).toEqual(last.data);
    const bad = structuredClone(command);
    bad.data.nodes.find(n => n.id === "lab-action-intake")!.metrics![0].denominator = -1;
    expect(saveOperatingModelSchema.safeParse(bad).success).toBe(false);
    expect(last.data.nodes.find(n => n.id === labRoleId)!.executorId).toBeNull();
    expect(last.data.links.filter(l => l.id.startsWith("lab:")).every(l =>
      l.readiness?.structure === "passed" && l.readiness.resources === "unknown" && l.readiness.trial === "unknown")).toBe(true);
  });
  it("refuses a second P.LAB identity rather than making a parallel role", () => {
    const root = fixture();
    root.alternatives![0].model.operatingModel!.revisions[0].data.nodes.push(emptyWorkNode("different", "P.LAB", "Already exists", "role", "dir"));
    expect(() => prepareLabRole(root, now)).toThrow(/reconciled/);
  });
});
