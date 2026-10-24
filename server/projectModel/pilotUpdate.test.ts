import { describe, expect, it, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Benchmark from "../../client/src/components/project-model/Benchmark";
import { initialModel } from "./seed";
import { applyApprovedMaterial } from "./materialImport";
import { applyPilotUpdate, assertPilotPreservation, findPilotCompetitor, pilotMarker } from "./pilotUpdate";
import { pilotSources } from "./pilotContent";

describe("narrow pilot decision without loss of benchmark", () => {
  const before = applyApprovedMaterial(initialModel(), "owner");
  const next = applyPilotUpdate(before, "owner");
  afterEach(() => vi.unstubAllGlobals());
  it("confirms dated owner decision, not profitability, with auditable prior version", () => {
    const segment = next.elements.find(e => e.id === "TH-SEGMENT")!;
    expect(segment.contentStatus).toBe("confirmed");
    expect(segment.details.decisionDate).toBe("2026-10-23");
    expect(segment.description).toContain("без администратора");
    expect(segment.details.rules).toContain("не доказательство");
    expect(next.decisions.some(d => d.before?.id === segment.id && d.after?.id === segment.id && d.proposalId)).toBe(true);
    expect(next.elements.find(e => e.id === "TH-PILOT-VALUE")?.contentStatus).toBe("hypothesis");
    expect(next.elements.find(e => e.id === "TH-MBLEX-CHANNEL")?.description).toContain("не готовая");
  });
  it("preserves all old competitors, sources, general cells, model/example and history", () => {
    expect(() => assertPilotPreservation(before, next)).not.toThrow();
    for (const e of before.elements.filter(e => e.details.benchmarkType === "competitor")) {
      const saved = next.elements.find(n => n.id === e.id)!;
      expect(saved.description).toBe(e.description);
      expect(saved.details.source).toBe(e.details.source);
      expect(saved.details.competitorPriority).toBe("general");
    }
    expect(next.elements.filter(e => e.details.benchmarkType === "competitor")).toHaveLength(5);
    expect(next.elements.filter(e => e.details.benchmarkType === "assessment" && e.details.benchmarkSuite !== "pilot")).toHaveLength(48);
    expect(next.elements.find(e => e.id === "TH-PRODUCT")).toEqual(before.elements.find(e => e.id === "TH-PRODUCT"));
  });
  it("saves all 24 pilot cells, source docs and no practically tested claims", () => {
    const cells = next.elements.filter(e => e.details.benchmarkType === "assessment" && e.details.benchmarkSuite === "pilot");
    expect(cells).toHaveLength(24);
    cells.forEach(e => expect(e.details.practicalTest).toContain("Не проводился"));
    for (const source of pilotSources) expect(next.documents.find(d => d.url === source.url)?.text).toContain(source.summary);
    expect(next.documents.some(d => d.title === pilotMarker)).toBe(true);
    expect(next.taskDrafts).toHaveLength(before.taskDrafts.length + 1);
    for (const key of ["massagebook", "clinicsense"] as const) {
      const company = findPilotCompetitor(next, key)!;
      expect(company.details.aiVoiceChat).toContain("Отсутствие AI НЕ");
      expect(company.details.competitorPriority).toBe("primary-starting-segment");
      expect(company.details.sourceDate).toContain("23.10.2026");
    }
  });
  it("repeat is a no-op and custom existing IDs/cards/subjects are reused, not duplicated", () => {
    expect(applyPilotUpdate(next, "owner")).toBe(next);
    const custom = structuredClone(before);
    custom.elements.push({ ...next.elements.find(e => e.id === "COMP-MASSAGEBOOK")!, id: "LEGACY-MASSAGEBOOK", details: {
      ...next.elements.find(e => e.id === "COMP-MASSAGEBOOK")!.details, benchmarkSubject: "massage-book", source: "https://pro.massagebook.com/\nhttps://example.test/old-research", resources: "Existing owner notes",
    } });
    const updated = applyPilotUpdate(custom, "owner");
    expect(findPilotCompetitor(updated, "massagebook")?.id).toBe("LEGACY-MASSAGEBOOK");
    expect(findPilotCompetitor(updated, "massagebook")?.details.resources).toBe("Existing owner notes");
    expect(findPilotCompetitor(updated, "massagebook")?.details.source).toContain("example.test/old-research");
    expect(updated.elements.some(e => e.id === "COMP-MASSAGEBOOK")).toBe(false);
    expect(updated.elements.filter(e => e.details.benchmarkSuite === "pilot" && e.details.benchmarkSubject === "massage-book")).toHaveLength(8);
  });
  it("preserves any additional wellness/other competitor and marks wellness adjacent", () => {
    const extended = structuredClone(before);
    const template = before.elements.find(e => e.id === "COMP-JOBBER")!;
    for (const title of ["Mangomint / Mira", "Vagaro / Vera", "Mindbody", "Workiz", "FieldPulse", "ServiceTitan", "Sintra", "Lindy"])
      extended.elements.push({ ...template, id: `EXTRA-${title}`, title, details: { benchmarkType: "competitor", benchmarkSubject: title, resources: "keep" } });
    const result = applyPilotUpdate(extended, "owner");
    expect(() => assertPilotPreservation(extended, result)).not.toThrow();
    expect(result.elements.find(e => e.title === "Mangomint / Mira")?.details.competitorPriority).toBe("adjacent-wellness");
    expect(result.elements.find(e => e.title === "Workiz")?.details.resources).toBe("keep");
  });
  it("direct competitor URLs render profiles even with primary filter; all/general and pilot remain accessible", () => {
    vi.stubGlobal("window", { location: { pathname: "/admin/project-model", search: "?view=benchmark&suite=pilot&filter=primary&element=COMP-MASSAGEBOOK" } });
    const html = renderToStaticMarkup(createElement(Benchmark, { state: next, openElement: () => {} }));
    expect(html).toContain("Основной конкурент стартового сегмента");
    expect(html).toContain("Настройка практики");
    expect(html).toContain("Отчёт владельцу");
    expect(html).toContain("MassageBook");
    expect(html).toContain("ClinicSense");
    expect(html).not.toContain('<h3>Jobber</h3>');
    vi.stubGlobal("window", { location: { pathname: "/admin/project-model", search: "?view=benchmark&element=COMP-JOBBER" } });
    const all = renderToStaticMarkup(createElement(Benchmark, { state: next, openElement: () => {} }));
    for (const title of ["Jobber", "Housecall Pro", "ZenMaid", "MassageBook", "ClinicSense"]) expect(all).toContain(title);
  });
});
