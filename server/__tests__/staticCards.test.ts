import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the Static Cards (Level 3 personal context) helpers
// (server/contactMemory.ts):
//   - formatStaticCards: renders cards grouped by type, size-capped, never
//     splitting a card or breaking mid-line; respects priority order.
//   - buildStaticCardsSection: wraps rendered cards in the STATIC_CARDS prompt
//     block (empty when there are no cards).
//   - buildContextProviderChain: canonical order USER_CONTEXT ->
//     CONTACT_CONTEXT -> STATIC_CARDS.
// Dependency-free, so no DB / server bootstrap is needed.
// ---------------------------------------------------------------------------

const {
  formatStaticCards,
  buildStaticCardsSection,
  buildContextProviderChain,
  MAX_STATIC_CARDS_LENGTH,
} = await import("../contactMemory");

describe("formatStaticCards", () => {
  it("returns empty string for no cards", () => {
    expect(formatStaticCards([])).toBe("");
  });

  it("groups cards by type with project group first", () => {
    const out = formatStaticCards([
      { cardType: "company", title: "Pricing", body: "$80/hr" },
      { cardType: "project", title: "Acme site", body: "Built the storefront" },
    ]);
    const projectIdx = out.indexOf("Projects:");
    const companyIdx = out.indexOf("Company / Services:");
    expect(projectIdx).toBeGreaterThanOrEqual(0);
    expect(companyIdx).toBeGreaterThanOrEqual(0);
    expect(projectIdx).toBeLessThan(companyIdx);
    expect(out).toContain("- Acme site — Built the storefront");
    expect(out).toContain("- Pricing — $80/hr");
  });

  it("collapses whitespace/newlines in title and body to one line", () => {
    const out = formatStaticCards([
      { cardType: "project", title: "  Big   project ", body: "line one\nline two" },
    ]);
    expect(out).toContain("- Big project — line one line two");
    expect(out).not.toContain("\nline two");
  });

  it("skips cards with an empty title", () => {
    const out = formatStaticCards([
      { cardType: "project", title: "   ", body: "no title" },
      { cardType: "project", title: "Real", body: "kept" },
    ]);
    expect(out).toContain("- Real — kept");
    expect(out).not.toContain("no title");
  });

  it("never exceeds the size cap (incl. headers) and never splits a card", () => {
    const cards = Array.from({ length: 50 }, (_, i) => ({
      cardType: "project",
      title: `Card ${i}`,
      body: "x".repeat(80),
    }));
    const out = formatStaticCards(cards, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    // Every emitted card line must be whole (title + full body), never truncated.
    for (const line of out.split("\n")) {
      if (line.startsWith("- ")) {
        expect(line).toMatch(/^- Card \d+ — x{80}$/);
      }
    }
  });

  it("counts group headers/separators against the cap", () => {
    // A single card whose line alone fits in 60 chars, but not once the
    // "Projects:\n" header is added. Must therefore be dropped entirely.
    const line = `- Tight — ${"q".repeat(40)}`; // ~50 chars, < 60
    expect(line.length).toBeLessThan(60);
    const out = formatStaticCards([{ cardType: "project", title: "Tight", body: "q".repeat(40) }], 55);
    expect(out).toBe(""); // header pushes it over 55
  });

  it("keeps the highest-priority card and stops at first overflow (same type)", () => {
    const cards = [
      { cardType: "project", title: "TOP", body: "y".repeat(50) },
      { cardType: "project", title: "LOW", body: "z".repeat(50) },
    ];
    const out = formatStaticCards(cards, 100);
    expect(out).toContain("TOP");
    expect(out).not.toContain("LOW");
  });

  it("does not let a short low-priority card jump ahead of a long high-priority one (cross type)", () => {
    // Priority order is the input order. A long project (high priority) that
    // fits, followed by a short company card that would overflow: the company
    // card must NOT be included even though it is shorter.
    const cards = [
      { cardType: "project", title: "BigProject", body: "y".repeat(70) },
      { cardType: "company", title: "Tiny", body: "z" },
    ];
    const projectOnly = formatStaticCards([cards[0]]);
    const out = formatStaticCards(cards, projectOnly.length + 5);
    expect(out).toContain("BigProject");
    expect(out).not.toContain("Tiny");
    expect(out).not.toContain("Company / Services:");
  });

  it("exposes a positive default cap", () => {
    expect(MAX_STATIC_CARDS_LENGTH).toBeGreaterThan(0);
  });
});

describe("buildStaticCardsSection", () => {
  it("is empty when no cards", () => {
    expect(buildStaticCardsSection("")).toBe("");
    expect(buildStaticCardsSection("   ")).toBe("");
  });

  it("wraps rendered cards in a STATIC_CARDS block", () => {
    const section = buildStaticCardsSection("Projects:\n- A — b");
    expect(section).toContain("STATIC_CARDS");
    expect(section).toContain("- A — b");
  });
});

describe("buildContextProviderChain", () => {
  it("orders USER_CONTEXT before CONTACT_CONTEXT before STATIC_CARDS", () => {
    const out = buildContextProviderChain({
      userContext: "I am a contractor",
      contactContext: "Called last week",
      staticCards: "Projects:\n- A — b",
    });
    const userIdx = out.indexOf("USER_CONTEXT");
    const contactIdx = out.indexOf("CONTACT_CONTEXT");
    const cardsIdx = out.indexOf("STATIC_CARDS");
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(contactIdx).toBeGreaterThan(userIdx);
    expect(cardsIdx).toBeGreaterThan(contactIdx);
  });

  it("omits STATIC_CARDS when there are no cards", () => {
    const out = buildContextProviderChain({ userContext: "x", contactContext: "y" });
    expect(out).not.toContain("STATIC_CARDS");
  });
});
