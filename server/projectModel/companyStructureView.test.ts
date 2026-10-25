import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import CompanyStructureViews from "../../client/src/components/project-model/CompanyStructureViews";

const model = () => buildCompanyStructure(defaultOperatingModel());
const renderView = (view: "company" | "management" | "journey") => renderToStaticMarkup(createElement(CompanyStructureViews, {
  view, data: model(), selectedId: null, onOpen: () => undefined, onPatchPath: () => undefined,
}));
describe("CompanyStructureViews SSR", () => {
  it("renders the three planning levels and table-derived direction details", () => {
    const html = renderView("company");
    for (const text of ["Компания как система работы", "T01", "Таблица направлений и крупных процессов",
      "Клиент результата", "Открытый вопрос", "Входы", "Связи с соседями"])
      expect(html).toContain(text);
    expect(html).toContain("<table");
    for (let n = 1; n <= 10; n++) expect(html).toContain(`T${String(n).padStart(2, "0")}`);
  });
  it("renders owner, CEO and role-only managerId reporting without departments", () => {
    const html = renderView("management");
    for (const text of ["Сергей", "AI CEO", "managerId", "Предложенная роль"]) expect(html).toContain(text);
    expect(html).not.toContain("Отдел ·");
  });
  it("renders customer stages and alternatives from explicit handoff links", () => {
    const html = renderView("journey");
    for (const text of ["Передачи и альтернативы", "ОТДЕЛЬНЫЙ ПРОЦЕСС B2B",
      "нет автоматического перехода", "Финансовые события по связям модели", "SUP.1"])
      expect(html).toContain(text);
    expect(html).not.toMatch(/<button[^>]*>\s*(Запустить|Подключить сотрудника)/);
  });
});
