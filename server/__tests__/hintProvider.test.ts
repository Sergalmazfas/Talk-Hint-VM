import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the AI provider routing + fallback (server/hintProvider.ts):
//   - routeGenerate: the gemini-first / OpenAI-fallback decision that keeps
//     live calls working when one provider degrades. This is the rule shared by
//     the live hint generator (translateAndSuggest) and the post-call
//     summarization closure in server/websocket.ts.
//   - looksLikeModelJson: the "is this output usable?" guard that decides
//     whether a Gemini reply counts as good or triggers a fallback.
// The Gemini and OpenAI calls are injected (vi.fn), so this runs with no live
// API call — consistent with the other tests.
// ---------------------------------------------------------------------------

const { routeGenerate, looksLikeModelJson } = await import("../hintProvider");

const SYSTEM = "system prompt";
const USER = "user prompt";
const FALLBACK = "gpt-4.1-mini";

const GOOD = JSON.stringify({ translation: "ok", suggestion: { en: "Sure" } });

function deps(over: Partial<Parameters<typeof routeGenerate>[2]> = {}) {
  return {
    model: "gemini-2.5-flash-lite",
    fallbackModel: FALLBACK,
    withGemini: vi.fn(async () => GOOD),
    withOpenAI: vi.fn(async () => JSON.stringify({ translation: "from openai" })),
    ...over,
  } as Parameters<typeof routeGenerate>[2];
}

describe("looksLikeModelJson", () => {
  it("accepts text containing a JSON object (even wrapped in prose/fences)", () => {
    expect(looksLikeModelJson(GOOD)).toBe(true);
    expect(looksLikeModelJson("Sure:\n```json\n{\"a\":1}\n```")).toBe(true);
  });

  it("rejects empty, null, or prose-only output", () => {
    expect(looksLikeModelJson("")).toBe(false);
    expect(looksLikeModelJson(null)).toBe(false);
    expect(looksLikeModelJson(undefined)).toBe(false);
    expect(looksLikeModelJson("I could not answer that.")).toBe(false);
  });
});

describe("routeGenerate", () => {
  it("uses Gemini for a gemini-* model when it returns good output", async () => {
    const d = deps();
    const out = await routeGenerate(SYSTEM, USER, d);

    expect(out).toBe(GOOD);
    expect(d.withGemini).toHaveBeenCalledTimes(1);
    expect(d.withGemini).toHaveBeenCalledWith("gemini-2.5-flash-lite", SYSTEM, USER);
    expect(d.withOpenAI).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI when Gemini returns empty output", async () => {
    const onFallback = vi.fn();
    const d = deps({ withGemini: vi.fn(async () => ""), onFallback });

    const out = await routeGenerate(SYSTEM, USER, d);

    expect(out).toBe(JSON.stringify({ translation: "from openai" }));
    expect(d.withGemini).toHaveBeenCalledTimes(1);
    expect(d.withOpenAI).toHaveBeenCalledTimes(1);
    expect(d.withOpenAI).toHaveBeenCalledWith(FALLBACK, SYSTEM, USER);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("falls back to OpenAI when Gemini returns unparseable (no JSON) output", async () => {
    const d = deps({ withGemini: vi.fn(async () => "sorry, no idea") });

    const out = await routeGenerate(SYSTEM, USER, d);

    expect(out).toBe(JSON.stringify({ translation: "from openai" }));
    expect(d.withOpenAI).toHaveBeenCalledWith(FALLBACK, SYSTEM, USER);
  });

  it("falls back to OpenAI when the Gemini call throws (provider error/timeout)", async () => {
    const onFallback = vi.fn();
    const d = deps({
      withGemini: vi.fn(async () => {
        throw new Error("Gemini API error: 503");
      }),
      onFallback,
    });

    const out = await routeGenerate(SYSTEM, USER, d);

    expect(out).toBe(JSON.stringify({ translation: "from openai" }));
    expect(d.withOpenAI).toHaveBeenCalledWith(FALLBACK, SYSTEM, USER);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("uses OpenAI directly (no Gemini, no fallback model) for a non-gemini model", async () => {
    const onFallback = vi.fn();
    const d = deps({ model: "gpt-4o-mini", onFallback });

    const out = await routeGenerate(SYSTEM, USER, d);

    expect(out).toBe(JSON.stringify({ translation: "from openai" }));
    expect(d.withGemini).not.toHaveBeenCalled();
    // Non-gemini routing uses the chosen model itself, not the fallback model.
    expect(d.withOpenAI).toHaveBeenCalledWith("gpt-4o-mini", SYSTEM, USER);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("respects a custom isGeminiModel classifier", async () => {
    const d = deps({
      model: "custom-llm",
      isGeminiModel: (m) => m === "custom-llm",
      withGemini: vi.fn(async () => GOOD),
    });

    const out = await routeGenerate(SYSTEM, USER, d);

    expect(out).toBe(GOOD);
    expect(d.withGemini).toHaveBeenCalledWith("custom-llm", SYSTEM, USER);
    expect(d.withOpenAI).not.toHaveBeenCalled();
  });
});
