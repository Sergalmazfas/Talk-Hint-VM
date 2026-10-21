import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-level contract checks only: these do NOT replace Xcode or iPhone tests.
const read = (path: string) => readFileSync(path, "utf8");
const api = read("ios/TalkHint/Networking/APIClient.swift");
const screen = read("ios/TalkHint/UI/CallProfilesViewController.swift");
const cards = read("ios/TalkHint/UI/KnowledgeCardsViewController.swift");
const settings = read("ios/TalkHint/UI/SettingsViewController.swift");
describe("native personal/work integration wiring (not a simulator test)", () => {
  it("exposes a work number and real native cards navigation from existing Settings", () => {
    expect(settings).toContain('case .phone: return 3');
    expect(settings).toContain('"cell-work-number"');
    expect(settings).toContain('"cell-call-profiles"');
    expect(settings).toContain("CallProfilesViewController()");
    expect(screen).toContain("KnowledgeCardsViewController(profileScope: scope)");
  });
  it("passes the exact scope through reads, creates, edits and the editor", () => {
    expect(api).toContain('"/api/cards?profile=\\(profileScope.rawValue)"');
    expect(api).toContain('"profileScope": profileScope.rawValue');
    expect(api).toContain('payload["profileScope"] = profileScope.rawValue');
    expect(api).toContain("cards.allSatisfy({ $0.profileScope == profileScope })");
    expect(cards).toContain("self.profileScope = card?.profileScope ?? profileScope");
    expect(cards.match(/sortOrder: sortOrder, profileScope: profileScope/g)).toHaveLength(2);
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
