import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSafeEnglishTranslation,
  requireReadyOwnerClone,
  requireReadyTranslatorClone,
  resolveTranslatorCloneProvider,
  synthesizeCartesiaCloneSpeech,
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

  it("selects only the two closed translator providers and requires the matching clone and key", () => {
    expect(resolveTranslatorCloneProvider("cartesia")).toBe("cartesia");
    expect(resolveTranslatorCloneProvider("elevenlabs")).toBe("elevenlabs");
    expect(resolveTranslatorCloneProvider("unknown")).toBe("elevenlabs");
    expect(requireReadyTranslatorClone("elevenlabs", { status: "ready", voiceId: "eleven" }, "key")).toBe("eleven");
    expect(requireReadyTranslatorClone("cartesia", { status: "ready", voiceId: "cartesia" }, "key")).toBe("cartesia");
    expect(() => requireReadyTranslatorClone("cartesia", null, "key")).toThrow(/Cartesia clone/);
    expect(() => requireReadyTranslatorClone("cartesia", { status: "ready", voiceId: "cartesia" }, undefined)).toThrow(/Cartesia service/);
    expect(() => requireReadyTranslatorClone("elevenlabs", { status: "ready", voiceId: "eleven" }, undefined)).toThrow(/ElevenLabs service/);
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

  it("requests bounded raw signed 24 kHz PCM from the selected Cartesia clone", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "test-cartesia-key");
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.cartesia.ai/tts/bytes");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-cartesia-key");
      expect(new Headers(init?.headers).get("Cartesia-Version")).toBe("2026-08-14");
      expect(JSON.parse(String(init?.body))).toEqual({
        model_id: "sonic-3.6", transcript: "Hello there.",
        voice: { mode: "id", id: "cartesia-clone" }, locale: "en",
        output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24_000 },
      });
      return new Response(new Uint8Array([1, 0, 2, 0]), { headers: { "content-type": "audio/raw" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(synthesizeCartesiaCloneSpeech("cartesia-clone", "Hello there.")).resolves.toEqual(
      Buffer.from([1, 0, 2, 0]),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails closed on Cartesia credentials, format, odd PCM, and provider failures", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("CARTESIA_API_KEY", "");
    await expect(synthesizeCartesiaCloneSpeech("voice", "Hello")).rejects.toThrow(/Cartesia is not configured/);
    vi.stubEnv("CARTESIA_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    await expect(synthesizeCartesiaCloneSpeech("voice", "Hello")).rejects.toThrow(/HTTP 503/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", {
      headers: { "content-type": "application/json" },
    })));
    await expect(synthesizeCartesiaCloneSpeech("voice", "Hello")).rejects.toThrow(/unsupported audio format/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 0]))));
    await expect(synthesizeCartesiaCloneSpeech("voice", "Hello")).rejects.toThrow(/unsupported audio format/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), {
      headers: { "content-type": "audio/raw" },
    })));
    await expect(synthesizeCartesiaCloneSpeech("voice", "Hello")).rejects.toThrow(/invalid PCM/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(720_001), {
      headers: { "content-type": "audio/raw" },
    })));
    await expect(synthesizeCartesiaCloneSpeech("voice", "Hello")).rejects.toThrow(/exceeded the call limit/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});