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
const REALTIME_ACCEL = 4; // send 20ms frames every 5ms (4x faster than realtime)
const FRAME_BYTES_MULAW = 160; // 20ms @ 8kHz mulaw

interface CollectedFinal {
  text: string;
  /** ms since first audio frame sent (harness clock) */
  atMs: number;
  isEndOfTurn: boolean;
}

interface StreamOutcome {
  finals: CollectedFinal[];
  lastFrameSentAtMs: number;
  error?: string;
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
          finals.push({ text: transcript, atMs: nowMs() - start, isEndOfTurn: true });
        }
        return;
      }
      // nova-3 v1: results with is_final / speech_final.
      if (msg.type === "Results" || msg.channel) {
        const alt = msg.channel?.alternatives?.[0];
        const transcript = String(alt?.transcript || "").trim();
        if (transcript && (msg.is_final || msg.speech_final)) {
          finals.push({ text: transcript, atMs: nowMs() - start, isEndOfTurn: !!msg.speech_final });
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
        // v1 needs an explicit CloseStream to flush; v2 flushes on EOT timeout.
        try {
          ws!.send(JSON.stringify({ type: "CloseStream" }));
        } catch {
          /* ignore */
        }
        // Wait a bounded window for trailing finals.
        await sleep(2500);
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
// Alignment: greedy best-match of collected finals to reference turns
// ---------------------------------------------------------------------------

function similarity(a: string, b: string): number {
  return 1 - Math.min(1, wordErrorRate(a, b));
}

interface Aligned {
  refTurn: ReferenceTurn;
  hypText: string;
  hypAtMs: number | null;
  hypEndOfTurn: boolean | null;
}

/**
 * Greedy alignment by order + similarity: walk reference turns in order and,
 * for each, consume the next best-matching final that appears at or after the
 * previously consumed final. Finals that don't clearly match are concatenated
 * into the nearest reference turn to avoid dropping content.
 */
function alignFinalsToTurns(finals: CollectedFinal[], refTurns: ReferenceTurn[]): Aligned[] {
  const aligned: Aligned[] = refTurns.map((t) => ({
    refTurn: t,
    hypText: "",
    hypAtMs: null,
    hypEndOfTurn: null,
  }));
  if (finals.length === 0 || refTurns.length === 0) return aligned;

  let refCursor = 0;
  for (const f of finals) {
    // Search a small forward window for the best matching reference turn.
    let bestIdx = refCursor;
    let bestSim = -1;
    const windowEnd = Math.min(refTurns.length, refCursor + 4);
    for (let i = refCursor; i < windowEnd; i++) {
      const s = similarity(refTurns[i].text, f.text);
      if (s > bestSim) {
        bestSim = s;
        bestIdx = i;
      }
    }
    const slot = aligned[bestIdx];
    slot.hypText = slot.hypText ? `${slot.hypText} ${f.text}` : f.text;
    slot.hypAtMs = f.atMs;
    slot.hypEndOfTurn = f.isEndOfTurn;
    refCursor = bestIdx; // don't move backwards
  }
  return aligned;
}

// ---------------------------------------------------------------------------
// Per-turn scoring
// ---------------------------------------------------------------------------

function scoreTurn(
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
  let speechEndToFinalMs: number | null = null;
  if (a.hypAtMs !== null && lastFrameSentAtMs > 0) {
    const delta = a.hypAtMs - lastFrameSentAtMs;
    // Scale accelerated harness clock back toward real time.
    speechEndToFinalMs = delta >= 0 ? Math.round(delta * REALTIME_ACCEL) : null;
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
    prematureEot: null, // requires per-turn boundary ground truth (not available yet)
    falseContinuation: null,
    speechEndToFinalMs,
    speechEndToEotMs: null,
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
      roles: [],
      cer: [],
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

        if (outcome.error) {
          notes.push(`fixture ${fixture.id} / ${c.id}: stream error — ${outcome.error}`);
          turnResults.push({
            turnIdx: -1,
            candidateId: c.id,
            hypothesisText: "",
            role: null,
            wer: null,
            cer: null,
            entityAccuracy: null,
            prematureEot: null,
            falseContinuation: null,
            speechEndToFinalMs: null,
            speechEndToEotMs: null,
            error: outcome.error,
          });
          continue;
        }

        const rowAcc = acc.get(c.id)!;

        // Degenerate turn detection (few giant finals — e.g. batch output or a
        // model whose EOT collapsed on this audio) makes per-turn alignment
        // meaningless: one reference turn gets the whole channel's text and
        // WER explodes into the thousands of percent. In that case score the
        // channel as ONE document (standard document-level WER) — honest, and
        // clearly noted. Per-channel jobs have a single role, so Owner/Guest
        // WER stays meaningful.
        const uniformRole = job.refTurns.every((t) => t.role === job.refTurns[0]?.role)
          ? job.refTurns[0]?.role ?? null : null;
        const degenerate = outcome.finals.length > 0 && job.refTurns.length >= 4 &&
          outcome.finals.length < job.refTurns.length / 2;
        if (degenerate) {
          const refJoined = job.refTurns.map((t) => t.text).join(" ");
          const hypJoined = outcome.finals.map((f) => f.text).join(" ");
          const docAligned: Aligned = {
            refTurn: { idx: -1, role: (uniformRole ?? "guest") as any, text: refJoined },
            hypText: hypJoined,
            hypAtMs: outcome.finals[outcome.finals.length - 1]?.atMs ?? null,
            hypEndOfTurn: null,
          };
          const tr = scoreTurn(c.id, docAligned, critical, outcome.lastFrameSentAtMs);
          tr.role = uniformRole as any;
          turnResults.push(tr);
          rowAcc.wer.push(tr.wer);
          rowAcc.cer!.push(tr.cer);
          rowAcc.roles!.push(uniformRole);
          rowAcc.semantic.push(semanticProxy(refJoined, hypJoined));
          rowAcc.moneyAcc.push(tr.entityAccuracy?.money ?? null);
          rowAcc.digitsAcc.push(tr.entityAccuracy?.digits ?? null);
          rowAcc.termsAcc!.push(tr.entityAccuracy?.terms ?? null);
          rowAcc.prematureEotFlags.push(null);
          rowAcc.falseWaitFlags.push(null);
          rowAcc.finalLatencies.push(null);
          rowAcc.eotLatencies.push(null);
          notes.push(`fixture ${fixture.id} / ${c.id} / ${job.label}: turn detection produced ${outcome.finals.length} final(s) for ${job.refTurns.length} reference turns — scored as document-level WER instead of per-turn alignment.`);
          continue;
        }

        const aligned = alignFinalsToTurns(outcome.finals, job.refTurns);

        for (const a of aligned) {
          try {
            const tr = scoreTurn(c.id, a, critical, outcome.lastFrameSentAtMs);
            turnResults.push(tr);
            // EVERY reference turn counts. A turn the candidate never
            // transcribed is a full deletion (WER 1.0) — excluding missed
            // turns would let a candidate look better by dropping the hard
            // ones. (Stream-level errors were already handled above and never
            // reach this loop.)
            if (a.hypText) {
              rowAcc.wer.push(tr.wer);
              rowAcc.cer!.push(tr.cer);
              rowAcc.roles!.push(a.refTurn.role ?? null);
              rowAcc.semantic.push(semanticProxy(a.refTurn.text, a.hypText));
              rowAcc.moneyAcc.push(tr.entityAccuracy?.money ?? null);
              rowAcc.digitsAcc.push(tr.entityAccuracy?.digits ?? null);
              rowAcc.termsAcc!.push(tr.entityAccuracy?.terms ?? null);
              rowAcc.prematureEotFlags.push(tr.prematureEot);
              rowAcc.falseWaitFlags.push(tr.falseContinuation);
              rowAcc.finalLatencies.push(tr.speechEndToFinalMs);
              rowAcc.eotLatencies.push(tr.speechEndToEotMs);
            } else {
              rowAcc.wer.push(1); // missed turn = everything deleted
              rowAcc.cer!.push(1);
              rowAcc.roles!.push(a.refTurn.role ?? null);
              rowAcc.semantic.push(0);
              rowAcc.moneyAcc.push(null);
              rowAcc.digitsAcc.push(null);
              rowAcc.termsAcc!.push(termsAccuracy(critical.terms, a.refTurn.text, ""));
              rowAcc.prematureEotFlags.push(null);
              rowAcc.falseWaitFlags.push(null);
              rowAcc.finalLatencies.push(null);
              rowAcc.eotLatencies.push(null);
            }
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
