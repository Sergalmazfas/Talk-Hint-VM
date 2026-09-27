import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeSubtitleTranslationCount,
  queuedSubtitleTranslationCount,
  translateTextSubtitle,
} from "./textSubtitle";

describe("bounded text subtitles", () => {
  const priorKey = process.env.OPENAI_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorKey;
  });

  it.each([
    ["ru", "Russian"],
    ["es", "Spanish"],
  ] as const)("requests text-only %s translation", async (language, languageName) => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: " translated text " } }] }),
    });
    vi.stubGlobal("fetch", fetch);

    await expect(translateTextSubtitle("hello caller", language)).resolves.toEqual({ translation: "translated text" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain(languageName);
    expect(body.messages[1].content).toBe("hello caller");
  });

  it("returns no invented subtitle if provider fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    await expect(translateTextSubtitle("hello caller", "ru")).resolves.toEqual({
      unavailableReason: "provider_error",
    });
  });

  it("does not make a provider request without configuration or source text", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(translateTextSubtitle("hello caller", "ru")).resolves.toEqual({
      unavailableReason: "not_configured",
    });
    process.env.OPENAI_API_KEY = "test-key";
    await expect(translateTextSubtitle("  ", "es")).resolves.toMatchObject({
      unavailableReason: "provider_error",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("queues fairly at concurrency eight and reports a full bounded queue", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn(async () => {
      await gate;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "translated" } }] }),
      };
    });
    vi.stubGlobal("fetch", fetch);

    const jobs = Array.from({ length: 248 }, () => translateTextSubtitle("hello", "ru"));
    expect(activeSubtitleTranslationCount()).toBe(8);
    expect(queuedSubtitleTranslationCount()).toBe(240);
    await expect(translateTextSubtitle("later turn", "ru")).resolves.toEqual({
      unavailableReason: "queue_full",
    });
    release();
    const results = await Promise.all(jobs);
    expect(results.every((result) => result.translation === "translated")).toBe(true);
    expect(activeSubtitleTranslationCount()).toBe(0);
    expect(queuedSubtitleTranslationCount()).toBe(0);
  });
});