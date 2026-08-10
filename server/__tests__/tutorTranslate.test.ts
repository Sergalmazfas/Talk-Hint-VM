// Coverage for the "Перевод" feature on tutor cards (task: translate button
// under each Emma phrase):
//   1. The /tutor page ships a translate button in each tutor card's .acts.
//   2. POST /api/tutor/translate is auth-protected (401 without a token).
//   3. Translation results are cached by normalized text (second call makes
//      NO second model call) and validation rejects bad input.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// Hermetic fakes: no Postgres / engine / OpenAI needed.
vi.mock("../db", () => ({
  db: {},
  pool: { query: async () => ({ rows: [] }) },
  dbReady: Promise.resolve(),
  isDatabaseAvailable: () => true,
  testDatabaseConnection: async () => true,
  isDevDatabase: true,
}));

const { TUTOR_AVATAR_PAGE_HTML } = await import("../tutorAvatarPage");
const {
  translateTutorText,
  validateTranslateInput,
  clearTranslationCache,
} = await import("../tutorTranslate");
const { registerTutorRoutes } = await import("../tutorRoutes");

describe("tutor card translation", () => {
  beforeEach(() => clearTranslationCache());

  it("the /tutor page renders a translate button under tutor cards", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('tr.className = "translateBtn"');
    expect(TUTOR_AVATAR_PAGE_HTML).toContain("L.translate");
    // v4 frozen design: the translate action is a lucide Languages icon +
    // localized «Перевод»/"Translate" label (no emoji/glyph icons).
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('translate: "Перевод"');
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('translate: "Translate"');
    expect(TUTOR_AVATAR_PAGE_HTML).toContain("ICONS.translate");
    // Toggling: repeated tap hides the translation box.
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('trBox.classList.remove("show")');
    // The button calls our backend, not the engine.
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('/api/tutor/translate');
  });

  it("POST /api/tutor/translate rejects unauthenticated requests", async () => {
    const app = express();
    app.use(express.json());
    registerTutorRoutes(app);
    const res = await request(app)
      .post("/api/tutor/translate")
      .send({ text: "Hello, how are you today?" });
    expect(res.status).toBe(401);
  });

  it("caches translations by normalized text — one model call for repeats", async () => {
    const generate = vi.fn(async () => "Привет, как дела?");
    const first = await translateTutorText("Hello, how are you?", generate);
    expect(first).toEqual({ translation: "Привет, как дела?", cached: false });
    const second = await translateTutorText("  hello,   how are you? ", generate);
    expect(second).toEqual({ translation: "Привет, как дела?", cached: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("fails loudly on an empty model reply (no silent fallback text)", async () => {
    await expect(translateTutorText("Hi", async () => "")).rejects.toThrow();
  });

  it("validates input: missing/empty/oversized text is rejected", () => {
    expect(validateTranslateInput({})).toBe("text_required");
    expect(validateTranslateInput({ text: "   " })).toBe("text_required");
    expect(validateTranslateInput({ text: "x".repeat(2001) })).toBe("text_too_long");
    expect(validateTranslateInput({ text: "ok" })).toBeNull();
  });
});
