// LIVE Hint Policy v2.1 — Adaptive Hint Types (Task #234).
//
// Two layers under test, both deterministic (no model call anywhere):
//  1. Prompt layer: ADAPTIVE_HINT_TYPE_RULES is part of the REAL assembled
//     live prompt (both translate ON/OFF branches), carries the canonical
//     policy scenarios (DIRECT confirmed-fact, CHOICE unknown SMS code,
//     USER_INPUT SSN placeholder, STRATEGIC negotiation, known-state
//     precedence, unknown physical action / eSIM), the adaptive-length and
//     unknown-state rules, and the extended JSON schema — while every
//     pre-existing layer (grounding / goal-priority / anti-loop) remains.
//  2. Parser layer: normalizeSuggestion validates type/options/native_helper,
//     applies the per-user translation gate to ALL new fields, and composes
//     the backward-compatible en/translation for CHOICE so old clients never
//     render an empty card and never crash on the new types.
//
// Single-BRAIN-call guarantee: normalizeSuggestion is pure string work on the
// one existing model reply; routeGenerate's "exactly one provider call for a
// non-gemini model" is asserted here too so v2.1 can't silently add a second
// critical-path LLM request.

import { describe, it, expect } from "vitest";

const { ADAPTIVE_HINT_TYPE_RULES, buildLiveSystemPrompt, LIVE_GROUNDING_RULES, GOAL_PRIORITY_RULES, LIVE_ANTI_LOOP_RULES } = await import("@shared/prompts");
const { normalizeSuggestion, composeChoiceCompat, redactSensitive } = await import("../hintShape");
const { routeGenerate } = await import("../hintProvider");

const baseOpts = { goal: "Transfer my number to an eSIM", conversationContext: "", contextSections: "" };

describe("ADAPTIVE_HINT_TYPE_RULES content (canonical policy scenarios)", () => {
  it("DIRECT: confirmed fact -> shortest reply, no CHOICE", () => {
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/DIRECT — the answer is already known/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toContain('"Yes, I did."');
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/FEW words, not the maximum/);
    // Known-state precedence: confirmed fact must be DIRECT, never CHOICE.
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/If the fact IS confirmed — use DIRECT, never CHOICE/);
  });

  it("CHOICE: unconfirmed SMS code -> yes/no alternatives, no invented fact", () => {
    expect(ADAPTIVE_HINT_TYPE_RULES).toContain("Did you receive the SMS code?");
    expect(ADAPTIVE_HINT_TYPE_RULES).toContain('"Yes, I got it."');
    expect(ADAPTIVE_HINT_TYPE_RULES).toContain('"No, not yet."');
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/mutually exclusive alternatives/);
  });

  it("USER_INPUT: SSN -> placeholder + native helper, never a generated value", () => {
    expect(ADAPTIVE_HINT_TYPE_RULES).toContain("What's your Social Security number?");
    expect(ADAPTIVE_HINT_TYPE_RULES).toContain("Sure, it's [your SSN].");
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/NEVER output a real SSN, PIN, verification code, full account number, or card number/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/even if such a value appeared earlier in the conversation or context/);
    // Non-sensitive confirmed substitution is explicitly preserved.
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/Non-sensitive confirmed values .* may still be filled in as before/);
  });

  it("CHOICE vs USER_INPUT boundary (press Install eSIM vs is the eSIM installed)", () => {
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/BOUNDARY vs CHOICE/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/"press Install eSIM" -> user_input/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/"is the eSIM installed\?" unconfirmed -> choice/);
  });

  it("STRATEGIC: only for explanation/negotiation/escalation/goal advancement, still spoken", () => {
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/STRATEGIC — only when a short factual reply is not enough/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/negotiating, escalating, or materially advancing the GOAL/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/still under 25 words/);
  });

  it("unknown-state rule strengthens grounding (physically did/received/saw/owns/knows/has)", () => {
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/Never infer or guess the user's unobserved real-world state/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/physically did, received, saw, owns, knows, or currently has/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/use CHOICE or USER_INPUT instead of inventing an answer/);
  });

  it("adaptive length rule: shortest natural phrase, never long just because 25 words fit", () => {
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/Hint length must match the conversational need/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/Prefer the shortest natural phrase that lets the user continue/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/Never make a hint long just because 25 words are available/);
  });

  it("native_helper is an instruction to the user, options are not facts, GOAL rules stay authoritative", () => {
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/native_helper is an INSTRUCTION TO THE USER/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/never part of what they say to the Guest/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/NOT facts/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/never .*added to the conversation as the user's speech/);
    expect(ADAPTIVE_HINT_TYPE_RULES).toMatch(/GOAL PRIORITY RULES above remain authoritative/);
  });
});

