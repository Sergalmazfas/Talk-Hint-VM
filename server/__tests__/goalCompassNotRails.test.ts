// Task: "Goal as compass, not rails" — the call goal guides hints but must
// never override the Owner's latest explicit intent or the current topic.
// These tests assert against the REAL assembled prompts (like
// liveGroundingRules.test.ts) plus the GoalEngine cancellation behavior.

import { describe, it, expect } from "vitest";

const {
  GOAL_PRIORITY_RULES,
  LIVE_ANTI_LOOP_RULES,
  buildLiveSystemPrompt,
  buildLiveChatSystemPrompt,
} = await import("@shared/prompts");

describe("GOAL_PRIORITY_RULES content", () => {
  it("states the compass rule verbatim", () => {
    expect(GOAL_PRIORITY_RULES).toContain(
      "The call goal guides the conversation but must never override the Owner's latest explicit intent. Follow the current topic first. Return to the original goal only when appropriate and only if it remains unresolved.",
    );
  });

  it("gives the other party's direct question absolute priority (ZIP example)", () => {
    const idx1 = GOAL_PRIORITY_RULES.indexOf("1. The other party's direct question");
    const idx2 = GOAL_PRIORITY_RULES.indexOf("2. The Owner's latest explicit intent");
    const idx3 = GOAL_PRIORITY_RULES.indexOf("3. The side topic the Owner deliberately opened");
    const idx4 = GOAL_PRIORITY_RULES.indexOf("4. The original call goal");
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
    expect(idx4).toBeGreaterThan(idx3);
    expect(GOAL_PRIORITY_RULES).toContain("Can you confirm your ZIP code?");
    expect(GOAL_PRIORITY_RULES).toMatch(/ABSOLUTE priority/);
  });

  it("forbids dragging an active side topic back to the goal", () => {
    expect(GOAL_PRIORITY_RULES).toMatch(/do NOT drag the conversation back to the original goal/i);
    expect(GOAL_PRIORITY_RULES).toMatch(/Never interrupt an active side topic merely because the original goal remains unresolved/);
  });

  it("declares explicit goal cancellation", () => {
    expect(GOAL_PRIORITY_RULES).toMatch(/GOAL CANCELLATION/);
    expect(GOAL_PRIORITY_RULES).toContain("Forget the phone issue, I only want to check my payment now");
    expect(GOAL_PRIORITY_RULES).toMatch(/treat the original goal as CANCELLED/i);
  });

  it("permits a soft return only at a natural pause, with the gentle example", () => {
    expect(GOAL_PRIORITY_RULES).toMatch(/SOFT RETURN TO GOAL/);
    expect(GOAL_PRIORITY_RULES).toContain("Anything else I can help with?");
    expect(GOAL_PRIORITY_RULES).toContain("Before we finish, can we also confirm that my calls and texts are working now?");
  });
});

describe("GOAL_PRIORITY_RULES is wired into every live prompt path", () => {
  const baseOpts = { goal: "Fix my phone service", language: "ru" };

  it("present in the translation-enabled live prompt", () => {
    expect(buildLiveSystemPrompt({ ...baseOpts, translateEnabled: true })).toContain(GOAL_PRIORITY_RULES);
  });

  it("present in the translation-disabled live prompt", () => {
    expect(buildLiveSystemPrompt({ ...baseOpts, translateEnabled: false })).toContain(GOAL_PRIORITY_RULES);
  });

  it("present in the live chat (/api/chat) prompt", () => {
    expect(buildLiveChatSystemPrompt({ goal: "Fix my number", language: "ru" })).toContain(GOAL_PRIORITY_RULES);
  });

  it("realtime/ask-assistant paths in websocket.ts inject it too", async () => {
    // These prompts are assembled inline (they take TALKHINT_GOLDEN_PROMPT
    // directly), so assert the source wiring like the grounding tests do.
    const fs = await import("fs");
    const src = fs.readFileSync("server/websocket.ts", "utf8");
    const usages = src.split("GOAL_PRIORITY_RULES").length - 1;
    // import + initSession instructions + ask-assistant systemPrompt
    expect(usages).toBeGreaterThanOrEqual(3);
  });
});

describe("anti-loop rules no longer force an unconditional pull back to goal", () => {
  it('replaced "GOAL FIRST, ALWAYS" with compass behavior', () => {
    expect(LIVE_ANTI_LOOP_RULES).not.toContain("GOAL FIRST, ALWAYS");
    expect(LIVE_ANTI_LOOP_RULES).toContain("GOAL AS COMPASS");
    expect(LIVE_ANTI_LOOP_RULES).toMatch(/do not pull back to the goal while it is active/i);
  });
});

