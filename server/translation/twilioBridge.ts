// Isolated PSTN translator bridge.  It intentionally does not import the Hint
// websocket handler or Deepgram: translator calls have their own media path.
import type WebSocket from "ws";
import { openaiRealtimeTranslationProvider } from "./openaiRealtimeTranslator";
import type { RealtimeTranslationProvider, RealtimeTranslationSession, TranslationTurnMetrics } from "./provider";
import { storage } from "../storage";

const RATE = 24_000;
const MODEL = process.env.TRANSLATOR_SPIKE_MODEL || "gpt-realtime";
const MULAW_DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const x = ~i, sign = x & 0x80, exponent = (x >> 4) & 7, mantissa = x & 15;
  MULAW_DECODE[i] = (sign ? -1 : 1) * ((((mantissa << 3) + 0x84) << exponent) - 0x84);
}

export type TranslatorLeg = "owner" | "guest";
export function oppositeTranslatorLeg(leg: TranslatorLeg): TranslatorLeg {
  return leg === "owner" ? "guest" : "owner";
}
export interface TranslatorCall {
  id: string; ownerId: string; ownerCallSid: string; guestNumber: string;
  callerId: string; baseUrl: string;
}
export interface TranslatorDialer {
  createGuestLeg(call: TranslatorCall): Promise<{ sid: string }>;
  hangup?(callSid: string): Promise<void>;
}
const calls = new Map<string, TranslatorCall>();
type ActiveLeg = { ws: WebSocket; streamSid: string; session?: RealtimeTranslationSession };
type BridgeState = {
  legs: Map<TranslatorLeg, ActiveLeg>;
  turns: Array<TranslationTurnMetrics & { leg: TranslatorLeg }>;
  errors: string[];
  failed: boolean;
  finalized: boolean;
  expiresAt: number;
  startedLegs: Set<TranslatorLeg>;
  guestStartRequested: boolean;
  guestCallSid?: string;
  transcriptsByItem: Map<string, string>;
};
const activeCalls = new Map<string, BridgeState>();
const terminationHandlers = new Map<string, (failed: boolean, reason?: string) => void>();
const feedSubscribers = new Map<string, Set<WebSocket>>();
export function subscribeTranslatorFeed(userId: string, ws: WebSocket) {
  const set = feedSubscribers.get(userId) || new Set<WebSocket>();
  set.add(ws); feedSubscribers.set(userId, set);
  ws.on("close", () => { set.delete(ws); if (!set.size) feedSubscribers.delete(userId); });
}
function sendFeed(userId: string, event: object) {
  const encoded = JSON.stringify(event);
  for (const ws of Array.from(feedSubscribers.get(userId) || [])) if (ws.readyState === ws.OPEN) ws.send(encoded);
}
let dialer: TranslatorDialer | undefined;
export function configureTranslatorDialer(value: TranslatorDialer) { dialer = value; }
const CALL_TTL_MS = 5 * 60_000;
export function expireTranslatorCall(id: string): boolean {
  const state = activeCalls.get(id);
  if (state) {
    terminationHandlers.get(id)?.(true, "Translator call expired before both legs connected");
    return true;
  }
  return calls.delete(id);
}
export function registerTranslatorCall(call: TranslatorCall) {
  calls.set(call.id, call);
  const timer: any = setTimeout(() => {
    const state = activeCalls.get(call.id);
    if (state && state.expiresAt <= Date.now()) {
      expireTranslatorCall(call.id);
    } else if (!state) {
      expireTranslatorCall(call.id);
    }
  }, CALL_TTL_MS);
  timer.unref?.();
}
export function getTranslatorCall(id: string) { return calls.get(id); }
export function handleTranslatorGuestStatus(callSid: string, status: string): boolean {
  const terminal = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
  if (!terminal.has(status)) return false;
  for (const [id, state] of Array.from(activeCalls.entries())) {
    if (state.guestCallSid !== callSid) continue;
    terminationHandlers.get(id)?.(status !== "completed", `Translator guest leg ended: ${status}`);
    return true;
  }
  return false;
}
/** Read-only snapshot used by regression tests; never exposes socket objects. */
export function getTranslatorBridgeSnapshot(id: string) {
  const state = activeCalls.get(id);
  return state && { turns: state.turns.map(t => ({ ...t })), errors: [...state.errors], legCount: state.legs.size };
}

