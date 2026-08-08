// Goal ACHIEVED false positives — an achieved-phrase inside a QUESTION or a
// negation must not mark the goal achieved (goal_achieved is a hard stop that
// silences ALL further hints for the rest of the call).
//
// Origin: real call 2026-08-08 — owner asked "What should I do the next to
// the fixed call and text?"; substring "fixed" marked the support goal
// achieved and no hints were shown for the remaining troubleshooting.

import { describe, it, expect } from "vitest";
import { GoalEngine } from "../goalEngine";

function engineWithSupportGoal(): GoalEngine {
  const engine = new GoalEngine("CA_test");
  // Establish the support goal the same way production does — via an owner
  // utterance that clearly states a support problem.
  engine.updateOnUtterance({ speaker: "HON", text: "My mobile number is not working. Can you help me fix it?", ts: Date.now() });
  return engine;
}

describe("goal achieved must not trigger from questions", () => {
  it("real-call regression: owner question containing 'fixed' does not achieve goal", () => {
    const engine = engineWithSupportGoal();
    const { state, goalAchieved } = engine.updateOnUtterance({
      speaker: "HON",
      text: "Yes. I see seasonal bars on my phone. What should I do the next to the fixed call and text?",
      ts: Date.now(),
    });
    expect(goalAchieved).toBe(false);
    expect(state.status).not.toBe("achieved");
  });

  it("guest question 'is it fixed now?' does not achieve goal", () => {
    const engine = engineWithSupportGoal();
    const { goalAchieved } = engine.updateOnUtterance({ speaker: "GST", text: "Is it fixed now? Can you check?", ts: Date.now() });
    expect(goalAchieved).toBe(false);
  });
});

describe("goal achieved must not trigger from negations", () => {
  it("'it's still not fixed' does not achieve goal", () => {
    const engine = engineWithSupportGoal();
    const { goalAchieved } = engine.updateOnUtterance({ speaker: "HON", text: "It's still not fixed.", ts: Date.now() });
    expect(goalAchieved).toBe(false);
  });

  it("'it isn't resolved' does not achieve goal", () => {
    const engine = engineWithSupportGoal();
    const { goalAchieved } = engine.updateOnUtterance({ speaker: "HON", text: "No, it isn't resolved.", ts: Date.now() });
    expect(goalAchieved).toBe(false);
  });
});

describe("clause-aware edge cases", () => {
  it("confirmation with a trailing question still achieves goal", () => {
    const engine = engineWithSupportGoal();
    const { goalAchieved } = engine.updateOnUtterance({ speaker: "GST", text: "Okay, it's fixed now. Anything else I can help with?", ts: Date.now() });
    expect(goalAchieved).toBe(true);
  });

  it("negated-then-confirmed phrase achieves goal via the second occurrence", () => {
    const engine = engineWithSupportGoal();
    const { goalAchieved } = engine.updateOnUtterance({ speaker: "HON", text: "It was not fixed before, but it's fixed now.", ts: Date.now() });
    expect(goalAchieved).toBe(true);
  });

  it("phrase embedded in another word ('undone') does not achieve goal", () => {
    const engine = engineWithSupportGoal();
    const { goalAchieved } = engine.updateOnUtterance({ speaker: "HON", text: "The change was undone.", ts: Date.now() });
    expect(goalAchieved).toBe(false);
  });
});

describe("slot-based achievement is not triggered by a question turn", () => {
  it("availability QUESTION filling date+time does not achieve booking goal", () => {
    const engine = new GoalEngine("CA_test2");
    engine.updateOnUtterance({ speaker: "HON", text: "I'd like to book an appointment for a haircut.", ts: Date.now() });
    const { goalAchieved, state } = engine.updateOnUtterance({ speaker: "GST", text: "Would Friday at 3 PM work for you?", ts: Date.now() });
    if (state.goalType === "booking") {
      expect(goalAchieved).toBe(false);
    }
  });
});

describe("genuine confirmations still achieve the goal", () => {
  it("'everything is fixed' achieves the support goal", () => {
    const engine = engineWithSupportGoal();
    const { state, goalAchieved } = engine.updateOnUtterance({ speaker: "HON", text: "Great, everything is fixed. Thank you.", ts: Date.now() });
    expect(goalAchieved).toBe(true);
    expect(state.status).toBe("achieved");
  });

  it("guest 'that should fix it' achieves the support goal", () => {
    const engine = engineWithSupportGoal();
    const { goalAchieved } = engine.updateOnUtterance({ speaker: "GST", text: "I've reset it on our side. That should fix the issue.", ts: Date.now() });
    expect(goalAchieved).toBe(true);
  });
});
