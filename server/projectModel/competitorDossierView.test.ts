import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompetitorDossierView, CompetitorDossierEditor } from "../../client/src/components/project-model/CompetitorDossier";
import Workbench from "../../client/src/components/project-model/CompetitorResearchWorkbench";
import { dossierSections } from "../../shared/competitorDossier";
import { researchFor } from "../../shared/competitorResearch";
import { lingvanexSnapshot } from "./competitorLingvanex";
import { vocalingoSnapshot } from "./competitorVocalingo";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "./competitorInitial";

describe("six-section dossier UI with real approved data", () => {
  it("shows six ordered sections, exact channels/prices and scoped technologies, not a fabricated chat avatar", () => {
    const snapshot = vocalingoSnapshot();
    const markup = renderToStaticMarkup(React.createElement(CompetitorDossierView, { snapshot, research: researchFor(snapshot) }));
    expect(markup.match(/class="pm-dossier-section"/g)).toHaveLength(6);
    const headingOffsets = dossierSections.map(heading => markup.indexOf(`<h3>${heading}</h3>`));
    expect(headingOffsets.every(offset => offset >= 0)).toBe(true);
    expect(headingOffsets).toEqual([...headingOffsets].sort((a, b) => a - b));
    for (const text of ["99.00 USD", "99.99 USD", "8.25 USD / месяц", "8.33 USD / месяц", "US App Store",
      "Канал покупки", "Персонаж в разговоре", "не доказывают наличие живого аватара", "Живой звонок",
      "Файл / инструмент", "ElevenLabs Scribe v2", "Платящие пользователи", "Не подтверждено"])
      expect(markup).toContain(text);
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("Тип выручки: Официально раскрытая выручка");
  });
  it("retains every legacy AI Phone offer summary without manufacturing function-scoped language counts", () => {
    const markup = renderToStaticMarkup(React.createElement(CompetitorDossierView, {
      snapshot: initialAIPhoneSnapshot, research: researchFor(initialAIPhoneSnapshot),
    }));
    for (const value of Object.values(initialAIPhoneSnapshot.offer)) expect(markup).toContain(value);
    expect(markup).toContain("Точный перечень языков и ограничения требуют отдельной проверки.");
    expect(markup).not.toContain("25 окт. 2026");
  });
  it("prepares editable template fields for all six sections and distinct source/date/status facts", () => {
    const markup = renderToStaticMarkup(React.createElement(CompetitorDossierEditor, {
      dossier: vocalingoSnapshot().dossier!, onChange: vi.fn(),
    }));
    for (const text of ["Добавить технический факт", "Добавить раунд", "Живой звонок", "Файл / инструмент",
      "Загрузки", "Платящие пользователи", "Выручка", "Синхронизация губ с речью в чате", "Допущения"])
      expect(markup).toContain(text);
    expect(markup).toMatch(/value=""/);
  });
  it("derives matrix cells for the two supplied companies, scoped languages and unknown avatars", () => {
    const records = [lingvanexSnapshot(), vocalingoSnapshot()].map((snapshot, index) => ({
      id: `comp-${index}`, revisions: [{ version: 1, savedAt: "2026-10-25", reason: "Approved", snapshot }],
    }));
    const markup = renderToStaticMarkup(React.createElement(Workbench, {
      directory: { records, talkhint: initialTalkHintBaseline }, initialSelectedIds: ["comp-0", "comp-1"], submit: vi.fn(),
    }));
    for (const text of ["Lingvanex", "VocaLingo", "Аватар в чате", "Медиа и аудиофайлы", "Текстовый перевод",
      "Контакты", "История общения", "AI-чат", "100+", "70+", "22"])
      expect(markup).toContain(text);
    expect(markup).toContain("Нет точек с достаточными проверяемыми данными");
  });
});
