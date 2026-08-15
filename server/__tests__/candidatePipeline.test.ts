// Candidate Pipeline v1 (Task #207) — unit tests for the pure parts:
// candidate id validation, mulaw conversion shape, and the hint latency
// recorder / summary math that feeds the admin verdict.

import { describe, it, expect } from "vitest";
import {
  CANDIDATE_STT_IDS,
  CANDIDATE_BRAIN_MODELS,
  isCandidateStt,
  isCandidateBrainModel,
  mulawToPcm16_24k,
  LiveLatencyRecorder,
  summarizeHintLatencies,
  HINT_SLA_MS,
  type HintLatencyEntry,
} from "../candidatePipeline";

describe("candidate id validation", () => {
  it("accepts only the benchmark realtime STT candidates", () => {
    expect(isCandidateStt("oai-realtime-server-vad")).toBe(true);
    expect(isCandidateStt("oai-realtime-semantic-vad")).toBe(true);
    expect(isCandidateStt("oai-batch-gpt-4o-transcribe")).toBe(false); // batch is not a live candidate
    expect(isCandidateStt("dg-flux-general-en")).toBe(false); // production, not a candidate
    expect(isCandidateStt(null)).toBe(false);
    expect(isCandidateStt("")).toBe(false);
  });

  it("accepts only the benchmark brain candidate models (no silent substitution)", () => {
    for (const m of CANDIDATE_BRAIN_MODELS) expect(isCandidateBrainModel(m)).toBe(true);
    expect(isCandidateBrainModel("gpt-4.1-mini")).toBe(false); // production model is not a candidate
    expect(isCandidateBrainModel("gpt-5.6-luna ")).toBe(false); // exact match only
    expect(isCandidateBrainModel(undefined)).toBe(false);
  });

  it("candidate lists are non-empty (guards against accidental emptying)", () => {
    expect(CANDIDATE_STT_IDS.length).toBeGreaterThan(0);
    expect(CANDIDATE_BRAIN_MODELS.length).toBeGreaterThan(0);
  });
});

describe("mulawToPcm16_24k", () => {
  it("produces 6 output bytes per input byte (16-bit + 3x upsample)", () => {
    const out = mulawToPcm16_24k(Buffer.from([0xff, 0x7f, 0x00]));
    expect(out.length).toBe(3 * 6);
  });

  it("mulaw silence (0xff) decodes to zero PCM", () => {
    const out = mulawToPcm16_24k(Buffer.from([0xff]));
    expect(out.readInt16LE(0)).toBe(0);
    expect(out.readInt16LE(2)).toBe(0);
    expect(out.readInt16LE(4)).toBe(0);
  });
});

describe("LiveLatencyRecorder", () => {
  it("records a full sent lifecycle with monotonically consistent stages", () => {
    const r = new LiveLatencyRecorder();
    const t0 = Date.now();
    r.start(1, t0);
    r.trigger(1);
    r.ready(1, "gpt");
    r.sent(1);
    const meta = r.toMetadata({ enabled: true, stt: "oai-realtime-semantic-vad", brainModel: "gpt-5.6-luna" }) as any;
    expect(meta.candidatePipeline).toEqual({
      enabled: true,
      stt: "oai-realtime-semantic-vad",
      brainModel: "gpt-5.6-luna",
      sttEffective: null,
      sttSwapDelayMs: null,
    });
    const e = meta.hintLatency.entries[0];
    expect(e.outcome).toBe("sent");
    expect(e.source).toBe("gpt");
    expect(e.triggerAt).toBeGreaterThanOrEqual(t0);
    expect(e.readyAt).toBeGreaterThanOrEqual(e.triggerAt);
    expect(e.sentAt).toBeGreaterThanOrEqual(e.readyAt);
    expect(meta.hintLatency.summary.hintsSent).toBe(1);
    expect(meta.hintLatency.slaMs).toBe(HINT_SLA_MS);
  });

  it("a dropped turn keeps its FIRST drop reason and never counts as sent", () => {
    const r = new LiveLatencyRecorder();
    r.start(5, Date.now());
    r.dropped(5, "cooldown");
    r.dropped(5, "no_suggestion"); // later reason must not overwrite
    const meta = r.toMetadata({ enabled: false, stt: null, brainModel: null }) as any;
    expect(meta.hintLatency.entries[0].outcome).toBe("dropped");
    expect(meta.hintLatency.entries[0].dropReason).toBe("cooldown");
    expect(meta.hintLatency.summary.hintsSent).toBe(0);
    expect(meta.hintLatency.summary.hintsDropped).toBe(1);
    // Disabled pipeline is labeled as such (baseline call), candidates nulled.
    expect(meta.candidatePipeline).toEqual({ enabled: false, stt: null, brainModel: null, sttEffective: null, sttSwapDelayMs: null });
  });

  it("dropped() after sent() does not un-send an entry", () => {
    const r = new LiveLatencyRecorder();
    r.start(2, Date.now());
    r.trigger(2);
    r.ready(2);
    r.sent(2);
    r.dropped(2, "late_reason");
    const meta = r.toMetadata({ enabled: false, stt: null, brainModel: null }) as any;
    expect(meta.hintLatency.entries[0].outcome).toBe("sent");
  });
});

