import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Regression guard for the TRAINING-mode prompts.
//
// Training Mode simulates a phone call with two separate prompts:
//   1. The GST (simulated partner) prompt — must stay in character: a real
//      person on the phone, never an assistant/coach, one language, JSON out.
//   2. The HINT (TalkHint assistant) prompt — must keep coaching HON only with
//      one English suggestion + native-language translation and JSON out.
//
// Both used to be assembled inline in server/training.ts and could only be
// regression-tested by grepping source. They are now assembled by the pure,
// exported buildTrainingGstSystemPrompt / buildTrainingHintSystemPrompt in
// shared/prompts.ts, so we assert against the REAL assembled string (resilient
// to whitespace/wording shifts) instead of the source file. We also verify the
// language placeholders are fully resolved (no leftover {CONVERSATION_LANGUAGE}
// / {HINT_LANGUAGE}).
// ---------------------------------------------------------------------------

const {
  buildTrainingGstSystemPrompt,
  buildTrainingHintSystemPrompt,
  TRAINING_GST_SYSTEM_PROMPT_TEMPLATE,
  TRAINING_HINT_SYSTEM_PROMPT_TEMPLATE,
} = await import("@shared/prompts");

describe("training-mode GST (simulated partner) prompt", () => {
  it("keeps the in-character guardrails", () => {
    const prompt = buildTrainingGstSystemPrompt({ conversationLanguage: "en" });
    expect(prompt).toContain(
      "You are the conversation partner (GST) in a TalkHint training call.",
    );
    expect(prompt).toContain(
      "You are NOT an assistant, NOT a coach, NOT a teacher, and NOT ChatGPT.",
    );
    expect(prompt).toContain("Mentioning goals, hints, training, AI, or the system");
    expect(prompt).toContain('"gst_text"');
  });

  it("resolves the conversation language placeholder", () => {
    const prompt = buildTrainingGstSystemPrompt({ conversationLanguage: "en" });
    expect(prompt).toContain("You MUST speak ONLY in English");
    expect(prompt).not.toContain("{CONVERSATION_LANGUAGE}");
    // template itself still carries the placeholder
    expect(TRAINING_GST_SYSTEM_PROMPT_TEMPLATE).toContain("{CONVERSATION_LANGUAGE}");
  });

  it("defaults to English when no language is given", () => {
    const prompt = buildTrainingGstSystemPrompt();
    expect(prompt).toContain("You MUST speak ONLY in English");
    expect(prompt).not.toContain("{CONVERSATION_LANGUAGE}");
  });
});

describe("training-mode HINT (TalkHint assistant) prompt", () => {
  it("keeps the assistant guardrails", () => {
    const prompt = buildTrainingHintSystemPrompt({ hintLanguage: "ru" });
    expect(prompt).toContain(
      "You are TalkHint, an AI assistant that helps users during phone calls.",
    );
    expect(prompt).toContain("You DO NOT speak in the conversation. You only provide hints.");
    expect(prompt).toContain('"suggestion_for_hon"');
    expect(prompt).toContain('"achieved": false');
  });

  it("resolves the hint language placeholder per language", () => {
    const ru = buildTrainingHintSystemPrompt({ hintLanguage: "ru" });
    expect(ru).toContain("user's native language (Russian)");
    expect(ru).not.toContain("{HINT_LANGUAGE}");

    const es = buildTrainingHintSystemPrompt({ hintLanguage: "es" });
    expect(es).toContain("user's native language (Spanish)");
    expect(es).not.toContain("{HINT_LANGUAGE}");

    // template itself still carries the placeholder
    expect(TRAINING_HINT_SYSTEM_PROMPT_TEMPLATE).toContain("{HINT_LANGUAGE}");
  });

  it("defaults to Russian when no language is given", () => {
    const prompt = buildTrainingHintSystemPrompt();
    expect(prompt).toContain("user's native language (Russian)");
    expect(prompt).not.toContain("{HINT_LANGUAGE}");
  });
});
