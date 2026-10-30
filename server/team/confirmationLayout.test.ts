import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../client/src/pages/team.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../client/src/index.css", import.meta.url), "utf8");

describe("team confirmation viewport safety", () => {
  it("bounds the dialog to the dynamic viewport, retaining a vh fallback and safe areas", () => {
    const modal = css.match(/\.team-page \.team-modal \{([^}]+)\}/)?.[1] ?? "";
    expect(modal).toContain("max-height: calc(100vh - 2rem)");
    expect(modal).toContain("100dvh");
    expect(modal).toContain("safe-area-inset-bottom");
    expect(modal).toContain("display: flex");
    expect(modal).toContain("flex-direction: column");
  });

  it("allows the explanatory text to shrink and scroll on touch screens", () => {
    const body = css.match(/\.team-page \.team-modal-body \{([^}]+)\}/)?.[1] ?? "";
    expect(body).toContain("min-height: 0");
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("-webkit-overflow-scrolling: touch");
  });

  it("keeps both actions outside the scrolling body without shrinking", () => {
    expect(css).toContain(".team-page .team-modal-actions { flex-shrink: 0; }");
    expect(source).toMatch(/<\/div>\s*<div className="team-modal-actions[^"]*">/);
    const actions = source.slice(source.indexOf('<div className="team-modal-actions'), source.indexOf("</section>", source.indexOf('<div className="team-modal-actions')));
    expect(actions).toContain("Отмена");
    expect(actions).toContain("Подтвердить последовательность");
    expect(actions).toContain("onClick={() => void applyAll()}");
  });
});
