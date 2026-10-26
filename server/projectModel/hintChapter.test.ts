import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { initialModel } from "./seed";
import { prepareProductBook } from "./research/productBook";
import { prepareHintChapter, summarizeHintRuns } from "./research/hintChapter";
import { readHypothesis } from "./hypotheses";
import { productBookDocumentId, readProductBook } from "../../shared/productBook";
import { getPassportChapterPacket, hintChapterDocumentId, passportChapterSchema } from "../../shared/passportChapter";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import { ProductCrewService, inputs, writeTools } from "../productCrew/service";
import PassportChapterView from "../../client/src/components/project-model/PassportChapterView";
vi.mock("../../client/src/components/project-model/PassportChapterView.css", () => ({}));

const at = "2026-10-26T21:00:00.000Z";
const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const protocol = { packageVersion: 2, metadata: { sourceDataRevision: 744 } };
function fixture() {
  const root = initialModel();
  const state = initialModel();
  state.documents = [
    { id: productBookDocumentId, title: "Passport v1", text: "Original passport", url: "", elementIds: [], updatedAt: at },
    { id: roadmapId, title: "Roadmap v20", text: "Original roadmap", url: "", elementIds: [], updatedAt: at },
  ];
  root.alternatives = [{ id: "new-country", title: "TalkHint", model: state }, { id: "untouched", title: "Keep", model: initialModel() }];
  const bookRoot = prepareProductBook(root, "fixture");
  const model = bookRoot.alternatives!.find(h => h.id === "new-country")!.model;
  model.documents.find(d => d.id === roadmapId)!.title = "Roadmap — v20";
  const roleIds = ["product-manager-specialist", "head-engineering", "benchmark-role-reference", "management-role-ux-designer",
    "lg-technical-role", "crew-channel-specialist", "lg-qa-role", "management-role-mobile-specialist", "management-role-finance-analyst"];
  const actionIds = ["company-action-product-reference", "company-action-product-sufficiency", "company-action-product-return",
    "company-action-technical-facts", "company-action-technical-control", "engineering-chief-readiness", "engineering-chief-priorities",
    "engineering-chief-estimates", "company-action-plans", "company-action-features", "company-action-handoff",
    "company-action-followup", "company-action-owner-competitor-test", "lg-action-8"];
  model.operatingModel = { revisions: [{ version: 1, at, actor: "fixture", data: {
    nodes: [...roleIds.map(id => emptyWorkNode(id, id, id, "role")), ...actionIds.map(id => emptyWorkNode(id, id, id, "action"))], links: [],
  } }] };
  return bookRoot;
}
describe("canonical Hint chapter", () => {
  it("adds one linked chapter, preserves Copilot, roles and other hypotheses, keeps immutable history and is idempotent", () => {
    const root = fixture(), before = structuredClone(root);
    const saved = prepareHintChapter(root, [], protocol, at);
    const state = readHypothesis(saved, "new-country"), old = readHypothesis(before, "new-country");
    const packet = getPassportChapterPacket(state, "hint")!;
    expect(packet.chapter.version).toBe(1);
    expect(packet.bookVersion).toBe(readProductBook(old.documents.find(d => d.id === productBookDocumentId))!.version + 1);
    expect(state.documents).toHaveLength(old.documents.length + 1);
    expect(packet.context.missingRoleIds).toEqual([]);
    expect(packet.context.missingActionIds).toEqual([]);
    expect(readProductBook(state.documents.find(d => d.id === productBookDocumentId))!.features)
      .toEqual(readProductBook(old.documents.find(d => d.id === productBookDocumentId))!.features);
    expect(state.operatingModel).toEqual(old.operatingModel);
    expect(saved.alternatives!.find(h => h.id === "untouched")).toEqual(before.alternatives!.find(h => h.id === "untouched"));
    expect(root).toEqual(before);
    expect(prepareHintChapter(saved, [], protocol, at)).toBe(saved);
    expect(state.decisions.some(e => e.documentBefore?.id === productBookDocumentId)).toBe(true);
    expect(state.documents.find(d => d.id === hintChapterDocumentId)!.text.length).toBeLessThan(50000);
  });
  it("keeps unknowns/null and owner acceptance separate from implementation; rejects incomplete JSON", () => {
    const state = readHypothesis(prepareHintChapter(fixture(), [], protocol, at), "new-country");
    const p = getPassportChapterPacket(state, "hint")!;
    expect(Object.keys(p.chapter.layers)).toHaveLength(6);
    expect(p.chapter.metrics).toHaveLength(4);
    expect(p.chapter.metrics.every(m => m.target === null && m.actual === null && m.status === "ждёт решения владельца")).toBe(true);
    expect(Object.values(p.chapter.layers).every(l => l.progress.accepted === null)).toBe(true);
    expect(p.chapter.requests.every(r => r.response === null)).toBe(true);
    expect(p.chapter.reviewProtocol.every(r => r.status === "не выполнено")).toBe(true);
    expect(p.chapter.katyaDuration.remoteVerified).toBe(false);
    expect(passportChapterSchema.safeParse({ ...p.chapter, layers: {} }).success).toBe(false);
    const bad = structuredClone(state); bad.documents.find(d => d.id === hintChapterDocumentId)!.text = "{}";
    expect(getPassportChapterPacket(bad, "hint")).toBeNull();
    expect(getPassportChapterPacket(state, "missing")).toBeNull();
  });
  it("resolves exactly the same JSON through the read-only MCP service without writes or another owner fallback", async () => {
    const state = readHypothesis(prepareHintChapter(fixture(), [], protocol, at), "new-country");
    const update = vi.fn(async () => { throw Error("No write"); });
    const service = new ProductCrewService({ read: async owner => owner === "fixture" ? state : initialModel(), update, updateMany: update });
    const packet = await service.call("fixture", "get_product_chapter", { mode: "hint" });
    expect(packet).toEqual(getPassportChapterPacket(state, "hint"));
    const doc: any = await service.call("fixture", "get_document", { documentId: hintChapterDocumentId });
    expect(JSON.parse(doc.text)).toEqual((packet as any).chapter);
    await expect(service.call("other", "get_product_chapter", { mode: "hint" })).rejects.toThrow();
    expect(writeTools.has("get_product_chapter")).toBe(false);
    expect(inputs.get_product_chapter.safeParse({ mode: "hint", launch: true }).success).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it("exports historical aggregates without secrets/audio/private text or invented end-to-end measurements", () => {
    const runs = summarizeHintRuns([{ id: "run", run_type: "brain", status: "completed", started_at: at, finished_at: at,
      config: { candidates: [{ model: "model", apiKey: "NEVER" }] }, corpus_hash: "hash", prompt_version: "v1",
      scorecard: { candidates: [{ candidateId: "test", avgReadyMs: 1000, estCostPer10MinCall: null, transcript: "NEVER" }] } }]);
    expect(JSON.stringify(runs)).not.toContain("NEVER");
    expect(runs[0].metrics.candidates).toEqual([{ candidateId: "test", avgReadyMs: 1000, estCostPer10MinCall: null }]);
    expect(runs[0].summary).toContain("brain");
  });
  it("renders all six layer selections, owner request and working role buttons from canonical data", () => {
    const state = readHypothesis(prepareHintChapter(fixture(), [], protocol, at), "new-country");
    for (const layer of ["product", "workflow", "lab", "metrics", "bench", "design"]) {
      vi.stubGlobal("window", { location: { search: `?chapter=hint&layer=${layer}`, origin: "https://fixture.test" } });
      const html = renderToStaticMarkup(React.createElement(PassportChapterView, { state }));
      expect(html).toContain("Скачать полный JSON");
      expect(html).toContain("aria-label=\"Слои главы Hint\"");
      expect(html).toContain("На согласовании");
      expect(html).not.toContain("Глава не найдена.");
      expect(html).not.toContain("javascript:");
      if (layer === "metrics") expect(html).toContain("ждёт решения владельца");
      if (layer === "lab") expect(html).toContain("Лаборатория · запуски");
    }
    vi.unstubAllGlobals();
  });
});
