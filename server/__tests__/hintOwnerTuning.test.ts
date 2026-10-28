import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveWaitState } from "../waitState";
import { HintCarryover } from "../hintCarryover";

describe("owner-approved D1–D3 regression fixtures (offline)", () => {
  it.each([
    "Just checking in to see if you're still working on something.",
    "I'm checking to see if you found the reset button.",
    "Let me know how it goes.",
    "Are you still checking the settings?",
  ])("does not make the owner wait when the guest checks progress: %s", text => {
    expect(resolveWaitState(false, text).waiting).toBe(false);
    expect(resolveWaitState(true, text).waiting).toBe(false);
  });
  it("keeps legitimate waiting and excludes a checking account", () => {
    expect(resolveWaitState(false, "One moment, let me check your account.").waiting).toBe(true);
    expect(resolveWaitState(false, "Still checking the system, almost there.").waiting).toBe(true);
    expect(resolveWaitState(false, "A checking account is required.").waiting).toBe(false);
  });
  it("answers the new question without mixing an older question into it", () => {
    const c = new HintCarryover();
    c.beginTurn("When did it stop working?", 1);
    const latest = c.beginTurn("What is your ZIP code?", 2).turn;
    expect(c.buildHintText(latest, true)).toEqual({ hintText: "What is your ZIP code?", carried: null });
    expect(c.peek()).toBeNull();
  });
  it("still carries a question across a non-question continuation", () => {
    const c = new HintCarryover();
    c.beginTurn("What is your ZIP code?", 1);
    const latest = c.beginTurn("Take your time.", 2).turn;
    expect(c.buildHintText(latest, true).hintText).toContain("ZIP code?");
  });
  it("pins the iOS source contract; not a substitute for an Xcode/device test", () => {
    const vc = readFileSync("ios/TalkHint/UI/InCallViewController.swift", "utf8");
    const show = vc.slice(vc.indexOf("private func showSuggestion("), vc.indexOf("@objc private func choiceOptionTapped"));
    expect(show).toContain("setContentOffset(.zero, animated: false)");
    expect(show).toContain("view.layoutIfNeeded()");
    const stream = readFileSync("ios/TalkHint/Calls/CallHintStream.swift", "utf8");
    const handler = stream.slice(stream.indexOf("private func handle(text:"), stream.indexOf("static func decode("));
    expect(handler.match(/DispatchQueue\.main\.async/g)).toHaveLength(1);
    expect(handler.indexOf("didReceive: event")).toBeLessThan(handler.indexOf("reportCurrentHintVisibility()"));
    const server = readFileSync("server/websocket.ts", "utf8");
    expect(server.indexOf("newer guest question before hint selection")).toBeLessThan(server.indexOf('// ===== WAIT STATE: Show 1 ACK'));
  });
});
