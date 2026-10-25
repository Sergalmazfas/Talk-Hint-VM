import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import Workbench from "../../client/src/components/project-model/CompetitorResearchWorkbench";
import QuarterArchive from "../../client/src/components/project-model/CompetitorQuarterArchive";
import { CompetitorResearchProfile, CompetitorResearchEditor } from "../../client/src/components/project-model/CompetitorResearchProfile";
import { emptyCompetitorResearch, researchFor, researchFeatures } from "../../shared/competitorResearch";
import type { CompetitorDirectory } from "../../shared/projectCompetitors";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "./competitorInitial";

const directory = (): CompetitorDirectory => ({
  records: [{ id: "AI", revisions: [{ version: 1, savedAt: "2026-10-25", reason: "Переданные данные", snapshot: structuredClone(initialAIPhoneSnapshot) }] }],
  talkhint: structuredClone(initialTalkHintBaseline),
});
describe("three-level research UI rendering", () => {
  it("derives the canonical function matrix and sourced-price cells, with distinct current/target rows and no fabricated map points", () => {
    const markup = renderToStaticMarkup(React.createElement(Workbench, {
      directory: directory(), initialSelectedIds: ["AI"], submit: vi.fn(),
    }));
    for (const feature of Object.values(researchFeatures)) expect(markup).toContain(feature);
    expect(markup).toContain("AI Phone");
    expect(markup).toContain("TalkHint — текущая позиция");
    expect(markup).toContain("TalkHint — целевая позиция");
    expect(markup).toContain("59.99");
    expect(markup).toContain("5.00");
    expect(markup).toContain("Сравнить выбранных");
    expect(markup).toContain("Нет точек с достаточными проверяемыми данными");
    expect(markup).toContain("Не ранжирован");
    expect(markup).toContain("22");
    expect(markup).not.toContain('class="recharts-scatter');
  });
  it("exposes separately unfilled geography and function-specific language data, not zeros or inferred reach", () => {
    const markup = renderToStaticMarkup(React.createElement(CompetitorResearchProfile, {
      research: researchFor(initialAIPhoneSnapshot),
    }));
    expect(markup).toContain("География");
    expect(markup).toContain("Русский");
    expect(markup).toContain("Испанский");
    expect(markup).toContain("Количество");
    expect(markup).toContain("Сохранённых сведений нет");
    for (const feature of Object.values(researchFeatures)) expect(markup).toContain(feature);
    expect(markup).not.toContain(">0</td>");
  });
  it("prepares an empty structured template with editable evidence and explicit personal/business scopes", () => {
    const markup = renderToStaticMarkup(React.createElement(CompetitorResearchEditor, {
      research: emptyCompetitorResearch(), onChange: vi.fn(),
    }));
    expect(markup).toContain("Добавить регион");
    expect(markup).toContain("Русский");
    expect(markup).toContain("Испанский");
    expect(markup).toContain("Личное");
    expect(markup).toContain("Бизнес");
    expect(markup).toMatch(/type="number"[^>]*value=""/);
  });
  it("provides manual archive creation without claiming scheduled or ChatGPT-driven writes", () => {
    const markup = renderToStaticMarkup(React.createElement(QuarterArchive, {
      directory: directory(), submit: vi.fn(), saving: false,
    }));
    expect(markup).toContain("Снять квартальный снимок");
    expect(markup).toContain("Квартальных снимков нет");
    expect(markup).toContain("ChatGPT");
    expect(markup).toContain("автоматической");
  });
});
