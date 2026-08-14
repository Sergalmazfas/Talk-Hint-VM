// EARS availability probes — REAL minimal API calls per candidate.
//
// HARD RULES honored here:
//  - No silent substitution: an unavailable candidate returns status
//    UNAVAILABLE with the real API error text in `detail`. We never swap in a
//    different model.
//  - Azure has no credentials => UNAVAILABLE with "no credentials configured",
//    WITHOUT any network call.
//  - Every external call is bounded by an explicit timeout so a hung API can
//    never hang the benchmark.
//  - Zero imports from the production call path.
//
// API REALITY (verified live against the real endpoints, 2026-08):
//  - OpenAI realtime transcription is provisioned via
//      POST https://api.openai.com/v1/realtime/client_secrets
//    with body { session: { type: "transcription", audio: { input: {
//      transcription: { model }, turn_detection: { type } } } } }.
//    The OLD /v1/realtime/transcription_sessions endpoint now 404s
//    ("Invalid URL"). The response echoes the accepted turn_detection.type, so
//    semantic_vad is only AVAILABLE when the echoed type === "semantic_vad".
//  - OpenAI batch transcription: POST /v1/audio/transcriptions (multipart) with
//    a tiny wav returns 200; a bad model returns invalid_request_error.
//  - Deepgram realtime: open the WS with `Authorization: Token <key>`; on open
//    send one 20ms mulaw silence frame. Flux (v2) emits a {type:"Connected"}
//    control message; nova-3 (v1) just holds the socket open. Success = the
//    socket opens without an auth/handshake error.

import WebSocket from "ws";
import { EARS_CANDIDATES } from "./candidates";
import type { AvailabilityResult, EarsCandidate } from "./types";

const DEFAULT_TIMEOUT_MS = 13000;

