import type { WebSocket } from "ws";
import { openaiRealtimeTranslationProvider } from "./translation/openaiRealtimeTranslator";
import type { RealtimeTranslationSession, TranslationEvent } from "./translation/provider";
import { storage } from "./storage";
import { db } from "./db";
import { pendingCalls } from "@shared/schema";
import { and, eq } from "drizzle-orm";

export const COPILOT_LANGUAGES = ["ru", "es", "uk", "kk"] as const;
const RATES = new Set([8000, 16000, 24000, 44100, 48000]);
const MAX_AUDIO_BYTES = 512 * 1024;
const MAX_SECONDS = 60 * 60 * 2;
// Must exceed the provider's server_vad silence_duration_ms (500ms).
const SILENCE_MS = 600;
const activeUsers = new Set<string>();

type Direction = "guest" | "private" | "owner";
type ClientMessage = { type: string; [key: string]: unknown };

export function authorizeCopilotCall(userId: string, call: any, pending: any): boolean {
  if (call && call.userId === userId && call.status === "active" &&
      call.metadata && typeof call.metadata === "object" && call.metadata.mode === "copilot") return true;
  return !!(pending && pending.userId === userId && pending.status === "accepted" &&
    pending.clientType === "ios_copilot");
}

export async function lookupAuthorizedCopilotCall(userId: string, callSid: string): Promise<boolean> {
  const call = await storage.getCallByCallSid(callSid);
  if (authorizeCopilotCall(userId, call, undefined)) return true;
  const [pending] = await db.select().from(pendingCalls)
    .where(and(eq(pendingCalls.callSid, callSid), eq(pendingCalls.userId, userId)));
  return authorizeCopilotCall(userId, undefined, pending);
}

// Linear interpolation is deliberately used rather than frame replication: a
// declared 8/16/44.1/48k input must not be sent to the provider as 24k.
export function resamplePcm16Mono(input: Buffer, fromHz: number, toHz = 24000): Buffer {
  if (fromHz === toHz) return Buffer.from(input);
  const samples = Math.floor(input.length / 2);
  const outSamples = Math.max(1, Math.round(samples * toHz / fromHz));
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const pos = i * (samples - 1) / Math.max(1, outSamples - 1);
    const lo = Math.floor(pos), hi = Math.min(samples - 1, lo + 1);
    const f = pos - lo;
    const value = Math.round(input.readInt16LE(lo * 2) * (1 - f) + input.readInt16LE(hi * 2) * f);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2);
  }
  return out;
}

