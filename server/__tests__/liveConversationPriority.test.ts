import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildLiveSystemPrompt, buildLiveUserPrompt, buildAskRefinePrompt,
  buildLiveChatSystemPrompt, GOAL_PRIORITY_RULES, LIVE_GROUNDING_RULES,
  ADAPTIVE_HINT_TYPE_RULES, STRATEGY_MEMORY_RULES,
} from "@shared/prompts";
import { buildOpenAIChatBody } from "../hintProvider";

// These assertions guard assembly and policy consistency, NOT model behavior.
describe("ordinary LIVE system + user conversation priority", () => {
  for (const translateEnabled of [true, false]) {
    for (const goal of ["Initial proposed plan", ""]) {
      it(`preserves current context and policy (translation=${translateEnabled}, goal=${!!goal})`, () => {
        const system = buildLiveSystemPrompt({
          goal, translateEnabled, conversationContext: "Honor: A known fact.\nGuest: Confirm it?",
          contextSections: "MY_CONTEXT:\nOlder profile", strategyMemory: "Prior suggestion, not speech",
        });
        const user = buildLiveUserPrompt("Confirm it?");
        const body = buildOpenAIChatBody("gpt-5.6-terra", system, user, 250);
        expect(body.messages).toEqual([{ role: "system", content: system }, { role: "user", content: user }]);
        expect(system).toContain("The conversation is the source of truth");
        expect(system).toContain("Separate the desired outcome from proposed steps");
        expect(system).toContain("not a permanent constraint unless the Owner explicitly made it mandatory");
        expect(system).toContain("Guest proposal updates the situation but is not Owner agreement");
        expect(system).toContain("nearest relevant conversation");
        expect(system).toContain("Asking for time does not disclose a value and need not contain a placeholder");
        expect(system).toContain("Do not invent why the user needs time");
        expect(system).toContain("If no Goal is supplied");
        expect(system).toContain("Honor: A known fact.\nGuest: Confirm it?");
        expect(system).toContain(ADAPTIVE_HINT_TYPE_RULES);
        expect(system).toContain(STRATEGY_MEMORY_RULES);
        expect(system).toContain("Sensitive authentication values are ALWAYS a [placeholder]");
        expect(system).toContain("If the fact IS confirmed — use DIRECT, never CHOICE");
        expect(user).toContain('Guest said: "Confirm it?"');
        expect(user).toContain("nearest relevant context");
        for (const contradiction of ["must ADVANCE", "They are correct and must be protected", "Not clarifications.", "steer back to the goal."]) {
          expect(system + user).not.toContain(contradiction);
        }
        expect(system).toContain('"type":"direct|choice|user_input|strategic"');
        if (!translateEnabled) expect(system).toContain('Omit "native_helper" always');
      });
    }
  }
  it("production ordinary-phone call uses the same pure user builder", () => {
    const source = readFileSync("server/websocket.ts", "utf8");
    const ordinary = source.slice(source.indexOf("async function translateAndSuggest"), source.indexOf("// Live-call \"Ask\" refine"));
    expect(ordinary).toContain("const userPrompt = buildLiveUserPrompt(text)");
    expect(ordinary).toContain("buildLiveSystemPrompt({");
    expect(ordinary).not.toContain("must ADVANCE");
  });
  it("shared consumer audit: Ask/chat inherit priorities, not new APIs or voice commands", () => {
    for (const prompt of [buildAskRefinePrompt({goal: "", language: "ru"}), buildLiveChatSystemPrompt({goal: ""})]) {
      expect(prompt).toContain(GOAL_PRIORITY_RULES);
      expect(prompt).toContain(LIVE_GROUNDING_RULES);
      expect(prompt).toContain(STRATEGY_MEMORY_RULES);
    }
  });
});