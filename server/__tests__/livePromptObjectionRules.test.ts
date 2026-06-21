import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
//      inline where translateAndSuggest assembles the live system prompt in
//      server/websocket.ts.
//
// Both branches of the assembled prompt (translation on / off) carry the cap,
// so we assert it appears on every suggestion line that survives in the file.
// ---------------------------------------------------------------------------

const { LIVE_ANTI_LOOP_RULES } = await import("@shared/prompts");

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const websocketSource = readFileSync(
  path.join(rootDir, "websocket.ts"),
  "utf8",
);

describe("live-call coaching prompt", () => {
  it("keeps the high-priority objection-handling rule", () => {
    expect(LIVE_ANTI_LOOP_RULES).toContain("OBJECTION PRIORITY");
    expect(LIVE_ANTI_LOOP_RULES).toContain(
      "Acknowledge -> Reframe -> Credibility -> Controlled question",
    );
  });

  it("embeds the objection rule into the assembled live system prompt", () => {
    // The websocket prompt builder interpolates LIVE_ANTI_LOOP_RULES directly.
    expect(websocketSource).toContain("${LIVE_ANTI_LOOP_RULES}");
  });

  it("keeps the under-25-words cap on every suggestion line", () => {
    const suggestionLines = websocketSource
      .split("\n")
      .filter((line) => line.includes("Suggest what user should say next"));

    expect(suggestionLines.length).toBeGreaterThan(0);
    for (const line of suggestionLines) {
      expect(line).toContain("under 25 words");
    }
  });
});
