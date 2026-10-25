import { SECRETARY_AUDIO_MODEL, SECRETARY_AUDIO_VOICE,SECRETARY_REASONING_MODEL, type SecretaryVoiceProvider } from "../secretary/voice";

/** Configuration selected for this draft, not a claim that a call has occurred. */
export function callPresentation(provider: SecretaryVoiceProvider, outgoing?: {
  fromNumber: string; scope: "personal" | "work";
  personality: { id: string; name: string; version: number } | null;
}) {
  if (provider === "retell") return {
    provider, model: "gpt-6.1-sol", reasoningModel: "gpt-6.1-sol",
    reasoning: "medium", voice: "retell-Merritt", mode: "retell_engine",
    ...(outgoing ? { outgoing } : {}),
  };
  return provider === "openai"
    ? { provider, model: SECRETARY_AUDIO_MODEL, voice: SECRETARY_AUDIO_VOICE, mode: "native_audio",reasoningModel:SECRETARY_REASONING_MODEL }
    : { provider, model: process.env.SECRETARY_REALTIME_MODEL || "gpt-realtime",
      voice: "owner_clone", mode: "cloned_speech" };
}

export const CALL_PRESENTATION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    provider: { type: "string", enum: ["openai", "retell", "elevenlabs", "cartesia"] },
    model: { type: "string" }, voice: { type: "string" },
    reasoningModel:{type:"string"},
    reasoning: { type: "string" },
    outgoing: { type: "object", additionalProperties: false, properties: {
      fromNumber: { type: "string" }, scope: { type: "string", enum: ["personal", "work"] },
      personality: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false,
        properties: { id: { type: "string" }, name: { type: "string" }, version: { type: "integer" } },
        required: ["id", "name", "version"] }] },
    }, required: ["fromNumber", "scope", "personality"] },
    mode: { type: "string", enum: ["native_audio", "cloned_speech", "retell_engine"] },
  },
  required: ["provider", "model", "voice", "mode"],
};
