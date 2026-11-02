import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("native Prepare preview source and localization invariants (not an iOS build)", () => {
  it("keeps the five localized key sets identical with no duplicate saved-plan keys", () => {
    const sets = ["en", "ru", "es", "kk", "uk"].map(locale => {
      const source = readFileSync(`ios/TalkHint/Resources/${locale}.lproj/Localizable.strings`, "utf8");
      const keys = [...source.matchAll(/^"(prepare\.saved\.[^"]+)"\s*=/gm)].map(x => x[1]).sort();
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toHaveLength(17);
      return keys;
    });
    for (const keys of sets) expect(keys).toEqual(sets[0]);
  });
  it("mounts and refreshes only in Hint, without replacing native confirmation or consuming a plan", () => {
    const controller = readFileSync("ios/TalkHint/UI/PrepareViewController.swift", "utf8");
    expect(controller).toContain("if mode == .hint { savedPlansView.refresh() }");
    expect(controller).toContain("if mode == .hint { feedStack.addArrangedSubview(savedPlansView) }");
    expect(controller).toContain("savedPlansView.stopLoading()");
    const view = readFileSync("ios/TalkHint/UI/PreparedHintPlansView.swift", "utf8");
    expect(view).toContain('accessibilityIdentifier = "button-prepare-saved-refresh"');
    expect(view).not.toMatch(/\b(?:setUserGoal|sendPrepare\w*|startCall|consume|confirmSecretary)\s*\(/);
    const api = readFileSync("ios/TalkHint/Networking/APIClient.swift", "utf8");
    expect(api).toContain('request("/api/prepare/hint-plans", method: "GET", json: nil, authenticated: true)');
  });
});
