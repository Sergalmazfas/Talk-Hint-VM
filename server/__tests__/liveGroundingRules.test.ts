// LIVE_GROUNDING_RULES — the grounding layer that forbids the live suggestion
// model from inventing facts about the user (Owner) or asserting real-world
// state it cannot know. These tests assert against the REAL assembled prompt
// (buildLiveSystemPrompt), the same way livePromptObjectionRules.test.ts does,
// so a refactor that drops the block from either prompt variant fails here.
//
// Origin: live call 2026-08-08 (Mint Mobile) where suggestions confidently
// answered "No, it's still not working" and guessed the device type, though
// only the owner can know either.

import { describe, it, expect } from "vitest";

const { LIVE_GROUNDING_RULES, buildLiveSystemPrompt } = await import(
  "@shared/prompts"
);

describe("LIVE_GROUNDING_RULES content", () => {
  it("forbids inventing or assuming user facts without a source", () => {
    expect(LIVE_GROUNDING_RULES).toMatch(/NEVER invent or assume a fact about the user/i);
    expect(LIVE_GROUNDING_RULES).toMatch(/MY_CONTEXT, CONTACT_CONTEXT, the call goal, knowledge cards, or the current conversation/);
  });

  it("forbids plausible/convenient answers without a source, not just guessing", () => {
    expect(LIVE_GROUNDING_RULES).toMatch(/Plausible answers are ALSO forbidden/i);
    expect(LIVE_GROUNDING_RULES).toMatch(/"Yes, I'm using an iPhone" without a source/);
  });

  it("directs the user to answer instead of answering for them (device example)", () => {
    expect(LIVE_GROUNDING_RULES).toContain('Tell them whether you\'re using an iPhone or Android.');
    expect(LIVE_GROUNDING_RULES).toMatch(/WRONG: "I'm using an Android\."/);
  });

  it('handles "is it working now?" without asserting yes/no (real-call scenario)', () => {
    // Guest asks "Is it working now?" and the owner has NOT answered yet:
    // the rules must show the neutral phrasing as RIGHT and both asserted
    // outcomes as WRONG.
    expect(LIVE_GROUNDING_RULES).toContain("Check whether calls are working now and answer based on the result.");
    expect(LIVE_GROUNDING_RULES).toMatch(/WRONG: "No, it's still not working\." \/ "Yes, everything works now\."/);
  });

  it("forbids claiming external actions succeeded or failed", () => {
    expect(LIVE_GROUNDING_RULES).toMatch(/NEVER claim an external action succeeded or failed/i);
  });

  it("defines state precedence with the current user statement on top", () => {
    expect(LIVE_GROUNDING_RULES).toMatch(/STATE PRECEDENCE/);
    expect(LIVE_GROUNDING_RULES).toMatch(
      /current explicit user statement > current call transcript > MY_CONTEXT \/ CONTACT_CONTEXT \/ knowledge cards > older call state/,
    );
  });

  it("stale contact memory must not pull suggestions back (working-now example)", () => {
    expect(LIVE_GROUNDING_RULES).toContain('CONTACT_CONTEXT says "Mint number is not working"');
    expect(LIVE_GROUNDING_RULES).toMatch(/current state is WORKING\. Stop suggesting troubleshooting/);
  });
});

describe("LIVE_GROUNDING_RULES is wired into the live prompt", () => {
  const baseOpts = { goal: "Fix my phone", language: "ru" };

  it("present in the translation-enabled prompt variant", () => {
    const prompt = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: true });
    expect(prompt).toContain(LIVE_GROUNDING_RULES);
  });

  it("present in the translation-disabled prompt variant", () => {
    const prompt = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: false });
    expect(prompt).toContain(LIVE_GROUNDING_RULES);
  });

  it("appears before the anti-loop rules so grounding reads as top-priority", () => {
    const prompt = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: true });
    const groundingIdx = prompt.indexOf("GROUNDING RULES");
    const antiLoopIdx = prompt.indexOf("You are TalkHint — a real-time conversation copilot");
    expect(groundingIdx).toBeGreaterThan(-1);
    expect(antiLoopIdx).toBeGreaterThan(-1);
    expect(groundingIdx).toBeLessThan(antiLoopIdx);
  });

  it("present when context sections are supplied (prod-like assembly)", () => {
    const prompt = buildLiveSystemPrompt({
      ...baseOpts,
      conversationContext: "Guest: Is it working now?",
      contextSections: "\nMY_CONTEXT:\nMint customer\n",
      translateEnabled: true,
    });
    expect(prompt).toContain(LIVE_GROUNDING_RULES);
  });
});

