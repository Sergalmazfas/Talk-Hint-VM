import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import Assessments, { AssessmentLinks } from "../../client/src/components/project-model/CompetitorAssessments";
import ReviewForm from "../../client/src/components/project-model/CompetitorReviewForm";
import Directory from "../../client/src/components/project-model/CompetitorDirectory";
import Workbench from "../../client/src/components/project-model/CompetitorResearchWorkbench";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "./competitorInitial";
import { assessmentHref, newReview, type CompetitorReview } from "../../shared/competitorAssessments";
import { publicSupportResearch } from "./research/publicSupport";
const html = (component: React.ReactElement) => renderToStaticMarkup(component);
describe("assessment links, forms, current cards and matrix", () => {
  it("offers three distinct clickable categories without assigning any score", () => {
    const markup = html(React.createElement(AssessmentLinks, { snapshot: initialAIPhoneSnapshot, id: "COMP-existing" }));
    for (const category of ["design", "usability", "support"] as const)
      expect(markup).toContain(assessmentHref("COMP-existing", category).replaceAll("&", "&amp;"));
    expect(markup.match(/Не оценено/g)).toHaveLength(2);
    expect(markup).toContain("Не проверено");
    expect(markup).not.toContain("0 / 10");
  });
  it("opens the selected category with public evidence separate from personal experience/history", () => {
    const markup = html(React.createElement(Assessments, { snapshot: { ...initialAIPhoneSnapshot, supportResearch: publicSupportResearch["6465173251"] },
      id: "COMP-existing", version: 2, initialCategory: "support", submit: vi.fn() }));
    for (const text of ["Поддержка · подробный разбор", "Что заявляет компания", "Наш личный опыт", "Реальных обращений ещё не зафиксировано", "История проверок (0)", "Settings → Feedback", "Внутренняя CRM", "Не установлено"])
      expect(markup).toContain(text);
    expect(markup).not.toContain("resolved");
  });
  it("forms offer manual optional scores, every standard scenario, attachments and support contact gating", () => {
    const render = (category: "design" | "usability" | "support") => html(React.createElement(ReviewForm, { category, busy: false, onSave: vi.fn(), onCancel: vi.fn() }));
    const design = render("design"), usability = render("usability"), support = render("support");
    for (const text of ["Читаемость и контраст", "Кнопки и расположение", "Иерархия", "Аватар", "Личное впечатление", "Наблюдаемое поведение", "Сохранить проверку без балла", "Добавить ссылку на материал"]) expect(design).toContain(text);
    for (const text of ["Найти контакт", "Выбрать язык", "Начать звонок", "поручение AI", "подтверждением", "итог и транскрипцию", "Найти историю", "отмена подписки", "Количество шагов", "Неприменимо", "Функция отсутствует по проверке"]) expect(usability).toContain(text);
    for (const text of ["Балл поддержки пока недоступен", "Первый ответ", "Бот", "Сотрудник", "Дата и время обращения", "Время решения", "Повторные обращения"]) expect(support).toContain(text);
    expect(support).toContain('disabled="" type="number"');
    expect(support).not.toContain('value="0"');
  });
  it("directory and matrix derive the same latest score and metadata; old scores remain only in history", () => {
    const saved: CompetitorReview = { ...newReview("design"), id: "218f7927-2cad-4337-9fa8-537227b6209f", author: "Личный тест", testedAt: "2026-10-24", platform: "iPhone", appVersion: "3.1", score: 9, rationale: "Проверка", savedAt: "2026-10-25T01:00:00.000Z", recordedBy: "test-owner" };
    const snapshot = { ...initialAIPhoneSnapshot, assessments: { design: [saved] } };
    const directory = { records: [{ id: "COMP-existing", revisions: [{ version: 1, savedAt: saved.savedAt, reason: "test", snapshot }] }], talkhint: structuredClone(initialTalkHintBaseline) };
    const table = html(React.createElement(Directory, { directory, hypothesisId: "new-country", view: "benchmark" }));
    const matrix = html(React.createElement(Workbench, { directory, initialSelectedIds: ["COMP-existing"] }));
    for (const markup of [table, matrix]) {
      expect(markup).toContain("9 / 10"); expect(markup).toContain("Личный тест"); expect(markup).toContain("3.1");
      expect(markup).toContain(assessmentHref("COMP-existing", "design").replaceAll("&", "&amp;"));
    }
    const updated = { ...snapshot, assessments: { design: [saved, { ...saved, id: "218f7927-2cad-4337-9fa8-537227b6209a", score: null }] } };
    const links = html(React.createElement(AssessmentLinks, { snapshot: updated, id: "COMP-existing" }));
    expect(links).not.toContain("9 / 10");
    expect(links).toContain("Не оценено");
  });
});
