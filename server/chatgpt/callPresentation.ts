import { SECRETARY_AUDIO_MODEL, SECRETARY_AUDIO_VOICE, type SecretaryVoiceProvider } from "../secretary/voice";

/** Configuration selected for this draft, not a claim that a call has occurred. */
export function callPresentation(provider: SecretaryVoiceProvider) {
  return provider === "openai"
    ? { provider, model: SECRETARY_AUDIO_MODEL, voice: SECRETARY_AUDIO_VOICE, mode: "native_audio" }
    : { provider, model: process.env.SECRETARY_REALTIME_MODEL || "gpt-realtime",
      voice: "owner_clone", mode: "cloned_speech" };
}

export const CALL_PRESENTATION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    provider: { type: "string", enum: ["openai", "elevenlabs", "cartesia"] },
    model: { type: "string" }, voice: { type: "string" },
    mode: { type: "string", enum: ["native_audio", "cloned_speech"] },
  },
  required: ["provider", "model", "voice", "mode"],
};
