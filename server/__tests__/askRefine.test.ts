// Ask-refine prompt contract (live-call Ask = hint instruction, not a chat).
// The prompt is assembled in shared/prompts.ts so it can be tested against the
// real string — same convention as buildLiveSystemPrompt.
import { describe, it, expect } from "vitest";
import {
  buildAskRefinePrompt,
  LIVE_GROUNDING_RULES,
  GOAL_PRIORITY_RULES,
  STRATEGY_MEMORY_RULES,
} from "@shared/prompts";

describe("buildAskRefinePrompt", () => {
  const base = {
    goal: "Book a table for two",
    language: "ru",
    conversationContext: "Guest: Would Monday work for you?\nHonor: Let me check.",
    currentHint: "Yes, Monday works for me.",
    contextSections: "USER CONTEXT:\nVegetarian.",
    translateEnabled: true,
    strategyMemory: "RECENT STRATEGY MEMORY:\n- offered Monday",
  };

  it("includes every mandatory grounding/priority/strategy block (grounding must reach EVERY suggestion path)", () => {
    const p = buildAskRefinePrompt(base);
    expect(p).toContain(LIVE_GROUNDING_RULES);
    expect(p).toContain(GOAL_PRIORITY_RULES);
    expect(p).toContain(STRATEGY_MEMORY_RULES);
  });

  it("embeds the live context: goal, conversation history, current hint, context sections, strategy memory", () => {
    const p = buildAskRefinePrompt(base);
    expect(p).toContain("Book a table for two");
    expect(p).toContain("Guest: Would Monday work for you?");
    expect(p).toContain('CURRENT SUGGESTED HINT (what the user was about to say): "Yes, Monday works for me."');
    expect(p).toContain("USER CONTEXT:\nVegetarian.");
    expect(p).toContain("RECENT STRATEGY MEMORY:\n- offered Monday");
  });

  it("frames the input as a mixed-language instruction producing ONE short English phrase as JSON", () => {
    const p = buildAskRefinePrompt(base);
    expect(p).toContain("INSTRUCTION");
    expect(p).toMatch(/never ask them to clarify the language/);
    expect(p).toContain("under 25 words");
    expect(p).toContain('{"en":"the phrase in ENGLISH","translation":"..."}');
    expect(p).toContain("No greetings, no explanations");
  });

  it("translation ON: asks for the native-language translation by name", () => {
    const p = buildAskRefinePrompt(base);
    expect(p).toContain('"translation": the same phrase in Russian.');
  });

  it("translation OFF: forces an empty translation (OFF must gate every suggestion path)", () => {
    const p = buildAskRefinePrompt({ ...base, translateEnabled: false });
    expect(p).toContain('ALWAYS an empty string "" (translation is disabled).');
    expect(p).not.toContain('"translation": the same phrase in Russian.');
  });

  it("omits empty optional sections without leaving labels behind", () => {
    const p = buildAskRefinePrompt({ goal: "", conversationContext: "", currentHint: "", strategyMemory: "" });
    expect(p).not.toContain("CONVERSATION HISTORY");
    expect(p).not.toContain("CURRENT SUGGESTED HINT");
    expect(p).toContain("Have a successful conversation");
  });
});
