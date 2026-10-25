import { describe, expect, it } from "vitest";
import { applyCommand, requestSchema } from "./domain";
import { applyHypothesisCommand } from "./hypotheses";
import { initialModel } from "./seed";
import { initialAIPhoneSnapshot } from "./competitorInitial";
import { analystProducts, analystCompetitors } from "../../shared/competitiveAnalyst";
import { defaultAnalystPreparation } from "../../shared/competitiveAnalystTemplate";
import { publicAnalystUrl } from "./analystPreparation";
import { prepareAnalystPackage } from "./research/prepareAnalyst";

export function analystFixture() {
  let state = initialModel();
  state.elements.push({ ...structuredClone(state.elements[0]), id: "TH-PILOT-COMPETITORS", title: "Конкуренты" });
  for (const p of analystProducts) {
    const snapshot = structuredClone(initialAIPhoneSnapshot);
    snapshot.name = p.name; snapshot.website = `https://${p.domain}/`;
    snapshot.appStore = `https://apps.apple.com/us/app/id${p.appId}`;
    snapshot.sources = [{ url: snapshot.website, checkedAt: "2026-10-24", note: "ТЕСТОВАЯ фикстура, не исследование" }];
    state = applyCommand(state, { type: "saveCompetitor", baseVersion: 0, snapshot, reason: "Синтетические данные" }, "owner");
  }
  return state;
}
describe("Stage A preparation", () => {
  it("projects exact canonical IDs, leaves missing cards missing and never writes on read", () => {
    const state = analystFixture(), before = JSON.stringify(state);
    const p = defaultAnalystPreparation(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(analystCompetitors(state).every(p => p.record)).toBe(true);
    expect(p.pilot.competitorId).toBe(state.competitorDirectory!.records[0].id);
    expect(p.sources.every(s => s.approval === "pending")).toBe(true);
    expect(p.sources.filter(s => s.kind === "instagram").every(s => s.url === null)).toBe(true);
    const empty = defaultAnalystPreparation(initialModel());
    expect(empty.pilot.competitorId).toBeNull(); expect(empty.sources).toEqual([]);
  });
  it("strictly persists preparation versions, repeat no-op, immutable history and no competitor edits", () => {
    let s = analystFixture(); const cards = structuredClone(s.competitorDirectory), elements = structuredClone(s.elements);
    const p = defaultAnalystPreparation(s), cmd = { type: "saveAnalystPreparation" as const, baseVersion: 0, preparation: p };
    s = applyCommand(s, cmd, "owner");
    expect(s.analystPreparation!.revisions[0]).toMatchObject({ version: 1, actor: "owner", status: "awaiting_approval" });
    expect(s.analystPreparation!.revisions[0].basisVersions).toHaveLength(5);
    expect(applyCommand(s, { ...cmd, baseVersion: 1 }, "owner")).toBe(s);
    const prior = structuredClone(s.analystPreparation);
    expect(() => applyCommand(s, cmd, "owner")).toThrow(/изменён/);
    const next = applyCommand(s, { ...cmd, baseVersion: 1, preparation: { ...p, approvalNotes: "Проверить список источников с Сергеем" } }, "owner");
    expect(next.analystPreparation!.revisions[0]).toEqual(prior!.revisions[0]);
    expect(next.analystPreparation!.revisions.at(-1)!.version).toBe(2);
    expect(next.competitorDirectory).toEqual(cards); expect(next.elements).toEqual(elements);
  });
  it("cannot grant execution, spoof metadata, reference foreign competitors or expand to another hypothesis", () => {
    const s = analystFixture(), p = defaultAnalystPreparation(s);
    const cmd = { type: "saveAnalystPreparation" as const, baseVersion: 0, preparation: p };
    expect(requestSchema.safeParse({ revision: s.revision, command: { ...cmd, actor: "attacker" } }).success).toBe(false);
    expect(requestSchema.safeParse({ revision: s.revision, command: { ...cmd, preparation: { ...p, execute: true } } }).success).toBe(false);
    expect(requestSchema.safeParse({ revision: s.revision, command: { ...cmd, preparation: {
      ...p, sources: [{ ...p.sources[0], approval: "approved" }],
    } } }).success).toBe(false);
    expect(() => applyCommand(s, { ...cmd, preparation: { ...p, pilot: { ...p.pilot, competitorId: "foreign-id" } } }, "owner")).toThrow(/владельца/);
    expect(() => applyCommand(s, { ...cmd, preparation: { ...p, sources: [...p.sources, p.sources[0]] } }, "owner")).toThrow(/Повторный/);
    expect(() => applyHypothesisCommand(s, "original", cmd, "owner")).toThrow(/новой Dev/);
  });
  it("enforces public URL metadata and bounded proposals, without fetching URLs", () => {
    for (const u of ["http://example.com", "https://127.0.0.1", "https://10.2.3.4",
      "https://user:password@example.com", "https://example.com?access_token=private", "https://[::1]"])
      expect(publicAnalystUrl.safeParse(u).success, u).toBe(false);
    expect(publicAnalystUrl.safeParse("https://help.vocalingo.app/en").success).toBe(true);
    const s = analystFixture(), p = defaultAnalystPreparation(s);
    expect(requestSchema.safeParse({ revision: 0, command: { type: "saveAnalystPreparation", baseVersion: 0,
      preparation: { ...p, limits: { ...p.limits, maxAttempts: 100 } },
    } }).success).toBe(false);
  });
  it("explicit preparation preserves both hypotheses, every competitor, reports and quarter snapshots; repeat never overwrites edits", () => {
    const root = initialModel(), model = analystFixture();
    root.alternatives = [{ id: "new-country", title: "Новая гипотеза", model }];
    const old = structuredClone(root);
    const next = prepareAnalystPackage(root, "owner");
    expect(next.elements).toEqual(old.elements);
    expect(next.alternatives![0].model.competitorDirectory).toEqual(model.competitorDirectory);
    expect(next.alternatives![0].model.analystPreparation!.revisions).toHaveLength(1);
    expect(prepareAnalystPackage(next, "owner")).toBe(next);
    expect(root).toEqual(old);
  });
});
