// Task: "Goal status never stops live assistance" — TalkHint is a continuous
// prompter for the ENTIRE call. Goal achieved/cancelled/replaced are context,
// UI, and analytics signals ONLY: they must never stop, suppress, or replace
// hint delivery (no hard stop, no forced canned closing phrase, no wait state).
//
// The guest-utterance handler is deeply coupled to Twilio/Deepgram sockets, so
// (like the grounding-rules tests) delivery gating is asserted at the source
// level, plus GoalEngine unit tests for post-achievement behavior.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { GoalEngine } from "../goalEngine";

const src = fs.readFileSync("server/websocket.ts", "utf8");

describe("no goal-status gate remains in the hint delivery path", () => {
  it("goalJustAchieved is gone entirely (no closing-phrase turn, no exemptions)", () => {
    expect(src).not.toContain("goalJustAchieved");
  });

  it("the canned closing phrase is gone — closing may only come from real farewell speech", () => {
    expect(src).not.toContain("All set! Thanks for the call.");
    expect(src).not.toContain("Готово! Спасибо за звонок.");
  });

  it("goalAchievedFlag never appears in a gating condition (if/&&/||/ternary/return)", () => {
    // Allowed: assignments (`goalAchievedFlag = true/false`) and comments.
    // Forbidden: any use inside a condition that could gate hint delivery.
    const lines = src.split("\n");
    const offenders = lines.filter((line) => {
      if (!line.includes("goalAchievedFlag")) return false;
      const code = line.split("//")[0];
      if (!code.includes("goalAchievedFlag")) return false; // comment only
      // Writes are fine (including resets like `if (x.goalChanged) goalAchievedFlag = false;`)
      // — only READS of the flag can gate delivery.
      const reads = code.replace(/goalAchievedFlag\s*=\s*(true|false)/g, "");
      if (!reads.includes("goalAchievedFlag")) return false;
      // The context-note ternary is the ONE allowed read: it only changes
      // prompt CONTEXT text, never delivery. Identify it explicitly.
      if (code.includes("goalAchievedFlag") && code.trim().startsWith("(goalAchievedFlag")) return false;
      return true;
    });
    expect(offenders).toEqual([]);
  });

  it("wantSuggestion is computed from turn shape only, never from goal status", () => {
    const m = src.match(/const wantSuggestion =[\s\S]{0,200}?;/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/goal/i);
  });

  it("achieved goal becomes a neutral context note that says to continue normally", () => {
    expect(src).toContain("The original call goal appears resolved. Continue assisting with the current conversation normally");
  });

  it("goal_achieved / goal_cancelled UI events are still emitted (analytics/UI stay)", () => {
    expect(src).toContain('"goal_achieved"');
    expect(src).toContain('"goal_cancelled"');
  });
});

describe("GoalEngine after achievement: tracking continues, nothing stops", () => {
  const mkAchievedEngine = () => {
    const engine = new GoalEngine("CA_test_achieved");
    engine.updateOnUtterance({ speaker: "HON", text: "My mobile number is not working. Can you help me fix it?", ts: 1 });
    const res = engine.updateOnUtterance({ speaker: "GST", text: "Okay, it's fixed now.", ts: 2 });
    expect(res.goalAchieved).toBe(true);
    return engine;
  };

  it("keeps processing utterances normally after achieved (no terminal state)", () => {
    const engine = mkAchievedEngine();
    const res = engine.updateOnUtterance({ speaker: "HON", text: "Great. I also want to check my payment details.", ts: 3 });
    // Still returns a live state and never re-fires achieved as a stop signal.
    expect(res.state.status).toBe("achieved"); // background context for UI
    expect(res.goalAchieved).toBe(false);
    expect(res.state.turnIndex).toBeGreaterThan(2);
  });

  it("a NEW topic after achievement can become the new detected goal", () => {
    const engine = mkAchievedEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "Great. Now I want to know how much the plan costs — what's the price?", ts: 3 });
    const res = engine.updateOnUtterance({ speaker: "HON", text: "Yes, tell me the cost and the fee for the plan, how much is it?", ts: 4 });
    // The engine is allowed to re-target: the new topic drives goalType again.
    expect(res.state.goalType).toBe("pricing");
  });

  it("achieved goal produces no slot steering (context only, no steering priority)", () => {
    const engine = mkAchievedEngine();
    const res = engine.updateOnUtterance({ speaker: "GST", text: "Anything else I can help with today?", ts: 3 });
    expect(res.state.nextBestAction).toBeUndefined();
  });
});
