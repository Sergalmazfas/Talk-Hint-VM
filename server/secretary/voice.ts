/** Secretary-only choices. Translator/Copilot defaults are intentionally separate. */
export type SecretaryVoiceProvider = "openai" | "retell" | "elevenlabs" | "cartesia";
// Historical decoding is not a rollout switch for unrelated callers.
export const DEFAULT_SECRETARY_VOICE_PROVIDER: SecretaryVoiceProvider = "openai";
export const SECRETARY_AUDIO_MODEL = "gpt-live-1";
export const SECRETARY_AUDIO_VOICE = "marin";
export const SECRETARY_REASONING_MODEL = "gpt-6.1-sol";
export function secretaryVoiceProvider(value: unknown): SecretaryVoiceProvider {
  if (value === undefined) return DEFAULT_SECRETARY_VOICE_PROVIDER;
  if (value === "openai" || value === "retell" || value === "elevenlabs" || value === "cartesia") return value;
  throw Object.assign(new Error("Choose a supported Secretary voice provider."), { status: 400 });
}
/** New assignments only; the decoder above remains for historical tasks. */
export function selectedSecretaryVoiceProvider(value:unknown):SecretaryVoiceProvider{
  // The updated native client explicitly sends its Retell preference. Keep
  // omitted values from older integrations backward-compatible.
  const provider=secretaryVoiceProvider(value);
  if(provider!=="openai" && provider!=="retell")throw Object.assign(new Error("New Secretary calls use Retell + Engine or GPT-Live 1 only. Refresh the call preparation; no call was placed."),{status:400});
  return provider;
}
let verifiedUntil = 0;
/** Verify exact account model access BEFORE any telephone leg is created. No fallback. */
export async function requireSecretaryAudioModel(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OpenAI Secretary is not configured."), { status: 503 });
  if (Date.now() < verifiedUntil) return;
  try {
    for(const model of [SECRETARY_AUDIO_MODEL,SECRETARY_REASONING_MODEL]){
    const response = await fetch(`https://api.openai.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!response.ok || (await response.json()).id !== model) throw new Error("unavailable");
    }
    verifiedUntil = Date.now() + 60_000;
  } catch {
    throw Object.assign(new Error("GPT-Live 1 / gpt-6.1-sol access could not be verified; no call was placed. No fallback."), { status: 503 });
  }
}
