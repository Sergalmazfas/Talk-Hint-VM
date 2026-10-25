import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Directory from "../../client/src/components/project-model/CompetitorDirectory";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "./competitorInitial";
import { type CompetitorDirectory } from "../../shared/projectCompetitors";
import { dossierSections } from "../../shared/competitorDossier";
import { researchFeatures } from "../../shared/competitorResearch";

function directory(): CompetitorDirectory {
  return {
    talkhint: structuredClone(initialTalkHintBaseline),
    records: [{
      id: "comp-ai-phone",
      revisions: [{ version: 1, savedAt: "2026-10-25T00:00:00Z", reason: "Переданные сведения", snapshot: structuredClone(initialAIPhoneSnapshot) }],
    }],
  };
}
describe("competitor directory rendering", () => {
  it("shows one linked company, all supplied prices, annual equivalent and real manual actions", () => {
    const markup = renderToStaticMarkup(React.createElement(Directory, {
      directory: directory(), hypothesisId: "new-country", view: "overview", submit: vi.fn(),
    }));
    expect(markup).toContain("Справочник конкурентов");
    expect(markup).toContain("competitor=comp-ai-phone");
    expect(markup).toContain('href="/admin/project-model?view=benchmark&amp;hypothesis=new-country&amp;competitor=comp-ai-phone"');
    expect(markup).toContain("hypothesis=new-country");
    for (const price of ["8.99", "14.99", "59.99", "5.99", "12.99", "29.99", "69.99"])
      expect(markup).toContain(price);
    expect(markup).toContain("5.00 USD / месяц при годовой оплате");
    expect(markup).toContain("Обновить данные");
    expect(markup).toContain("Сравнить выбранных");
    expect(markup).toContain("автоматического поиска, проверки или обновления нет");
    expect(markup).not.toContain("Jobber");
  });
  it("opens exactly six dossier sections and all canonical scenarios without inventing readiness", () => {
    const markup = renderToStaticMarkup(React.createElement(Directory, {
      directory: directory(), hypothesisId: "new-country", selectedId: "comp-ai-phone", view: "benchmark", submit: vi.fn(),
    }));
    expect(markup.match(/class="pm-dossier-section"/g)).toHaveLength(6);
    for (const heading of dossierSections) expect(markup).toContain(`<h3>${heading}</h3>`);
    for (const scenario of Object.values(researchFeatures)) expect(markup).toContain(scenario);
    expect(markup).toContain("Second Phone Number Inc");
    expect(markup).toContain("Заявлено официально");
    expect(markup).toContain("Не подтверждено");
    expect(markup).toContain("Живой персонаж-собеседник в чате");
    expect(markup).toContain("независимая проверка не заявлена");
    expect(markup).toContain("https://www.aiphone.ai/");
    expect(markup).toContain("id6465173251");
  });
  it("retains old prices in visible revision differences and does not fall back for missing IDs", () => {
    const data = directory(), updated = structuredClone(initialAIPhoneSnapshot);
    updated.plans[1].price = 19.99;
    data.records[0].revisions.push({ version: 2, savedAt: "2026-10-25T01:00:00Z", reason: "Изменение цены", snapshot: updated });
    const markup = renderToStaticMarkup(React.createElement(Directory, {
      directory: data, hypothesisId: "new-country", selectedId: "comp-ai-phone", view: "benchmark",
    }));
    expect(markup).toContain("Версия 1");
    expect(markup).toContain("Версия 2");
    expect(markup).toContain("14.99 → 19.99");
    const missing = renderToStaticMarkup(React.createElement(Directory, {
      directory: data, hypothesisId: "new-country", selectedId: "not-owned", view: "benchmark",
    }));
    expect(missing).toContain("Карточка не найдена");
    expect(missing).not.toContain("Second Phone Number Inc");
  });
  it("escapes research text as text, never executable HTML", () => {
    const data = directory();
    data.records[0].revisions[0].snapshot.name = "<script>alert(1)</script>";
    const markup = renderToStaticMarkup(React.createElement(Directory, {
      directory: data, hypothesisId: "new-country", view: "overview",
    }));
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });
});
