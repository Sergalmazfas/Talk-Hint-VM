import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { secretaryVoiceProvider } from "./voice";
describe("Secretary-only voice defaults and pre-dial availability", () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv("OPENAI_API_KEY", "fixture-not-a-real-key"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("defaults new requests to OpenAI and preserves explicit older provider choices", () => {
    expect(secretaryVoiceProvider(undefined)).toBe("openai");
    expect(secretaryVoiceProvider("elevenlabs")).toBe("elevenlabs");
    expect(secretaryVoiceProvider("cartesia")).toBe("cartesia");
    expect(() => secretaryVoiceProvider("unknown")).toThrow();
    expect(() => secretaryVoiceProvider(null)).toThrow();
  });
  it("verifies exact model access once before dialing, without requiring a clone", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "gpt-realtime-2.1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { requireSecretaryAudioModel } = await import("./voice");
    await requireSecretaryAudioModel(); await requireSecretaryAudioModel();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/models/gpt-realtime-2.1");
  });
  it("rejects unavailable or substituted models, never silently selects ElevenLabs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "gpt-realtime" }), { status: 200 })));
    const { requireSecretaryAudioModel } = await import("./voice");
    await expect(requireSecretaryAudioModel()).rejects.toThrow(/no call was placed/);
  });
});
