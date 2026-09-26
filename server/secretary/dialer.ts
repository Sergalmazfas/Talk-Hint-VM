import twilio from "twilio";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { phoneNumbers } from "@shared/schema";
import { storage } from "../storage";
import { resolveProductionBaseUrl } from "../baseUrl";
import { getClone, getCartesiaClone } from "../voiceLab/store";
import { requireReadyTranslatorClone, type TranslatorCloneProvider } from "../translation/cloneSpeech";

export interface SecretaryDialJob {
  id: string;
  userId: string;
  phoneNumber: string;
  voiceProvider: string;
}

// Twilio needs a public HTTPS callback. Never derive this from a client Host
// header: an attacker must not be able to redirect signed voice callbacks.
export function secretaryCallbackOrigin(): string {
  if (process.env.NODE_ENV === "production") {
    const origin = resolveProductionBaseUrl();
    if (!origin) throw new Error("Secretary calling is unavailable: production callback URL is not configured");
    return origin;
  }
  const devHost = process.env.REPLIT_DEV_DOMAIN;
  if (!devHost) throw new Error("Secretary calling is unavailable: development callback host is not configured");
  return `https://${devHost}`;
}

export async function dialSecretaryTask(job: SecretaryDialJob): Promise<{ sid: string; callId: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio calling is not configured");
  const voiceProvider: TranslatorCloneProvider = job.voiceProvider === "cartesia" ? "cartesia" : "elevenlabs";
  const clone = await (voiceProvider === "cartesia" ? getCartesiaClone(job.userId) : getClone(job.userId));
  requireReadyTranslatorClone(
    voiceProvider,
    clone,
    voiceProvider === "cartesia" ? process.env.CARTESIA_API_KEY : process.env.ELEVENLABS_API_KEY,
  );
  if (!process.env.OPENAI_API_KEY) throw new Error("Secretary conversation model is not configured");
  const [number] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.userId, job.userId)).limit(1);
  if (!number) throw new Error("Assign a TalkHint phone number before starting a Secretary call");
  const origin = secretaryCallbackOrigin();
  const params = new URLSearchParams({ taskId: job.id });
  const client = twilio(accountSid, authToken);
  const created = await client.calls.create({
    to: job.phoneNumber,
    from: number.twilioNumber,
    url: `${origin}/twilio/secretary/voice?${params}`,
    method: "POST",
    statusCallback: `${origin}/twilio/secretary/status?${params}`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    timeout: 30,
    timeLimit: 300,
    record: false,
  });
  // The REST create response is the authoritative SID for this task. If the
  // subsequent history write fails, the worker must NOT redial an ambiguous
  // call; it will report an error and remain in its single-use starting state.
  const existing = await storage.getCallByCallSid(created.sid);
  const call = existing ?? await storage.createCall({
    userId: job.userId,
    callSid: created.sid,
    fromNumber: number.twilioNumber,
    toNumber: job.phoneNumber,
    direction: "outgoing",
    status: "ringing",
    transcript: "",
    metadata: { mode: "secretary", secretaryTaskId: job.id },
  });
  return { sid: created.sid, callId: call.id };
}