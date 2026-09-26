import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSafeEnglishTranslation,
  requireReadyOwnerClone,
  synthesizeCloneSpeech,
} from "../translation/cloneSpeech";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Translator cloned speech", () => {
  it("requires a ready owner clone and configured ElevenLabs key", () => {
    expect(() => requireReadyOwnerClone(null, "key")).toThrow(/ready owner clone/);
    expect(() => requireReadyOwnerClone({ status: "creating", voiceId: "v" }, "key")).toThrow();
    expect(() => requireReadyOwnerClone({ status: "ready", voiceId: "v" }, undefined)).toThrow();
    expect(requireReadyOwnerClone({ status: "ready", voiceId: "v" }, "secret")).toBe("v");
  });

  it("accepts only non-empty English Latin translations", () => {
    expect(isSafeEnglishTranslation("Hello, how are you?")).toBe(true);
    expect(isSafeEnglishTranslation("   ")).toBe(false);
    expect(isSafeEnglishTranslation("Привет")).toBe(false);
    expect(isSafeEnglishTranslation("你好")).toBe(false);
    expect(isSafeEnglishTranslation("x".repeat(1_501))).toBe(false);
  });

  it("requests raw 24 kHz PCM from the snapshotted voice and bounds the returned stream", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-secret");
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.elevenlabs.io/v1/text-to-speech/owner%20clone/stream?output_format=pcm_24000");
      expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-secret");
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Hello there.", model_id: "eleven_multilingual_v2" });
      return new Response(new Uint8Array([1, 0, 2, 0]), {
        headers: { "content-type": "audio/pcm" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(synthesizeCloneSpeech("owner clone", "Hello there.")).resolves.toEqual(
      Buffer.from([1, 0, 2, 0]),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails closed on provider, response-format, and caller-abort errors", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    await expect(synthesizeCloneSpeech("voice", "Hello")).rejects.toThrow(/HTTP 503/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not audio", {
      headers: { "content-type": "application/json" },
    })));
    await expect(synthesizeCloneSpeech("voice", "Hello")).rejects.toThrow(/unsupported audio format/);

    const controller = new AbortController();
    controller.abort();
    await expect(synthesizeCloneSpeech("voice", "Hello", controller.signal)).rejects.toThrow(/cancelled/);
  });

  it("does not issue requests without credentials or with invalid translated text", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(synthesizeCloneSpeech("voice", "Hello")).rejects.toThrow(/not configured/);
    vi.stubEnv("ELEVENLABS_API_KEY", "key");
    await expect(synthesizeCloneSpeech("voice", "Привет")).rejects.toThrow(/invalid English translation/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});