describe("owner-only question gate (library fast path skips canned answers)", () => {
  it("detects real-world state checks from the actual call", async () => {
    const { isOwnerOnlyQuestion } = await import("../dialogueMatch");
    expect(isOwnerOnlyQuestion("Try making a call. Is it working now?")).toBe(true);
    expect(isOwnerOnlyQuestion("Is everything working after the reset?")).toBe(true);
    expect(isOwnerOnlyQuestion("Are you using an iPhone or Android?")).toBe(true);
    expect(isOwnerOnlyQuestion("Which phone do you have?")).toBe(true);
    expect(isOwnerOnlyQuestion("Did you tap reset network settings?")).toBe(true);
    expect(isOwnerOnlyQuestion("Do you see the Mint Mobile plan under cellular?")).toBe(true);
    expect(isOwnerOnlyQuestion("What does the screen say?")).toBe(true);
  });

  it("does not flag ordinary business questions the library should answer", async () => {
    const { isOwnerOnlyQuestion } = await import("../dialogueMatch");
    expect(isOwnerOnlyQuestion("What are your prices?")).toBe(false);
    expect(isOwnerOnlyQuestion("How soon can you cover a shift?")).toBe(false);
    expect(isOwnerOnlyQuestion("Can you tell me your Mint Mobile phone number?")).toBe(false);
    expect(isOwnerOnlyQuestion("We already have a staffing agency.")).toBe(false);
    expect(isOwnerOnlyQuestion("Where did you get my number?")).toBe(false);
  });
});

describe("/api/chat live branch is grounded", () => {
  it("live chat prompt contains LIVE_GROUNDING_RULES and the golden prompt", async () => {
    const { buildLiveChatSystemPrompt, TALKHINT_GOLDEN_PROMPT } = await import("@shared/prompts");
    const prompt = buildLiveChatSystemPrompt({ goal: "Fix my number", language: "ru" });
    expect(prompt).toContain(LIVE_GROUNDING_RULES);
    expect(prompt).toContain(TALKHINT_GOLDEN_PROMPT);
    expect(prompt).toContain("USER'S GOAL: Fix my number");
    expect(prompt).toContain("LIVE call");
  });
});

describe("answer-side guard: canned answers asserting unverifiable state are never served", () => {
  it("flags answers that assert mutable state or personal facts", async () => {
    const { answerAssertsUnverifiableState } = await import("../dialogueMatch");
    expect(answerAssertsUnverifiableState("No, it's still not working.")).toBe(true);
    expect(answerAssertsUnverifiableState("Yes, everything works now.")).toBe(true);
    expect(answerAssertsUnverifiableState("It is working now, thanks.")).toBe(true);
    expect(answerAssertsUnverifiableState("I'm using an iPhone.")).toBe(true);
    expect(answerAssertsUnverifiableState("I have an Android.")).toBe(true);
    expect(answerAssertsUnverifiableState("I already restarted it.")).toBe(true);
    expect(answerAssertsUnverifiableState("The problem is fixed.")).toBe(true);
  });

  it("does not flag ordinary sourced business answers", async () => {
    const { answerAssertsUnverifiableState } = await import("../dialogueMatch");
    expect(answerAssertsUnverifiableState("Our rate is $25 per hour for backup staffing.")).toBe(false);
    expect(answerAssertsUnverifiableState("I can cover shifts on weekdays until 5 PM.")).toBe(false);
    expect(answerAssertsUnverifiableState("Let me check and get back to you.")).toBe(false);
    expect(answerAssertsUnverifiableState("Could you tell me which plan you're referring to?")).toBe(false);
  });

  it("matchDialogueLibrary skips an entry whose answer asserts state", async () => {
    const { matchDialogueLibrary } = await import("../dialogueMatch");
    const library = {
      id: "lib1", userId: "u1", goalText: "fix my mint mobile number", goalType: "support",
      entries: [
        { type: "typical", trigger: "Is it working now?", variants: ["Is everything working now?"], answer: "Yes, everything works now.", translation: "", slot: null },
      ],
    } as any;
    const hit = matchDialogueLibrary([library], "Is it working now?", "fix my mint mobile number", "support");
    expect(hit).toBeNull();
  });
});

describe("dialogue-library fast path (generator prompt) is also grounded", () => {
  // Library lines bypass the live LLM entirely, so the grounding constraint
  // must exist at build time — the generator prompt forbids invented personal
  // facts / real-world state in canned answers.
  it("generator system prompt forbids invented state in answers", async () => {
    const { buildSystemPrompt } = await import("../dialogueLibraryGenerator");
    const prompt = buildSystemPrompt("support", "ru");
    expect(prompt).toMatch(/NEVER put an invented personal fact or real-world state into an "answer"/);
    expect(prompt).toMatch(/direct the user to answer from what they actually know/);
  });
});
