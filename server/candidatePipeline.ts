// Candidate Pipeline v1 (Task #207).
//
// Per-user experimental live-call pipeline: an alternate realtime STT
// (OpenAI realtime transcription instead of Deepgram Flux) and/or an
// alternate Brain (hint) model — enabled per user, OFF by default, so the
// production pipeline is never affected unless the flag is explicitly set.
//
// Also owns the per-call hint latency recorder: guest end-of-turn (STT final)
// → Brain trigger → first usable hint text → ws sent. Stages are flushed into
// calls.metadata at call end so the admin verdict endpoint can compare a
// candidate call against baseline calls.

import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Allowed candidate ids — kept in lockstep with the benchmark candidate lists
// (server/benchmark/candidates.ts). No silent substitution: an unknown id is
// rejected at save time, never coerced.
// ---------------------------------------------------------------------------

export const CANDIDATE_STT_IDS = [
  "oai-realtime-server-vad",
  "oai-realtime-semantic-vad",
] as const;
export type CandidateSttId = (typeof CANDIDATE_STT_IDS)[number];

export const CANDIDATE_BRAIN_MODELS = [
  "gpt-5.2",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
] as const;

export function isCandidateStt(id: unknown): id is CandidateSttId {
  return typeof id === "string" && (CANDIDATE_STT_IDS as readonly string[]).includes(id);
}
export function isCandidateBrainModel(m: unknown): m is string {
  return typeof m === "string" && (CANDIDATE_BRAIN_MODELS as readonly string[]).includes(m);
}

export interface CandidatePipelineConfig {
  enabled: boolean;
  stt: string | null; // CandidateSttId or null (= keep production Flux)
  brainModel: string | null; // candidate model id or null (= keep production model)
}

export const DISABLED_PIPELINE: CandidatePipelineConfig = {
  enabled: false,
  stt: null,
  brainModel: null,
};

// ---------------------------------------------------------------------------
// OpenAI realtime transcription — live adapter.
// Mirrors the benchmark harness streaming shape (GA realtime API, transcription
// intent, ephemeral client secret, pcm16@24k) but runs against live Twilio
// mulaw@8k frames in real time.
// ---------------------------------------------------------------------------

const OAI_STT_MODEL = "gpt-4o-transcribe";

function sttTurnDetection(id: CandidateSttId): string {
  return id === "oai-realtime-semantic-vad" ? "semantic_vad" : "server_vad";
}

