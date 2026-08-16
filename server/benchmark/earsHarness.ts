// EARS benchmark harness — streams fixture audio through each AVAILABLE
// candidate and scores the resulting transcripts against the frozen reference
// transcript.
//
// HARD RULES honored:
//  - Skips UNAVAILABLE candidates (recorded in notes; never substituted).
//  - Fixtures with no audio => cannot run EARS. We add a note and return no
//    results for them. We NEVER synthesize audio to fake a run.
//  - Every external call is bounded by a timeout; per-turn/per-candidate
//    failures are caught so one failure never aborts the whole run.
//  - Zero imports from the production call path.
//
// Runtime note: real-time streaming is accelerated (frames sent faster than
// wall-clock) to bound total runtime. That acceleration is recorded in notes,
// and latency figures are scaled back to real time where computable.

import WebSocket from "ws";
import type { BenchmarkFixture } from "@shared/schema";
import type {
  AvailabilityResult,
  EarsCandidate,
  EarsTurnResult,
  ReferenceTurn,
  CriticalEntities,
} from "./types";
import {
  wordErrorRate,
  charErrorRate,
  entityAccuracy,
  termsAccuracy,
  semanticProxy,
  buildScorecardRow,
  normalizeText,
  type EarsScorecardRow,
  type EarsRowInput,
} from "./earsMetrics";
import { splitWavChannels } from "./audioChannels";

const CANDIDATE_STREAM_TIMEOUT_MS = 60000;

/** Stream guard must cover the (accelerated) audio duration plus a flush
 * window — a real 4-minute call would otherwise time out mid-stream. */
function streamGuardMs(mulawBytes: number): number {
  const streamMs = (mulawBytes / 8000) * 1000 / REALTIME_ACCEL; // mulaw8k: 8000 B/s
  return Math.max(CANDIDATE_STREAM_TIMEOUT_MS, Math.round(streamMs) + 30_000);
}
/** @internal exported for unit tests only */
export const REALTIME_ACCEL = 4; // send 20ms frames every 5ms (4x faster than realtime)
const FRAME_BYTES_MULAW = 160; // 20ms @ 8kHz mulaw

interface CollectedFinal {
  text: string;
  /** ms since first audio frame sent (harness clock, receipt time) */
  atMs: number;
  isEndOfTurn: boolean;
  /** provider-reported AUDIO-timeline end of the transcribed segment, in ms —
   * the only evidence strong enough to map a final onto a reference turn.
   * null when the provider does not report audio offsets. */
  audioEndMs?: number | null;
}

interface StreamOutcome {
  finals: CollectedFinal[];
  lastFrameSentAtMs: number;
  error?: string;
  /** measurement-honesty annotations discovered during streaming (e.g.
   * possible tail truncation) — surfaced verbatim in run notes. */
  note?: string;
}

