import type { Express, Request, Response } from "express";
import { Readable } from "node:stream";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import {
  failClone, finishClone, getClone, getRun, insertRun, listVoiceLab,
  recordPlayback, reserveClone, toPublicClone, toPublicRun,
} from "./store";
import {
  createClonedVoice, decodeAudio, ElevenLabsProvider, transcribeRussian,
  decodeAudioWithMaxDuration, ElevenLabsHttpError, translateToNaturalEnglish, type SupportedMime,
} from "./providers";
import { withAbsolutePlaybackTimings } from "./timings";

const base = "/api/admin/voice-lab";
const RUN_LIMIT = 6;
const WINDOW_MS = 60_000;
const RELEASE_MAX_AGE_MS = 10 * 60_000;
const RELEASE_MAX_FUTURE_MS = 30_000;
const runRequests = new Map<string, number[]>();
const provider = new ElevenLabsProvider();

function userId(req: Request) {
  return (req as any).user?.id as string;
}

function caughtError(res: Response, error: unknown, fallback: string) {
  const status = Number((error as any)?.status);
  const message = typeof (error as any)?.message === "string" ? (error as any).message : fallback;
  res.status(status >= 400 && status < 500 ? status : status === 500 ? 500 : 502)
    .json({ error: status ? message : fallback });
}

function allowRun(user: string) {
  const now = Date.now();
  const recent = (runRequests.get(user) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= RUN_LIMIT) {
    runRequests.set(user, recent);
    return false;
  }
  recent.push(now);
  runRequests.set(user, recent);
  return true;
}

function abortOnDisconnect(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", () => {
    if (!res.writableEnded) abort();
  });
  return controller;
}