async function mintClientSecret(turnDetection: string, fetchImpl: typeof fetch = fetch): Promise<{ value: string } | { error: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: "OPENAI_API_KEY missing" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 13000);
  try {
    const res = await fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: { input: { transcription: { model: OAI_STT_MODEL }, turn_detection: { type: turnDetection } } },
        },
      }),
      signal: ac.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) return { error: `client_secret HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
    const value = JSON.parse(bodyText)?.value;
    if (!value) return { error: "no client secret in response" };
    return { value };
  } catch (e) {
    return { error: (e as Error).name === "AbortError" ? "client_secret timeout" : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** mulaw@8k bytes -> PCM16@24k (naive 3x upsample), matching the harness. */
export function mulawToPcm16_24k(mulaw: Buffer): Buffer {
  const BIAS = 0x84;
  const decoded = Buffer.alloc(mulaw.length * 2 * 3);
  let w = 0;
  for (let i = 0; i < mulaw.length; i++) {
    const u = ~mulaw[i] & 0xff;
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

/** Same shape as the Deepgram wrapper in websocket.ts: send + finish. */
export interface LiveSttConnection {
  send: (mulaw: Buffer) => void;
  finish: () => void;
}

export interface OaiRealtimeSttOptions {
  sttId: CandidateSttId;
  track: string; // for logging only
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  log: (msg: string) => void;
  /** Bounded wait for the WebSocket handshake. Default 10s. */
  openTimeoutMs?: number;
  /** Test injection points. */
  wsFactory?: (url: string, headers: Record<string, string>) => WebSocket;
  fetchImpl?: typeof fetch;
}

/**
 * Open a live OpenAI realtime transcription socket for one Twilio track.
 * TRANSACTIONAL: resolves with a connection ONLY after the WebSocket handshake
 * has completed (bounded by openTimeoutMs); any construct/handshake/auth
 * failure or timeout resolves with { error } instead. The caller must NOT tear
 * down the production STT until this resolves successfully — that is what
 * keeps a failed candidate swap from leaving a call with no transcription
 * while being labeled "swapped". Post-open failures are surfaced via log; we
 * never silently fall back to Flux mid-call, so a candidate run is never
 * contaminated by mixed STT output.
 */
export async function createOpenAiRealtimeStt(opts: OaiRealtimeSttOptions): Promise<LiveSttConnection | { error: string }> {
  const secret = await mintClientSecret(sttTurnDetection(opts.sttId), opts.fetchImpl ?? fetch);
  if ("error" in secret) return { error: secret.error };

  let ws: WebSocket;
  try {
    // GA realtime API — no OpenAI-Beta header (beta shape rejected since 2026).
    const headers = { Authorization: `Bearer ${secret.value}` };
    ws = opts.wsFactory
      ? opts.wsFactory("wss://api.openai.com/v1/realtime?intent=transcription", headers)
      : new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", { headers });
  } catch (e) {
    return { error: `ws construct error: ${(e as Error).message}` };
  }

  let closed = false;
  let interimAcc = ""; // delta events accumulate the in-progress turn text

  // Wait for the handshake (or a bounded timeout) before reporting success.
  const opened = await new Promise<{ ok: true } | { error: string }>((resolve) => {
    let settled = false;
    const settle = (r: { ok: true } | { error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => settle({ error: `handshake timeout after ${opts.openTimeoutMs ?? 10000}ms` }), opts.openTimeoutMs ?? 10000);
    ws.once("open", () => settle({ ok: true }));
    ws.once("unexpected-response", (_req: unknown, res: any) => settle({ error: `handshake HTTP ${res?.statusCode}` }));
    ws.once("error", (err: Error) => settle({ error: `ws error: ${err.message}` }));
    ws.once("close", (code: number) => settle({ error: `closed during handshake code=${code}` }));
  });
  if ("error" in opened) {
    try { ws.close(); } catch { /* ignore */ }
    return { error: opened.error };
  }
  opts.log(`[OAI-STT] ${opts.track}: open (${opts.sttId})`);

  ws.on("message", (data: WebSocket.RawData) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "error") {
      if (msg.error?.code === "input_audio_buffer_commit_empty") return;
      opts.log(`[OAI-STT] ${opts.track}: server error ${JSON.stringify(msg.error).slice(0, 200)}`);
      return;
    }
    if (msg.type === "conversation.item.input_audio_transcription.delta") {
      const d = String(msg.delta || "");
      if (d) {
        interimAcc += d;
        opts.onInterim(interimAcc.trim());
      }
      return;
    }
    if (msg.type === "conversation.item.input_audio_transcription.completed") {
      interimAcc = "";
      const transcript = String(msg.transcript || "").trim();
      if (transcript) opts.onFinal(transcript);
    }
  });

  ws.on("error", (err: Error) => opts.log(`[OAI-STT] ${opts.track}: ws error ${err.message}`));
  ws.on("close", (code: number) => {
    if (!closed) opts.log(`[OAI-STT] ${opts.track}: closed code=${code}`);
  });

  return {
    send: (mulaw: Buffer) => {
      if (closed) return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: mulawToPcm16_24k(mulaw).toString("base64") }));
      }
    },
    finish: () => {
      closed = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Verdict classification (pure — unit-tested).
// STT and Brain candidacy are INDEPENDENT: a call whose STT swap failed but
// whose Brain override ran is still a Brain-candidate call, never baseline —
// otherwise a real candidate-Brain result would contaminate the baseline cohort.
// ---------------------------------------------------------------------------

export interface PipelineCallLabel {
  /** STT candidacy: requested AND the swap actually carried the call. */
  sttCandidate: boolean;
  /** Brain candidacy: a candidate Brain model was configured (it always applies once loaded). */
  brainCandidate: boolean;
  /** Candidate STT was requested but the swap failed (call ran on production STT). */
  sttSwapFailed: boolean;
  /** In ANY candidate cohort (stt or brain). Baseline = not this. */
  isCandidate: boolean;
}

export function classifyPipelineCall(pipelineMeta: {
  enabled?: boolean;
  stt?: string | null;
  brainModel?: string | null;
  sttEffective?: string | null;
} | null | undefined): PipelineCallLabel {
  const enabled = !!pipelineMeta?.enabled;
  const sttRequested = enabled && pipelineMeta?.stt != null;
  const sttCandidate = sttRequested && pipelineMeta?.sttEffective === "swapped";
  const sttSwapFailed = sttRequested && !sttCandidate;
  const brainCandidate = enabled && pipelineMeta?.brainModel != null;
  return {
    sttCandidate,
    brainCandidate,
    sttSwapFailed,
    isCandidate: sttCandidate || brainCandidate,
  };
}

// ---------------------------------------------------------------------------
// Hint latency recorder (per call).
// Stages, all epoch ms:
//   sttFinalAt — guest end-of-turn committed by STT (handler entry)
//   triggerAt  — Brain (suggestion) request fired
//   readyAt    — first usable hint text available server-side
//   sentAt     — suggestion pushed to the /ui websocket
// ---------------------------------------------------------------------------

export interface HintLatencyEntry {
  utteranceId: number;
  sttFinalAt: number;
  triggerAt?: number;
  readyAt?: number;
  sentAt?: number;
  source?: string; // library | gpt | ...
  outcome: "sent" | "dropped";
  dropReason?: string;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface HintLatencySummary {
  hintsSent: number;
  hintsDropped: number;
  totalP50Ms: number | null; // sttFinal -> sent
  totalP95Ms: number | null;
  brainP50Ms: number | null; // trigger -> ready
  brainP95Ms: number | null;
  withinSlaPct: number | null; // <= 1000ms end-to-end (LIVE SLA target ceiling)
}

export const HINT_SLA_MS = 1000;

export function summarizeHintLatencies(entries: HintLatencyEntry[]): HintLatencySummary {
  const sent = entries.filter((e) => e.outcome === "sent" && e.sentAt);
  const totals = sent.map((e) => e.sentAt! - e.sttFinalAt).sort((a, b) => a - b);
  const brains = sent
    .filter((e) => e.triggerAt && e.readyAt)
    .map((e) => e.readyAt! - e.triggerAt!)
    .sort((a, b) => a - b);
  return {
    hintsSent: sent.length,
    hintsDropped: entries.length - sent.length,
    totalP50Ms: percentile(totals, 50),
    totalP95Ms: percentile(totals, 95),
    brainP50Ms: percentile(brains, 50),
    brainP95Ms: percentile(brains, 95),
    withinSlaPct: totals.length ? Math.round((totals.filter((t) => t <= HINT_SLA_MS).length / totals.length) * 100) : null,
  };
}

export class LiveLatencyRecorder {
  private entries: HintLatencyEntry[] = [];
  private byUtterance = new Map<number, HintLatencyEntry>();

  start(utteranceId: number, sttFinalAt: number): void {
    const e: HintLatencyEntry = { utteranceId, sttFinalAt, outcome: "dropped" };
    this.entries.push(e);
    this.byUtterance.set(utteranceId, e);
  }
  trigger(utteranceId: number): void {
    const e = this.byUtterance.get(utteranceId);
    if (e && !e.triggerAt) e.triggerAt = Date.now();
  }
  ready(utteranceId: number, source?: string): void {
    const e = this.byUtterance.get(utteranceId);
    if (e && !e.readyAt) {
      e.readyAt = Date.now();
      if (source) e.source = source;
    }
  }
  sent(utteranceId: number): void {
    const e = this.byUtterance.get(utteranceId);
    if (e) {
      e.sentAt = Date.now();
      e.outcome = "sent";
    }
  }
  dropped(utteranceId: number, reason: string): void {
    const e = this.byUtterance.get(utteranceId);
    if (e && e.outcome !== "sent" && !e.dropReason) e.dropReason = reason;
  }

  /**
   * Metadata payload merged into calls.metadata at call end.
   * sttInfo makes the label HONEST: "swapped" means the candidate STT actually
   * carried the call (after swapDelayMs of Flux-covered lead-in); "failed"
   * means the swap did not happen and the call must NOT be scored as a
   * candidate STT run even though the flag was enabled.
   */
  toMetadata(
    pipeline: CandidatePipelineConfig,
    sttInfo?: { effective: "swapped" | "failed" | null; swapDelayMs: number | null }
  ): Record<string, unknown> {
    return {
      candidatePipeline: {
        enabled: pipeline.enabled,
        stt: pipeline.enabled ? pipeline.stt : null,
        brainModel: pipeline.enabled ? pipeline.brainModel : null,
        sttEffective: sttInfo?.effective ?? null,
        sttSwapDelayMs: sttInfo?.swapDelayMs ?? null,
      },
      hintLatency: {
        slaMs: HINT_SLA_MS,
        summary: summarizeHintLatencies(this.entries),
        entries: this.entries.slice(0, 200), // hard cap: metadata stays bounded
      },
    };
  }

  get count(): number {
    return this.entries.length;
  }
}
