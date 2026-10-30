import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-contract checks only. Actual compilation, UIKit and SDK dispatch
// require HintDtmfTests via TalkHintValidation on macOS, never a fake green here.
const read = (path: string) => readFileSync(`ios/${path}`, "utf8");
const manager = read("TalkHint/Calls/CallManager.swift");
const screen = read("TalkHint/UI/InCallViewController.swift");
const keypad = read("TalkHint/UI/InCallKeypadViewController.swift");
const gate = read("TalkHint/Calls/HintDtmf.swift");
describe("native Hint keypad source contract (not an iOS build)", () => {
  it("uses the connected, exact outbound Hint session and real SDK without redial or other modes", () => {
    const send = manager.split("private func sendHintDigits")[1].split("/// Routes")[0];
    for (const guard of ["sessions[uuid]", "session.mode == .hint", "session.isOutgoing",
      "session.twilioCall", "call.state == .connected", "call.sendDigits($0)"])
      expect(send).toContain(guard);
    expect(send).not.toMatch(/TwilioVoiceSDK\.connect|APIClient|setSpeaker|audioSession/);
    expect(manager).toContain("sendHintDigits(digits, for: uuid)");
    expect(manager).toContain("perform action: CXPlayDTMFCallAction");
    expect(manager).toContain("action.type == .singleTone");
  });
  it("adds a keypad without removing mute, end or route and dismisses the full stack", () => {
    for (const id of ["button-mute", "button-end-call", "button-audio-route", "button-incall-keypad"])
      expect(screen).toContain(id);
    expect(screen).toContain("dtmfSender != nil");
    expect(screen).toContain("presenter.dismiss(animated: true)");
    expect(keypad).toContain('["123", "456", "789", "*0#"]');
    expect(keypad).toContain('for: .touchUpInside');
    expect(keypad).toContain("scroll.contentLayoutGuide");
    expect(keypad).toContain("close.bottomAnchor.constraint(equalTo: safe.bottomAnchor");
    expect(keypad).not.toMatch(/CallManager|AVAudioSession|APIClient|endCall/);
  });
  it("rejects pause characters and disconnected calls instead of scheduling delayed sends", () => {
    expect(gate).toContain('"0123456789*#".contains($0)');
    expect(gate).toContain("digits.count <= 32");
    expect(gate).toContain("guard connected, isValid(digits) else { return false }");
    expect(gate).not.toMatch(/asyncAfter|Timer|Task|sleep|queue\.append/);
  });
  it("keeps all five localization key sets and placeholders aligned", () => {
    const tables = ["en", "ru", "es", "kk", "uk"].map(lang =>
      new Map([...read(`TalkHint/Resources/${lang}.lproj/Localizable.strings`)
        .matchAll(/^"([^"]+)"\s*=\s*"((?:\\.|[^"\\])*)";/gm)].map(m => [m[1], m[2]])));
    for (const table of tables) {
      expect([...table.keys()].sort()).toEqual([...tables[0].keys()].sort());
      for (const key of ["incall.keypad.title", "incall.keypad.close", "incall.keypad.unavailable"])
        expect(table.get(key)?.length).toBeGreaterThan(0);
      for (const [key, value] of table)
        expect(value.match(/%(?:\d+\$)?[@dfsu]/g) ?? []).toEqual(tables[0].get(key)!.match(/%(?:\d+\$)?[@dfsu]/g) ?? []);
    }
  });
  it("makes native XCTest execution mandatory in the macOS acceptance gate", () => {
    const native = read("TalkHintTests/HintDtmfTests.swift"), validator = read("scripts/verify-xcresult.py");
    for (const name of [...native.matchAll(/func (test\w+)\(/g)].map(m => m[1]))
      expect(validator).toContain(`"${name}"`);
    expect(native).toContain("testReconnectDoesNotReplayEarlierKeyPresses");
  });
});
