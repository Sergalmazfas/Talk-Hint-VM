import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Benchmark from "../../client/src/components/project-model/Benchmark";
import { applyApprovedMaterial } from "./materialImport";
import { initialModel } from "./seed";

describe("persisted benchmark view and direct links", () => {
  afterEach(() => vi.unstubAllGlobals());
  const state = applyApprovedMaterial(initialModel(), "test-owner");
  it.each(["COMP-JOBBER", "COMP-HOUSECALL-PRO", "COMP-ZENMAID"])("reopens %s with its persisted profile and sources", (id) => {
    vi.stubGlobal("window", { location: { search: `?view=benchmark&element=${id}` } });
    const html = renderToStaticMarkup(createElement(Benchmark, { state, openElement: () => {} }));
    expect(html).toContain(`/admin/project-model?view=benchmark&amp;element=${id}`);
    expect(html).toContain("23.10.2026");
    expect(html).toContain("2026-10-24");
    expect(html).toContain("Не проводился");
    expect(html).toContain("https://www.getjobber.com/faq/");
    expect(html).toContain("Предварительные заметки о рынке");
  });
  it("never invents competitor facts when the owner's model is empty", () => {
    vi.stubGlobal("window", { location: { search: "?view=benchmark" } });
    const html = renderToStaticMarkup(createElement(Benchmark, { state: { ...state, elements: [], documents: [], relations: [], taskDrafts: [] }, openElement: () => {} }));
    expect(html).toContain("Не установлено");
    expect(html).not.toContain("$19");
  });
});
