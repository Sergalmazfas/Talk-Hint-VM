import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { applyCommand, requestSchema } from "./domain";
import { initialModel } from "./seed";
import { projectPackageBlocks, type ProjectModelState, type ModelCommand } from "../../shared/projectModel";
import { emptyStrategyNode, emptyStrategyDecision, defaultStrategyMap, strategyEntries, strategyLinks, strategyGaps } from "../../shared/projectStrategy";
import { emptyCompetitorResearch, researchRows, researchFeatures, featureStatusLabel, positioningFor, quarterDirectory } from "../../shared/competitorResearch";
import { initialAIPhoneSnapshot } from "./competitorInitial";
import { newReview } from "../../shared/competitorAssessments";
import { applyHypothesisCommand } from "./hypotheses";

export function strategyFixture(): ProjectModelState {
  const base = initialModel(), template = base.elements[0];
  return { schema: 1, revision: 0, elements: projectPackageBlocks.map(b => ({
    ...structuredClone(template), id: b.id, title: b.title, description: b.id === "TH-PRODUCT" ? "Согласованная концепция — не готовность" : "",
    details: {}, contentStatus: "hypothesis", scope: "talkhint", version: 1, needsReview: false,
  })), relations: [], documents: [], decisions: [], proposals: [], taskDrafts: [] };
}
const run = (s: ProjectModelState, c: ModelCommand) => applyCommand(s, c, "owner");
function node(s: ProjectModelState, title: string, kind: ReturnType<typeof emptyStrategyNode>["kind"] = "hypothesis") {
  const next = run(s, { type: "saveStrategyNode", baseVersion: 0, node: { ...emptyStrategyNode(), title, kind } });
  return { s: next, ref: `node:${next.strategy!.nodes.at(-1)!.id}` };
}
function dependency(s: ProjectModelState, from: string, to: string, kind: "depends_on" | "navigation" = "depends_on") {
  return run(s, { type: "saveStrategyLink", from, to, kind, reason: `${from} основан на ${to}` });
}
function edit(s: ProjectModelState, ref: string, text: string) {
  const record = s.strategy!.nodes.find(n => `node:${n.id}` === ref)!;
  return run(s, { type: "saveStrategyNode", id: record.id, baseVersion: record.revisions.at(-1)!.version,
    node: { ...record.revisions.at(-1)!.data, description: text } });
}
function competitor(s: ProjectModelState) {
  const snapshot = structuredClone(initialAIPhoneSnapshot);
  snapshot.research = emptyCompetitorResearch();
  snapshot.research.features.secretary_outgoing = { status: "unknown", note: "Не проверено", sourceUrls: [], checkedAt: null };
  return run(s, { type: "saveCompetitor", baseVersion: 0, reason: "ЯВНО ТЕСТОВАЯ фикстура, не новость", snapshot });
}
describe("connected strategy model", () => {
  it("projects legacy data without mutation or hidden initialization; strict evidence and server metadata", () => {
    const s = strategyFixture(), before = JSON.stringify(s);
    strategyEntries(s); strategyLinks(s); strategyGaps(s);
    expect(JSON.stringify(s)).toBe(before); expect(s.strategy).toBeUndefined();
    const input = { ...emptyStrategyNode(), title: "Проверка" };
    expect(requestSchema.safeParse({ revision: 0, command: { type: "saveStrategyNode", baseVersion: 0, node: input, actor: "spoof" } }).success).toBe(false);
    input.evidence.status = "verified";
    expect(() => run(s, { type: "saveStrategyNode", baseVersion: 0, node: input })).toThrow();
    input.evidence.sourceNote = "Наш тест, исходное наблюдение"; input.evidence.checkedAt = "2026-10-25";
    const next = run(s, { type: "saveStrategyNode", baseVersion: 0, node: input });
    expect(next.strategy!.nodes[0].revisions[0].actor).toBe("owner");
    expect(next.elements).toEqual(s.elements);
    expect(() => run(s, { type: "saveStrategyNode", baseVersion: 0, node: {
      ...input, evidence: { ...input.evidence, sourceUrls: ["https://example.test/?api_key=private"] },
    } })).toThrow();
  });
  it("uses typed local references, enforces immutable history and versions; action gaps aren't assignments", () => {
    let { s, ref } = node(strategyFixture(), "Проверить запись", "action");
    expect(strategyGaps(s).filter(g => g.ref === ref).map(g => g.message)).toContain("Нет ответственного");
    expect(s.strategy!.nodes[0].revisions[0].data.assignment.ownerRef).toBeNull();
    expect(() => dependency(s, ref, "node:foreign-owner")).toThrow(/не найдена/);
    const before = structuredClone(s);
    s = edit(s, ref, "Уточнить сценарий");
    expect(s.strategy!.nodes[0].revisions[0]).toEqual(before.strategy!.nodes[0].revisions[0]);
    expect(() => run(s, { type: "saveStrategyNode", id: ref.slice(5), baseVersion: 1, node: emptyStrategyNode() })).toThrow();
    const latest = s.strategy!.nodes[0].revisions.at(-1)!;
    expect(run(s, { type: "saveStrategyNode", id: ref.slice(5), baseVersion: latest.version, node: latest.data })).toBe(s);
    expect(() => run(s, { type: "saveStrategyNode", id: ref.slice(5), baseVersion: latest.version,
      node: { ...latest.data, assignment: { ...latest.data.assignment, ownerRef: "element:TH-PRODUCT" } } })).toThrow(/тип/);
  });
  it("propagates only directed dependencies, explains indirect paths and terminates cycles", () => {
    let { s, ref: source } = node(strategyFixture(), "Факт", "result");
    const first = node(s, "Вывод", "difference"); s = first.s;
    const second = node(s, "Проверка", "experiment"); s = second.s;
    const neighbor = node(s, "Просто связано"); s = neighbor.s;
    s = dependency(s, first.ref, source); s = dependency(s, second.ref, first.ref);
    s = dependency(s, source, second.ref); // An explicit cycle is bounded, not recursively expanded.
    s = dependency(s, neighbor.ref, source, "navigation");
    const next = edit(s, source, "Изменившееся наблюдение");
    const events = next.strategy!.impacts;
    expect(events.map(i => i.target)).toEqual([first.ref, second.ref]);
    expect(events[0].path).toEqual([source, first.ref]);
    expect(events[1].path).toEqual([source, first.ref, second.ref]);
    expect(events[1].reason).toContain(" → ");
    expect(new Set(events.map(i => `${i.eventId}:${i.target}`)).size).toBe(events.length);
    expect(next.strategy!.nodes.length).toBe(s.strategy!.nodes.length);
    expect(next.strategy!.decisions).toHaveLength(0);
  });
  it("records retain/defer/revised with actor/date, never rewrites the conclusion and keeps pending flags", () => {
    const created = node(strategyFixture(), "Основание", "result");
    let s = dependency(created.s, "element:TH-DIFFERENTIATION", created.ref);
    const original = structuredClone(s.elements);
    s = edit(s, created.ref, "Новые данные");
    const impact = s.strategy!.impacts.find(i => i.target === "element:TH-DIFFERENTIATION")!;
    expect(s.elements.map(e => ({ ...e, needsReview: false }))).toEqual(original);
    expect(s.elements.find(e => e.id === "TH-DIFFERENTIATION")!.needsReview).toBe(true);
    expect(() => run(s, { type: "reviewElement", id: "TH-DIFFERENTIATION", reason: "Обойти" })).toThrow(/панели/);
    expect(() => run(s, { type: "reviewStrategyImpact", id: impact.id, outcome: "revised", reason: "Не изменял" })).toThrow(/Сначала/);
    s = run(s, { type: "reviewStrategyImpact", id: impact.id, outcome: "deferred", reason: "Нужен реальный тест" });
    expect(s.elements.find(e => e.id === "TH-DIFFERENTIATION")!.needsReview).toBe(true);
    const deferred = s;
    expect(run(s, { type: "reviewStrategyImpact", id: impact.id, outcome: "deferred", reason: "Нужен реальный тест" })).toBe(deferred);
    s = run(s, { type: "reviewStrategyImpact", id: impact.id, outcome: "retained", reason: "Факт пока официальное заявление, живой проверки нет" });
    expect(s.elements.find(e => e.id === "TH-DIFFERENTIATION")!.needsReview).toBe(false);
    expect(s.strategy!.impacts[0].reviews.map(r => r.outcome)).toEqual(["deferred", "retained"]);
    expect(s.strategy!.impacts[0].reviews[1].actor).toBe("owner");
    expect(() => run(s, { type: "reviewStrategyImpact", id: impact.id, outcome: "deferred", reason: "Переписать историю" })).toThrow(/уже/);
  });
  it("supports genuine changed conclusions without clearing other unreviewed events", () => {
    const first = node(strategyFixture(), "Основание"), target = node(first.s, "Вывод");
    let s = dependency(target.s, target.ref, first.ref);
    s = edit(s, first.ref, "Первое"); s = edit(s, first.ref, "Второе");
    const impact = s.strategy!.impacts[0];
    s = edit(s, target.ref, "Уточнённый вывод с оговоркой");
    s = run(s, { type: "reviewStrategyImpact", id: impact.id, outcome: "revised", reason: "Уточнил границы утверждения" });
    expect(s.strategy!.impacts[0].reviews.at(-1)?.outcome).toBe("revised");
    expect(s.strategy!.impacts[1].reviews).toEqual([]);
  });
  it("runs the test-only competitor→benchmark→uniqueness→decision→owned action chain without changing mission", () => {
    let s = competitor(strategyFixture());
    const comp = s.competitorDirectory!.records[0], source = `fact:${comp.id}:feature:secretary_outgoing`;
    const mission = node(s, "Миссия пользователя", "mission"); s = mission.s;
    const unique = node(s, "Уникальность ещё требует доказательств", "difference"); s = unique.s;
    s = dependency(s, unique.ref, source);
    s = run(s, { type: "saveStrategyMap", baseVersion: 0, map: defaultStrategyMap() });
    const beforeMission = structuredClone(s.strategy!.nodes.find(n => `node:${n.id}` === mission.ref));
    const snapshot = structuredClone(s.competitorDirectory!.records[0].revisions.at(-1)!.snapshot);
    snapshot.research!.features.secretary_outgoing = {
      status: "official_claim", note: "ТЕСТ: конкурент заявил исходящие поручения, не реальная новость",
      sourceUrls: ["https://example.test/test-only"], checkedAt: "2026-10-25",
    };
    s = run(s, { type: "saveCompetitor", id: comp.id, baseVersion: 1, reason: "Тестовое изменение", snapshot });
    expect(featureStatusLabel(researchRows(s.competitorDirectory!)[0], "secretary_outgoing")).toBe("Официально заявлено");
    expect(positioningFor(researchRows(s.competitorDirectory!)[0]).plottable).toBe(false);
    expect(s.strategy!.impacts.some(i => i.target === unique.ref && i.source === source)).toBe(true);
    expect(s.strategy!.impacts.some(i => i.target === "map:current" && i.effect === "recomputed")).toBe(true);
    expect(s.strategy!.nodes.find(n => `node:${n.id}` === mission.ref)).toEqual(beforeMission);
    expect(s.strategy!.decisions).toEqual([]); // A competitor fact did not create a decision or action.
    const person = node(s, "Ответственный тестовой фикстуры", "person"); s = person.s;
    const decision = { ...emptyStrategyDecision(), title: "Не заявлять уникальность без сравнения",
      learned: "У конкурента есть заявление", basisRefs: [source], affectedRefs: [unique.ref],
      options: ["Скопировать", "Проверить качество"], choice: "Проверить качество", rationale: "Наличие не равно качеству",
      expectedResult: "Сопоставимые данные", nextStep: "Ручной тест позже", ownerRef: person.ref, status: "accepted" as const };
    s = run(s, { type: "saveStrategyDecision", baseVersion: 0, decision });
    const accepted = s.strategy!.decisions[0], decisionRef = `decision:${accepted.id}`;
    s = run(s, { type: "saveStrategyNode", baseVersion: 0, node: {
      ...emptyStrategyNode(), kind: "action", title: "Подготовить одинаковый сценарий — НЕ запускать",
      assignment: { ownerRef: person.ref, skillRefs: [], dependencyRefs: [decisionRef], expectedResult: "Сценарий", status: "planned" },
    } });
    const actionRef = `node:${s.strategy!.nodes.at(-1)!.id}`;
    expect(strategyLinks(s).some(l => l.from === actionRef && l.to === decisionRef)).toBe(true);
    expect(strategyLinks(s).some(l => l.from === decisionRef && l.to === source)).toBe(true);
    expect(comp.revisions[0].snapshot.research!.features.secretary_outgoing!.status).toBe("unknown");
    expect(() => run(s, { type: "saveStrategyDecision", id: accepted.id, baseVersion: 1,
      decision: { ...decision, choice: "Скрыто переписать" } })).toThrow(/неизменно/);
    s = run(s, { type: "saveStrategyDecision", baseVersion: 0,
      decision: { ...decision, title: "Пересмотр", supersedes: accepted.id, choice: "Оставить проверку, уточнив сценарий" } });
    expect(s.strategy!.decisions[0].revisions[0].data).toEqual(decision);
    expect(s.strategy!.decisions[0].revisions.at(-1)!.data.status).toBe("superseded");
    expect(s.strategy!.decisions[0].supersededBy).toBe(s.strategy!.decisions[1].id);
    expect(s.strategy!.nodes.find(n => `node:${n.id}` === mission.ref)).toEqual(beforeMission);
  });
  it("tracks private review changes only after append, separately from public facts; immutable reviews remain stable", () => {
    let s = competitor(strategyFixture());
    const id = s.competitorDirectory!.records[0].id;
    const review = { ...newReview("design"), author: "Тест", platform: "iOS", appVersion: "test",
      score: 7, rationale: "Наблюдения теста" };
    const firstId = randomUUID();
    s = run(s, { type: "addCompetitorReview", id, baseVersion: 1, requestId: firstId, review });
    const dependent = node(s, "Наш вывод по дизайну"); s = dependent.s;
    const historical = node(s, "Вывод по конкретной проверке"); s = historical.s;
    s = dependency(s, dependent.ref, `review:${id}:design`);
    s = dependency(s, historical.ref, `review:${id}:design:${firstId}`);
    s = run(s, { type: "addCompetitorReview", id, baseVersion: 2, requestId: randomUUID(), review: { ...review, score: 8 } });
    expect(s.strategy!.impacts.filter(i => i.source.startsWith("review:")).map(i => i.target)).toEqual([dependent.ref]);
    const event = s.strategy!.impacts.find(i => i.target === dependent.ref)!;
    expect((event.after as { score: number }).score).toBe(8);
    expect(strategyEntries(s).find(e => e.key === `review:${id}:design:${firstId}`)?.kind).toContain("Историческая");
  });
  it("does not duplicate impacts on identical saves, reads, rechecks or reordered object keys", () => {
    const a = node(strategyFixture(), "Факт"), b = node(a.s, "Вывод");
    let s = dependency(b.s, b.ref, a.ref);
    s = edit(s, a.ref, "Новое");
    const snapshot = JSON.stringify(s);
    for (let i = 0; i < 3; i++) strategyEntries(s);
    expect(JSON.stringify(s)).toBe(snapshot);
    const rec = s.strategy!.nodes[0], data = rec.revisions.at(-1)!.data;
    s = run(s, { type: "saveStrategyNode", id: rec.id, baseVersion: 2,
      node: { ...data, evidence: { ...data.evidence, checkedAt: "2026-10-25" } } });
    expect(s.strategy!.impacts).toHaveLength(1);
  });
  it("does not treat reordering keyed public facts as a new strategic event", () => {
    let s = competitor(strategyFixture());
    const c = s.competitorDirectory!.records[0], dependent = node(s, "Сравнение предложения"); s = dependent.s;
    s = dependency(s, dependent.ref, `competitor:${c.id}`);
    const snapshot = structuredClone(c.revisions.at(-1)!.snapshot);
    snapshot.plans.reverse(); snapshot.checkedAt = "2026-10-25";
    s = run(s, { type: "saveCompetitor", id: c.id, baseVersion: 1, reason: "Только порядок и дата проверки", snapshot });
    expect(s.strategy!.impacts).toEqual([]);
  });
  it("does not claim a recalculation when no strategic map has been saved", () => {
    let s = competitor(strategyFixture());
    s = node(s, "Начать связывать данные").s;
    const record = s.competitorDirectory!.records[0], snapshot = structuredClone(record.revisions[0].snapshot);
    snapshot.research!.features.secretary_outgoing = {
      status: "official_claim", note: "ТЕСТ", sourceUrls: ["https://example.test"], checkedAt: "2026-10-25",
    };
    s = run(s, { type: "saveCompetitor", id: record.id, baseVersion: 1, snapshot, reason: "Тест" });
    expect(s.strategy!.mapVersions).toEqual([]);
    expect(s.strategy!.impacts.some(i => i.target === "map:current" && i.effect === "review")).toBe(true);
    expect(s.strategy!.impacts.some(i => i.effect === "recomputed")).toBe(false);
  });
  it("versions explicit methods, leaves expert positions unchanged and freezes old quarterly data", () => {
    let s = competitor(strategyFixture());
    const basis = node(s, "Экспертное основание", "hypothesis"); s = basis.s;
    const compId = s.competitorDirectory!.records[0].id;
    const map = { ...defaultStrategyMap(), mode: "expert" as const, title: "Экспертная методика",
      points: [{ ref: `competitor:${compId}`, x: 2, y: 1, rationale: "Оценка, не измерение", basisRefs: [basis.ref] }] };
    s = run(s, { type: "saveStrategyMap", baseVersion: 0, map });
    expect(s.strategy!.mapVersions.map(m => m.version)).toEqual([0, 1]);
    const now = new Date(), quarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
    s = run(s, { type: "captureCompetitorQuarter", quarter, reason: "Тест", direction: "Не реальное исследование" });
    const savedQuarter = structuredClone(s.competitorDirectory!.quarters![0]);
    s = edit(s, basis.ref, "Новое основание");
    expect(s.strategy!.impacts.some(i => i.target === "map:current" && i.effect === "review")).toBe(true);
    expect(s.strategy!.mapVersions.at(-1)!.data.points).toEqual(map.points);
    const updated = { ...map, title: "Другая шкала", x: { ...map.x, scaleMax: 30 } };
    s = run(s, { type: "saveStrategyMap", baseVersion: 1, map: updated });
    expect(s.strategy!.mapVersions[1].data).toEqual(map);
    expect(s.competitorDirectory!.quarters![0]).toEqual(savedQuarter);
    expect(quarterDirectory(s.competitorDirectory!, savedQuarter).records[0].revisions[0].version).toBe(1);
    expect(() => run(s, { type: "saveStrategyMap", baseVersion: 2, map: {
      ...defaultStrategyMap(), x: { ...defaultStrategyMap().x, scaleMax: 100 },
    } })).toThrow(/v2 фиксировано/);
  });
  it("cannot write connected strategy into the original hypothesis", () => {
    const original = initialModel(), before = JSON.stringify(original);
    expect(() => applyHypothesisCommand(original, "original", {
      type: "saveStrategyNode", baseVersion: 0, node: { ...emptyStrategyNode(), title: "Не сюда" },
    }, "owner")).toThrow(/исходная модель/);
    expect(JSON.stringify(original)).toBe(before);
  });
  for (const change of ["add_feature", "remove_feature", "add_competitor"] as const)
    it(`actually recalculates scenario_v2 for ${change}, preserving archive geometry`, () => {
      let s = competitor(strategyFixture());
      const record = s.competitorDirectory!.records[0];
      const baseline = structuredClone(record.revisions[0].snapshot);
      // Use a feature not present in the six legacy compatibility scenarios.
      baseline.research!.features = Object.fromEntries(Object.keys(researchFeatures).map(k => [k, {
        status: "not_supported", note: "ЯВНО ТЕСТОВОЕ отсутствие", sourceUrls: ["https://example.test"],
        checkedAt: "2026-10-25", contexts: ["personal", "business"],
      }]));
      baseline.research!.autonomy = { mode: "confirmed_tasks", evidence: {
        status: "live_verified", note: "Синтетическая проверка", sourceUrls: ["https://example.test"], checkedAt: "2026-10-25",
      } };
      if (change === "add_feature") delete baseline.research!.features.chat;
      s = run(s, { type: "saveCompetitor", id: record.id, baseVersion: 1, reason: "Синтетическая база", snapshot: baseline });
      s = run(s, { type: "saveStrategyMap", baseVersion: 0, map: defaultStrategyMap() });
      const previousMaps = structuredClone(s.strategy!.mapVersions);
      const now = new Date(), quarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
      s = run(s, { type: "captureCompetitorQuarter", quarter, reason: "ТЕСТ", direction: "Фикстура" });
      const archived = structuredClone(s.competitorDirectory!.quarters);
      const snapshot = structuredClone(baseline);
      if (change === "add_feature") snapshot.research!.features.chat = {
        status: "live_verified", note: "ЯВНО ТЕСТОВЫЙ новый факт", sourceUrls: ["https://example.test"],
        checkedAt: "2026-10-25", contexts: ["personal", "business"],
      };
      if (change === "remove_feature") delete snapshot.research!.features.chat;
      if (change === "add_competitor") {
        snapshot.name = "ЯВНО ТЕСТОВЫЙ второй продукт"; snapshot.website = "https://second.example.test"; snapshot.appStore = "https://apps.apple.com/us/app/id9999999999";
      }
      s = run(s, { type: "saveCompetitor", ...(change === "add_competitor" ? {} : { id: record.id }),
        baseVersion: change === "add_competitor" ? 0 : 2, reason: "Тест структурного изменения", snapshot });
      const current = s.strategy!.mapVersions.at(-1)!;
      expect(s.strategy!.mapVersions.slice(0, -1)).toEqual(previousMaps);
      expect(s.competitorDirectory!.quarters).toEqual(archived);
      expect(current.version).toBe(previousMaps.at(-1)!.version + 1);
      expect(s.decisions.at(-1)?.strategyChange?.command).toBe("recalculateStrategyMap");
      expect(s.strategy!.impacts.some(i => i.target === "map:current" && i.effect === "recomputed")).toBe(true);
      if (change === "add_competitor") expect(current.calculations).toHaveLength(previousMaps.at(-1)!.calculations!.length + 1);
      else {
        const point = current.calculations!.find(p => p.ref === `competitor:${record.id}`)!;
        expect(point.x).toBe(change === "add_feature" ? 2 : null);
        const event = s.strategy!.impacts.find(i => i.source === `fact:${record.id}:feature:chat`)!;
        expect(change === "add_feature" ? event.before : event.after).toBeNull();
      }
    });
});
