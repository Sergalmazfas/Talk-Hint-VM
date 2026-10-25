import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import Workspace, { ProjectStrategySummary } from "../../client/src/components/project-model/ProjectStrategyWorkspace";
import { StrategyReferencePicker } from "../../client/src/components/project-model/StrategyReferencePicker";
import StrategyPositionMap from "../../client/src/components/project-model/StrategyPositionMap";
import PackageViews from "../../client/src/components/project-model/PackageViews";
import { projectPackageBlocks, type ProjectModelState } from "../../shared/projectModel";
import { emptyStrategyNode, strategyEntries, strategyHref, defaultStrategyMap, type StrategyMapVersion, type StrategyEntry } from "../../shared/projectStrategy";
import { applyCommand } from "./domain";
import { initialAIPhoneSnapshot } from "./competitorInitial";
import { emptyCompetitorResearch, researchFeatures } from "../../shared/competitorResearch";

const html = (component: React.ReactElement) => renderToStaticMarkup(component);
function fixture(): ProjectModelState {
  return {
    schema: 1, revision: 0, elements: projectPackageBlocks.map(b => ({
      id: b.id, title: b.title, section: "Бизнес-модель", scope: "talkhint", kind: "context",
      description: `Сохранённое описание ${b.id}`, details: {}, contentStatus: "hypothesis",
      implementationStatus: "planned", version: 1, updatedAt: "2026-10-25", needsReview: false,
    })), relations: [], documents: [], proposals: [], decisions: [], taskDrafts: [],
    hypothesisContext: { selectedId: "new-country", options: [], primaryId: null },
  };
}
describe("connected project views", () => {
  it("derives the first Product slide from existing records and leaves mission and payment unconfirmed", () => {
    const s = fixture(), before = JSON.stringify(s);
    const markup = html(React.createElement(ProjectStrategySummary, { state: s }));
    for (const id of ["TH-PRODUCT", "TH-CLIENT", "TH-PROBLEM", "TH-PILOT-VALUE", "TH-DIFFERENTIATION"])
      expect(markup).toContain(`Сохранённое описание ${id}`);
    expect(markup).toContain("миссия не зафиксирована");
    expect(markup).toContain("Готовность платить не подтверждена");
    expect(markup).toContain("Непривязанные факты не считаются подтверждением продукта");
    expect(JSON.stringify(s)).toBe(before);
    const packageHtml = html(React.createElement(PackageViews, { state: s, view: "overview", openElement: vi.fn(), submit: vi.fn() }));
    expect(packageHtml).toContain("Вывод стратегии на первом слайде");
    expect(packageHtml).toContain("Связная стратегия проекта");
  });
  it("only includes explicitly related verified grounds, not unrelated research or public promises", () => {
    let s = fixture();
    for (const title of ["Связанное наблюдение", "НЕСВЯЗАННОЕ подтверждение"]) s = applyCommand(s, {
      type: "saveStrategyNode", baseVersion: 0, node: { ...emptyStrategyNode(), title, kind: "result",
        evidence: { status: "verified", sourceNote: "Только тестовое наблюдение", sourceUrls: ["https://example.test/check"],
          checkedAt: "2026-10-25", period: "Тест", versionLabel: "Приложение test" } },
    }, "owner");
    s = applyCommand(s, { type: "saveStrategyLink", from: "element:TH-PRODUCT",
      to: `node:${s.strategy!.nodes[0].id}`, kind: "depends_on", reason: "Обосновывает вывод" }, "owner");
    const markup = html(React.createElement(ProjectStrategySummary, { state: s }));
    expect(markup).toContain("Связанное наблюдение");
    expect(markup).not.toContain("НЕСВЯЗАННОЕ подтверждение");
    expect(markup).toContain("https://example.test/check");
    expect(markup).toContain("2026-10-25");
  });
  it("offers searchable clickable references, explicit dependencies, action gaps and immutable histories", () => {
    let s = applyCommand(fixture(), { type: "saveStrategyNode", baseVersion: 0,
      node: { ...emptyStrategyNode(), title: "Подготовить сравнение", kind: "action" } }, "owner");
    const ref = `node:${s.strategy!.nodes[0].id}`;
    s = applyCommand(s, { type: "saveStrategyLink", from: ref, to: "element:TH-PRODUCT",
      kind: "depends_on", reason: "Основание тестового действия" }, "owner");
    const submit = vi.fn();
    const markup = html(React.createElement(Workspace, { state: s, submit, saving: false }));
    for (const text of ["Новое решение", "Подготовить сравнение", "Нет ответственного", "Не определены необходимые навыки",
      "История", "Основано на", "Зависит от", "методики"]) expect(markup).toContain(text);
    expect(markup).toContain(strategyHref(ref).replaceAll("&", "&amp;"));
    expect(markup).not.toContain("ключи через запятую");
    const picker = html(React.createElement(StrategyReferencePicker, { entries: strategyEntries(s), value: [ref], label: "Основание", onChange: vi.fn() }));
    expect(picker).toContain('type="search"');
    expect(picker).toContain("Подготовить сравнение");
    expect(submit).not.toHaveBeenCalled();
  });
  it("does not change the original hypothesis surface", () => {
    const s = fixture(); s.hypothesisContext!.selectedId = "original";
    const markup = html(React.createElement(PackageViews, { state: s, view: "overview", openElement: vi.fn(), submit: vi.fn() }));
    expect(markup).not.toContain("Связная стратегия проекта");
    expect(markup).not.toContain("Вывод стратегии на первом слайде");
  });
  it("displays frozen historical map data, keeps unknown coordinates unknown and never reads today's values as old geometry", () => {
    const version: StrategyMapVersion = { id: "MAP-saved", version: 1, actor: "test", at: "2026-10-25", calculatedAt: "2026-10-25",
      data: defaultStrategyMap(), calculations: [
        { ref: "competitor:one", name: "Архивное название", x: 5, y: 1, lower: 5, upper: 7, reason: "Данные на дату снимка" },
        { ref: "competitor:unknown", name: "Непроверенный продукт", x: null, y: null, lower: 0, upper: 22, reason: "Недостаточно подтверждений" },
      ] };
    const entries = new Map<string, StrategyEntry>([["competitor:one", {
      key: "competitor:one", title: "НОВОЕ название и позиция", kind: "Конкурент", version: 2, value: { x: 20, y: 2 },
      sourceUrls: [], sourceNote: "", checkedAt: "2026-10-26", href: "",
    }]]);
    const before = JSON.stringify(version);
    const markup = html(React.createElement(StrategyPositionMap, { version, entries, historical: true }));
    expect(markup).toContain("Архивное название");
    expect(markup).toContain("X 5 · Y 1");
    expect(markup).toContain("X: Не определено · Y: Не определено");
    expect(markup).not.toContain("НОВОЕ название и позиция");
    expect(JSON.stringify(version)).toBe(before);
  });
  it("actually recalculates, versions and displays a changed v2 point while preserving the old map and quarter", () => {
    let s = fixture();
    const snapshot = structuredClone(initialAIPhoneSnapshot), research = emptyCompetitorResearch();
    const evidence = { status: "not_supported" as const, note: "Явно синтетическая проверка, не факты компании",
      sourceUrls: ["https://example.test/synthetic"], checkedAt: "2026-10-25", contexts: ["personal", "business"] as ("personal" | "business")[] };
    for (const key of Object.keys(researchFeatures) as (keyof typeof researchFeatures)[]) research.features[key] = structuredClone(evidence);
    research.autonomy = { mode: "confirmed_tasks", evidence: { ...evidence, status: "live_verified" } };
    snapshot.research = research;
    s = applyCommand(s, { type: "saveCompetitor", baseVersion: 0, reason: "СИНТЕТИЧЕСКАЯ фикстура", snapshot }, "owner");
    const compId = s.competitorDirectory!.records[0].id;
    s = applyCommand(s, { type: "saveStrategyMap", baseVersion: 0, map: defaultStrategyMap() }, "owner");
    const archived = structuredClone(s.strategy!.mapVersions.at(-1)!);
    expect(archived.calculations!.find(c => c.ref === `competitor:${compId}`)!.x).toBe(0);
    const date = new Date(), quarter = `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    s = applyCommand(s, { type: "captureCompetitorQuarter", quarter, reason: "Тест", direction: "Не реальное исследование" }, "owner");
    const frozenQuarter = structuredClone(s.competitorDirectory!.quarters![0]);
    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.research!.features.secretary_outgoing = { ...evidence, status: "live_verified" };
    s = applyCommand(s, { type: "saveCompetitor", id: compId, baseVersion: 1, snapshot: nextSnapshot,
      reason: "ТЕСТ: подтверждение двух сценариев, не реальная новость" }, "owner");
    const latest = s.strategy!.mapVersions.at(-1)!;
    expect(latest.version).toBe(2);
    expect(latest.data).toEqual(archived.data); // Same methodology, new auditable calculation.
    expect(latest.calculations!.find(c => c.ref === `competitor:${compId}`)!.x).toBe(2);
    expect(latest.calculations!.find(c => c.ref === `competitor:${compId}`)!.y).toBe(1);
    expect(s.strategy!.mapVersions[1]).toEqual(archived);
    expect(s.competitorDirectory!.quarters![0]).toEqual(frozenQuarter);
    expect(s.decisions.at(-1)!.strategyChange?.command).toBe("recalculateStrategyMap");
    expect(s.strategy!.impacts.some(i => i.target === "map:current" && i.source === `fact:${compId}:feature:secretary_outgoing` && i.effect === "recomputed")).toBe(true);
    const markup = html(React.createElement(Workspace, { state: s, submit: vi.fn(), saving: false }));
    const current = markup.slice(markup.indexOf("Действующая стратегическая методика"), markup.indexOf("История методик"));
    expect(current).toContain("текущая карта");
    expect(current).toContain("X 2 · Y 1");
    expect(current).not.toContain("X 0 · Y 1");
    expect(markup).toContain("Пересчитано");
  });
});
