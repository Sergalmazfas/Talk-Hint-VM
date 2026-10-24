import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RunCost from "./RunCost";
import { calculateLabCost, captureLabTariff } from "../../../../server/secretaryLab/cost";

describe("cost report UI", () => {
  it("shows legacy/missing tariff as unmeasured, never zero", () => {
    const html = renderToStaticMarkup(<RunCost />);
    expect(html).toContain("Стоимость не измерялась");
    expect(html).toContain("это не $0");
  });
  it("shows unknown total, separate included audio, token rates, clickable official sources and date", () => {
    const cost = calculateLabCost("eleven-engine", {
      model: "gpt-6.1-sol", voice: "actual-voice", ttsModel: "eleven_flash_v2_5", profileId: "optimized",
      createdAt: "2026-10-24T12:00:00Z", endedAt: "2026-10-24T12:01:00Z", audioConnectedAt: "2026-10-24T12:00:00Z",
      events: [], tariffSnapshot: captureLabTariff(),
    })!;
    const html = renderToStaticMarkup(<RunCost cost={cost} />);
    expect(html).toContain("Полная сумма неизвестна");
    expect(html).toContain("Подтверждённое списание: Неизвестно");
    expect(html).toContain("optimized"); expect(html).toContain("actual-voice");
    expect(html).toContain("Включено"); expect(html).toContain("TalkHint Engine");
    expect(html).toContain("млн токенов"); expect(html).toContain("2026-10-24");
    expect(html).toContain('href="https://elevenlabs.io/pricing/agents"');
    expect(html).toContain('href="https://developers.openai.com/api/docs/pricing"');
    expect(html).not.toContain("Итого:");
  });
});