export function mulawToPcm24(payload: string): Buffer {
  const source = Buffer.from(payload, "base64"), out = Buffer.alloc(source.length * 6);
  for (let i = 0; i < source.length; i++) for (let n = 0; n < 3; n++) out.writeInt16LE(MULAW_DECODE[source[i]], (i * 3 + n) * 2);
  return out;
}
function pcm24ToMulaw(pcm: Buffer): string {
  const out = Buffer.alloc(Math.floor(pcm.length / 6));
  for (let i = 0; i < out.length; i++) {
    let sample = pcm.readInt16LE(i * 6), sign = sample < 0 ? 0x80 : 0;
    sample = Math.min(32635, Math.abs(sample)) + 132;
    const exponent = Math.max(0, Math.min(7, Math.floor(Math.log2(sample)) - 7));
    out[i] = ~(sign | (exponent << 4) | ((sample >> (exponent + 3)) & 15));
  }
  return out.toString("base64");
}

/** Pair two independently-streamed Twilio legs; audio is never echoed locally. */
export function handleTranslatorTwilioStream(
  ws: WebSocket,
  provider: RealtimeTranslationProvider = openaiRealtimeTranslationProvider,
) {
  let session: RealtimeTranslationSession | null = null;
  let streamSid = "", call: TranslatorCall | undefined, leg: TranslatorLeg | undefined;
  let socketClosed = false;
  const persist = (snapshot?: BridgeState) => {
    if (!call) return;
    const state = snapshot || activeCalls.get(call.id);
    const turns = state?.turns || [];
    const transcript = turns.map(t => `${t.leg === "owner" ? "Owner" : "Guest"}: ${t.sourceTranscript || ""}\n${t.leg === "owner" ? "Guest" : "Owner"} (translation): ${t.translatedTranscript || ""}`).join("\n");
    void storage.updateCallTranscriptByCallSid(call.ownerCallSid, transcript);
    void storage.mergeCallMetadataByCallSid(call.ownerCallSid, {
      mode: "translator", direction: "ru_en_bidirectional", provider: "openai-realtime",
      model: MODEL, translatorTurns: turns, translatorErrors: state?.errors || [],
    });
  };
  const finishBridge = (failed: boolean, reason?: string) => {
    if (!call) return;
    const state = activeCalls.get(call.id);
    if (!state || state.finalized) return;
    state.finalized = true;
    state.failed = failed;
    if (reason) state.errors.push(reason);
    if (failed && reason) {
      sendFeed(call.ownerId, { type: "error", callSid: call.ownerCallSid, message: reason, fatal: true });
    }
    for (const entry of Array.from(state.legs.values())) {
      entry.session?.cancel();
      try { entry.ws.close(failed ? 1011 : 1000, failed ? "translator failed" : "translator ended"); } catch {}
    }
    if (dialer?.hangup) {
      void dialer.hangup(call.ownerCallSid).catch(() => {});
      if (state.guestCallSid) void dialer.hangup(state.guestCallSid).catch(() => {});
    }
    persist(state);
    void storage.getCallByCallSid(call.ownerCallSid).then((record) => {
      if (record) {
        return storage.updateCall(record.id, {
          status: failed ? "failed" : "completed",
          endedAt: new Date(),
        });
      }
    });
    activeCalls.delete(call.id);
    terminationHandlers.delete(call.id);
    calls.delete(call.id);
  };
  ws.on("message", async (raw: Buffer) => {
    let msg: any; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.event === "start") {
      streamSid = msg.start?.streamSid || "";
      const p = msg.start?.customParameters || {};
      call = getTranslatorCall(p.translatorCallId);
      leg = p.translatorLeg === "owner" || p.translatorLeg === "guest" ? p.translatorLeg : undefined;
      // Unknown/unpaired legs must receive neither audio nor a provider session.
      let state = call ? activeCalls.get(call.id) : undefined;
      const startCallSid = msg.start?.callSid as string | undefined;
      if (!call || !leg || !startCallSid ||
        (leg === "owner" && startCallSid !== call.ownerCallSid) ||
        (leg === "guest" && (!state?.guestCallSid || startCallSid !== state.guestCallSid)) ||
        state?.startedLegs.has(leg) || (state && state.expiresAt < Date.now())) {
        try { ws.close(1008, "unpaired translator leg"); } catch {} return;
      }
      if (!state) {
        state = { legs: new Map(), turns: [], errors: [], failed: false, finalized: false,
          expiresAt: Date.now() + CALL_TTL_MS, startedLegs: new Set(), guestStartRequested: false, transcriptsByItem: new Map() };
        activeCalls.set(call.id, state);
      }
      if (!terminationHandlers.has(call.id)) {
        terminationHandlers.set(call.id, finishBridge);
      }
      state.startedLegs.add(leg);
      try {
        session = await provider.startSession({
          languages: ["ru", "en"], sourceLangHint: "auto",
          inputFormat: { encoding: "pcm16", sampleRateHz: RATE },
          outputFormat: { encoding: "pcm16", sampleRateHz: RATE },
        });
        // The socket may have disappeared while provider startup was in
        // flight. Never resurrect a finalized bridge or originate a PSTN leg.
        if (socketClosed || ws.readyState !== ws.OPEN || activeCalls.get(call.id) !== state || state.finalized) {
          session.cancel();
          session = null;
          return;
        }
        session.onEvent(ev => {
          const state = call ? activeCalls.get(call.id) : undefined;
          if (!state || state.failed || state.finalized) return;
          if (ev.type === "translated_audio" && call && leg) {
            // Never return a translation to its source.  A missing opposite
            // leg means drop audio (not a fallback/echo).
            const target = activeCalls.get(call.id)?.legs.get(oppositeTranslatorLeg(leg));
            if (target && target.ws.readyState === target.ws.OPEN) {
              target.ws.send(JSON.stringify({ event: "media", streamSid: target.streamSid, media: { payload: pcm24ToMulaw(Buffer.from(ev.base64, "base64")) } }));
            }
          } else if (ev.type === "source_transcript" && call && leg) {
            if (ev.itemId) {
              state?.transcriptsByItem.set(ev.itemId, ev.text);
              const completed = state?.turns.find(t => t.sourceItemId === ev.itemId);
              if (completed) { completed.sourceTranscript = ev.text; persist(); }
            }
            sendFeed(call.ownerId, { type: "source_transcript", callSid: call.ownerCallSid, leg, text: ev.text, itemId: ev.itemId });
          } else if ((ev.type === "translated_transcript_delta" || ev.type === "translated_transcript_done") && call && leg) {
            sendFeed(call.ownerId, { type: ev.type, callSid: call.ownerCallSid, leg, text: ev.text, responseId: ev.responseId });
          } else if (ev.type === "turn_completed" && leg && state && call) {
            if (ev.metrics.sourceItemId && state.transcriptsByItem.has(ev.metrics.sourceItemId)) {
              ev.metrics.sourceTranscript = state.transcriptsByItem.get(ev.metrics.sourceItemId);
            }
            state.turns.push({ ...ev.metrics, leg }); persist();
            sendFeed(call.ownerId, { type: "turn_completed", callSid: call.ownerCallSid, leg, metrics: ev.metrics });
          } else if (ev.type === "invariant_violation" && call) {
            finishBridge(true, `Translator invariant violation: ${ev.code}`);
          } else if (ev.type === "error" && call) {
            if (ev.fatal) finishBridge(true, ev.message);
            else { state?.errors.push(ev.message); persist(); sendFeed(call.ownerId, { type: "error", callSid: call.ownerCallSid, message: ev.message, fatal: false }); }
          }
        });
        state.legs.set(leg, { ws, streamSid, session });
        if (leg === "owner" && !state.guestStartRequested) {
          state.guestStartRequested = true;
          if (!dialer) throw new Error("Translator PSTN dialer is not configured");
          const guest = await dialer.createGuestLeg(call);
          if (socketClosed || ws.readyState !== ws.OPEN || activeCalls.get(call.id) !== state || state.finalized) {
            if (dialer.hangup) void dialer.hangup(guest.sid).catch(() => {});
            return;
          }
          state.guestCallSid = guest.sid;
          void storage.mergeCallMetadataByCallSid(call.ownerCallSid, { mode: "translator", guestCallSid: guest.sid });
        }
      } catch (error: any) {
        // Fail closed: teardown instead of ever falling through to Hint/Deepgram.
        const reason = error?.message || "bridge start failed";
        if (call && activeCalls.has(call.id)) {
          finishBridge(true, reason);
          try { ws.close(1011, "translator unavailable"); } catch {}
        }
        else {
          if (call) void storage.mergeCallMetadataByCallSid(call.ownerCallSid, {
            mode: "translator",
            translatorErrors: [reason],
          });
          try { ws.close(1011, "translator unavailable"); } catch {}
        }
      }
    } else if (msg.event === "media" && session && msg.media?.payload) {
      session.sendAudio(mulawToPcm24(msg.media.payload));
    }
  });
  ws.on("close", () => {
    socketClosed = true;
    session?.cancel();
    // Either media leg ending means the conversation is over. Tear down the
    // peer and both PSTN calls exactly once; never leave an orphan paid leg.
    if (call && leg) finishBridge(false);
  });
}