describe("buildLiveSystemPrompt integration (both branches)", () => {
  it("translate ON: adaptive rules present alongside ALL existing layers, schema extended", () => {
    const prompt = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: true, language: "ru" });
    expect(prompt).toContain(ADAPTIVE_HINT_TYPE_RULES);
    // No existing layer was displaced.
    expect(prompt).toContain(LIVE_GROUNDING_RULES);
    expect(prompt).toContain(GOAL_PRIORITY_RULES);
    expect(prompt).toContain(LIVE_ANTI_LOOP_RULES);
    // Extended JSON instruction.
    expect(prompt).toContain('"type":"direct|choice|user_input|strategic"');
    expect(prompt).toContain('"options"');
    expect(prompt).toContain('"native_helper"');
    expect(prompt).toMatch(/Omit "options" unless type is choice/);
  });

  it("translate OFF: adaptive rules present, native_helper explicitly gated off", () => {
    const prompt = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: false });
    expect(prompt).toContain(ADAPTIVE_HINT_TYPE_RULES);
    expect(prompt).toMatch(/leave translation fields and native_helper empty/);
    expect(prompt).toMatch(/Omit "native_helper" always/);
  });

  it("native helper language follows the user's language: RU -> Russian, ES -> Spanish", () => {
    const ru = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: true, language: "ru" });
    expect(ru).toContain('"native_helper":"short instruction in Russian');
    const es = buildLiveSystemPrompt({ ...baseOpts, translateEnabled: true, language: "es" });
    expect(es).toContain('"native_helper":"short instruction in Spanish');
  });
});

