// Translator Realtime Spike — contract tests for the dev-only stand gating
// and the OpenAI adapter's cost/prompt helpers. No network access.
import { describe, it, expect, afterEach } from "vitest";
import { isSpikeEnabled, isValidSpikeToken } from "../translation/spike";
import {
  buildInterpreterInstructions,
  estimateTurnCostUsd,
} from "../translation/openaiRealtimeTranslator";

const ORIGINAL_ENV = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe("translator spike gating", () => {
  it("is disabled entirely in production", () => {
    process.env.NODE_ENV = "production";
    expect(isSpikeEnabled()).toBe(false);
    // Even a hypothetically correct token must be rejected in production.
    expect(isValidSpikeToken("a".repeat(48))).toBe(false);
  });

  it("rejects missing and wrong tokens in development", () => {
    process.env.NODE_ENV = "development";
    expect(isSpikeEnabled()).toBe(true);
    expect(isValidSpikeToken(null)).toBe(false);
    expect(isValidSpikeToken("")).toBe(false);
    expect(isValidSpikeToken("wrong-token")).toBe(false);
    expect(isValidSpikeToken("a".repeat(48))).toBe(false);
  });
});

describe("interpreter instructions (frozen pure-translation prompt)", () => {
  it("names both languages and forbids assistant behavior", () => {
    const p = buildInterpreterInstructions(["ru", "en"]);
    expect(p).toContain("Russian");
    expect(p).toContain("English");
    expect(p).toContain("ONLY the translation");
    expect(p).toContain("NEVER answer questions");
    expect(p).toMatch(/filler/i);
    expect(p).toMatch(/phone numbers/i);
    expect(p).toMatch(/invent/i);
  });
});

describe("estimateTurnCostUsd", () => {
  const usage = {
    input_token_details: { audio_tokens: 1000, text_tokens: 500, cached_tokens: 0 },
    output_token_details: { audio_tokens: 2000, text_tokens: 100 },
  };

  it("computes gpt-realtime pricing", () => {
    // 1000*32 + 500*4 + 2000*64 + 100*16 = 163,600 per-1M units
    expect(estimateTurnCostUsd("gpt-realtime", usage)).toBeCloseTo(0.1636, 6);
  });

  it("subtracts cached audio tokens from the full-price bucket", () => {
    const cached = {
      input_token_details: {
        audio_tokens: 1000,
        text_tokens: 0,
        cached_tokens: 400,
        cached_tokens_details: { audio_tokens: 400, text_tokens: 0 },
      },
      output_token_details: { audio_tokens: 0, text_tokens: 0 },
    };
    // 600*32 + 400*0.4 = 19,360 per-1M units
    expect(estimateTurnCostUsd("gpt-realtime", cached)).toBeCloseTo(0.01936, 6);
  });

  it("returns undefined for unknown models or missing usage", () => {
    expect(estimateTurnCostUsd("some-future-model", usage)).toBeUndefined();
    expect(estimateTurnCostUsd("gpt-realtime", undefined)).toBeUndefined();
  });

  it("matches the longest model prefix (mini vs base)", () => {
    const mini = estimateTurnCostUsd("gpt-realtime-mini", usage)!;
    const base = estimateTurnCostUsd("gpt-realtime", usage)!;
    expect(mini).toBeLessThan(base);
  });
});
