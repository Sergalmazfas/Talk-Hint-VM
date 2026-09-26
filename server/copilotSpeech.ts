import type { Express, Request, Response as ExpressResponse, NextFunction } from "express";
import { authMiddleware } from "./auth";
import { lookupAuthorizedCopilotCall } from "./copilotStream";
import { consumeVerifiedCopilotReply, isLatinCopilotReply } from "./copilotVerifiedReplies";
import { ElevenLabsProvider } from "./voiceLab/providers";
import { getClone } from "./voiceLab/store";

const MAX_TEXT_LENGTH = 1_000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const REQUEST_LIMIT = 8;
const REQUEST_WINDOW_MS = 60_000;

const requestsByCall = new Map<string, number[]>();
const provider = new ElevenLabsProvider();

function allowCallRequest(userId: string, callSid: string) {
  const now = Date.now();
  const key = `${userId}\u0000${callSid}`;
  requestsByCall.forEach((times, existingKey) => {
    const live = times.filter(time => now - time < REQUEST_WINDOW_MS);
    if (!live.length) requestsByCall.delete(existingKey);
    else requestsByCall.set(existingKey, live);
  });
  if (!requestsByCall.has(key) && requestsByCall.size >= 4_096) {
    const oldestKey = requestsByCall.keys().next().value;
    if (oldestKey) requestsByCall.delete(oldestKey);
  }
  const recent = (requestsByCall.get(key) ?? []).filter(time => now - time < REQUEST_WINDOW_MS);
  if (recent.length >= REQUEST_LIMIT) {
    requestsByCall.set(key, recent);
    return false;
  }
  recent.push(now);
  requestsByCall.set(key, recent);
  return true;
}

function bearerAuth(req: Request, res: ExpressResponse, next: NextFunction) {
  if (!req.headers.authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Bearer authentication is required" });
  }
  // authMiddleware otherwise accepts an already-populated Passport session;
  // this endpoint intentionally authenticates only the explicit Bearer token.
  (req as any).user = undefined;
  authMiddleware(req, res, next);
}

async function boundedAudio(response: globalThis.Response): Promise<Buffer> {
  if (!response.body) throw new Error("ElevenLabs returned an empty audio response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw Object.assign(new Error("Generated speech exceeds the 2 MB audio limit"), { status: 502 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("ElevenLabs returned empty audio");
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

export function registerCopilotSpeechRoute(app: Express) {
  app.post("/api/copilot/clone-speech", bearerAuth, async (req, res) => {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { callSid, holdId, responseId, text } = req.body ?? {};
    if (typeof callSid !== "string" || !/^CA[0-9a-f]{32}$/i.test(callSid) ||
        typeof holdId !== "string" || holdId.length < 1 || holdId.length > 128 ||
        typeof responseId !== "string" || responseId.length < 1 || responseId.length > 256 ||
        typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: "callSid, holdId, responseId, and text are required and must be valid" });
    }
    if (!isLatinCopilotReply(text)) {
      return res.status(409).json({ error: "Copilot speech is available only for verified English text" });
    }

    let authorized = false;
    try {
      authorized = await lookupAuthorizedCopilotCall(userId, callSid);
    } catch {
      return res.status(503).json({ error: "Copilot call authorization is unavailable" });
    }
    if (!authorized) return res.status(403).json({ error: "Call is not an active Copilot call owned by this user" });

    if (!allowCallRequest(userId, callSid)) {
      return res.status(429).json({ error: "Copilot speech request limit reached for this call" });
    }
    let clone;
    try {
      clone = await getClone(userId);
    } catch {
      return res.status(409).json({ error: "Voice clone metadata is unavailable; create an OWN voice clone before using Copilot speech" });
    }
    if (!clone || clone.userId !== userId || clone.status !== "ready" ||
        typeof clone.voiceId !== "string" || !clone.voiceId.trim()) {
      return res.status(409).json({ error: "No ready OWN voice clone is available for this account" });
    }
    if (!consumeVerifiedCopilotReply(userId, callSid, holdId, responseId, text)) {
      return res.status(409).json({ error: "Text does not match an available verified Copilot reply" });
    }
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(503).json({ error: "ElevenLabs speech service is not configured" });
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortOnDisconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once("aborted", abortOnDisconnect);
    res.once("close", abortOnDisconnect);
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPSTREAM_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const upstream = await provider.streamSpeech(clone.voiceId, text, controller.signal);
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => undefined);
        return res.status(502).json({ error: `ElevenLabs speech generation failed (HTTP ${upstream.status})` });
      }
      const audio = await boundedAudio(upstream);
      res.status(200)
        .set({
          "Content-Type": "audio/mpeg",
          "Content-Length": String(audio.length),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        .send(audio);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        if (timedOut) {
          res.status(504).json({ error: "ElevenLabs speech generation timed out" });
        } else if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "ElevenLabs speech generation failed";
          res.status(502).json({ error: message });
        }
      }
    } finally {
      clearTimeout(timeout);
      req.removeListener("aborted", abortOnDisconnect);
      res.removeListener("close", abortOnDisconnect);
    }
  });
}