describe("normalizeSuggestion — parser/validation/compat (pure, no model call)", () => {
  const on = { translateEnabled: true };
  const off = { translateEnabled: false };

  it("legacy reply (no type) keeps exact pre-v2.1 shape", () => {
    const r = normalizeSuggestion({ en: "Yes, I did.", translation: "Да, сделал." }, on);
    expect(r).toEqual({ en: "Yes, I did.", translation: "Да, сделал." });
  });

  it("unknown type is dropped, hint still usable (defensive default)", () => {
    const r = normalizeSuggestion({ type: "banana", en: "Hello.", translation: "Привет." }, on);
    expect(r?.type).toBeUndefined();
    expect(r?.en).toBe("Hello.");
  });

  it("DIRECT passes through with its type", () => {
    const r = normalizeSuggestion({ type: "direct", en: "Yes, I did.", translation: "Да." }, on);
    expect(r?.type).toBe("direct");
    expect(r?.options).toBeUndefined();
    expect(r?.nativeHelper).toBeUndefined();
  });

  it("CHOICE with empty en composes a backward-compatible en/translation from options", () => {
    const r = normalizeSuggestion({
      type: "choice",
      en: "",
      translation: "",
      options: [
        { label: "yes", en: "Yes, I got it.", translation: "Да, получил." },
        { label: "no", en: "No, not yet.", translation: "Нет, ещё нет." },
      ],
    }, on);
    expect(r?.type).toBe("choice");
    expect(r?.options).toHaveLength(2);
    // Old client reads en/translation only — must be non-empty and show both options.
    expect(r?.en).toBe('If yes: "Yes, I got it." / If no: "No, not yet."');
    expect(r?.translation).toBe('If yes: "Да, получил." / If no: "Нет, ещё нет."');
  });

  it("CHOICE filters junk options and caps at 3", () => {
    const r = normalizeSuggestion({
      type: "choice",
      options: [
        { label: "a", en: "One." }, null, { label: "b" }, { label: "c", en: "Two." },
        { label: "d", en: "Three." }, { label: "e", en: "Four." },
      ],
    }, on);
    expect(r?.options?.map(o => o.en)).toEqual(["One.", "Two.", "Three."]);
  });

  it("malformed CHOICE (fewer than 2 usable options, no main text) fails closed — no empty card", () => {
    expect(normalizeSuggestion({ type: "choice", en: "", options: [{ label: "yes", en: "Yes." }] }, on)).toBeNull();
    expect(normalizeSuggestion({ type: "choice", en: "", options: [] }, on)).toBeNull();
  });

  it("single-option CHOICE with a main text degrades to a plain hint (option list dropped)", () => {
    const r = normalizeSuggestion({ type: "choice", en: "Yes.", options: [{ label: "yes", en: "Yes." }] }, on);
    expect(r?.en).toBe("Yes.");
    expect(r?.options).toBeUndefined();
  });

  it("USER_INPUT keeps placeholder frame + native helper; options are ignored for this type", () => {
    const r = normalizeSuggestion({
      type: "user_input",
      en: "Sure, it's [your SSN].",
      translation: "Конечно, это [ваш SSN].",
      native_helper: "Скажите свой SSN.",
      options: [{ label: "x", en: "junk" }, { label: "y", en: "junk2" }],
    }, on);
    expect(r?.type).toBe("user_input");
    expect(r?.en).toContain("[your SSN]");
    expect(r?.nativeHelper).toBe("Скажите свой SSN.");
    expect(r?.options).toBeUndefined();
  });

  it("native_helper is ignored for non-user_input types", () => {
    const r = normalizeSuggestion({ type: "direct", en: "Yes.", native_helper: "лишнее" }, on);
    expect(r?.nativeHelper).toBeUndefined();
  });

  it("Translation OFF gates EVERY translated field: translation, option translations, native_helper", () => {
    const choice = normalizeSuggestion({
      type: "choice",
      options: [
        { label: "yes", en: "Yes.", translation: "Да." },
        { label: "no", en: "No.", translation: "Нет." },
      ],
    }, off);
    expect(choice?.translation).toBe("");
    expect(choice?.options?.every(o => o.translation === "")).toBe(true);
    const input = normalizeSuggestion({ type: "user_input", en: "It's [your PIN].", translation: "x", native_helper: "Назовите PIN." }, off);
    expect(input?.translation).toBe("");
    expect(input?.nativeHelper).toBeUndefined();
  });

  it("STRATEGIC passes through as a normal typed hint", () => {
    const r = normalizeSuggestion({
      type: "strategic",
      en: "I understand, but I made those payments for August. Can you apply $317.80 to my August payment?",
      translation: "…",
    }, on);
    expect(r?.type).toBe("strategic");
    expect(r?.en).toMatch(/August/);
  });

  it("stripPreamble is applied to en/translation and option texts", () => {
    const strip = (s: string) => s.replace(/^Got it[,.]?\s*/i, "");
    const r = normalizeSuggestion({
      type: "choice",
      options: [
        { label: "yes", en: "Got it, Yes.", translation: "Да." },
        { label: "no", en: "No.", translation: "Нет." },
      ],
    }, { translateEnabled: true, stripPreamble: strip });
    expect(r?.options?.[0].en).toBe("Yes.");
  });

  it("composeChoiceCompat handles missing labels gracefully", () => {
    expect(composeChoiceCompat([
      { label: "", en: "Yes.", translation: "" },
      { label: "no", en: "No.", translation: "" },
    ], "en")).toBe('"Yes." / If no: "No."');
  });
});

