import { SecretaryLab } from "./service";
import { handleSecretaryTwilioStream } from "../secretary/agent";
import { getClone, getCartesiaClone } from "../voiceLab/store";
import { requireReadyTranslatorClone } from "../translation/cloneSpeech";
import { translateTextSubtitle } from "../translation/textSubtitle";

/** Does not import the telephone dialer, tasks worker or call storage. */
export const secretaryLab = new SecretaryLab({
  startEngine: handleSecretaryTwilioStream,
  context: async (ownerId, voiceProvider) => {
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI unavailable");
    const clone = await (voiceProvider === "cartesia" ? getCartesiaClone(ownerId) : getClone(ownerId));
    const cloneVoiceId = requireReadyTranslatorClone(voiceProvider, clone,
      voiceProvider === "cartesia" ? process.env.CARTESIA_API_KEY : process.env.ELEVENLABS_API_KEY);
    return { ownerId, voiceProvider, cloneVoiceId };
  },
  translate: text => translateTextSubtitle(text, "ru"),
});
// Periodic cleanup prevents untouched reports retaining text indefinitely.
setInterval(() => secretaryLab.sweep(), 60_000).unref();

export async function secretaryLabReadiness(owner: string) {
  const [elevenlabs, cartesia] = await Promise.all([getClone(owner), getCartesiaClone(owner)]);
  const status = (clone: typeof elevenlabs, configured: boolean) => ({
    ready: !!(process.env.OPENAI_API_KEY && configured && clone?.status === "ready" && clone.voiceId?.trim()),
    source: !clone || clone.status !== "ready" ? "unavailable"
      : clone.durationMs === 0 ? "linked_existing" : "sample_clone",
  });
  return {
    providers: {
      elevenlabs: status(elevenlabs, !!process.env.ELEVENLABS_API_KEY),
      cartesia: status(cartesia, !!process.env.CARTESIA_API_KEY),
    },
    models: { realtime: process.env.SECRETARY_REALTIME_MODEL || "gpt-realtime", stt: "gpt-4o-mini-transcribe" },
    limits: { durationSeconds: 300, historyMinutes: 60 },
    note: "No telephone calls. Paid AI/audio processing. No audio recording; temporary text reports expire after one hour or server restart. Linked existing voices are not proof of a personal clone.",
    sessions: secretaryLab.reports(owner),
  };
}
