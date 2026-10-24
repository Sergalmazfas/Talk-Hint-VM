import { describe, expect, it, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Benchmark from "../../client/src/components/project-model/Benchmark";
import { initialModel } from "./seed";
import { applyApprovedMaterial } from "./materialImport";
import { applyPilotUpdate, inputOf } from "./pilotUpdate";
import { applyProjectPackage, assertPackagePreservation } from "./packageUpdate";
import { projectPackageBlocks } from "../../shared/projectModel";
import { packageSources } from "./packageContent";

describe("approved owner package — convenience, not less participation", () => {
  const before = applyPilotUpdate(applyApprovedMaterial(initialModel(), "owner"), "owner");
  const after = applyProjectPackage(before, "owner");
  afterEach(() => vi.unstubAllGlobals());
  it("saves all ten summaries with source/date and separate implementation status", () => {
    expect(projectPackageBlocks).toHaveLength(10);
    for (const b of projectPackageBlocks) {
      const e = after.elements.find(e => e.id === b.id)!;
      expect(e.description.length).toBeGreaterThan(10);
      expect(e.details.sourceDate).toBeTruthy();
      expect(e.details.provenance).toBeTruthy();
      expect(e.implementationStatus).not.toBe("implemented");
    }
    expect(after.elements.find(e => e.id === "TH-PROBLEM")?.contentStatus).toBe("hypothesis");
    expect(after.elements.find(e => e.id === "TH-PROBLEM")?.details.evidence).toContain("нет интервью");
  });
  it("retains every previous competitor, assessment, source text, relation and history entry", () => {
    expect(() => assertPackagePreservation(before, after)).not.toThrow();
    for (const old of before.elements.filter(e => ["COMP-JOBBER", "COMP-HOUSECALL-PRO", "COMP-ZENMAID", "TH-OFFER", "TH-SEGMENT"].includes(e.id)))
      expect(inputOf(after.elements.find(e => e.id === old.id)!)).toEqual(inputOf(old));
    expect(after.elements.filter(e => e.details.benchmarkType === "competitor")).toHaveLength(5);
    expect(after.elements.filter(e => e.details.benchmarkType === "assessment")).toHaveLength(93);
  });
  it("records owner correction with old versions, never deletes history or asserts results", () => {
    const value = after.elements.find(e => e.id === "TH-PILOT-VALUE")!;
    expect(value.details.hypothesis).toContain("НЕ означает отстранение");
    expect(value.details.convenience).toBe("Не измерено");
    expect(value.details.netIncome).toBe("Не измерено");
    expect(after.decisions.some(d => d.before?.id === "TH-PILOT-VALUE" && d.before.details.hypothesis?.includes("меньше"))).toBe(true);
    expect(after.proposals.some(p => p.targetId === "TH-PROBLEM" && p.status === "approved" && p.change.contentStatus === "hypothesis")).toBe(true);
    const current = after.elements.filter(e => e.scope === "talkhint").map(e => `${e.description} ${JSON.stringify(e.details)}`).join("\n");
    expect(current).not.toMatch(/может требовать меньше настройки и времени владельца/);
  });
  it("persists primary price conditions, historical conflict and arithmetic as distinct evidence", () => {
    const cs = after.elements.find(e => e.id === "COMP-CLINICSENSE")!;
    const mb = after.elements.find(e => e.id === "COMP-MASSAGEBOOK")!;
    expect(cs.details.pricing).toContain("Lite $39");
    expect(cs.details.pricing).toContain("Standard $69");
    expect(cs.details.pricing).toContain("Premium $99");
    expect(cs.details.pricing).toContain("$20");
    expect(mb.details.pricing).toContain("AMTA-СКИДКОЙ 25%");
    expect(mb.details.pricing).toContain("Launch $15");
    expect(mb.details.pricing).toContain("не воспроизвелась");
    expect(mb.details.pricing).toContain("РАСЧЁТ / требует подтверждения");
    expect(after.elements.filter(e => e.details.benchmarkType === "pricing-evidence")).toHaveLength(6);
    expect(after.elements.find(e => e.id === "PRICE-MB-PRACTICE")?.contentStatus).toBe("question");
  });
  it("saves formulas and unknowns, not arbitrary market counts or multiplying month12 by12", () => {
    expect(after.elements.find(e => e.id === "TH-TAM")?.details.tamFormula).toContain("уникальных");
    expect(after.elements.find(e => e.id === "TH-SAM")?.details.samFormula).toContain("обслуживаемые");
    const som = after.elements.find(e => e.id === "TH-SOM")!;
    expect(som.details.somFormula).toContain("retention");
    expect(som.details.somFormula).toContain("onboardingCapacity");
    expect(som.details.monetaryScenario).toContain("не MRR_12 × 12");
    expect(som.contentStatus).toBe("question");
  });
  it("preserves exact nine source URLs without duplicates and links pain/value/function/comparison/evidence", () => {
    for (const s of packageSources) {
      const docs = after.documents.filter(d => d.url === s.url);
      expect(docs).toHaveLength(1);
      expect(docs[0].text).toContain(s.text);
      expect(docs[0].elementIds).toContain("TH-VALIDATION");
    }
    for (const [from, to] of [["TH-PROBLEM", "TH-PILOT-VALUE"], ["TH-PILOT-VALUE", "TH-PRODUCT"], ["TH-PRODUCT", "TH-DIFFERENTIATION"], ["TH-DIFFERENTIATION", "TH-VALIDATION"]])
      expect(after.relations.some(r => r.from === from && r.to === to)).toBe(true);
    expect(after.elements.find(e => e.id === "TH-CONTENT-PIPELINE")?.details.contentEditing).toContain("Генерация новых сцен не входит");
    expect(after.elements.find(e => e.id === "TH-TEAM")?.details.nextStep).toContain("следующий этап");
  });
  it("repeat creates no duplicates and no task/provider/transport execution", () => {
    expect(applyProjectPackage(after, "owner")).toBe(after);
    expect(after.taskDrafts).toEqual(before.taskDrafts);
    expect(after.elements.find(e => e.id === "TH-CONTENT-PIPELINE")?.implementationStatus).toBe("not_started");
  });
  it("renders separate difference matrix and both price profiles without mixing pilot/general rows", () => {
    for (const id of ["COMP-MASSAGEBOOK", "COMP-CLINICSENSE"]) {
      vi.stubGlobal("window", { location: { pathname: "/admin/project-model", search: `?view=benchmark&suite=difference&filter=primary&element=${id}` } });
      const html = renderToStaticMarkup(createElement(Benchmark, { state: after, openElement: () => {} }));
      expect(html).toContain("Монтаж исходного видео");
      expect(html).toContain("Доход после расходов");
      expect(html).toContain("Не измерено");
      expect(html).not.toContain("Настройка практики</th>");
      expect(html).not.toContain("Входящий звонок</th>");
      expect(html).toContain("Book Now");
    }
  });
});