describe("normalizeSuggestion — adversarial model output", () => {
  const on = { translateEnabled: true };

  it("valid CHOICE ALWAYS gets the canonical composed compat string, even when the model also sent a main reply", () => {
    const r = normalizeSuggestion({
      type: "choice",
      en: "Some arbitrary main reply the model should not have sent.",
      translation: "Произвольный ответ.",
      options: [
        { label: "yes", en: "Yes.", translation: "Да." },
        { label: "no", en: "No.", translation: "Нет." },
      ],
    }, on);
    // Dedup/telemetry/hint-usage and the legacy client all consume this same string.
    expect(r?.en).toBe('If yes: "Yes." / If no: "No."');
    expect(r?.translation).toBe('If yes: "Да." / If no: "Нет."');
  });

  it("CHOICE without option translations yields populated en and empty translation (defined legacy behavior)", () => {
    const r = normalizeSuggestion({
      type: "choice",
      options: [{ label: "yes", en: "Yes." }, { label: "no", en: "No." }],
    }, on);
    expect(r?.en).toBe('If yes: "Yes." / If no: "No."');
    expect(r?.translation).toBe("");
  });

  it("redacts an echoed SSN with separators from any hint field", () => {
    const r = normalizeSuggestion({ type: "direct", en: "Sure, it's 123-45-6789.", translation: "Это 123-45-6789." }, on);
    expect(r?.en).toBe("Sure, it's [your SSN].");
    expect(r?.translation).toBe("Это [your SSN].");
  });

  it("redacts an echoed card number from choice options", () => {
    const r = normalizeSuggestion({
      type: "choice",
      options: [
        { label: "yes", en: "Yes, card 4111 1111 1111 1111.", translation: "" },
        { label: "no", en: "No.", translation: "" },
      ],
    }, on);
    expect(r?.options?.[0].en).toBe("Yes, card [your card number].");
    expect(r?.en).not.toContain("4111");
  });

  it("user_input frames get aggressive digit redaction (echoed OTP/account instead of a placeholder)", () => {
    const r = normalizeSuggestion({
      type: "user_input",
      en: "Sure, it's 482913.",
      translation: "Это 482913.",
      native_helper: "Скажите код 482913.",
    }, on);
    expect(r?.en).toBe("Sure, it's [your number].");
    expect(r?.translation).toBe("Это [your number].");
    expect(r?.nativeHelper).toBe("Скажите код [your number].");
  });

  it("does NOT over-redact legitimate values: prices, ZIP codes, short quantities", () => {
    const r = normalizeSuggestion({ type: "strategic", en: "Can you apply $317.80 to my August payment? My ZIP is 60614.", translation: "" }, on);
    expect(r?.en).toContain("$317.80");
    expect(r?.en).toContain("60614");
  });

  it("redactSensitive: plain digit runs are only redacted in aggressive mode", () => {
    expect(redactSensitive("Code 482913")).toBe("Code 482913");
    expect(redactSensitive("Code 482913", { aggressive: true })).toBe("Code [your number]");
  });
});

describe("single BRAIN call per guest turn is preserved", () => {
  it("routeGenerate makes exactly one provider call for a non-gemini (Terra) model", async () => {
    let openaiCalls = 0;
    let geminiCalls = 0;
    await routeGenerate("sys", "user", {
      model: "gpt-5.6-terra",
      fallbackModel: "gpt-4.1-mini",
      withGemini: async () => { geminiCalls++; return "{}"; },
      withOpenAI: async () => { openaiCalls++; return '{"translation":"","suggestion":{"type":"direct","en":"Yes."},"sentiment":"neutral"}'; },
    });
    expect(openaiCalls).toBe(1);
    expect(geminiCalls).toBe(0);
  });
});
