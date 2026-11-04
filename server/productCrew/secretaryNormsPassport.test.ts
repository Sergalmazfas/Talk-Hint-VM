import { describe, expect, it } from "vitest";
import { makeSecretaryNorms, renderSecretaryNorms, secretaryNormsSchema, hashText, normsJournalEntry } from "../../script/lib/secretaryNorms";
import { inputs, ProductCrewService } from "./service";
import { journalEntrySchema } from "./knowledgeAppend";
import { expectedResultSchema } from "../../shared/journalExpectation";
import { documentTextLimit } from "../projectModel/documentVolumes";

const at = "2026-11-04T17:00:00.000Z";
describe("Secretary descriptive norms, no runtime rollout", () => {
  it("preserves all exact owner targets, preliminary provenance and 5-call rebase", () => {
    const p = makeSecretaryNorms(at);
    expect(p.goals.map(g => [g.baseline, g.target])).toEqual([[1700, 1400], [3300, 2600], [12, 8], [3, 0], [2.7, 1.5]]);
    expect(p.baseline).toMatchObject({ reportedSampleSize: 1, independentlyRecomputed: false, preliminary: true, rebaseAfterFirstCCalls: 5, idealKatyaTurns: 6 });
  });
  it("never changes Katya, enables an agent or silently activates all five metrics", () => {
    const p = makeSecretaryNorms(at);
    expect(p.status).toBe("proposed"); expect(p.enabled).toBe(false);
    expect(p.stages).toMatchObject({ activeMetricId: null, maxOptimizationMetricsPerProduct: 1, nextStepImprovementPercent: [20, 30] });
    expect(secretaryNormsSchema.safeParse({ ...p, enabled: true }).success).toBe(false);
    expect(secretaryNormsSchema.safeParse({ ...p, status: "active" }).success).toBe(false);
    expect(secretaryNormsSchema.safeParse({ ...p, extraRuntimeSetting: true }).success).toBe(false);
  });
  it("separates hard hold norms, unmeasured facts and target-free observations", () => {
    const p = makeSecretaryNorms(at);
    expect(p.hold.map(h => h.target)).toEqual([100, 0]);
    expect(p.observation).toHaveLength(4); expect(p.observation.every(o => o.target === null)).toBe(true);
    expect(p.factTemplate.value).toBeNull(); expect(p.factTemplate.evidence).toBeNull();
    expect(p.factTemplate.metricIds).toHaveLength(11);
    expect(p.factTemplate.missingDataRule).toContain("не 0");
    expect(p.hold[0].definition).toContain("unknown");
  });
  it("keeps independent review, weekly Seva, Maria's plan and owner product boundary", () => {
    const p = makeSecretaryNorms(at);
    expect(p.duties.map(d => d.acceptorRoleId)).toEqual(["secretary-qa", "secretary-project-head", "head-product", "owner"]);
    expect(p.duties.every(d => d.roleId !== d.acceptorRoleId)).toBe(true);
    expect(p.duties[2].trigger).toContain("неделю");
    expect(p.ownerRoleId).toBe("secretary-project-head"); expect(p.planFromRoleId).toBe("head-product");
    expect(p.proposalGate).toEqual({ journalReadRequired: true, rejected: ["GPT-Live"], retained: "Retell" });
  });
  it("uses immutable result documents and append-only facts rather than overwrite or acceptance", () => {
    const p = makeSecretaryNorms(at), text = renderSecretaryNorms(p);
    expect(p.appendOnly.immutableOriginal).toBe(true);
    expect(p.appendOnly.nextFacts).toContain("новый документ");
    expect(p.appendOnly.correctionRule).toContain("не удалять");
    expect(text).toContain("Факт сейчас: не измерено");
    expect(text).toContain("GPT-Live отклонён");
    expect(hashText(text)).toBe(hashText(renderSecretaryNorms(p)));
    const args = { revision: 1, requestId: "00000000-0000-4000-8000-000000000001",
      recordId: "work", title: p.title, text, nextStep: "Марии на рассмотрение, proposed" };
    expect(inputs.submit_result.parse(args).text).toBe(text);
    expect(text.length).toBeLessThan(40000);
    expect(text.length).toBeLessThanOrEqual(documentTextLimit);
  });
  it("requires numeric journal expectations and avoids unsupported fractional tool arguments", () => {
    const expected = expectedResultSchema.parse({ text: "Proposed, не живые пороги", appliesTo: "other",
      metrics: [{ metric: "proposed_pause_median_ms", operator: "lte", value: 1400, unit: "ms" },
        { metric: "proposed_restarts_per_100_phrases", operator: "lte", value: 150, unit: "count" }] });
    expect(expected.metrics.every(m => Number.isInteger(m.value))).toBe(true);
    expect(expected.metrics[1].value / 100).toBe(1.5);
    const p = makeSecretaryNorms(at), text = renderSecretaryNorms(p);
    const entry = normsJournalEntry(p, "DOC-NORMS", hashText(text), at);
    expect(journalEntrySchema.parse(entry)).toEqual(entry);
    expect(entry.expectedResult.metrics).toHaveLength(7);
    expect(entry.expectedResult.appliesTo).toBe("other");
    expect(entry.productChangeAuthorized).toBe(false); expect(entry.newRuntimeExecution).toBe(false);
    expect(entry.expectedResult.metrics.every(m => Number.isInteger(m.value))).toBe(true);
    expect(journalEntrySchema.safeParse({ ...entry, expectedResult: undefined }).success).toBe(false);
  });
  it("uses get_work for documentary work; get_team linkedWork is the operating graph, not that queue", async () => {
    const state = { revision: 1, documents: [],
      elements: [{ id: "work", title: "Паспорт норм", version: 1, details: {}, implementationStatus: "planned",
        coordination: { roleId: "secretary-project-head", kind: "work", operations: [] } }],
      operatingModel: { revisions: [{ data: { nodes: [
        { id: "secretary-project-head", kind: "role", resourceIds: [] },
      ], links: [] } }] } };
    const service = new ProductCrewService({ read: async () => state } as any);
    const team = await service.call("owner", "get_team", { roleId: "secretary-project-head" });
    expect(team.roles[0].linkedWork).toEqual([]);
    const work = await service.call("owner", "get_work", { recordId: "work" });
    expect(work.record.id).toBe("work");
    expect(work.record).not.toHaveProperty("implementationStatus");
  });
});
