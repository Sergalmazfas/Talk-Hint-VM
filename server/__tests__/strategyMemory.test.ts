// LIVE Hint Policy v2.2 — Strategy Memory (Task #236).
//
// Deterministic tests, no model call anywhere:
//  1. Tracker layer (server/strategyMemory.ts): cycle assembly (suggestion ->
//     actual Owner speech -> Guest reaction), deterministic outcomes via the
//     #226 usage scorer, CHOICE branch selection, bounded memory.
//  2. Prompt layer: STRATEGY_MEMORY_RULES present in every live prompt branch
//     (translate ON/OFF, live chat, ask-assistant/realtime via source wiring),
//     RECENT STRATEGY MEMORY block injected only when non-empty, and no
//     existing layer displaced.
//  3. Single-BRAIN-call + no-new-LLM guarantees.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const {
  STRATEGY_MEMORY_RULES,
  ADAPTIVE_HINT_TYPE_RULES,
  buildLiveSystemPrompt,
  buildLiveChatSystemPrompt,
  LIVE_GROUNDING_RULES,
  GOAL_PRIORITY_RULES,
  LIVE_ANTI_LOOP_RULES,
} = await import("@shared/prompts");
const { StrategyMemoryTracker, scoreOutcome, MAX_CYCLES } = await import("../strategyMemory");
const { routeGenerate } = await import("../hintProvider");

const baseOpts = { goal: "Cancel my subscription", conversationContext: "", contextSections: "" };

// ---------------------------------------------------------------------------
// 1. Tracker — outcomes are computed ONLY from actual Owner speech
// ---------------------------------------------------------------------------

describe("StrategyMemoryTracker — suggestion is never automatically an Owner fact", () => {
  it("ignored hint: owner said something completely different -> outcome ignored, suggestion not treated as spoken", () => {
    const t = new StrategyMemoryTracker();
    t.recordSuggestion("Yes, I already installed the app.", "direct");
    t.recordOwnerTurn("Actually, can we talk about my bill instead?");
    t.recordGuestTurn("Sure, what about the bill?");
    const out = t.render();
    expect(out).toContain("Outcome: ignored");
    expect(out).toContain('Owner actually said: "Actually, can we talk about my bill instead?"');
    // The render explicitly labels suggestions as advice, not facts.
    expect(out).toMatch(/advice, NOT facts/);
  });

  it("no owner reply: suggestion shown but owner silent -> explicitly NOT spoken", () => {
    const t = new StrategyMemoryTracker();
    t.recordSuggestion("Yes, I did.", "direct");
    t.recordGuestTurn("Hello? Are you there?");
    const out = t.render();
    expect(out).toContain("Owner actually said: (nothing — the suggestion was NOT spoken)");
    expect(out).toContain("Outcome: no owner reply");
  });

  it("full usage (successful DIRECT): owner spoke the hint -> accepted", () => {
    const t = new StrategyMemoryTracker();
    t.recordSuggestion("Yes, I did.", "direct");
    t.recordOwnerTurn("Yes, I did.");
    t.recordGuestTurn("Great, moving on. What's your ZIP code?");
    expect(t.render()).toContain("Outcome: accepted");
  });

  it("partial usage: owner spoke only one of two thoughts -> partial", () => {
    const t = new StrategyMemoryTracker();
    t.recordSuggestion("I made those payments in August, and I want a refund for the late fee.", "strategic");
    t.recordOwnerTurn("I made those payments in August.");
    t.recordGuestTurn("Let me check the August payments.");
    expect(t.render()).toContain("Outcome: partial");
  });

  it("CHOICE branch selection: owner said the NO option -> branch selected: no; YES never becomes fact", () => {
    const t = new StrategyMemoryTracker();
    t.recordSuggestion('If yes: "Yes, I got it." / If no: "No, not yet."', "choice", [
      { label: "yes", en: "Yes, I got it." },
      { label: "no", en: "No, not yet." },
    ]);
    t.recordOwnerTurn("No, not yet.");
    t.recordGuestTurn("Okay, I'll resend the code.");
    const out = t.render();
    expect(out).toContain("branch selected: no");
    expect(out).toContain("Options shown (hypothetical until spoken)");
    expect(out).not.toContain("branch selected: yes");
  });

  it("CHOICE with no matching owner speech: no branch is ever selected", () => {
    const cycle = {
      suggestionEn: "x",
      suggestionType: "choice" as const,
      options: [
        { label: "yes", en: "Yes, I got it." },
        { label: "no", en: "No, not yet." },
      ],
      ownerSaid: ["Can I speak to a supervisor please?"],
      closed: true,
    };
    const { outcome, selectedBranch } = scoreOutcome(cycle);
    expect(outcome).toBe("ignored");
    expect(selectedBranch).toBeUndefined();
  });

  it("CHOICE tie between options selects nothing (never guesses a branch)", () => {
    const cycle = {
      suggestionEn: "x",
      suggestionType: "choice" as const,
      options: [
        { label: "a", en: "Yes exactly." },
        { label: "b", en: "Yes exactly." },
      ],
      ownerSaid: ["Yes exactly."],
      closed: true,
    };
    expect(scoreOutcome(cycle).selectedBranch).toBeUndefined();
  });
});

