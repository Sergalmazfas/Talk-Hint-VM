import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ACTION_RESULT_RULES, needsOwnerResultOptions, withActionResults } from "../hintActionResults";

afterEach(() => vi.unstubAllEnvs());
describe("owner action result policy", () => {
  it("defaults off and leaves the old prompt unchanged", () => {
    vi.stubEnv("HINT_ACTION_RESULTS_ENABLED", "false");
    expect(withActionResults("base")).toBe("base");
    expect(needsOwnerResultOptions("Please check your data and let me know")).toBe(false);
  });
  it("gives conditional choices, never infers completion or causes speech", () => {
    const prompt = withActionResults("base", true);
    expect(prompt).toContain(ACTION_RESULT_RULES);
    expect(prompt).toContain("Never select a result");
    expect(prompt).toContain("translation is enabled");
    expect(prompt).toContain("When the Owner states the result");
  });
  it.each([
    "I'll stay right here while you complete the activation and test your mobile data.",
    "Please check your data and let me know how it goes.",
    "Can you see any signal bars?",
  ])("bypasses canned / guest-wait replies for: %s", text => {
    expect(needsOwnerResultOptions(text, true)).toBe(true);
  });
  it.each(["Let me check your account.", "I'll test the connection. Please hold.",
    "I'll check your line to see if it works.", "Thank you."])(
    "keeps Guest lookups unchanged: %s", text => {
      expect(needsOwnerResultOptions(text, true)).toBe(false);
    });
  it("wires normal, realtime, Ask/chat and canned-library paths", () => {
    const ws = readFileSync("server/websocket.ts", "utf8");
    expect(ws).toContain("withActionResults(buildLiveSystemPrompt(");
    expect(ws).toContain("const fullInstructions = withActionResults(");
    expect(ws).toContain("withActionResults(buildAskRefinePrompt(");
    expect(ws).toContain("isOwnerOnlyQuestion(text) || needsOwnerResultOptions(text)");
    expect(readFileSync("server/routes.ts", "utf8"))
      .toContain("withActionResults(buildLiveChatSystemPrompt(");
  });
  it("publication bootstrap can pause without re-enabling a saved switch", () => {
    const source = readFileSync("server/callLab/service.ts", "utf8");
    // Policy moved to startup.ts; production must remain paused even if the
    // environment asks for automatic activation. Check the current assembly,
    // not the removed inline expression or an obsolete SQL parameter index.
    const startup = readFileSync("server/callLab/startup.ts", "utf8");
    expect(startup).toContain('process.env.NODE_ENV === "production"');
    expect(startup).toContain('process.env.LAB_START_PAUSED !== "false"');
    expect(source).toContain("labStartsPaused");
    expect(source).toContain("WHEN $6 THEN false ELSE call_lab_controls.enabled");
  });
});