function now(): number {
  return Date.now();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Generate a 20ms mulaw@8k silence frame (160 bytes; 0xFF is mulaw silence). */
function mulawSilenceFrame(): Buffer {
  return Buffer.alloc(160, 0xff);
}

/** Minimal RIFF/PCM16 mono wav of `seconds` of silence at `rate` Hz. */
function synthSilenceWav(seconds = 0.5, rate = 16000): Buffer {
  const samples = Math.round(seconds * rate);
  const dataLen = samples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  // remaining bytes already zero => silence
  return buf;
}

function unavailable(candidateId: string, detail: string, latencyMs?: number): AvailabilityResult {
  return { candidateId, status: "UNAVAILABLE", checkedAt: nowIso(), detail, latencyMs };
}

function available(candidateId: string, detail: string, latencyMs?: number): AvailabilityResult {
  return { candidateId, status: "AVAILABLE", checkedAt: nowIso(), detail, latencyMs };
}

// ---------------------------------------------------------------------------
// Deepgram realtime probe
// ---------------------------------------------------------------------------

function buildDeepgramUrl(cfg: Record<string, unknown>): string {
  const base = String(cfg.url);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "url" || v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function probeDeepgram(c: EarsCandidate): Promise<AvailabilityResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  const started = now();
  if (!key) {
    return unavailable(c.id, "no credentials configured (DEEPGRAM_API_KEY missing)");
  }
  const url = buildDeepgramUrl(c.config);
  return await new Promise<AvailabilityResult>((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const finish = (r: AvailabilityResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.removeAllListeners();
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const timer = setTimeout(() => {
      finish(unavailable(c.id, `timeout after ${DEFAULT_TIMEOUT_MS}ms opening ${url}`, now() - started));
    }, DEFAULT_TIMEOUT_MS);

    try {
      ws = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
    } catch (e) {
      finish(unavailable(c.id, `ws construct error: ${(e as Error).message}`, now() - started));
      return;
    }

    ws.on("open", () => {
      // Send one tiny mulaw silence frame to prove the stream accepts audio.
      try {
        ws?.send(mulawSilenceFrame());
      } catch (e) {
        finish(unavailable(c.id, `send failed after open: ${(e as Error).message}`, now() - started));
        return;
      }
      // Give the server a brief window to surface an error message; if none,
      // the connection is healthy.
      setTimeout(() => {
        finish(available(c.id, `WS open @ ${url}; sent 20ms mulaw silence ok`, now() - started));
      }, 800);
    });

    ws.on("message", (data: WebSocket.RawData) => {
      const text = data.toString();
      if (text.length < 2000 && /"type"\s*:\s*"Error"/i.test(text)) {
        finish(unavailable(c.id, `server error: ${text.slice(0, 300)}`, now() - started));
      }
      // Connected / Metadata / TurnInfo etc. are healthy signals — ignore.
    });

    ws.on("unexpected-response", (_req, res) => {
      finish(unavailable(c.id, `handshake failed HTTP ${res.statusCode} ${res.statusMessage || ""}`.trim(), now() - started));
    });

    ws.on("error", (err: Error) => {
      finish(unavailable(c.id, `ws error: ${err.message}`, now() - started));
    });
  });
}

// ---------------------------------------------------------------------------
// OpenAI realtime probe (client_secrets provisioning)
// ---------------------------------------------------------------------------

async function probeOpenAiRealtime(c: EarsCandidate): Promise<AvailabilityResult> {
  const key = process.env.OPENAI_API_KEY;
  const started = now();
  if (!key) {
    return unavailable(c.id, "no credentials configured (OPENAI_API_KEY missing)");
  }
  const model = String(c.config.model);
  const requestedTd = String(c.config.turn_detection);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: {
            input: {
              transcription: { model },
              turn_detection: { type: requestedTd },
            },
          },
        },
      }),
      signal: ac.signal,
    });
    const latencyMs = now() - started;
    const bodyText = await res.text();
    if (!res.ok) {
      return unavailable(c.id, `HTTP ${res.status}: ${bodyText.slice(0, 400)}`, latencyMs);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return unavailable(c.id, `unparseable success body: ${bodyText.slice(0, 300)}`, latencyMs);
    }
    const acceptedTd = parsed?.session?.audio?.input?.turn_detection?.type ?? null;
    const acceptedModel = parsed?.session?.audio?.input?.transcription?.model ?? null;
    if (acceptedModel !== model) {
      return unavailable(
        c.id,
        `model not honored: requested ${model}, got ${acceptedModel ?? "none"}`,
        latencyMs
      );
    }
    // semantic_vad is only AVAILABLE when the API echoes it back verbatim.
    if (acceptedTd !== requestedTd) {
      return unavailable(
        c.id,
        `turn_detection not honored: requested ${requestedTd}, API returned ${acceptedTd ?? "none"}`,
        latencyMs
      );
    }
    return available(
      c.id,
      `client_secret issued; model=${acceptedModel}, turn_detection=${acceptedTd}`,
      latencyMs
    );
  } catch (e) {
    const err = e as Error;
    const detail = err.name === "AbortError"
      ? `timeout after ${DEFAULT_TIMEOUT_MS}ms`
      : `fetch error: ${err.message}`;
    return unavailable(c.id, detail, now() - started);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// OpenAI batch probe (POST /v1/audio/transcriptions with tiny silence wav)
// ---------------------------------------------------------------------------

async function probeOpenAiBatch(c: EarsCandidate): Promise<AvailabilityResult> {
  const key = process.env.OPENAI_API_KEY;
  const started = now();
  if (!key) {
    return unavailable(c.id, "no credentials configured (OPENAI_API_KEY missing)");
  }
  const model = String(c.config.model);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const wav = synthSilenceWav(0.5, 16000);
    const form = new FormData();
    form.append("model", model);
    form.append(
      "file",
      new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
      "silence.wav"
    );
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ac.signal,
    });
    const latencyMs = now() - started;
    const bodyText = await res.text();
    if (!res.ok) {
      return unavailable(c.id, `HTTP ${res.status}: ${bodyText.slice(0, 400)}`, latencyMs);
    }
    return available(c.id, `transcription accepted (model=${model})`, latencyMs);
  } catch (e) {
    const err = e as Error;
    const detail = err.name === "AbortError"
      ? `timeout after ${DEFAULT_TIMEOUT_MS}ms`
      : `fetch error: ${err.message}`;
    return unavailable(c.id, detail, now() - started);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Per-candidate dispatch
// ---------------------------------------------------------------------------

async function probeCandidate(c: EarsCandidate): Promise<AvailabilityResult> {
  try {
    if (c.provider === "azure") {
      // NO network call — there are no Azure credentials in this environment.
      return unavailable(c.id, "no credentials configured (Azure Speech key not present); skipped without network call");
    }
    if (c.provider === "deepgram") {
      return await probeDeepgram(c);
    }
    if (c.provider === "openai") {
      return c.kind === "batch" ? await probeOpenAiBatch(c) : await probeOpenAiRealtime(c);
    }
    return unavailable(c.id, `unknown provider ${(c as EarsCandidate).provider}`);
  } catch (e) {
    // Defensive: an unexpected throw must still yield UNAVAILABLE, not crash.
    return unavailable(c.id, `probe threw: ${(e as Error).message}`);
  }
}

/**
 * Probe every candidate in the Mandatory Candidate Matrix with a real minimal
 * API call. Probes run in parallel; each is independently bounded by a timeout.
 */
export async function checkEarsAvailability(): Promise<AvailabilityResult[]> {
  return Promise.all(EARS_CANDIDATES.map((c) => probeCandidate(c)));
}

// Exposed for the harness (batch reference candidate reuses the same wav synth)
// and for tests that want to exercise the pure helpers.
export const __internal = { synthSilenceWav, mulawSilenceFrame, buildDeepgramUrl };