function nowMs(): number {
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Deepgram realtime streaming
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

async function streamDeepgram(c: EarsCandidate, mulaw: Buffer): Promise<StreamOutcome> {
  const key = process.env.DEEPGRAM_API_KEY;
  const finals: CollectedFinal[] = [];
  if (!key) return { finals, lastFrameSentAtMs: 0, error: "DEEPGRAM_API_KEY missing" };
  const url = buildDeepgramUrl(c.config);
  const start = nowMs();
  // Real (unaccelerated) audio duration — Deepgram processes accelerated input
  // at roughly REALTIME pace, so its transcript can lag the sender by minutes.
  const audioDurationMs = Math.round((mulaw.length / 8000) * 1000);

  return await new Promise<StreamOutcome>((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    let lastFrameSentAtMs = 0;
    let outNote: string | undefined;
    const done = (err?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      try {
        ws?.removeAllListeners();
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve({ finals, lastFrameSentAtMs, error: err, note: outNote });
    };
    // Guard must cover REALTIME processing of the whole call (not the
    // accelerated send time): Deepgram keeps transcribing long after the last
    // frame is sent. The old accelerated-duration guard + fixed 2.5s flush
    // truncated ~60% of a 7-minute call and produced an artifact WER of ~74%.
    const guardMs = Math.max(streamGuardMs(mulaw.length), audioDurationMs + 60_000);
    const guard = setTimeout(() => done(`timeout after ${guardMs}ms`), guardMs);

    try {
      ws = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
    } catch (e) {
      done(`ws construct error: ${(e as Error).message}`);
      return;
    }

    ws.on("message", (data: WebSocket.RawData) => {
      const text = data.toString();
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === "Error") {
        done(`server error: ${text.slice(0, 300)}`);
        return;
      }
      // Flux v2: TurnInfo carries the CUMULATIVE transcript of the ongoing
      // turn on every Update — collecting those duplicates the text many
      // times over and explodes WER. Only EndOfTurn is a final.
      if (msg.type === "TurnInfo") {
        const transcript = String(msg.transcript || "").trim();
        if (transcript && msg.event === "EndOfTurn") {
          // Flux reports the turn's audio window in SECONDS.
          const audioEndMs = typeof msg.audio_window_end === "number"
            ? Math.round(msg.audio_window_end * 1000) : null;
          finals.push({ text: transcript, atMs: nowMs() - start, isEndOfTurn: true, audioEndMs });
        }
        return;
      }
      // nova-3 v1: results with is_final / speech_final.
      if (msg.type === "Results" || msg.channel) {
        const alt = msg.channel?.alternatives?.[0];
        const transcript = String(alt?.transcript || "").trim();
        if (transcript && (msg.is_final || msg.speech_final)) {
          // nova-3 reports segment start/duration in SECONDS.
          const audioEndMs = typeof msg.start === "number" && typeof msg.duration === "number"
            ? Math.round((msg.start + msg.duration) * 1000) : null;
          finals.push({ text: transcript, atMs: nowMs() - start, isEndOfTurn: !!msg.speech_final, audioEndMs });
        }
      }
    });

    ws.on("unexpected-response", (_req, res) => done(`handshake HTTP ${res.statusCode}`));
    ws.on("error", (err: Error) => done(`ws error: ${err.message}`));

    ws.on("open", async () => {
      try {
        for (let off = 0; off < mulaw.length; off += FRAME_BYTES_MULAW) {
          if (settled) return;
          const frame = mulaw.subarray(off, Math.min(off + FRAME_BYTES_MULAW, mulaw.length));
          ws!.send(frame);
          lastFrameSentAtMs = nowMs() - start;
          await sleep(20 / REALTIME_ACCEL);
        }
        // DRAIN — do NOT stop after a fixed short wait. Under accelerated
        // sending Deepgram processes at roughly REALTIME pace and lags the
        // sender by minutes; a fixed 2.5s flush window silently truncated the
        // tail of the call (measurement artifact WER ~74%). Two constraints:
        //  1. Deepgram kills an idle socket after 60s without client messages
        //     (INACTIVE_CLIENT) — so we keep feeding SILENCE frames at
        //     realtime pace while the server catches up (KeepAlive is not
        //     supported by Flux v2; silence audio works for both APIs).
        //  2. We stop when the provider's reported audio offset reaches the
        //     end of the real audio, or finals go quiet for a generous
        //     window, bounded by the outer guard.
        // Stop conditions: provider audio offset reaches the end of the real
        // audio, OR we have drained for the full worst-case backlog window.
        // NOTE: "no finals for N seconds" is NOT a valid stop condition — a
        // per-role channel legitimately goes silent for minutes while the
        // other party talks, and bailing early truncates the tail.
        const silenceFrame = Buffer.alloc(FRAME_BYTES_MULAW, 0xff); // mulaw silence
        const lastAudio = () =>
          finals.reduce((m, f) => (typeof f.audioEndMs === "number" ? Math.max(m, f.audioEndMs) : m), 0);
        // Worst-case backlog: server processes at ~1x, we sent in duration/ACCEL,
        // so it can lag by duration*(1-1/ACCEL); add margin for jitter.
        const drainBudgetMs =
          Math.round(audioDurationMs * (1 - 1 / REALTIME_ACCEL)) + 45_000;
        const drainStart = nowMs();
        while (!settled) {
          if (ws!.readyState !== WebSocket.OPEN) break;
          ws!.send(silenceFrame); // 20ms of silence every 20ms = realtime pace
          await sleep(20);
          if (lastAudio() >= audioDurationMs - 2_000) break; // caught up
          if (nowMs() - drainStart > drainBudgetMs) break; // budget exhausted
        }
        // CloseStream flushes any remaining buffered audio and closes the
        // socket (both v1 and Flux v2); collect trailing finals briefly.
        try {
          ws!.send(JSON.stringify({ type: "CloseStream" }));
        } catch {
          /* ignore */
        }
        {
          const flushUntil = nowMs() + 8_000;
          while (!settled && nowMs() < flushUntil) {
            if (ws!.readyState === WebSocket.CLOSED) break;
            await sleep(250);
          }
        }
        // Honesty check: if the last provider audio offset falls well short of
        // the audio we sent, the tail may still be missing — record it.
        const lastAudioEnd = finals.reduce(
          (m, f) => (typeof f.audioEndMs === "number" ? Math.max(m, f.audioEndMs) : m), 0);
        if (lastAudioEnd > 0 && lastAudioEnd < audioDurationMs - 20_000) {
          outNote = `possible tail truncation: last transcribed audio offset ${Math.round(lastAudioEnd / 1000)}s of ${Math.round(audioDurationMs / 1000)}s sent — treat WER as an upper bound for this stream.`;
        }
        done();
      } catch (e) {
        done(`stream error: ${(e as Error).message}`);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// OpenAI realtime streaming (WS via ephemeral client secret)
// ---------------------------------------------------------------------------

async function mintOpenAiClientSecret(
  model: string,
  turnDetection: string
): Promise<{ value: string } | { error: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: "OPENAI_API_KEY missing" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 13000);
  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: { input: { transcription: { model }, turn_detection: { type: turnDetection } } },
        },
      }),
      signal: ac.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) return { error: `client_secret HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
    const parsed = JSON.parse(bodyText);
    const value = parsed?.value;
    if (!value) return { error: `no client secret in response` };
    return { value };
  } catch (e) {
    return { error: (e as Error).name === "AbortError" ? "client_secret timeout" : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Convert mulaw@8k bytes to PCM16@24k base64 (OpenAI realtime wants pcm). */
function mulawToPcm16_24k(mulaw: Buffer): Buffer {
  // mulaw decode table -> 16-bit PCM, then naive 3x upsample (8k -> 24k).
  const BIAS = 0x84;
  const decoded = Buffer.alloc(mulaw.length * 2 * 3);
  let w = 0;
  for (let i = 0; i < mulaw.length; i++) {
    let u = ~mulaw[i] & 0xff;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    let sample = ((mantissa << 3) + BIAS) << exponent;
    sample -= BIAS;
    if (sign !== 0) sample = -sample;
    for (let k = 0; k < 3; k++) {
      decoded.writeInt16LE(sample, w);
      w += 2;
    }
  }
  return decoded;
}

async function streamOpenAiRealtime(c: EarsCandidate, mulaw: Buffer): Promise<StreamOutcome> {
  const finals: CollectedFinal[] = [];
  const model = String(c.config.model);
  const td = String(c.config.turn_detection);
  const secret = await mintOpenAiClientSecret(model, td);
  if ("error" in secret) return { finals, lastFrameSentAtMs: 0, error: secret.error };

  const pcm = mulawToPcm16_24k(mulaw);
  const PCM_FRAME = 24000 * 2 * 0.02; // 20ms @ 24kHz pcm16 = 960 bytes
  const start = nowMs();

  return await new Promise<StreamOutcome>((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    let lastFrameSentAtMs = 0;
    const done = (err?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      try {
        ws?.removeAllListeners();
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve({ finals, lastFrameSentAtMs, error: err });
    };
    const guardMs = streamGuardMs(mulaw.length);
    const guard = setTimeout(() => done(`timeout after ${guardMs}ms`), guardMs);

    try {
      // GA realtime API: no OpenAI-Beta header (beta shape is rejected with
      // beta_api_shape_disabled since 2026).
      ws = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
        headers: { Authorization: `Bearer ${secret.value}` },
      });
    } catch (e) {
      done(`ws construct error: ${(e as Error).message}`);
      return;
    }

    ws.on("message", (data: WebSocket.RawData) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "error") {
        // Non-fatal: committing an (already-consumed) buffer under server VAD
        // returns commit_empty — the transcripts collected so far are valid.
        if (msg.error?.code === "input_audio_buffer_commit_empty") return;
        done(`server error: ${JSON.stringify(msg.error).slice(0, 300)}`);
        return;
      }
      // completed transcription events per input audio buffer segment.
      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        const transcript = String(msg.transcript || "").trim();
        if (transcript) finals.push({ text: transcript, atMs: nowMs() - start, isEndOfTurn: true });
      }
    });

    ws.on("unexpected-response", (_req, res) => done(`handshake HTTP ${res.statusCode}`));
    ws.on("error", (err: Error) => done(`ws error: ${err.message}`));

    ws.on("open", async () => {
      try {
        for (let off = 0; off < pcm.length; off += PCM_FRAME) {
          if (settled) return;
          const frame = pcm.subarray(off, Math.min(off + PCM_FRAME, pcm.length));
          ws!.send(JSON.stringify({ type: "input_audio_buffer.append", audio: frame.toString("base64") }));
          lastFrameSentAtMs = nowMs() - start;
          await sleep(20 / REALTIME_ACCEL);
        }
        // Server/semantic VAD owns turn boundaries — no manual commit (it
        // errors with commit_empty). Send a short silence tail so VAD closes
        // the last turn, then allow time for the final transcription events.
        try {
          const silence = Buffer.alloc(Math.round(24000 * 2 * 0.5)); // 0.5s pcm16 silence
          ws!.send(JSON.stringify({ type: "input_audio_buffer.append", audio: silence.toString("base64") }));
        } catch {
          /* ignore */
        }
        await sleep(8000);
        done();
      } catch (e) {
        done(`stream error: ${(e as Error).message}`);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// OpenAI batch transcription (whole file)
// ---------------------------------------------------------------------------

async function transcribeOpenAiBatch(
  c: EarsCandidate,
  audio: Buffer,
  filename: string,
  mime: string
): Promise<StreamOutcome> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { finals: [], lastFrameSentAtMs: 0, error: "OPENAI_API_KEY missing" };
  const model = String(c.config.model);
  const ac = new AbortController();
  // Batch uploads of multi-minute call audio can legitimately take a while.
  const timer = setTimeout(() => ac.abort(), 180_000);
  try {
    const form = new FormData();
    form.append("model", model);
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ac.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) return { finals: [], lastFrameSentAtMs: 0, error: `HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
    let text = "";
    try {
      text = JSON.parse(bodyText).text || "";
    } catch {
      text = bodyText;
    }
    return { finals: [{ text: text.trim(), atMs: 0, isEndOfTurn: true }], lastFrameSentAtMs: 0 };
  } catch (e) {
    return {
      finals: [],
      lastFrameSentAtMs: 0,
      error: (e as Error).name === "AbortError" ? "batch timeout" : (e as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Alignment: PROVABLE mapping only.
//
// HARD RULE (measurement honesty): alignment must never use the candidate's
// own transcript text to decide which reference turn a final belongs to,
// and must never be inferred from receipt order, final counts, or receipt
// wall-clock time plus a slack heuristic — none of those can prove where a
// candidate segment sits on the AUDIO timeline (an STT can merge/split turns
// while keeping the count, and network/processing delay shifts receipt time
// arbitrarily).
//
// The ONLY accepted basis is explicit audio-timeline evidence on BOTH sides:
//   - every reference turn carries a ground-truth end boundary (tEndMs,
//     strictly increasing), AND
//   - every candidate final carries a provider-reported audio end offset
//     (audioEndMs) for the segment it transcribed.
// A final then belongs to the unique reference turn whose boundary interval
// (tEnd[i-1], tEnd[i]] contains its audioEndMs. If either side lacks the
// metadata, per-turn metrics are UNAVAILABLE for that stream — never guessed.
// ---------------------------------------------------------------------------

/** @internal exported for unit tests only */
export interface Aligned {
  refTurn: ReferenceTurn;
  hypText: string;
  hypAtMs: number | null;
  hypEndOfTurn: boolean | null;
}

export type PerTurnBasis = "timestamps" | "unavailable";

/** @internal exported for unit tests only */
export function alignProvably(
  finals: CollectedFinal[],
  refTurns: ReferenceTurn[]
): { basis: PerTurnBasis; aligned: Aligned[] } {
  const empty = (): Aligned[] =>
    refTurns.map((t) => ({ refTurn: t, hypText: "", hypAtMs: null, hypEndOfTurn: null }));

  if (refTurns.length === 0) return { basis: "unavailable", aligned: [] };

  const boundaries = refTurns.map((t) => (typeof t.tEndMs === "number" ? t.tEndMs : null));
  const refOk = boundaries.every((b, i) => b !== null && (i === 0 || b > (boundaries[i - 1] as number)));
  const candOk = finals.every((f) => typeof f.audioEndMs === "number" && !Number.isNaN(f.audioEndMs));
  if (!refOk || !candOk) return { basis: "unavailable", aligned: empty() };

  const aligned = empty();
  const last = refTurns.length - 1;
  for (const f of finals) {
    const endMs = f.audioEndMs as number;
    // Unique turn whose boundary interval (tEnd[i-1], tEnd[i]] contains the
    // segment's audio end; content ending after the last boundary belongs to
    // the last turn (no later turn exists on this channel).
    let idx = last;
    for (let i = 0; i < boundaries.length; i++) {
      if (endMs <= (boundaries[i] as number)) { idx = i; break; }
    }
    const slot = aligned[idx];
    slot.hypText = slot.hypText ? `${slot.hypText} ${f.text}` : f.text;
    slot.hypAtMs = f.atMs;
    slot.hypEndOfTurn = f.isEndOfTurn;
  }
  return { basis: "timestamps", aligned };
}

// ---------------------------------------------------------------------------
// Per-turn scoring
// ---------------------------------------------------------------------------

// A candidate EOT that arrives more than PREMATURE_THRESHOLD_MS before the
// reference turn boundary is flagged as premature. A small negative window
// (200 ms) absorbs reference-annotation imprecision without masking real
// premature fires that cut off trailing words.
/** @internal exported for unit tests only */
export const PREMATURE_THRESHOLD_MS = -200;

/** @internal exported for unit tests only */
export function scoreTurn(
  candidateId: string,
  a: Aligned,
  critical: CriticalEntities,
  lastFrameSentAtMs: number
): EarsTurnResult {
  const hyp = a.hypText;
  const ref = a.refTurn.text;
  const ea = entityAccuracy(critical, hyp);
  const termsAcc = termsAccuracy(critical.terms, ref, hyp);

  // Latency (realtime only): from last-audio-frame-sent to this turn's final.
  // `lastFrameSentAtMs > 0` distinguishes realtime streams from batch (batch
  // sets lastFrameSentAtMs = 0 and should not produce latency figures here).
  const isRealtime = lastFrameSentAtMs > 0;
  let speechEndToFinalMs: number | null = null;
  if (a.hypAtMs !== null && isRealtime) {
    const delta = a.hypAtMs - lastFrameSentAtMs;
    // Scale accelerated harness clock back toward real time.
    speechEndToFinalMs = delta >= 0 ? Math.round(delta * REALTIME_ACCEL) : null;
  }

  // EOT boundary metrics — only computable when:
  //   (a) ground-truth turn end timing is annotated (tEndMs on the ref turn), AND
  //   (b) the candidate is realtime (batch has no streaming EOT concept).
  // Formula: convert harness wall-clock (accelerated) to real audio-time offset,
  // then subtract the ground-truth turn boundary.
  //   candidate EOT in audio time = hypAtMs * REALTIME_ACCEL
  //   speechEndToEotMs = candidateEotAudioMs − tEndMs
  //   > 0 → candidate fired after turn ended (desirable, measures reaction delay)
  //   < 0 → candidate fired before turn ended (premature, cuts off speech)
  let speechEndToEotMs: number | null = null;
  let prematureEot: boolean | null = null;
  let falseContinuation: boolean | null = null;
  const tEndMs = a.refTurn.tEndMs;
  if (isRealtime && typeof tEndMs === "number") {
    if (a.hypAtMs !== null && a.hypEndOfTurn === true) {
      // Candidate fired an EOT signal for this turn.
      const candidateEotAudioMs = a.hypAtMs * REALTIME_ACCEL;
      speechEndToEotMs = Math.round(candidateEotAudioMs - tEndMs);
      prematureEot = speechEndToEotMs < PREMATURE_THRESHOLD_MS;
      falseContinuation = false;
    } else if (a.hypText) {
      // Candidate produced text but no EOT signal — false continuation (false wait).
      prematureEot = false;
      falseContinuation = true;
    } else {
      // Candidate missed the turn entirely — counts as false wait (no EOT fired).
      prematureEot = null;
      falseContinuation = true;
    }
  }

  return {
    turnIdx: a.refTurn.idx,
    candidateId,
    hypothesisText: hyp,
    role: a.refTurn.role,
    wer: hyp ? wordErrorRate(ref, hyp) : null,
    cer: hyp ? charErrorRate(ref, hyp) : null,
    entityAccuracy: hyp
      ? { money: ea.money, dates: ea.dates, digits: ea.digits, names: ea.names, terms: termsAcc }
      : null,
    prematureEot,
    falseContinuation,
    speechEndToFinalMs,
    speechEndToEotMs,
  };
}

// ---------------------------------------------------------------------------
// Public harness entry point
// ---------------------------------------------------------------------------

function statusOf(availability: AvailabilityResult[], id: string): AvailabilityResult | undefined {
  return availability.find((a) => a.candidateId === id);
}

function normalizeAudioFormat(fmt: string | null | undefined): {
  isMulaw8k: boolean;
  filename: string;
  mime: string;
} {
  const f = (fmt || "").toLowerCase();
  if (f === "mulaw8k" || f === "mulaw" || f === "g711_ulaw") {
    return { isMulaw8k: true, filename: "audio.ulaw", mime: "audio/basic" };
  }
  if (f === "wav") return { isMulaw8k: false, filename: "audio.wav", mime: "audio/wav" };
  if (f === "mp3") return { isMulaw8k: false, filename: "audio.mp3", mime: "audio/mpeg" };
  return { isMulaw8k: false, filename: "audio.bin", mime: "application/octet-stream" };
}

export async function runEarsBenchmark(opts: {
  fixtures: BenchmarkFixture[];
  candidates: EarsCandidate[];
  availability: AvailabilityResult[];
}): Promise<{ turnResults: EarsTurnResult[]; scorecard: EarsScorecardRow[]; notes: string[] }> {
  const { fixtures, candidates, availability } = opts;
  const notes: string[] = [];
  const turnResults: EarsTurnResult[] = [];

  notes.push(
    `Realtime streaming accelerated ${REALTIME_ACCEL}x to bound runtime; latency figures scaled back to real time.`
  );
  notes.push(
    `Latency honesty: providers that process accelerated input at ~realtime pace (observed for Deepgram) accumulate a receive backlog, so their EOT/final latency figures are UPPER BOUNDS under acceleration, not production latency. Accuracy (WER) is unaffected once the stream is fully drained.`
  );

  // Determine which candidates we may actually run.
  const runnable: EarsCandidate[] = [];
  for (const c of candidates) {
    const av = statusOf(availability, c.id);
    if (!av || av.status !== "AVAILABLE") {
      notes.push(`Candidate ${c.id} skipped: ${av ? `${av.status} — ${av.detail}` : "no availability result"}`);
      continue;
    }
    runnable.push(c);
  }

  // Split fixtures by audio presence.
  const withAudio = fixtures.filter((f) => !!f.audioBase64);
  const noAudio = fixtures.filter((f) => !f.audioBase64);
  if (noAudio.length) {
    notes.push(
      `no real audio fixtures yet for ${noAudio.length} fixture(s) [${noAudio
        .map((f) => f.id)
        .join(", ")}] — EARS cannot run on them (no audio synthesized).`
    );
  }

  // Accumulators for scorecard rows, keyed by candidate id.
  const acc = new Map<string, EarsRowInput>();
  for (const c of runnable) {
    acc.set(c.id, {
      candidateId: c.id,
      label: c.label,
      wer: [],
      werWeights: [],
      roles: [],
      cer: [],
      perTurnBases: [],
      perTurnScored: 0,
      semantic: [],
      moneyAcc: [],
      digitsAcc: [],
      termsAcc: [],
      prematureEotFlags: [],
      falseWaitFlags: [],
      eotLatencies: [],
      finalLatencies: [],
      costEstimate: null,
      referenceOnly: !!c.referenceOnly,
    });
  }

  for (const fixture of withAudio) {
    const refTurns = (fixture.referenceTurns as ReferenceTurn[]) || [];
    const critical = (fixture.criticalEntities as CriticalEntities) || {
      money: [],
      dates: [],
      digits: [],
      names: [],
      decisions: [],
    };
    const fmt = normalizeAudioFormat(fixture.audioFormat);

    let audio: Buffer;
    try {
      audio = Buffer.from(fixture.audioBase64 as string, "base64");
    } catch (e) {
      notes.push(`fixture ${fixture.id}: failed to decode audioBase64 (${(e as Error).message}) — skipped`);
      continue;
    }

    // Build one or more audio "jobs" per fixture. A dual-channel WAV recording
    // (real Twilio call) is split into per-channel streams so each candidate
    // hears exactly what production STT hears: one speaker per stream, at
    // ORIGINAL 8kHz telephone quality (channel de-interleave + μ-law transcode
    // only — never resampled or enhanced). Each channel is scored against the
    // reference turns of its role, which is what makes Owner/Guest WER honest.
    interface AudioJob {
      label: string;
      refTurns: ReferenceTurn[];
      mulaw: Buffer | null; // null => realtime candidates cannot run this job
      batchAudio: Buffer;
      batchFilename: string;
      batchMime: string;
    }
    const jobs: AudioJob[] = [];
    const isWav = (fixture.audioFormat || "").toLowerCase() === "wav";
    if (isWav && fixture.audioChannels === "dual") {
      try {
        const split = splitWavChannels(audio);
        const roleMap: Array<"owner" | "guest"> = Array.isArray((fixture as any).channelRoles) && (fixture as any).channelRoles.length
          ? (fixture as any).channelRoles
          : ["owner", "guest"];
        split.channels.forEach((ch, i) => {
          const role = roleMap[i] === "guest" ? "guest" : roleMap[i] === "owner" ? "owner" : (i === 0 ? "owner" : "guest");
          jobs.push({
            label: `channel ${i} (${role})`,
            refTurns: refTurns.filter((t) => t.role === role),
            mulaw: ch.mulaw8k,
            batchAudio: ch.wav,
            batchFilename: `channel${i}-${role}.wav`,
            batchMime: "audio/wav",
          });
        });
        notes.push(`fixture ${fixture.id}: dual-channel recording split into ${split.channels.length} per-role streams (${roleMap.join("/")}); original 8kHz telephone audio, no enhancement.`);
      } catch (e) {
        notes.push(`fixture ${fixture.id}: channel split failed (${(e as Error).message}) — realtime candidates skipped; batch runs on the whole file.`);
        jobs.push({ label: "whole file", refTurns, mulaw: null, batchAudio: audio, batchFilename: fmt.filename, batchMime: fmt.mime });
      }
    } else if (fmt.isMulaw8k) {
      jobs.push({ label: "whole stream", refTurns, mulaw: audio, batchAudio: audio, batchFilename: fmt.filename, batchMime: fmt.mime });
    } else {
      notes.push(`fixture ${fixture.id}: audioFormat=${fixture.audioFormat}/${fixture.audioChannels ?? "?"} — realtime candidates need mulaw8k or a dual-channel 8kHz WAV; only batch runs.`);
      jobs.push({ label: "whole file", refTurns, mulaw: null, batchAudio: audio, batchFilename: fmt.filename, batchMime: fmt.mime });
    }

    for (const c of runnable) {
      for (const job of jobs) {
      // Per-candidate isolation: any failure here becomes a recorded error, not
      // an aborted run.
      try {
        let outcome: StreamOutcome;
        if (c.kind === "batch") {
          outcome = await transcribeOpenAiBatch(c, job.batchAudio, job.batchFilename, job.batchMime);
        } else if (c.provider === "deepgram" || c.provider === "openai") {
          if (!job.mulaw) {
            notes.push(`fixture ${fixture.id} / ${c.id} / ${job.label}: no mulaw8k stream available for realtime candidate — skipped.`);
            continue;
          }
          outcome = c.provider === "deepgram"
            ? await streamDeepgram(c, job.mulaw)
            : await streamOpenAiRealtime(c, job.mulaw);
        } else {
          notes.push(`fixture ${fixture.id} / ${c.id}: unsupported provider — skipped.`);
          continue;
        }

        if (outcome.note) {
          notes.push(`fixture ${fixture.id} / ${c.id} / ${job.label}: ${outcome.note}`);
        }

        const rowAcc = acc.get(c.id)!;
        const jobRole = job.refTurns.every((t) => t.role === job.refTurns[0]?.role)
          ? job.refTurns[0]?.role ?? null : null;
        const jobRefJoined = job.refTurns.map((t) => t.text).join(" ");
        const jobRefWords = jobRefJoined.split(/\s+/).filter(Boolean).length;

        if (outcome.error) {
          // A failed channel is a FULL DELETION for the comparable channel
          // score — skipping it would let a candidate improve its aggregate
          // by failing on hard channels.
          notes.push(`fixture ${fixture.id} / ${c.id} / ${job.label}: stream error — ${outcome.error}; channel scored as full deletion (WER 1.0), never skipped.`);
          rowAcc.wer.push(1);
          rowAcc.werWeights!.push(jobRefWords);
          rowAcc.cer!.push(1);
          rowAcc.roles!.push(jobRole);
          rowAcc.semantic.push(0);
          const eaFail = entityAccuracy(critical, "");
          rowAcc.moneyAcc.push(eaFail.money);
          rowAcc.digitsAcc.push(eaFail.digits);
          rowAcc.termsAcc!.push(termsAccuracy(critical.terms, jobRefJoined, ""));
          rowAcc.perTurnBases!.push("unavailable");
          turnResults.push({
            turnIdx: -1,
            candidateId: c.id,
            hypothesisText: "",
            role: jobRole,
            wer: 1,
            cer: 1,
            entityAccuracy: null,
            prematureEot: null,
            falseContinuation: null,
            speechEndToFinalMs: null,
            speechEndToEotMs: null,
            error: outcome.error,
          });
          continue;
        }

        // -------------------------------------------------------------------
        // UNIFIED COMPARABILITY RULE — identical for EVERY candidate:
        //
        // 1. WER / Owner WER / Guest WER / Semantic / entity accuracy are
        //    scored at the CHANNEL level (whole per-role stream as one
        //    document). No alignment involved, so Flux, nova-3, OpenAI
        //    realtime and batch are all measured by the same method.
        // 2. Per-turn metrics (EOT latency, premature EOT, false wait) are
        //    computed ONLY when the finals→turns mapping is provable without
        //    the candidate's own text (timestamps or exact count). Otherwise
        //    they are UNAVAILABLE — never inferred.
        // -------------------------------------------------------------------
        const hypJoined = outcome.finals.map((f) => f.text).join(" ");
        const docAligned: Aligned = {
          refTurn: { idx: -1, role: (jobRole ?? "guest") as any, text: jobRefJoined },
          hypText: hypJoined,
          hypAtMs: null, // channel-level score carries no latency semantics
          hypEndOfTurn: null,
        };
        const docTr = scoreTurn(c.id, docAligned, critical, 0);
        docTr.role = jobRole as any;
        turnResults.push(docTr);
        rowAcc.wer.push(hypJoined ? docTr.wer : 1); // empty stream = full deletion
        rowAcc.werWeights!.push(jobRefWords);
        rowAcc.cer!.push(hypJoined ? docTr.cer : 1);
        rowAcc.roles!.push(jobRole);
        rowAcc.semantic.push(semanticProxy(jobRefJoined, hypJoined));
        // Empty stream = missed applicable entities score ZERO, not null —
        // otherwise dropping the audio would exclude the penalty entirely.
        const eaDoc = hypJoined ? docTr.entityAccuracy : entityAccuracy(critical, "");
        rowAcc.moneyAcc.push(eaDoc?.money ?? null);
        rowAcc.digitsAcc.push(eaDoc?.digits ?? null);
        rowAcc.termsAcc!.push(hypJoined ? docTr.entityAccuracy?.terms ?? null : termsAccuracy(critical.terms, jobRefJoined, ""));

        // Per-turn pass — provable mapping only.
        const { basis, aligned } = alignProvably(outcome.finals, job.refTurns);
        rowAcc.perTurnBases!.push(basis);
        if (basis === "unavailable") {
          notes.push(`fixture ${fixture.id} / ${c.id} / ${job.label}: per-turn metrics UNAVAILABLE — mapping requires reference turn boundaries (tEndMs) AND provider audio offsets on every final (${outcome.finals.length} final(s) vs ${job.refTurns.length} reference turns); refusing count/order/receipt-time/text inference. Channel-level WER above is the comparable score.`);
          continue;
        }
        notes.push(`fixture ${fixture.id} / ${c.id} / ${job.label}: per-turn mapping proven by audio-timeline boundaries (reference tEndMs × provider audio offsets) — ${aligned.length} turns scored per-turn.`);

        for (const a of aligned) {
          try {
            const tr = scoreTurn(c.id, a, critical, outcome.lastFrameSentAtMs);
            turnResults.push(tr);
            rowAcc.perTurnScored = (rowAcc.perTurnScored ?? 0) + 1;
            // Per-turn samples feed ONLY the turn-boundary metrics. Accuracy
            // columns stay channel-level so all candidates remain comparable.
            rowAcc.prematureEotFlags.push(tr.prematureEot);
            rowAcc.falseWaitFlags.push(tr.falseContinuation);
            rowAcc.finalLatencies.push(a.hypText ? tr.speechEndToFinalMs : null);
            rowAcc.eotLatencies.push(tr.speechEndToEotMs);
          } catch (e) {
            // Per-turn isolation.
            turnResults.push({
              turnIdx: a.refTurn.idx,
              candidateId: c.id,
              hypothesisText: a.hypText,
              role: a.refTurn.role,
              wer: null,
              cer: null,
              entityAccuracy: null,
              prematureEot: null,
              falseContinuation: null,
              speechEndToFinalMs: null,
              speechEndToEotMs: null,
              error: `turn scoring failed: ${(e as Error).message}`,
            });
          }
        }
      } catch (e) {
        notes.push(`fixture ${fixture.id} / ${c.id} / ${job.label}: candidate run failed — ${(e as Error).message}`);
      }
      }
    }
  }

  const scorecard: EarsScorecardRow[] = [];
  for (const c of runnable) {
    scorecard.push(buildScorecardRow(acc.get(c.id)!));
  }

  if (withAudio.length === 0) {
    notes.push("No fixtures with audio were provided — EARS produced no transcription results.");
  }

  // Reference-only candidates never win a LIVE comparison; annotate.
  for (const c of runnable) {
    if (c.referenceOnly) {
      notes.push(`Candidate ${c.id} is reference-only (accuracy ceiling); excluded from LIVE winner selection.`);
    }
  }

  // Touch normalizeText so tree-shakers keep the import meaningful and the
  // helper stays exercised by the harness path.
  void normalizeText;

  return { turnResults, scorecard, notes };
}