describe("summarizeHintLatencies", () => {
  const entry = (totalMs: number, brainMs: number, id: number): HintLatencyEntry => {
    const t0 = 1_000_000;
    return {
      utteranceId: id,
      sttFinalAt: t0,
      triggerAt: t0 + 50,
      readyAt: t0 + 50 + brainMs,
      sentAt: t0 + totalMs,
      outcome: "sent",
    };
  };

  it("computes p50/p95 and SLA share from sent entries only", () => {
    const entries: HintLatencyEntry[] = [
      entry(400, 300, 1),
      entry(800, 600, 2),
      entry(1600, 1400, 3),
      { utteranceId: 4, sttFinalAt: 0, outcome: "dropped", dropReason: "cooldown" },
    ];
    const s = summarizeHintLatencies(entries);
    expect(s.hintsSent).toBe(3);
    expect(s.hintsDropped).toBe(1);
    expect(s.totalP50Ms).toBe(800);
    expect(s.totalP95Ms).toBe(1600);
    expect(s.brainP50Ms).toBe(600);
    // 2 of 3 within the 1000ms SLA
    expect(s.withinSlaPct).toBe(67);
  });

  it("returns nulls (never fabricated zeros) when no hints were sent", () => {
    const s = summarizeHintLatencies([
      { utteranceId: 1, sttFinalAt: 0, outcome: "dropped", dropReason: "reaction_only" },
    ]);
    expect(s.hintsSent).toBe(0);
    expect(s.totalP50Ms).toBeNull();
    expect(s.totalP95Ms).toBeNull();
    expect(s.brainP50Ms).toBeNull();
    expect(s.withinSlaPct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transactional STT swap: createOpenAiRealtimeStt must NOT report success
// until the WebSocket handshake completes; failure/timeout returns { error }.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { createOpenAiRealtimeStt, classifyPipelineCall } from "../candidatePipeline";

class FakeWs extends EventEmitter {
  readyState = 0; // CONNECTING
  sentFrames: string[] = [];
  closed = false;
  send(data: string) { this.sentFrames.push(data); }
  close() { this.closed = true; this.emit("close", 1000); }
}

const okSecretFetch = (async () =>
  ({ ok: true, status: 200, text: async () => JSON.stringify({ value: "ephemeral-secret" }) })) as unknown as typeof fetch;

function makeOpts(ws: FakeWs, openTimeoutMs = 200) {
  return {
    sttId: "oai-realtime-semantic-vad" as const,
    track: "inbound",
    onInterim: () => {},
    onFinal: () => {},
    log: () => {},
    openTimeoutMs,
    wsFactory: () => ws as any,
    fetchImpl: okSecretFetch,
  };
}

describe("createOpenAiRealtimeStt handshake (transactional swap)", () => {
  it("resolves with a connection only AFTER the socket opens", async () => {
    const ws = new FakeWs();
    const p = createOpenAiRealtimeStt(makeOpts(ws));
    let resolved = false;
    p.then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false); // still handshaking — caller must keep Flux
    ws.readyState = 1; // OPEN
    ws.emit("open");
    const conn = await p;
    expect("error" in conn).toBe(false);
  });

  it("handshake error resolves with { error } and closes the socket (never a fake success)", async () => {
    const ws = new FakeWs();
    const p = createOpenAiRealtimeStt(makeOpts(ws));
    await new Promise((r) => setTimeout(r, 5));
    ws.emit("error", new Error("401 unauthorized"));
    const res = await p;
    expect("error" in res && res.error).toContain("401");
    expect(ws.closed).toBe(true);
  });

  it("a socket that never opens times out with { error } (bounded wait)", async () => {
    const ws = new FakeWs();
    const res = await createOpenAiRealtimeStt(makeOpts(ws, 60));
    expect("error" in res && res.error).toContain("timeout");
    expect(ws.closed).toBe(true);
  });

  it("client-secret failure surfaces the real error without touching the socket", async () => {
    const badFetch = (async () =>
      ({ ok: false, status: 403, text: async () => "no access" })) as unknown as typeof fetch;
    const ws = new FakeWs();
    const res = await createOpenAiRealtimeStt({ ...makeOpts(ws), fetchImpl: badFetch });
    expect("error" in res && res.error).toContain("403");
  });
});

describe("classifyPipelineCall (independent STT/Brain candidacy)", () => {
  it("STT swapped + Brain set => both candidacies", () => {
    const l = classifyPipelineCall({ enabled: true, stt: "oai-realtime-semantic-vad", brainModel: "gpt-5.6-luna", sttEffective: "swapped" });
    expect(l).toEqual({ sttCandidate: true, brainCandidate: true, sttSwapFailed: false, isCandidate: true });
  });

  it("STT swap FAILED but Brain override ran => still a Brain-candidate call, NEVER baseline", () => {
    const l = classifyPipelineCall({ enabled: true, stt: "oai-realtime-server-vad", brainModel: "gpt-5.6-luna", sttEffective: "failed" });
    expect(l.sttCandidate).toBe(false);
    expect(l.sttSwapFailed).toBe(true);
    expect(l.brainCandidate).toBe(true);
    expect(l.isCandidate).toBe(true);
  });

  it("STT-only pipeline whose swap failed is excluded from the candidate cohort", () => {
    const l = classifyPipelineCall({ enabled: true, stt: "oai-realtime-server-vad", brainModel: null, sttEffective: "failed" });
    expect(l.isCandidate).toBe(false);
    expect(l.sttSwapFailed).toBe(true);
  });

  it("missing sttEffective (crash before flush) is treated as NOT swapped", () => {
    const l = classifyPipelineCall({ enabled: true, stt: "oai-realtime-server-vad", brainModel: null, sttEffective: null });
    expect(l.sttCandidate).toBe(false);
    expect(l.isCandidate).toBe(false);
  });

  it("disabled or absent pipeline is baseline", () => {
    expect(classifyPipelineCall(null).isCandidate).toBe(false);
    expect(classifyPipelineCall({ enabled: false, stt: "oai-realtime-server-vad", brainModel: "gpt-5.6-luna" }).isCandidate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Teardown race source guards: the async candidate STT setup in websocket.ts
// must abort when the Twilio stream closes first, and must finish any sockets
// it created — no late swap after cleanup, no orphaned realtime sessions.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

describe("websocket.ts candidate swap teardown race (source guards)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "websocket.ts"), "utf8");

  it("stream close paths set the streamClosed flag before pipeline state is touched", () => {
    // Both teardown paths (Twilio "stop" event and raw ws close) must arm the guard.
    const stopIdx = src.indexOf('case "stop":\n            log(`Stream ended');
    expect(stopIdx).toBeGreaterThan(-1);
    expect(src.slice(stopIdx, stopIdx + 400)).toContain("streamClosed = true");
    const closeIdx = src.indexOf("[Twilio] WS closed code=");
    expect(closeIdx).toBeGreaterThan(-1);
    expect(src.slice(closeIdx, closeIdx + 400)).toContain("streamClosed = true");
  });

  it("swapToCandidateStt checks closure after the async handshakes and finishes created sockets", () => {
    const fnIdx = src.indexOf("async function swapToCandidateStt");
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = src.slice(fnIdx, src.indexOf("ws.on(\"message\"", fnIdx));
    // Guard before setup starts.
    expect(fn).toContain("if (streamClosed) return;");
    // Guard AFTER the awaited handshakes, with cleanup of both created sockets.
    const postAwait = fn.slice(fn.indexOf("await Promise.all"));
    expect(postAwait).toContain("if (streamClosed) {");
    expect(postAwait).toContain('if (!("error" in inbound)) inbound.finish();');
    expect(postAwait).toContain('if (!("error" in outbound)) outbound.finish();');
    // The closed-race branch must return BEFORE any pipeline state mutation.
    const closedBranch = postAwait.slice(postAwait.indexOf("if (streamClosed) {"), postAwait.indexOf('if ("error" in inbound'));
    expect(closedBranch).toContain("return;");
    expect(closedBranch).not.toContain("sttSwapState");
    expect(closedBranch).not.toContain("deepgramInbound =");
  });

  it("the pipeline config loader re-checks closure after each async boundary", () => {
    const idx = src.indexOf("const pipelineReady = ownerContextReady");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 900);
    expect(block).toContain("if (!streamUserId || streamClosed) return;");
    expect(block).toContain("if (!cfg.enabled || streamClosed) return;");
  });
});
