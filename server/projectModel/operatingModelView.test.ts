import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OperatingModelView from "../../client/src/components/project-model/OperatingModelView";
import PackageView from "../../client/src/components/project-model/PackageViews";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
describe("organisation planning UI", () => {
  it("renders an actual hierarchical table and all dimensions without executing work", () => {
    const state = initialModel(), submit = vi.fn(), before = JSON.stringify(state);
    const html = renderToStaticMarkup(React.createElement(OperatingModelView, { state, submit }));
    expect(html).toContain("<table");
    for (const label of ["Код", "Узел", "Клиент", "Должность", "Crew", "Ресурсы", "Дни", "Часы", "Часовой пояс", "Результат", "Отчёт", "Принимающий", "История", "Документы", "Сохранить черновик"])
      expect(html).toContain(label);
    expect(html).not.toMatch(/<button[^>]*>\s*(Запустить|Включить сотрудников)/);
    expect(submit).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });
  it("mounts only new-country, and saved versions are shown instead of fabricated saves", () => {
    let state = initialModel();
    const props = { view: "overview", openElement: vi.fn() };
    expect(renderToStaticMarkup(React.createElement(PackageView, { ...props, state }))).not.toContain('id="operating-model"');
    state = applyCommand(state, { type: "saveOperatingModel", baseVersion: 0, data: defaultOperatingModel() }, "owner");
    state.hypothesisContext = { selectedId: "new-country", options: [], primaryId: null };
    const html = renderToStaticMarkup(React.createElement(PackageView, { ...props, state, submit: vi.fn() }));
    expect(html).toContain('id="operating-model"');
    expect(html).toContain('href="#operating-model"');
    expect(html).toContain("Последняя сохранённая");
    expect(html).not.toContain("Шаблон не сохранён");
  });
});
