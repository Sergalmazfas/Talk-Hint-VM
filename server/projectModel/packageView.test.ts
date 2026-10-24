import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { projectPackageBlocks, type ModelElement, type ProjectModelState } from "@shared/projectModel";
import PackageViews from "../../client/src/components/project-model/PackageViews";

function makeElement(id: string, details: Record<string, string> = {}, description = `Описание ${id}`): ModelElement {
  return {
    id,
    title: `Узел ${id}`,
    section: "Обзор",
    scope: "talkhint",
    kind: "context",
    description,
    contentStatus: "confirmed",
    implementationStatus: "not_started",
    details,
    version: 1,
    updatedAt: "2025-03-11T12:00:00.000Z",
    needsReview: false,
  };
}

function makeState(): ProjectModelState {
  const ids = [
    ...projectPackageBlocks.map(({ id }) => id),
    "TH-SEGMENT", "TH-SAM-SOM", "TH-TAM", "TH-SAM", "TH-SOM", "TH-ECONOMICS",
    "TH-DIFFERENTIATION", "TH-POSITIONING", "TH-CONTENT-PIPELINE", "TH-VALIDATION",
    "COMP-MASSAGEBOOK",
  ];
  const elements = [...new Set(ids)].map((id) => makeElement(
    id,
    id === "TH-POSITIONING" ? {
      convenience: "", netIncome: "", positionIntent: "Желаемая область, не измерение", measurement: "",
      aiAllowed: "Черновая подготовка текста", attribution: "Не измерено", rules: "Публикация только после согласования", unknown: "Нет результатов", evidence: "Не проверено",
    }
      : id === "TH-CONTENT-PIPELINE" ? { procedure: "Исходное видео → монтаж → одобрение владельца → публикация" }
        : id === "TH-TAM" ? { tamFormula: "Число практик × годовая цена", inputs: "Число практик", rules: "Региональная граница", unknown: "Число пока неизвестно", evidence: "Формула, не замер" }
          : id === "TH-ECONOMICS" ? { monetaryScenario: "Проверить затраты на рекламу и монтаж", inputs: "Затраты, обращения, записи", rules: "Не считать фактом", unknown: "Нет финансовых результатов", evidence: "Сценарий для проверки" }
            : id === "TH-PROBLEM" ? { problem: "Трудно отслеживать обращения", alternatives: "Текущие инструменты и ручные процессы", economics: "Потерянное время и стоимость привлечения", solution: "Собранный рабочий контекст", evidence: "Интервью не внесены" }
              : id === "COMP-MASSAGEBOOK" ? { benchmarkType: "competitor", competitorPriority: "primary-starting-segment", prioritySegmentId: "TH-SEGMENT" } : {},
    id === "TH-CONTENT-PIPELINE" ? "Persisted pipeline description" : `Ответ из модели: ${id}`,
  ));
  const product = elements.find((element) => element.id === "TH-PRODUCT")!;
  product.details.source = "https://research.example/source";
  product.details.sourceDate = "2025-02-14";
  const position = elements.find((element) => element.id === "TH-POSITIONING")!;
  (position.details as unknown as Record<string, string>).consent = "Согласование владельца требуется";
  return {
    schema: 1,
    revision: 3,
    elements,
    relations: [],
    documents: [{
      id: "DOC-1", title: "Заметки владельца", text: "Связанный фрагмент", url: "https://research.example/document",
      elementIds: ["TH-PRODUCT"], updatedAt: "2025-02-15T12:00:00.000Z",
    }, {
      id: "DOC-2", title: "Внутренний документ", text: "Внутренний фрагмент", url: "/admin/project-model?view=overview&element=TH-PROBLEM",
      elementIds: ["TH-PROBLEM"], updatedAt: "2025-02-16T12:00:00.000Z",
    }],
    proposals: [],
    decisions: [],
    taskDrafts: [],
  };
}

describe("PackageViews SSR", () => {
  const state = makeState();

  it("renders all ten ordered overview blocks with confidence, implementation, source date and linked materials", () => {
    const markup = renderToStaticMarkup(React.createElement(PackageViews, { state, view: "overview", openElement: vi.fn() }));
    const ids = Array.from(markup.matchAll(/class="pm-package-block"[^>]*>[\s\S]*?<span class="pm-package-block-main"><strong>([\s\S]*?)<\/strong>/g), (match) => match[1]);
    expect(ids).toHaveLength(10);
    expect(markup.indexOf("<strong>Продукт</strong>")).toBeLessThan(markup.indexOf("<strong>Клиент</strong>"));
    expect(markup).toContain("Согласовано");
    expect(markup).toContain("Реализация: Не начато");
    expect(markup).toContain("https://research.example/source");
    expect(markup).toContain("Дата источника: 2025-02-14");
    expect(markup).toContain("https://research.example/document");
    expect(markup).toContain("Заметки владельца");
    expect(markup).toContain("Внутренний документ");
    expect(markup).toContain("/admin/project-model?view=overview&amp;element=TH-PROBLEM");
  });

  it("shows persisted needs, alternatives, economics, and evidence on the segment view", () => {
    const markup = renderToStaticMarkup(React.createElement(PackageViews, { state, view: "segment", openElement: vi.fn() }));
    expect(markup).toContain("Трудно отслеживать обращения");
    expect(markup).toContain("Текущие инструменты и ручные процессы");
    expect(markup).toContain("Потерянное время и стоимость привлечения");
    expect(markup).toContain("Интервью не внесены");
    expect(markup).toContain("Открыть матрицу конкурентов");
    expect(markup).toContain("Открыть профиль");
    expect(markup).toContain('href="/admin/project-model?view=overview&amp;element=TH-PROBLEM"');
    expect(markup).toContain("<summary>Текст документа</summary>");
    expect(markup).toContain("Внутренний фрагмент");
  });

  it("renders the market formulas from persisted element details without substituting numbers", () => {
    const markup = renderToStaticMarkup(React.createElement(PackageViews, { state, view: "market", openElement: vi.fn() }));
    expect(markup).toContain("Число практик × годовая цена");
    expect(markup).toContain("Денежный сценарий / допущения");
    expect(markup).toContain("Проверить затраты на рекламу и монтаж");
    expect(markup).toContain("Входные данные и источники");
    expect(markup).toContain("Неизвестное");
    expect(markup).toContain("Основание / результаты проверок");
    expect(markup).toContain("TAM");
    expect(markup).not.toContain("$");
  });

  it("keeps the two-axis view qualitative and sources pipeline text from the saved node", () => {
    const markup = renderToStaticMarkup(React.createElement(PackageViews, { state, view: "difference", openElement: vi.fn() }));
    const axis = markup.match(/<div class="pm-axis-map">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(axis).toContain("TalkHint");
    expect(axis).toContain("замысел, не измерение");
    expect(axis).not.toContain("MassageBook");
    expect(axis).not.toContain("ClinicSense");
    expect(markup).toContain("MassageBook");
    expect(markup).toContain("ClinicSense");
    expect(markup).toContain("Неизмерено");
    expect(markup).toContain("Исходное видео → монтаж → одобрение владельца → публикация");
    expect(markup).toContain("Разрешённое поведение AI");
    expect(markup).toContain("Атрибуция и окупаемость");
    expect(markup).toContain("Согласие владельца");
    expect(markup).not.toContain("Число практик × годовая цена");
    expect(markup).not.toContain("<ol>");
  });
});
