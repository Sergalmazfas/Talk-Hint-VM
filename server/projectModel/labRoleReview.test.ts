import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { readHypothesis } from "./hypotheses";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import { productBookText, productBookDocumentId } from "../../shared/productBook";
import { prepareLabRole, labPacketId, labFormId, labRoleId } from "./research/labRole";
import { reviseLabRole, reviewId, protocolId, rubricId, methodId } from "./research/labRoleReview";
const now = "2026-10-27T03:00:00Z";
function fixture() {
  const root = initialModel(), model = initialModel();
  model.documents = [
    { id: productBookDocumentId, title: "Book", text: productBookText({
      version: 9, updatedAt: now, snapshotDate: "2026-10-25", status: "На согласовании", lifecycle: "В разработке",
      purpose: "", vision: "", b2c: "", b2b: "", current: "", nextStage: "", completion: "", features: [],
      legal: "", finance: "", responsibilities: "", contradictions: "", roadmap: "", previousPassport: "",
    }), url: "", elementIds: [], updatedAt: now },
    { id: "DOC-TALKHINT-CHAPTER-HINT", title: "Hint", text: "Untouched Hint", url: "", elementIds: [], updatedAt: now },
    { id: "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d", title: "Roadmap", text: "Keep roadmap", url: "", elementIds: [], updatedAt: now },
  ];
  model.operatingModel = { revisions: [{ version: 1, at: now, actor: "fixture", data: {
    nodes: [emptyWorkNode("dir", "T07", "Engineering", "department"),
      ...["HEAD.07", "P.LG.QA", "P.LG.TECH", "P.PRODUCT", "P.OPS", "P.COORD", "P.LEGAL"]
        .map(code => emptyWorkNode(code, code, code, "role", "dir")),
      emptyWorkNode("weekly", "T07.REPORT.WEEK", "Weekly", "action", "dir")], links: [], stageReports: [],
  } }] };
  root.alternatives = [{ id: "new-country", title: "TalkHint", model }];
  const prepared = prepareLabRole(root, now);
  prepared.revision = 768;
  const state = readHypothesis(prepared, "new-country");
  const pass = JSON.parse(state.documents.find(d => d.id === labPacketId)!.text);
  pass.metadata.sourceRevision = 768;
  pass.manualPass = { verdict: "принять с исправлениями", by: "внешний ручной проход" };
  pass.trialProtocol[0].status = "частично";
  return { root: prepared, pass };
}
describe("P.LAB v2 manual-review revision", () => {
  it("preserves the submitted pass losslessly, identities, history, book and Hint", () => {
    const { root, pass } = fixture(), before = readHypothesis(root, "new-country");
    const next = reviseLabRole(root, pass, "11 corrections", "Hypotheses, no QA", now);
    const after = readHypothesis(next, "new-country"), doc = (id: string) => after.documents.find(d => d.id === id)!;
    const body = JSON.parse(doc(reviewId).text), protocol = JSON.parse(doc(protocolId).text);
    expect({ ...body, trialProtocol: protocol.trialProtocol, manualPass: protocol.manualPass }).toEqual(pass);
    expect(after.operatingModel!.revisions).toHaveLength(before.operatingModel!.revisions.length + 1);
    expect(after.operatingModel!.revisions.at(-1)!.data.nodes.map(n => n.id))
      .toEqual(before.operatingModel!.revisions.at(-1)!.data.nodes.map(n => n.id));
    for (const id of [productBookDocumentId, "DOC-TALKHINT-CHAPTER-HINT"])
      expect(doc(id)).toEqual(before.documents.find(d => d.id === id));
    expect(after.elements).toEqual(before.elements);
    expect(after.relations).toEqual(before.relations);
    expect(readHypothesis(root, "new-country").revision).toBe(768);
    expect(reviseLabRole(next, pass, "", "", now)).toBe(next);
  });
  it("makes run precede QA, bounds returns and allows truthful mail without a running QA/head", () => {
    const { root, pass } = fixture();
    const s = readHypothesis(reviseLabRole(root, pass, "", "", now), "new-country");
    const p = JSON.parse(s.documents.find(d => d.id === labPacketId)!.text);
    const n = (code: string) => p.actions.find((a: any) => a.code === code);
    expect(p.version).toBe(2);
    expect(p.metadata.sourceRevision).toBe(s.revision);
    expect(p.flowPolicy.maxQaReturns).toBe(2);
    expect(n("LAB.2").nextId).toBe(n("LAB.8").id);
    expect(n("LAB.8").nextId).toBe(n("LAB.QA").id);
    expect(n("LAB.QA").acceptorId).not.toBe("HEAD.07");
    expect(p.links.some((l: any) => l.from === "lab-result-run" && l.to === n("LAB.MAIL.PREPARE").id)).toBe(true);
    expect(p.links.some((l: any) => l.from === "lab-result-analyze" && [n("LAB.QA").id, n("LAB.PRODUCT").id].includes(l.to))).toBe(false);
    expect(n("LAB.PRODUCT.RECEIVE").nextId).toBe(n("LAB.REPORT").id);
    expect(p.gate).toMatchObject({ installationAllowed: false, workerStarted: false, mailEnabled: false });
    expect(p.actions.every((a: any) => a.success && (a.failure || p.actionCommon.failure))).toBe(true);
    expect(p.actions.every((a: any) => a.roleId !== a.acceptorId)).toBe(true);
    expect(p.role.executorId).toBeNull();
    expect(p.metricAliases.test_calls_done).toBe("owner_calls_received");
    expect(p.metricDefinitions.some((m: any) => m.id === "scouting_on_time")).toBe(false);
    expect(p.rubric.categories).toHaveLength(6);
    expect(s.documents.find(d => d.id === labFormId)!.text).toContain("пропущено");
    expect(s.documents.find(d => d.id === methodId)!.text).toContain("ожидает вход");
    expect(s.documents.find(d => d.id === rubricId)).toBeDefined();
    expect(s.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === labRoleId)!.executorId).toBeNull();
  });
});
