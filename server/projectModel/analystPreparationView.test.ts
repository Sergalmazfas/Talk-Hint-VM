import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompetitiveAnalystPreparation from "../../client/src/components/project-model/CompetitiveAnalystPreparation";
import PackageView from "../../client/src/components/project-model/PackageViews";
import { initialModel } from "./seed";
import { defaultAnalystPreparation } from "../../shared/competitiveAnalystTemplate";
import { applyCommand } from "./domain";

describe("preparation UI contract", () => {
  it("shows substantive passport, registry gaps, tools, pilot, constraints and no launch control", () => {
    const state = initialModel(), submit = vi.fn(), before = JSON.stringify(state);
    const html = renderToStaticMarkup(React.createElement(CompetitiveAnalystPreparation, { state, submit }));
    for (const label of ["Паспорт роли", "VocaLingo", "Guardianly", "CrewAI", "SerpAPI",
      "Gemini", "Сергей", "Источники", "Сохранить", "Подготовлен, ожидает согласования"])
      expect(html).toContain(label);
    expect(html).not.toMatch(/<button[^>]*>\s*(Запустить|Начать|Согласовать|Включить)/);
    expect(JSON.stringify(state)).toBe(before); expect(submit).not.toHaveBeenCalled();
  });
  it("mounts only in the new hypothesis overview and retains saved historical preparation", () => {
    let state = initialModel();
    const plain = renderToStaticMarkup(React.createElement(PackageView, { state, view: "overview", openElement: vi.fn() }));
    expect(plain).not.toContain('id="competitive-analyst"');
    const prep = defaultAnalystPreparation(state);
    state = applyCommand(state, { type: "saveAnalystPreparation", baseVersion: 0, preparation: prep }, "fixture-owner");
    state = applyCommand(state, { type: "saveAnalystPreparation", baseVersion: 1, preparation: { ...prep, approvalNotes: "Вторая сохранённая редакция" } }, "fixture-owner");
    state.hypothesisContext = { selectedId: "new-country", primaryId: null, options: [] };
    const html = renderToStaticMarkup(React.createElement(PackageView, { state, view: "overview", openElement: vi.fn(), submit: vi.fn() }));
    expect(html).toContain('id="competitive-analyst"');
    expect(html).toContain('href="#competitive-analyst"');
    expect(html).toContain("Вторая сохранённая редакция");
    expect(html).toContain("История");
    expect(state.analystPreparation!.revisions).toHaveLength(2);
  });
});