describe("GoalEngine: explicit goal cancellation", () => {
  const mkEngine = async () => {
    const { GoalEngine } = await import("../goalEngine");
    return new GoalEngine("test-call");
  };

  it("owner's explicit abandonment cancels the goal and stops steering", async () => {
    const engine = await mkEngine();
    // Establish a support goal first.
    engine.updateOnUtterance({ speaker: "HON", text: "My phone is not working, I need help to fix it", ts: 1 });
    expect(engine.getState().goalType).toBe("support");

    const res = engine.updateOnUtterance({
      speaker: "HON",
      text: "Forget the phone thing for now",
      ts: 2,
    });
    expect(res.goalCancelled).toBe(true);
    expect(res.state.status).toBe("cancelled");
    expect(res.state.nextBestAction).toBeUndefined();
  });

  it("a cancelled goal can no longer be marked achieved by old confirmation phrases", async () => {
    const engine = await mkEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "My phone is broken, please help fix this issue", ts: 1 });
    engine.updateOnUtterance({ speaker: "HON", text: "Never mind, that's no longer needed", ts: 2 });
    const res = engine.updateOnUtterance({ speaker: "GST", text: "Okay, it's all done and resolved.", ts: 3 });
    expect(res.goalAchieved).toBe(false);
    expect(res.state.status).toBe("cancelled");
  });

  it("guest speech never cancels the owner's goal", async () => {
    const engine = await mkEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "I need help, my phone is broken", ts: 1 });
    const res = engine.updateOnUtterance({ speaker: "GST", text: "Forget the phone issue, let's talk about upgrades", ts: 2 });
    expect(res.goalCancelled).toBe(false);
    expect(res.state.status).not.toBe("cancelled");
  });

  it("cancel-and-replace in one utterance: old goal cancelled, new goal detected", async () => {
    const engine = await mkEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "My phone is not working, help me fix this problem please", ts: 1 });
    expect(engine.getState().goalType).toBe("support");
    const res = engine.updateOnUtterance({
      speaker: "HON",
      text: "Forget the phone issue, I only want to know how much the plan costs and the price now",
      ts: 2,
    });
    expect(res.goalCancelled).toBe(true);
    // Pricing keywords ("how much", "costs", "price") should re-target the goal.
    expect(res.state.goalType).toBe("pricing");
  });

  it('discourse markers do NOT cancel: "forget it, let\'s continue"', async () => {
    const engine = await mkEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "My phone is not working, help me fix it", ts: 1 });
    const res = engine.updateOnUtterance({ speaker: "HON", text: "Forget it, let's continue", ts: 2 });
    expect(res.goalCancelled).toBe(false);
    expect(res.state.status).not.toBe("cancelled");
  });

  it('resume markers do NOT cancel: "never mind that, back to the phone"', async () => {
    const engine = await mkEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "My phone is not working, help me fix it", ts: 1 });
    const res = engine.updateOnUtterance({ speaker: "HON", text: "Never mind that, back to the phone issue", ts: 2 });
    expect(res.goalCancelled).toBe(false);
    expect(res.state.status).not.toBe("cancelled");
  });

  it("pure cancellation empties missingSlots so fast-layer slot steering stops", async () => {
    const engine = await mkEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "I want to book an appointment, can I schedule a visit?", ts: 1 });
    expect(engine.getState().missingSlots.length).toBeGreaterThan(0);
    const res = engine.updateOnUtterance({ speaker: "HON", text: "Forget the appointment thing", ts: 2 });
    expect(res.state.status).toBe("cancelled");
    expect(res.state.missingSlots).toEqual([]);
    expect(res.state.nextBestAction).toBeUndefined();
  });

  it("after cancel-and-replace, the NEW goal stays active on later turns", async () => {
    const engine = await mkEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "My phone is not working, help me fix this problem please", ts: 1 });
    const rep = engine.updateOnUtterance({
      speaker: "HON",
      text: "Forget the phone issue, I only want to know how much the plan costs and the price now",
      ts: 2,
    });
    expect(rep.goalCancelled).toBe(true);
    expect(rep.state.goalType).toBe("pricing");
    expect(rep.state.status).toBe("changed");
    const next = engine.updateOnUtterance({ speaker: "GST", text: "Sure, let me pull up your plan details.", ts: 3 });
    expect(next.state.goalType).toBe("pricing");
    expect(next.state.status).toBe("in_progress");
  });

  it("ordinary topic drift does NOT cancel the goal", async () => {
    const engine = await mkEngine();
    engine.updateOnUtterance({ speaker: "HON", text: "My phone is not working, I need it fixed", ts: 1 });
    const res = engine.updateOnUtterance({
      speaker: "HON",
      text: "I also want to know when my next payment is due",
      ts: 2,
    });
    expect(res.goalCancelled).toBe(false);
    expect(res.state.status).not.toBe("cancelled");
  });
});