describe("StrategyMemoryTracker — bounded, cheap, deterministic", () => {
  it("memory never grows past MAX_CYCLES regardless of call length", () => {
    const t = new StrategyMemoryTracker();
    for (let i = 0; i < 50; i++) {
      t.recordSuggestion(`Suggestion number ${i}.`, "direct");
      t.recordOwnerTurn(`Suggestion number ${i}.`);
      t.recordGuestTurn(`Guest reply ${i}.`);
    }
    expect(t.size()).toBeLessThanOrEqual(MAX_CYCLES);
    const out = t.render();
    // Oldest cycles evicted, newest kept.
    expect(out).not.toContain("Suggestion number 0.");
    expect(out).toContain("Suggestion number 49.");
    // Bounded number of rendered cycles.
    expect((out.match(/TalkHint suggested/g) || []).length).toBeLessThanOrEqual(MAX_CYCLES);
  });

  it("long texts are capped so the block stays token-cheap", () => {
    const t = new StrategyMemoryTracker();
    const long = "word ".repeat(200);
    t.recordSuggestion(long, "strategic");
    t.recordOwnerTurn(long);
    t.recordGuestTurn(long);
    const out = t.render();
    expect(out.length).toBeLessThan(800);
  });

  it("render is empty until a cycle is CLOSED by a guest reaction (open cycles never rendered)", () => {
    const t = new StrategyMemoryTracker();
    expect(t.render()).toBe("");
    t.recordSuggestion("Yes, I did.", "direct");
    t.recordOwnerTurn("Yes, I did.");
    expect(t.render()).toBe(""); // still open — no guest reaction yet
    t.recordGuestTurn("Great.");
    expect(t.render()).not.toBe("");
  });

  it("owner speech before any suggestion, or empty texts, never crash or open cycles", () => {
    const t = new StrategyMemoryTracker();
    t.recordOwnerTurn("Hello, I'm calling about my account.");
    t.recordGuestTurn("How can I help?");
    t.recordSuggestion("", "direct"); // empty suggestion ignored
    expect(t.size()).toBe(0);
    expect(t.render()).toBe("");
  });

  it("misunderstanding / rejection reactions are carried verbatim so the Brain can adapt", () => {
    const t = new StrategyMemoryTracker();
    t.recordSuggestion("Could you waive the fee as a courtesy given my payment history?", "strategic");
    t.recordOwnerTurn("Could you waive the fee as a courtesy?");
    t.recordGuestTurn("I don't understand what you're asking.");
    const out = t.render();
    expect(out).toContain(`Guest reaction: "I don't understand what you're asking."`);
  });
});

