import { SecretaryLab } from "./service";
import { confirmedSecretaryOwnerName } from "../secretary/ownerIdentity";
import { handleSecretaryTwilioStream } from "../secretary/agent";
import { getClone, getCartesiaClone } from "../voiceLab/store";
import { requireReadyTranslatorClone } from "../translation/cloneSpeech";
import { translateTextSubtitle } from "../translation/textSubtitle";
import { OpenAILabRealtime } from "./openAIRealtime";
import { requireSecretaryAudioModel,SECRETARY_AUDIO_MODEL as LAB_REALTIME_MODEL,SECRETARY_AUDIO_VOICE as LAB_REALTIME_VOICE } from "../secretary/voice";

let modelCheck: Promise<{ ready: boolean; reason?: string }> | undefined;
let modelCheckedAt = 0;
function availability() {
  if (process.env.NODE_ENV !== "development") return Promise.resolve({ ready: false, reason: "OpenAI comparison is Dev-only" });
  if (!modelCheck || Date.now() - modelCheckedAt > 60_000) {
    modelCheckedAt = Date.now(); modelCheck = requireSecretaryAudioModel().then(()=>({ready:true}))
      .catch(()=>({ready:false,reason:"GPT-Live 1 / gpt-6.1-sol access unconfirmed; no fallback"}));
  }
  return modelCheck;
}

/** Does not import the telephone dialer, tasks worker or call storage. */
export const secretaryLab = new SecretaryLab({
  startEngine: handleSecretaryTwilioStream,
  context: async (ownerId, voiceProvider) => {
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI unavailable");
    if(voiceProvider==="openai")return{ownerId,ownerName:confirmedSecretaryOwnerName(ownerId),voiceProvider,cloneVoiceId:""};
    const clone = await (voiceProvider === "cartesia" ? getCartesiaClone(ownerId) : getClone(ownerId));
    const cloneVoiceId = requireReadyTranslatorClone(voiceProvider, clone,
      voiceProvider === "cartesia" ? process.env.CARTESIA_API_KEY : process.env.ELEVENLABS_API_KEY);
    return { ownerId, ownerName: confirmedSecretaryOwnerName(ownerId), voiceProvider, cloneVoiceId };
  },
  translate: text => translateTextSubtitle(text, "ru"),
  openAI: process.env.NODE_ENV === "development" ? {
    isAvailable: async () => (await availability()).ready,
    create: (owner, instruction, callbacks) => new OpenAILabRealtime(owner, instruction, callbacks),
  } : undefined,
  onEnd: report => console.info("[SecretaryLab] ended", JSON.stringify({
    session: report.id, reason: report.reason, guestTurns: report.metrics.guestTurns,
    secretaryTurns: report.metrics.secretaryTurns,
    // No transcript, audio, owner identity, ticket or voice identifier in logs.
    lastStage: report.events.at(-2)?.type ?? "unknown",
  })),
});
// Periodic cleanup prevents untouched reports retaining text indefinitely.
setInterval(() => secretaryLab.sweep(), 60_000).unref();

export async function secretaryLabReadiness(owner: string) {
  const [elevenlabs, cartesia, openAI] = await Promise.all([getClone(owner), getCartesiaClone(owner), availability()]);
  const status = (clone: typeof elevenlabs, configured: boolean) => ({
    ready: !!(process.env.OPENAI_API_KEY && configured && clone?.status === "ready" && clone.voiceId?.trim()),
    source: !clone || clone.status !== "ready" ? "unavailable"
      : clone.durationMs === 0 ? "linked_existing" : "sample_clone",
  });
  return {
    providers: {
      elevenlabs: status(elevenlabs, !!process.env.ELEVENLABS_API_KEY),
      cartesia: status(cartesia, !!process.env.CARTESIA_API_KEY),
      openai: { ...openAI, source: "builtin", model: LAB_REALTIME_MODEL, voice: LAB_REALTIME_VOICE,
        checkedAt: modelCheckedAt ? new Date(modelCheckedAt).toISOString() : undefined },
    },
    models: { realtime: LAB_REALTIME_MODEL, stt: "GPT-Live native EN/RU/ES" },
    limits: { durationSeconds: 300, historyMinutes: 60 },
    note: "No telephone calls. Paid AI/audio processing. No audio recording; temporary text reports expire after one hour or server restart. Linked existing voices are not proof of a personal clone.",
    sessions: secretaryLab.reports(owner),
  };
}
