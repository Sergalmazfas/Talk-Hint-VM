import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-level contract checks only: these do NOT replace Xcode or iPhone tests.
const read = (path: string) => readFileSync(path, "utf8");
const api = read("ios/TalkHint/Networking/APIClient.swift");
const numbers = read("ios/TalkHint/UI/NumbersViewController.swift");
const screen = numbers.slice(numbers.indexOf("final class CallProfilesViewController:"));
const cards = read("ios/TalkHint/UI/KnowledgeCardsViewController.swift");
const settings = read("ios/TalkHint/UI/SettingsViewController.swift");
describe("native personal/work integration wiring (not a simulator test)", () => {
  it("keeps required symbols in already-compiled sources when the new files are absent from a Mac target", () => {
    for (const name of ["CallProfileScope", "CallProfileNumber", "CallProfileItem", "CallProfilesSnapshot"]) {
      expect(api).toMatch(new RegExp(`(?:enum|struct) ${name}[: ]`));
      expect(read("ios/TalkHint/Networking/CallProfilesModels.swift")).not.toMatch(new RegExp(`(?:enum|struct) ${name}[: ]`));
    }
    expect(numbers).toContain("final class CallProfilesViewController:");
    expect(read("ios/TalkHint/UI/CallProfilesViewController.swift")).not.toContain("final class CallProfilesViewController:");
    // Marker files can remain in regenerated projects without duplicate symbols.
    const definitions = [api, numbers, read("ios/TalkHint/Networking/CallProfilesModels.swift"),
      read("ios/TalkHint/UI/CallProfilesViewController.swift")].join("\n");
    expect(definitions.match(/struct CallProfilesSnapshot:/g)).toHaveLength(1);
    expect(definitions.match(/final class CallProfilesViewController:/g)).toHaveLength(1);
  });
  it("exposes a work number and real native cards navigation from existing Settings", () => {
    expect(settings).toContain('case .phone: return 3');
    expect(settings).toContain('"cell-work-number"');
    expect(settings).toContain('"cell-call-profiles"');
    expect(settings).toContain("CallProfilesViewController()");
    expect(screen).toContain("KnowledgeCardsViewController(profileScope: scope)");
  });
  it("passes the exact scope through reads, creates, edits and the editor", () => {
    expect(api).toContain('request("/api/cards", method: "GET", json: nil, authenticated: true,');
    expect(api).toContain('queryItems: [URLQueryItem(name: "profile", value: profileScope.rawValue)]');
    expect(api).toContain('"profileScope": profileScope.rawValue');
    expect(api).toContain('payload["profileScope"] = profileScope.rawValue');
    expect(api).toContain("cards.allSatisfy({ $0.profileScope == profileScope })");
    expect(cards).toContain("self.profileScope = card?.profileScope ?? profileScope");
    expect(cards.match(/sortOrder: sortOrder, profileScope: profileScope/g)).toHaveLength(2);
  });
  it("keeps the query separate from the path and routes HTTP calls through the tested URL builder", () => {
    expect(api).not.toContain('request("/api/cards?');
    expect(api).toContain('components.queryItems = queryItems.isEmpty ? nil : queryItems');
    expect(api).toContain('URLRequest(url: try Self.requestURL(path, queryItems: queryItems))');
    expect(api).toContain('!path.contains("?")');
    const nativeTests = read("ios/TalkHintTests/CallProfilesTests.swift");
    expect(nativeTests).toContain('XCTAssertEqual(url.path, "/api/cards")');
    expect(nativeTests).toContain('XCTAssertEqual(query.first?.value, scope.rawValue)');
  });
  it("uses native owner auth and keeps setup separate from ordinary calls", () => {
    const connection = api.slice(api.indexOf("func connectWorkNumber("), api.indexOf("struct KnowledgeCardItem"));
    expect(connection).toContain('"/api/call-profiles/work-number"');
    expect(connection).toContain('json: ["numberId": numberId], authenticated: true');
    expect(screen).toContain("UIAlertController(");
    expect(screen).toContain("candidate.existingBindingMove == true");
    expect(screen).toContain("guard !connecting else { return }");
    expect(screen).not.toContain("SessionStore.shared.activeNumberId =");
    expect(screen).not.toContain("start_call");
    expect(screen).not.toContain("TwilioVoice");
    const load = screen.slice(screen.indexOf("private func loadProfiles"), screen.indexOf("private func rows"));
    expect(load).toContain("APIClient.shared.callProfiles()");
    expect(load).not.toContain("connectWorkNumber");
  });
  it("does not report network/authorization failures as an empty successful card list", () => {
    expect(cards).toContain("loadError = error.localizedDescription");
    expect(cards).toContain('"profiles.cards_load_failed"');
    expect(screen).toContain("snapshot = nil");
    expect(screen).toContain("await loadProfiles()");
  });
});

describe("all five native translations remain aligned", () => {
  const languages = ["en", "ru", "es", "kk", "uk"];
  const strings = languages.map(lang => {
    const contents = read(`ios/TalkHint/Resources/${lang}.lproj/Localizable.strings`);
    const entries = [...contents.matchAll(/^"([^"]+)"\s*=\s*"((?:\\.|[^"\\])*)";/gm)];
    return { lang, entries, map: new Map(entries.map(e => [e[1], e[2]])) };
  });
  it("has identical keys, no duplicate keys and identical format placeholders", () => {
    const base = strings[0];
    for (const lang of strings) {
      expect(lang.entries.length, `${lang.lang} duplicates`).toBe(lang.map.size);
      expect([...lang.map.keys()].sort(), lang.lang).toEqual([...base.map.keys()].sort());
      for (const [key, value] of base.map) {
        const placeholders = (s: string) => (s.match(/%(?:\d+\$)?[@dfius]/g) ?? []).sort();
        expect(placeholders(lang.map.get(key)!), `${lang.lang} ${key}`).toEqual(placeholders(value));
      }
    }
  });
  it("translates every profile key used by the new native screens", () => {
    const sources = [api, cards, screen, settings, read("ios/TalkHint/Networking/CallProfilesModels.swift")].join("\n");
    const keys = new Set([...sources.matchAll(/"(profiles\.[a-z_]+)"/g)].map(m => m[1]));
    expect(keys.size).toBeGreaterThan(15);
    for (const { lang, map } of strings) for (const key of keys) expect(map.has(key), `${lang} ${key}`).toBe(true);
  });
});