// ---------------------------------------------------------------------------
// 2. Prompt layer
// ---------------------------------------------------------------------------

describe("STRATEGY_MEMORY_RULES content (all 10 policy rules)", () => {
  it("suggestions are advice not facts; only Owner speech establishes facts", () => {
    expect(STRATEGY_MEMORY_RULES).toMatch(/Previous suggestions are advice, not facts/);
    expect(STRATEGY_MEMORY_RULES).toMatch(/Only Owner speech and trusted context establish user facts/);
    expect(STRATEGY_MEMORY_RULES).toMatch(/never becomes a fact by itself/);
  });
  it("worked -> advance; ignored -> not said; partial -> only expressed meaning", () => {
    expect(STRATEGY_MEMORY_RULES).toMatch(/If the previous approach worked, advance/);
    expect(STRATEGY_MEMORY_RULES).toMatch(/If the Owner ignored a suggestion, do not assume it was said/);
    expect(STRATEGY_MEMORY_RULES).toMatch(/used only part of a suggestion, rely only on the meaning actually expressed/);
  });
  it("misunderstanding -> simplify/rephrase, never identical repeat; rejection -> adapt", () => {
    expect(STRATEGY_MEMORY_RULES).toMatch(/did not understand, simplify or rephrase/);
    expect(STRATEGY_MEMORY_RULES).toMatch(/never repeat the identical wording/);
    expect(STRATEGY_MEMORY_RULES).toMatch(/rejected the previous approach, adapt the strategy/);
  });
  it("CHOICE stays hypothetical until actual speech; memory is secondary to GOAL/current question", () => {
    expect(STRATEGY_MEMORY_RULES).toMatch(/CHOICE alternatives remain hypothetical until the Owner selects one through actual speech/);
    expect(STRATEGY_MEMORY_RULES).toMatch(/unselected option is never a fact/);
    expect(STRATEGY_MEMORY_RULES).toMatch(/secondary to the current Guest question, the current Owner intent, trusted facts, and the GOAL PRIORITY RULES/);
  });
});

describe("buildLiveSystemPrompt integration (v2.2)", () => {
  const memory = new StrategyMemoryTracker();
  memory.recordSuggestion("Yes, I did.", "direct");
  memory.recordOwnerTurn("Yes.");
  memory.recordGuestTurn("Great. Next question.");
  const memoryBlock = memory.render();

  it("translate ON: rules + memory block present, NO existing layer displaced", () => {
    const p = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: true, strategyMemory: memoryBlock });
    expect(p).toContain(STRATEGY_MEMORY_RULES);
    expect(p).toContain("RECENT STRATEGY MEMORY");
    expect(p).toContain(LIVE_GROUNDING_RULES);
    expect(p).toContain(GOAL_PRIORITY_RULES);
    expect(p).toContain(LIVE_ANTI_LOOP_RULES);
    expect(p).toContain(ADAPTIVE_HINT_TYPE_RULES);
  });

  it("translate OFF: rules + memory block present too", () => {
    const p = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: false, strategyMemory: memoryBlock });
    expect(p).toContain(STRATEGY_MEMORY_RULES);
    expect(p).toContain("RECENT STRATEGY MEMORY");
  });

  it("empty memory: rules stay, no dangling RECENT STRATEGY MEMORY block", () => {
    const p = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: true });
    expect(p).toContain(STRATEGY_MEMORY_RULES);
    expect(p).not.toContain("RECENT STRATEGY MEMORY (");
  });

  it("memory supplements — does not displace — CONVERSATION HISTORY", () => {
    const p = buildLiveSystemPrompt({
      ...baseOpts,
      conversationContext: "Guest: Is it working now?",
      translateEnabled: true,
      strategyMemory: memoryBlock,
    });
    expect(p).toContain("CONVERSATION HISTORY:\nGuest: Is it working now?");
    expect(p).toContain("RECENT STRATEGY MEMORY");
  });

  it("live chat prompt carries the rules (and optional memory)", () => {
    const p = buildLiveChatSystemPrompt({ goal: "Fix my number", strategyMemory: memoryBlock });
    expect(p).toContain(STRATEGY_MEMORY_RULES);
    expect(p).toContain("RECENT STRATEGY MEMORY");
    expect(buildLiveChatSystemPrompt({ goal: "Fix my number" })).toContain(STRATEGY_MEMORY_RULES);
  });
});

