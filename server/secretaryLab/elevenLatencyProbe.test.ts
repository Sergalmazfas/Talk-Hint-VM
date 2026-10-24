import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { WebSocket, WebSocketServer } from "ws";
import { connectProbeSocket } from "../../scripts/eleven-latency/transport";
import { options, schedule, correlate, summarize, distribution, type Attempt, type Callback, type Observation } from "../../scripts/eleven-latency/experiment";
import { fixtureManifest, loadFixtures } from "../../scripts/eleven-latency/fixtures";
import type { ElevenTiming } from "../../shared/elevenLabProfiles";

const cb = (extra: Partial<Callback> = {}): Callback => ({ id: "callback", scenarioId: "en-text",
  receivedMs: 20, fingerprint: "transcript", accepted: true, finished: true, closedEarly: false,
  repeatedTranscript: false, streamCompleted: true, timingId: "response-1", ...extra });
const timing = (latency: number, extra: Partial<ElevenTiming> = {}): ElevenTiming => ({
  id: "response-1", requestReceivedMs: 10, firstTextMs: 10 + latency, firstAudioMs: 30 + latency,
  speechEndMs: null, endOfTurnMs: null, transcriptReceivedMs: null, providerAudioEventId: null,
  playbackClientMs: null, playbackTelemetryReceivedMs: null, checkpointsMs: [], checkpointSkipped: 0,
  cancelled: false, correlation: "sequential/best-effort", ...extra,
});
function attempt(profile: "baseline" | "optimized", pair: string, latency: number, extra: Partial<Attempt> = {}): Attempt {
  const t = timing(latency);
  const observation: Observation = { scenarioId: "en-text", language: "en", kind: "text",
    startedMs: 0, endedMs: 200, status: "ok", callbacks: [cb()], timings: [t], pauses: [], audioFrames: [] };
  return { id: `${profile}-${pair}`, profile, pair, phase: "measured", position: 0, scenarios: [],
    attempt: 0, retryOf: null, observations: [observation], callbacks: [cb()], timings: [t],
    correlationValid: true, status: "ok", ...extra };
}
afterEach(() => vi.unstubAllGlobals());
describe("reproducible Eleven Dev experiment", () => {
  it("shuffles paired order and scenarios reproducibly, with separate warmups", () => {
    const a = schedule(options(["--seed", "one"]));
    expect(a).toEqual(schedule(options(["--seed", "one"])));
    expect(a).not.toEqual(schedule(options(["--seed", "two"])));
    expect(a.filter(s => s.phase === "warmup")).toHaveLength(2);
    expect(a.filter(s => s.phase === "measured")).toHaveLength(20);
    expect(new Set(a.map(s => s.profile + s.position)).size).toBe(4);
    for (let i = 0; i < a.length; i += 2) {
      expect(a[i].pair).toBe(a[i + 1].pair);
      expect(a[i].profile).not.toBe(a[i + 1].profile);
      expect(a[i].scenarios).toEqual(a[i + 1].scenarios);
      expect(new Set(a[i].scenarios.map(s => s.id)).size).toBe(9);
    }
  });
  it("requires explicit paid budgets and validates every numeric flag", () => {
    expect(options([]).maxSessions).toBe(0);
    expect(options([]).maxEngineRequests).toBe(0);
    for (const flags of [["--repetitions", "NaN"], ["--retries", "-1"], ["--warmups", "0"],
      ["--max-sessions", "Infinity"], ["--max-wall-seconds", "1.5"], ["--unknown"], ["--seed"],
      ["--seed", "one", "--seed", "two"]]) expect(() => options(flags)).toThrow();
  });
  it("plans offline even in production and rejects paid production before DB/provider access", () => {
    const args = ["--import", "tsx", "scripts/probe-eleven-latency.ts"];
    const env = { ...process.env, NODE_ENV: "production" };
    const plan = JSON.parse(execFileSync(process.execPath, [...args, "--plan"], { env, encoding: "utf8" }));
    expect(plan.requiredSessions).toBe(22);
    expect(plan.fixtureManifest).toHaveLength(12);
    const run = spawnSync(process.execPath, [...args, "--run"], { env, encoding: "utf8" });
    expect(run.status).not.toBe(0); expect(run.stderr).toContain("Dev only");
    expect(run.stdout).not.toContain("[Database]");
  });
  it("never guesses a mapping when callback counts differ", () => {
    const callbacks = [cb({ timingId: undefined }), cb({ id: "retry", timingId: undefined })];
    expect(correlate(callbacks, [timing(100)])).toBe(false);
    expect(callbacks.every(c => c.timingId === undefined)).toBe(true);
    expect(correlate(callbacks, [timing(100), timing(200, { id: "response-3", cancelled: true })])).toBe(true);
    expect(callbacks.map(c => c.timingId)).toEqual(["response-1", "response-3"]);
  });
  it("reports deterministic distributions and bootstrap intervals without ratings", () => {
    expect(distribution([]).p50).toBeNull();
    expect(distribution([3, 1, 2]).p50).toBe(2);
    const runs = [attempt("baseline", "1", 200), attempt("optimized", "1", 100),
      attempt("baseline", "2", 300), attempt("optimized", "2", 200),
      attempt("optimized", "warmup", 9999, { phase: "warmup" })];
    const result = summarize(runs, "seed");
    expect(result).toEqual(summarize(runs, "seed"));
    expect(result.paired[0]).toMatchObject({ completePairs: 2, medianDeltaBootstrap95: [-100, -100],
      optimizedMinusBaseline: { p50: -100 } });
    expect(result.groups.find(g => g.profile === "optimized" && g.language === "en")?.engineFirstTextMs.max).toBe(200);
    expect(result).not.toHaveProperty("winner");
  });
  it("does not replace failure with a successful retry or mix cancelled/ambiguous/replayed responses", () => {
    const a = attempt("baseline", "1", 200), b = attempt("optimized", "1", 10, { status: "error" });
    b.observations[0].status = "error";
    const retry = attempt("optimized", "1", 1, { attempt: 1, retryOf: b.id });
    expect(summarize([a, b, retry], "s").paired[0].completePairs).toBe(0);
    for (const change of ["cancelled", "ambiguous", "replay", "incomplete", "multiple"]) {
      const candidate = attempt("optimized", "1", 10);
      if (change === "cancelled") candidate.observations[0].timings[0].cancelled = true;
      if (change === "ambiguous") candidate.correlationValid = false;
      if (change === "replay") candidate.observations[0].callbacks[0].repeatedTranscript = true;
      if (change === "incomplete") candidate.observations[0].callbacks[0].streamCompleted = false;
      if (change === "multiple") candidate.observations[0].callbacks.push(cb());
      expect(summarize([a, candidate], "s").paired[0].completePairs).toBe(0);
    }
  });
  it("excludes earlier successful scenarios if their session later failed", () => {
    const runs = [attempt("baseline", "1", 200), attempt("optimized", "1", 10, { status: "error" })];
    // Observation itself succeeded; a later scenario failed in this session.
    expect(runs[1].observations[0].status).toBe("ok");
    expect(summarize(runs, "s").paired[0]).toMatchObject({ completePairs: 0, missingOrExcludedPairs: 1 });
  });
  it("counts transport entry during the internal pause separately from a later response", () => {
    const a = attempt("baseline", "1", 100);
    a.observations[0].pauses = [{ startMs: 10, endMs: 50 }];
    a.observations[0].audioFrames = [{ atMs: 40, eventId: 1 }];
    expect(summarize([a], "s").groups[0]).toMatchObject({
      requestDuringInternalPause: 1, frameDuringInternalPause: 1, pauseTrials: 1 });
    a.observations[0].callbacks[0].receivedMs = 51;
    expect(summarize([a], "s").groups[0].requestDuringInternalPause).toBe(0);
  });
  it("includes never-started planned pairs in an interrupted experiment's denominator", () => {
    const planned = schedule(options(["--repetitions", "4"]));
    const result = summarize([], "s", planned);
    expect(result.paired[0]).toMatchObject({ completePairs: 0, plannedPairs: 4, missingOrExcludedPairs: 4 });
    expect(result.groups[0]).toMatchObject({ notStartedSessions: 4, plannedFirstAttemptTrials: 12 });
  });
});
describe("real SDK startup against a silent local provider", () => {
  it.each(["text", "audio"])("sends the first %s scenario without waiting for an unsolicited response", async kind => {
    vi.stubGlobal("WebSocket", WebSocket);
    const provider = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>(resolve => provider.once("listening", resolve));
    const received: any[] = [], audio = vi.fn(), control = vi.fn();
    provider.on("connection", socket => {
      socket.on("message", raw => {
        const event = JSON.parse(raw.toString()); received.push(event);
        if (event.type === "conversation_initiation_client_data") {
          socket.send(JSON.stringify({ type: "conversation_initiation_metadata",
            conversation_initiation_metadata_event: { conversation_id: "synthetic-test",
              agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } }));
          // Intentionally NO greeting, audio, transcript or LLM callback.
        } else if (event.type === "user_message" || event.user_audio_chunk) {
          socket.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "TEST reply" } }));
          socket.send(JSON.stringify({ type: "audio", audio_event: {
            audio_base_64: Buffer.alloc(640).toString("base64"), event_id: 1 } }));
        }
      });
    });
    let sdk: Awaited<ReturnType<typeof connectProbeSocket>> | undefined;
    try {
      const address = provider.address();
      if (typeof address === "string" || !address) throw Error("Missing test port");
      sdk = await connectProbeSocket(`ws://127.0.0.1:${address.port}`, audio, control);
      expect(control).not.toHaveBeenCalledWith(expect.objectContaining({ type: "agent_response" }));
      expect(audio).not.toHaveBeenCalled();
      expect(received).toHaveLength(1);
      if (kind === "text") sdk.sendMessage({ type: "user_message", text: "Hello TEST" });
      else sdk.sendMessage({ user_audio_chunk: Buffer.alloc(640).toString("base64") });
      await vi.waitFor(() => {
        expect(audio).toHaveBeenCalledTimes(1);
        expect(control).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_response" }));
      });
      expect(received[1]).toHaveProperty(kind === "text" ? "text" : "user_audio_chunk");
    } finally {
      sdk?.close(); for (const socket of provider.clients) socket.terminate();
      await new Promise<void>(resolve => provider.close(() => resolve()));
    }
  });
});
describe("synthetic fixture budget and provenance", () => {
  it("refuses the entire uncached synthesis plan before spending anything", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eleven-fixtures-"));
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      await expect(loadFixtures(dir, 1, vi.fn())).rejects.toThrow("Fixture budget");
      expect(fetch).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("reuses content-addressed PCM with zero synthesis, reporting hashes and all languages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eleven-fixtures-"));
    const fetch = vi.fn(), hashes = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      for (const f of fixtureManifest) await writeFile(join(dir, `${f.cacheKey}.pcm`), Buffer.alloc(6));
      const fixtures = await loadFixtures(dir, 0, vi.fn(), undefined, hashes);
      expect(fixtures.size).toBe(9); expect(hashes).toHaveBeenCalledTimes(12);
      expect(fetch).not.toHaveBeenCalled();
      expect(fixtures.get("ru-number")?.after).toHaveLength(6);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("records attempted characters and never silently retries failed synthesis", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eleven-fixtures-"));
    const fetch = vi.fn(async () => ({ ok: false, status: 429 })), before = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(loadFixtures(dir, 50000, before)).rejects.toThrow("HTTP 429");
      expect(fetch).toHaveBeenCalledTimes(1); expect(before).toHaveBeenCalledTimes(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
