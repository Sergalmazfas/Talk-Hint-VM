import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import EmployeeSectionsView from "../../client/src/components/team/EmployeeSections";
import { readEmployeeSections } from "../../shared/employeeSections";

vi.stubGlobal("React", React);
describe("team employee section presentation", () => {
  it("keeps current model separate from the disabled recommendation and shows laboratory/workplace", () => {
    const sections = readEmployeeSections({
      workplace: { description: "Разбор разрешённых материалов", inputs: ["Снимок"], outputs: ["Разбор"],
        sourceDocumentIds: ["DOC-SOURCE"], limitations: ["Без новых прав"],
        laboratory: { title: "Hint", description: "Независимая QA", documentId: null } },
      modelRecommendation: { modelId: "candidate", family: null, rationale: "Нужен стенд",
        source: "Owner", enabled: false, status: "proposed" },
    });
    const html = renderToStaticMarkup(React.createElement(EmployeeSectionsView, { sections, currentModel: "active-model" }));
    expect(html).toContain("Рабочее место");
    expect(html).toContain("Независимая QA");
    expect(html).toContain("Текущая: active-model");
    expect(html).toContain("Предложено · не включено");
    expect(html).toContain("candidate");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Текущая: candidate");
  });
  it("does not infer a current model or access from an absent section", () => {
    const html = renderToStaticMarkup(React.createElement(EmployeeSectionsView, { sections: null, currentModel: null }));
    expect(html).toContain("Не заполнено");
    expect(html).not.toContain("<button");
  });
  it("renders injected text as text, never as executable markup", () => {
    const html = renderToStaticMarkup(React.createElement(EmployeeSectionsView, {
      sections: null, currentModel: '<script>alert("x")</script>',
    }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