describe("server wiring (source-level, mirrors goalCompassNotRails style)", () => {
  const src = readFileSync(join(__dirname, "..", "websocket.ts"), "utf8");

  it("per-call tracker exists and feeds every stage: guest reaction, owner speech, delivered suggestion, prompt render", () => {
    expect(src).toContain("new StrategyMemoryTracker()");
    expect(src).toContain("strategyMemory.recordGuestTurn(text)");
    expect(src).toContain("strategyMemory.recordOwnerTurn(text)");
    expect(src).toContain("strategyMemory.recordSuggestion(");
    expect(src).toContain("strategyMemory.render()");
  });

  it("only DELIVERED suggestions are recorded (recordSuggestion sits after the sent broadcast, alongside latencyRecorder.sent)", () => {
    const sentIdx = src.indexOf('latencyRecorder.sent(utteranceId, translated.suggestion.en)');
    // The GUEST-turn recordSuggestion must sit after the sent broadcast. The
    // ask-refine bridge (pushHint) has its own earlier recordSuggestion, which
    // also records only after its uiBroadcast — search from sentIdx onward.
    const recIdx = src.indexOf("strategyMemory.recordSuggestion(", sentIdx);
    expect(sentIdx).toBeGreaterThan(-1);
    expect(recIdx).toBeGreaterThan(sentIdx);
  });

  it("golden-prompt paths (realtime init + ask-assistant) carry STRATEGY_MEMORY_RULES", () => {
    expect((src.match(/STRATEGY_MEMORY_RULES/g) || []).length).toBeGreaterThanOrEqual(3); // import + >=2 injections
  });
});

// ---------------------------------------------------------------------------
// 3. Single Terra call per Guest turn preserved; memory adds no LLM
// ---------------------------------------------------------------------------

describe("single BRAIN call per guest turn is preserved with strategy memory in the prompt", () => {
  it("routeGenerate still makes exactly one provider call for the Terra model", async () => {
    let openaiCalls = 0;
    let geminiCalls = 0;
    const memory = new StrategyMemoryTracker();
    memory.recordSuggestion("Yes, I did.", "direct");
    memory.recordGuestTurn("ok");
    const sys = buildLiveSystemPrompt({ ...baseOpts, strategyMemory: memory.render() });
    await routeGenerate(sys, "Guest said: \"hi\"", {
      model: "gpt-5.6-terra",
      fallbackModel: "gpt-4.1-mini",
      withGemini: async () => { geminiCalls++; return "{}"; },
      withOpenAI: async () => { openaiCalls++; return '{"translation":"","suggestion":{"type":"direct","en":"Yes."},"sentiment":"neutral"}'; },
    });
    expect(openaiCalls).toBe(1);
    expect(geminiCalls).toBe(0);
  });

  it("strategyMemory module imports no provider/DB — pure string work", () => {
    const src = readFileSync(join(__dirname, "..", "strategyMemory.ts"), "utf8");
    expect(src).not.toMatch(/fetch\(/);
    // Only pure local imports allowed: the usage scorer and hint types.
    const imports = src.match(/^import .*$/gm) || [];
    expect(imports.every((l) => l.includes("./hintUsage") || l.includes("./hintShape"))).toBe(true);
    expect(src).not.toMatch(/\basync\b/);
  });
});