function send(ws: WebSocket, value: object) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(value));
}
function fail(ws: WebSocket, code: string, message: string) {
  send(ws, { type: "error", code, message });
}
function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validCallSid(value: unknown): value is string {
  return typeof value === "string" && /^CA[0-9a-f]{32}$/i.test(value);
}
function validBase64(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_AUDIO_BYTES * 2 &&
    value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export function createCopilotStream(ws: WebSocket, _userId: string, authorize = lookupAuthorizedCopilotCall): void {
  if (activeUsers.has(_userId)) {
    fail(ws, "concurrency", "A Copilot session is already active");
    ws.close();
    return;
  }
  activeUsers.add(_userId);
  let started = false;
  let authorizing = false;
  let closed = false;
  let rate = 0;
  let totalBytes = 0;
  let activeHold: string | undefined;
  let endedHoldCandidate: string | undefined;
  let activeHoldHasAudio = false;
  const sessions: Partial<Record<Direction, RealtimeTranslationSession>> = {};
  const ready = new Set<Direction>();
  let readySent = false;
  let wantsConversationFeed = false;
  const responseHolds = new Map<string, string>();
  const privateItems = new Map<string, string>();
  const responseItems = new Map<string, string>();
  const startedAt = Date.now();

  const shutdown = () => {
    if (closed) return;
    closed = true;
    activeUsers.delete(_userId);
    for (const session of Object.values(sessions)) {
      try { session?.cancel(); } catch {}
    }
  };
  const event = (direction: Direction, ev: TranslationEvent) => {
    if (closed) return;
    if (ev.type === "input_committed" && direction === "private" && ev.itemId) {
      const holdId = (activeHoldHasAudio ? activeHold : undefined) ?? endedHoldCandidate;
      if (holdId) privateItems.set(ev.itemId, holdId);
    }
    if (ev.type === "response_created" && ev.responseId && ev.sourceItemId) {
      responseItems.set(ev.responseId, ev.sourceItemId);
    }
    if (ev.type === "response_created" && direction === "private" && ev.responseId) {
      // The provider may report response.created after the UI has released
      // PTT. A candidate is safe only when no newer hold has started.
      const holdId = (ev.sourceItemId ? privateItems.get(ev.sourceItemId) : undefined)
        ?? ((activeHoldHasAudio ? activeHold : undefined) ?? endedHoldCandidate);
      if (holdId) {
        responseHolds.set(ev.responseId, holdId);
        endedHoldCandidate = undefined;
      }
    } else if (ev.type === "source_transcript") {
      if (direction === "private") {
        const holdId = ev.itemId ? privateItems.get(ev.itemId) : undefined;
        if (holdId) send(ws, { type: "source_text", direction, text: ev.text, holdId });
      } else {
        send(ws, { type: "source_text", direction, text: ev.text, itemId: ev.itemId });
      }
    } else if (ev.type === "translated_transcript_delta") {
      if (direction === "owner") return;
      const holdId = direction === "private" ? (ev.responseId ? responseHolds.get(ev.responseId) : undefined) : undefined;
      if (direction === "private" && !holdId) return;
      send(ws, { type: "text_delta", direction, text: ev.text, responseId: ev.responseId,
        itemId: ev.responseId ? responseItems.get(ev.responseId) : undefined, holdId });
    } else if (ev.type === "translated_transcript_done") {
      if (direction === "owner") return;
      const holdId = direction === "private" ? (ev.responseId ? responseHolds.get(ev.responseId) : undefined) : undefined;
      if (direction === "private" && !holdId) return;
      send(ws, { type: "text_done", direction, text: ev.text, responseId: ev.responseId,
        itemId: ev.responseId ? responseItems.get(ev.responseId) : undefined, holdId });
      if (ev.responseId) {
        responseHolds.delete(ev.responseId);
        responseItems.delete(ev.responseId);
      }
    } else if (ev.type === "ready") {
      ready.add(direction);
      if (ready.size === (wantsConversationFeed ? 3 : 2) && !readySent) {
        readySent = true;
        send(ws, wantsConversationFeed
          ? { type: "ready", capabilities: ["owner_transcript", "conversation_source"] }
          : { type: "ready" });
      }
    } else if (ev.type === "error" && ev.fatal) {
      // Translation failure is isolated: it must not tear down the ordinary call.
      fail(ws, "provider_error", "Copilot translation is unavailable");
    }
  };

  ws.on("message", async (raw) => {
    const rawBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as any);
    if (closed || rawBuffer.length > MAX_AUDIO_BYTES * 2) { fail(ws, "oversize", "Message is too large"); return; }
    let msg: ClientMessage;
    try { msg = JSON.parse(rawBuffer.toString()); } catch { fail(ws, "format", "Message must be JSON"); return; }
    if (!msg || typeof msg.type !== "string") { fail(ws, "format", "Invalid message"); return; }
    if (msg.type === "start") {
      if (started) { fail(ws, "replay", "Start was already received"); return; }
      if (!validCallSid(msg.callSid)) { fail(ws, "call_sid", "Invalid Twilio CallSid"); ws.close(); return; }
      if (!COPILOT_LANGUAGES.includes(msg.language as any)) { fail(ws, "language", "Unsupported language"); return; }
      if (typeof msg.sampleRateHz !== "number" || !RATES.has(msg.sampleRateHz)) { fail(ws, "rate", "Unsupported sample rate"); return; }
      if (authorizing) { fail(ws, "replay", "Start is already being authorized"); return; }
      authorizing = true;
      try {
        if (!await authorize(_userId, msg.callSid)) {
          fail(ws, "call_unauthorized", "Call is not an active Copilot call");
          shutdown(); ws.close(); return;
        }
      } catch {
        fail(ws, "call_unauthorized", "Call authorization unavailable");
        shutdown(); ws.close(); return;
      }
      if (closed) return;
      authorizing = false;
      started = true; rate = msg.sampleRateHz;
      wantsConversationFeed = msg.conversationFeed === true;
      const language = msg.language as string;
      let guest: RealtimeTranslationSession | undefined;
      let privateSession: RealtimeTranslationSession | undefined;
      let owner: RealtimeTranslationSession | undefined;
      try {
        const results = await Promise.allSettled([
          openaiRealtimeTranslationProvider.startSession({ languages: ["en", language], outputLanguage: language, outputMode: "text", inputFormat: { encoding: "pcm16", sampleRateHz: 24000 }, outputFormat: { encoding: "pcm16", sampleRateHz: 24000 } }),
          openaiRealtimeTranslationProvider.startSession({ languages: [language, "en"], outputLanguage: "en", outputMode: "text", inputFormat: { encoding: "pcm16", sampleRateHz: 24000 }, outputFormat: { encoding: "pcm16", sampleRateHz: 24000 } }),
          wantsConversationFeed
            ? openaiRealtimeTranslationProvider.startSession({ languages: ["en", "en"], outputLanguage: "en", outputMode: "text", inputFormat: { encoding: "pcm16", sampleRateHz: 24000 }, outputFormat: { encoding: "pcm16", sampleRateHz: 24000 } })
            : Promise.resolve(undefined),
        ]);
        if (results[0].status === "fulfilled") guest = results[0].value;
        if (results[1].status === "fulfilled") privateSession = results[1].value;
        if (results[2].status === "fulfilled") owner = results[2].value;
        if (!guest || !privateSession || (wantsConversationFeed && !owner)) throw new Error("provider session startup failed");
        sessions.guest = guest; sessions.private = privateSession; sessions.owner = owner;
        guest.onEvent(ev => event("guest", ev)); privateSession.onEvent(ev => event("private", ev));
        owner?.onEvent(ev => event("owner", ev));
      } catch {
        for (const session of [guest, privateSession, owner]) {
          try { session?.cancel(); } catch {}
        }
        fail(ws, "provider_error", "Copilot translation is unavailable");
        shutdown();
      }
      return;
    }
    if (!started) { fail(ws, "not_started", "Start is required"); return; }
    if (msg.type === "hold_start") {
      if (typeof msg.holdId !== "string" || msg.holdId.length < 1 || msg.holdId.length > 128) { fail(ws, "hold_id", "Invalid holdId"); return; }
      if (activeHold) { fail(ws, "hold", "A hold is already active"); return; }
      activeHold = msg.holdId; activeHoldHasAudio = false; endedHoldCandidate = undefined;
      // Close the previous public utterance without mixing it into the
      // private translator's input. Both sessions remain isolated.
      sessions.owner?.sendAudio(Buffer.alloc(Math.round(24000 * SILENCE_MS / 1000) * 2));
      send(ws, { type: "hold_ready", holdId: activeHold }); return;
    }
    if (msg.type === "hold_end") {
      if (!activeHold || msg.holdId !== activeHold) { fail(ws, "hold", "Unknown holdId"); return; }
      // A short tail lets server VAD commit the final words without ending the session.
      sessions.private?.sendAudio(Buffer.alloc(Math.round(24000 * SILENCE_MS / 1000) * 2));
      endedHoldCandidate = activeHoldHasAudio ? activeHold : undefined;
      send(ws, { type: "hold_end_ack", holdId: activeHold }); activeHold = undefined; return;
    }
    if (msg.type === "audio") {
      if (msg.direction !== "guest" && msg.direction !== "private" && msg.direction !== "owner") { fail(ws, "direction", "Invalid direction"); return; }
      if (!validBase64(msg.pcm16) || !Buffer.from(msg.pcm16, "base64").length) { fail(ws, "audio", "Invalid PCM16"); return; }
      const source = Buffer.from(msg.pcm16, "base64");
      if (source.length % 2) { fail(ws, "audio", "PCM16 must contain whole samples"); return; }
      if (msg.direction === "private" && (!activeHold || msg.holdId !== activeHold)) { fail(ws, "hold", "Private audio requires the matching hold"); return; }
      // A pre-hold public frame can already be queued behind hold_start.
      // Drop it rather than sending it to either translation session.
      if (msg.direction === "owner" && activeHold) return;
      if (msg.direction === "private") {
        endedHoldCandidate = undefined;
        activeHoldHasAudio = true;
      }
      if (Date.now() - startedAt > MAX_SECONDS * 1000 || (totalBytes += source.length) > MAX_SECONDS * rate * 2) { fail(ws, "duration", "Copilot duration limit reached"); shutdown(); return; }
      const session = sessions[msg.direction];
      if (!session) { fail(ws, "provider_error", "Translation session is unavailable"); return; }
      session.sendAudio(resamplePcm16Mono(source, rate));
      return;
    }
    fail(ws, "format", "Unknown message type");
  });
  ws.on("close", shutdown);
  ws.on("error", shutdown);
}