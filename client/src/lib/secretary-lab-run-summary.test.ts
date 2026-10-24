import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonaSummary, RunSummary } from "@/components/secretary-lab/RunSummary";

describe("session persona summaries", () => {
  it("distinguishes explicit legacy none from an absent historical field", () => {
    expect(renderToStaticMarkup(createElement(PersonaSummary, { personality: null }))).toContain("Без личности · legacy");
    expect(renderToStaticMarkup(createElement(PersonaSummary, {}))).toContain("Не записана · legacy / неизвестно");
  });

  it("renders the immutable report persona and actual run bundle/profile", () => {
    const html = renderToStaticMarkup(createElement(RunSummary, {
      voiceBundle: "Sarah · eleven_flash_v2_5",
      profile: "Flash 2.5 · основной язык RU",
      personality: { id: "server-id", name: "Каталоговая личность", version: 4, mode: "work" },
    }));
    expect(html).toContain("Sarah · eleven_flash_v2_5");
    expect(html).toContain("Flash 2.5 · основной язык RU");
    expect(html).toContain("Каталоговая личность · v4 · TEST role: work");
    expect(html).not.toContain("server-id");
  });
});