export function registerVoiceLabRoutes(app: Express) {
  app.get(base, requireBenchmarkAdmin, async (req, res) => {
    try {
      const data = await listVoiceLab(userId(req));
      res.json({
        clone: toPublicClone(data.clone),
        runs: data.runs.map(toPublicRun),
      });
    } catch {
      res.status(500).json({ error: "Voice Lab data is unavailable" });
    }
  });

  app.post(`${base}/clone`, requireBenchmarkAdmin, async (req, res) => {
    const uid = userId(req);
    let audio: ReturnType<typeof decodeAudio>;
    try {
      if (req.body?.consent !== true) return res.status(400).json({ error: "Explicit voice-cloning consent is required" });
      audio = decodeAudioWithMaxDuration(req.body?.audioBase64, req.body?.mimeType, req.body?.durationMs, 180_000);
    } catch (error) {
      return caughtError(res, error, "Invalid audio input");
    }
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: "ElevenLabs API key is not configured" });

    let reservation;
    try {
      reservation = await reserveClone(uid, audio.durationMs);
      if (!reservation) {
        const existing = await getClone(uid);
        const message = existing?.status === "creating"
          ? "A clone request is already in progress"
          : existing?.status === "uncertain"
            ? "Clone creation outcome is uncertain. Do not retry to avoid a duplicate paid clone; check the ElevenLabs account or contact an administrator."
            : "A voice clone already exists for this admin";
        return res.status(409).json({
          error: message,
          clone: toPublicClone(existing),
        });
      }
    } catch {
      return res.status(500).json({ error: "Could not reserve voice-clone creation" });
    }

    const controller = abortOnDisconnect(req, res);
    try {
      const voiceId = await createClonedVoice(audio.buffer, audio.mimeType as SupportedMime, uid, controller.signal);
      const clone = await finishClone(uid, voiceId);
      if (!clone) throw new Error("Voice-clone record could not be saved");
      if (!res.headersSent) res.json({ clone: toPublicClone(clone) });
    } catch (error) {
      const definitivelyRejected = error instanceof ElevenLabsHttpError &&
        error.status >= 400 && error.status < 500;
      const status = definitivelyRejected ? "retryable" : "uncertain";
      let failureStateSaved = true;
      try {
        await failClone(uid, status);
      } catch {
        failureStateSaved = false;
      }
      if (!res.headersSent && !res.destroyed) {
        const clone = await getClone(uid).catch(() => null);
        if (!failureStateSaved) {
          return res.status(500).json({
            error: "Clone creation failed, but its safety state could not be saved. Do not retry; contact an administrator before another attempt.",
            clone: toPublicClone(clone),
          });
        }
        if (definitivelyRejected) {
          res.status(502).json({
            error: `ElevenLabs rejected the clone request (HTTP ${error.status}). It was not accepted; correct the recording if needed and explicitly submit another attempt.`,
            clone: toPublicClone(clone),
          });
        } else {
          res.status(502).json({
            error: "Clone creation outcome is uncertain. The provider may have completed it; do not retry to avoid a duplicate paid clone. Check the ElevenLabs account or contact an administrator.",
            clone: toPublicClone(clone),
          });
        }
      }
    } finally {
      controller.abort();
    }
  });

  app.post(`${base}/run`, requireBenchmarkAdmin, async (req, res) => {
    const uid = userId(req);
    let audio: ReturnType<typeof decodeAudio>;
    try {
      audio = decodeAudio(req.body?.audioBase64, req.body?.mimeType, req.body?.durationMs);
    } catch (error) {
      return caughtError(res, error, "Invalid audio input");
    }
    const releasedAtMs = req.body?.releasedAtMs;
    const now = Date.now();
    if (typeof releasedAtMs !== "number" || !Number.isSafeInteger(releasedAtMs) ||
        releasedAtMs < now - RELEASE_MAX_AGE_MS || releasedAtMs > now + RELEASE_MAX_FUTURE_MS) {
      return res.status(400).json({ error: "releasedAtMs must be a plausible Unix epoch timestamp in milliseconds" });
    }
    if (!allowRun(uid)) return res.status(429).json({ error: "Voice Lab run limit reached; wait a minute and try again" });

    let clone;
    try {
      clone = await getClone(uid);
    } catch {
      return res.status(500).json({ error: "Voice Lab clone data is unavailable" });
    }
    if (clone?.status !== "ready" || !clone.voiceId) {
      return res.status(409).json({ error: "Create a voice clone before starting a run" });
    }

    const controller = abortOnDisconnect(req, res);
    try {
      const transcript = await transcribeRussian(audio.buffer, audio.mimeType, controller.signal);
      const transcriptionComplete = Date.now();
      const english = await translateToNaturalEnglish(transcript, controller.signal);
      const englishReady = Date.now();
      const run = await insertRun(uid, {
        transcript,
        english,
        voiceId: clone.voiceId,
        provider: provider.name,
        timings: {
          micRelease: releasedAtMs,
          transcriptionComplete,
          englishReady,
        },
      });
      if (!res.headersSent) res.json({ run: toPublicRun(run) });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) caughtError(res, error, "Voice Lab run failed");
    } finally {
      controller.abort();
    }
  });

  app.get(`${base}/runs/:id/audio`, requireBenchmarkAdmin, async (req, res) => {
    const uid = userId(req);
    let run;
    try {
      run = await getRun(uid, req.params.id);
    } catch {
      return res.status(500).json({ error: "Voice Lab run data is unavailable" });
    }
    if (!run) return res.status(404).json({ error: "Voice Lab run not found" });

    const controller = abortOnDisconnect(req, res);
    try {
      const upstream = await provider.streamSpeech(run.voiceId, run.english, controller.signal);
      if (!upstream.ok || !upstream.body) {
        controller.abort();
        return res.status(502).json({ error: `ElevenLabs audio request failed (HTTP ${upstream.status})` });
      }
      res.status(200).set({
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      Readable.fromWeb(upstream.body as any).on("error", () => {
        if (!res.headersSent) res.status(502).json({ error: "Audio stream failed" });
        else res.destroy();
      }).pipe(res);
    } catch {
      if (!res.headersSent && !res.destroyed) res.status(502).json({ error: "ElevenLabs audio request failed" });
    }
  });

  app.post(`${base}/runs/:id/play`, requireBenchmarkAdmin, async (req, res) => {
    const { firstAudioMs, playResult, elevenlabsRequestMs } = req.body ?? {};
    if (!(firstAudioMs === null || (typeof firstAudioMs === "number" && Number.isFinite(firstAudioMs) && firstAudioMs >= 0 && firstAudioMs <= 60_000))) {
      return res.status(400).json({ error: "firstAudioMs must be null or a number between 0 and 60000" });
    }
    if (typeof playResult !== "string" || !playResult.trim() || playResult.length > 120) {
      return res.status(400).json({ error: "playResult must be a non-empty string up to 120 characters" });
    }
    if (elevenlabsRequestMs !== undefined &&
        (typeof elevenlabsRequestMs !== "number" || !Number.isFinite(elevenlabsRequestMs) || elevenlabsRequestMs < 0 || elevenlabsRequestMs > 60_000)) {
      return res.status(400).json({ error: "elevenlabsRequestMs must be between 0 and 60000" });
    }
    try {
      const uid = userId(req);
      const existing = await getRun(uid, req.params.id);
      if (!existing) return res.status(404).json({ error: "Voice Lab run not found" });
      try {
        withAbsolutePlaybackTimings(existing.timings as any, { firstAudioMs, elevenlabsRequestMs });
      } catch (error) {
        return res.status(400).json({ error: (error as Error).message });
      }
      const run = await recordPlayback(uid, req.params.id, {
        firstAudioMs, playResult: playResult.trim(), elevenlabsRequestMs,
      });
      if (!run) return res.status(404).json({ error: "Voice Lab run not found" });
      return res.json({ run: toPublicRun(run) });
    } catch {
      return res.status(500).json({ error: "Could not save playback result" });
    }
  });

  // Convert request-parser failures (including the server's global JSON body
  // limit) to an explicit API error instead of Express's default HTML page.
  app.use(base, (error: any, _req: Request, res: Response, next: (error?: any) => void) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "Audio request exceeds the 10 MB request limit" });
    }
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Request body must be valid JSON" });
    }
    next(error);
  });
}