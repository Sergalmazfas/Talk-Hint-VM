import { describe, expect, it } from "vitest";
import { applyCommand, requestSchema } from "./domain";
import { initialModel } from "./seed";
import { applyApprovedMaterial, approvedMaterial, materialMarker } from "./materialImport";
import { materialSources } from "./materialSources";

describe("approved discussion and competitive benchmark", () => {
  const initial = initialModel();
  const state = applyApprovedMaterial(initial, "test-owner");
  it("persists all supplied materials, 48 independent assessments, documents and audit", () => {
    expect(state.elements.filter(e => e.details.benchmarkType === "assessment")).toHaveLength(48);
    expect(state.elements.filter(e => e.details.benchmarkType === "competitor")).toHaveLength(3);
    expect(state.documents.find(d => d.title === materialMarker)).toBeDefined();
    for (const source of materialSources) expect(state.documents.find(d => d.url === source.url)?.text).toContain(source.summary);
    for (const e of approvedMaterial) expect(state.elements.some(p => p.id === e.id)).toBe(true);
    expect(state.taskDrafts).toHaveLength(4);
    expect(state.proposals.every(p => p.status === "approved")).toBe(true);
    expect(state.decisions.some(d => d.before && d.after && d.proposalId)).toBe(true);
  });
  it("does not mutate old state and preserves the separate client example", () => {
    expect(initial.documents.find(d => d.title === materialMarker)).toBeUndefined();
    for (const example of initial.elements.filter(e => e.scope === "salon_example")) {
      const saved = state.elements.find(e => e.id === example.id)!;
      expect(saved.description).toBe(example.description);
      expect(saved.details).toEqual(example.details);
      expect(saved.scope).toBe("salon_example");
    }
    expect(state.elements.find(e => e.id === "TH-SEGMENT")?.description).toContain("Победитель НЕ выбран");
  });
  it("is strictly idempotent including revision and decisions", () => {
    expect(applyApprovedMaterial(state, "test-owner")).toBe(state);
    expect(new Set(state.elements.map(e => e.id)).size).toBe(state.elements.length);
    expect(new Set(state.relations.map(r => `${r.from}|${r.to}|${r.label}`)).size).toBe(state.relations.length);
  });
  it("has valid source, requirement and task references", () => {
    for (const r of state.relations) {
      expect(state.elements.some(e => e.id === r.from)).toBe(true);
      expect(state.elements.some(e => e.id === r.to)).toBe(true);
    }
    for (const task of state.taskDrafts) {
      expect(task.text).toContain("не отправлен в Replit");
      for (const ref of task.references) expect(state.elements.find(e => e.id === ref.id)?.version).toBe(ref.version);
    }
  });
  it("keeps preliminary numbers hypothetical, no practical success and no ready Crew claims", () => {
    for (const e of state.elements.filter(e => ["market-note", "assessment", "competitor"].includes(e.details.benchmarkType ?? "")))
      expect(e.details.practicalTest).toContain("Не проводился");
    expect(state.elements.find(e => e.id === "TH-ECONOMICS")?.contentStatus).toBe("hypothesis");
    expect(state.elements.find(e => e.id === "COMP-ZENMAID")?.details.aiVoiceChat).toContain("не доказательство");
    expect(state.elements.find(e => e.id === "COMP-JOBBER")?.details.comparison).toContain("не уникально");
    expect(state.elements.find(e => e.id === "COMP-HOUSECALL-PRO")?.details.unknown).toContain("Противоречие");
  });
  it("stable IDs are validated and duplicate creation cannot overwrite", () => {
    const element = { ...approvedMaterial[0].input, contentStatus: "proposal" as const };
    expect(requestSchema.safeParse({ revision: 0, command: { type: "createElement", id: "<script>", element } }).success).toBe(false);
    expect(() => applyCommand(state, { type: "createElement", id: "COMP-JOBBER", element }, "test-owner")).toThrow("ID уже существует");
    expect(() => applyCommand(initial, { type: "createElement", id: "UNIQUE-ID", element: approvedMaterial[0].input }, "test-owner")).toThrow("только через предложение");
  });
});
