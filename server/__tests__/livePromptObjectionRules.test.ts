import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Regression guard for the LIVE-call coaching prompt.
//
// Two behaviors must survive future prompt edits or cold-call suggestion
// quality silently degrades:
//   1. The high-priority objection-handling rule (OBJECTION PRIORITY +
//      "Acknowledge -> Reframe -> Credibility -> Controlled question"), which
//      lives in the shared LIVE_ANTI_LOOP_RULES block embedded into every
//      assembled live system prompt.
//   2. The "under 25 words" cap on the suggested spoken reply, which is added
//      where buildLiveSystemPrompt assembles the live system prompt.
//
// Both branches of the assembled prompt (translation on / off) carry the cap,
// so we assert it appears in the real assembled string for both branches.
// Asserting against buildLiveSystemPrompt's output (instead of grepping
// websocket.ts source) keeps the test resilient to whitespace/wording shifts
// while still guarding the actual prompt the model receives.
// ---------------------------------------------------------------------------

const { LIVE_ANTI_LOOP_RULES, buildLiveSystemPrompt } = await import(
  "@shared/prompts"
);

describe("live-call coaching prompt", () => {
  it("keeps the high-priority objection-handling rule", () => {
    expect(LIVE_ANTI_LOOP_RULES).toContain("OBJECTION PRIORITY");
    expect(LIVE_ANTI_LOOP_RULES).toContain(
      "Acknowledge -> Reframe -> Credibility -> Controlled question",
    );
  });

  it("embeds the objection rule into the assembled live system prompt", () => {
    for (const translateEnabled of [true, false]) {
      const prompt = buildLiveSystemPrompt({
        goal: "Book a meeting",
        language: "ru",
        translateEnabled,
      });
      expect(prompt).toContain("OBJECTION PRIORITY");
      expect(prompt).toContain(
        "Acknowledge -> Reframe -> Credibility -> Controlled question",
      );
    }
  });

  it("keeps the under-25-words cap on the suggestion line in both branches", () => {
    for (const translateEnabled of [true, false]) {
      const prompt = buildLiveSystemPrompt({
        goal: "Book a meeting",
        language: "ru",
        translateEnabled,
      });
      const suggestionLines = prompt
        .split("\n")
        .filter((line) => line.includes("Suggest what user should say next"));

      expect(suggestionLines.length).toBeGreaterThan(0);
      for (const line of suggestionLines) {
        expect(line).toContain("under 25 words");
      }
    }
  });
});
