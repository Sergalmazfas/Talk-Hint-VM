/** Secretary-only choices. Translator/Copilot defaults are intentionally separate. */
export type SecretaryVoiceProvider = "openai" | "elevenlabs" | "cartesia";
export const DEFAULT_SECRETARY_VOICE_PROVIDER: SecretaryVoiceProvider = "openai";
export const SECRETARY_AUDIO_MODEL = "gpt-realtime-2.1";
export const SECRETARY_AUDIO_VOICE = "marin";
export function secretaryVoiceProvider(value: unknown): SecretaryVoiceProvider {
  if (value === undefined) return DEFAULT_SECRETARY_VOICE_PROVIDER;
  if (value === "openai" || value === "elevenlabs" || value === "cartesia") return value;
  throw Object.assign(new Error("Choose a supported Secretary voice provider."), { status: 400 });
}
let verifiedUntil = 0;
/** Verify exact account model access BEFORE any telephone leg is created. No fallback. */
export async function requireSecretaryAudioModel(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OpenAI Secretary is not configured."), { status: 503 });
  if (Date.now() < verifiedUntil) return;
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${SECRETARY_AUDIO_MODEL}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!response.ok || (await response.json()).id !== SECRETARY_AUDIO_MODEL) throw new Error("unavailable");
    verifiedUntil = Date.now() + 60_000;
  } catch {
    throw Object.assign(new Error("gpt-realtime-2.1 access could not be verified; no call was placed. Choose another Secretary voice explicitly."), { status: 503 });
  }
}
