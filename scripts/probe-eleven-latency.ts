/** Opt-in Dev-only paired experiment. --plan is offline; --run requires explicit
 * resource ceilings. Never opens microphone/playback/phone or real tools. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import type { WebSocketConnection } from "../node_modules/@elevenlabs/client/dist/utils/WebSocketConnection.js";
import { connectProbeSocket } from "./eleven-latency/transport";
import { options, schedule, summarize, correlate, type Attempt, type Callback, type Observation } from "./eleven-latency/experiment";
import { fixtureDefinitions, fixtureManifest, loadFixtures } from "./eleven-latency/fixtures";
import { elevenProfiles, type ElevenTiming } from "../shared/elevenLabProfiles";

const o = options(process.argv.slice(2)), plan = schedule(o);
assert(!(process.argv.includes("--run") && process.argv.includes("--plan")), "Choose --plan OR --run");
const requiredSessions = plan.length * (1 + o.retries);
const manifest = { version: 1, options: o, plan, requiredSessions, profileSnapshots: elevenProfiles,
  fixtureManifest, maximumProviderConfiguredSeconds: o.maxSessions * 300,
  requestedSessionStopAfterSeconds: o.maxSessionSeconds,
  fixtureCharactersIfUncached: fixtureDefinitions.reduce((n, f) => n + f.text.length, 0),
  apiBudgetNote: "Resource ceilings, NOT a dollar quote. Includes paid Eleven agents, fixture TTS and Engine model usage. No automatic paid retries.",
  startRateLimit: "At most six session starts per rolling hour, unchanged Dev limit." };
if (!process.argv.includes("--run")) {
  console.log(JSON.stringify(manifest, null, 2));
} else {
  assert(process.env.NODE_ENV === "development" && process.env.REPLIT_DEPLOYMENT !== "1", "Dev only");
  assert(o.maxSessions >= requiredSessions, `--max-sessions must cover ${requiredSessions} including reserved retries`);
  assert(o.maxEngineRequests > 0 && o.maxWallSeconds > 0, "Explicit --max-engine-requests and --max-wall-seconds required");
  // No database, provider or server import with side effects in offline planning.
  const { dbReady, pool } = await import("../server/db");
  const { ElevenEngineLab } = await import("../server/secretaryLab/elevenEngine");
  const { PgComparisonRepository } = await import("../server/secretaryLab/comparisonStore");
  const { upgradeElevenAudio } = await import("../server/secretaryLab/elevenAudioUpgrade");
  await dbReady; assert(pool, "Dev DB required");
  const store = new PgComparisonRepository(pool);
  const { rows } = await pool.query("SELECT owner_id FROM secretary_lab_comparisons WHERE expires_at>now() ORDER BY created_at DESC LIMIT 1");
  assert(rows[0], "Existing opted-in lab owner required");
  const owner = rows[0].owner_id, batchId = randomUUID(), started = performance.now(), batchCreatedAt = new Date().toISOString();
  const out = "generated-artifacts/eleven-latency";
  const attempts: Attempt[] = [], starts: number[] = [];
  const fixtureHashes: { key: string; sha256: string; bytes: number }[] = [];
  const usage = { sessions: 0, engineRequests: 0, rejectedEngineRequests: 0, fixtureCharacters: 0 };
  let batchStatus = "running", active: Attempt | undefined, current: Observation | undefined;
  let stopActive: (() => void) | undefined, interrupted = false;
  const controller = new AbortController();
  const wallTimer = setTimeout(() => { controller.abort(); stopActive?.(); }, Math.min(2 ** 31 - 1, o.maxWallSeconds * 1000));
  const signal = () => { interrupted = true; controller.abort(); stopActive?.(); };
  process.on("SIGINT", signal); process.on("SIGTERM", signal);
  const remaining = () => o.maxWallSeconds * 1000 - (performance.now() - started);
  const check = () => { if (interrupted || remaining() <= 0) throw Error(interrupted ? "Interrupted" : "Wall budget exhausted"); };
  const delay = async (ms: number) => {
    const end = performance.now() + ms;
    while (performance.now() < end) { check(); await new Promise(r => setTimeout(r, Math.min(100, end - performance.now()))); }
  };
  const archive = async () => {
    const summary = summarize(attempts, o.seed, plan);
    const experiment = { ...manifest, batchId, batchStatus, usage, attempts, fixtureHashes, summary,
      subjectiveRating: null, physicalPlaybackOrMicrophoneTested: false };
    await store.checkpoint(owner, batchId, { title: "ElevenLabs · seeded paired latency · TEST",
      instruction: "Synthetic Dev comparison only; no real actions, telephone or listening judgment.",
      evaluation: { score: null, note: "" }, runs: [{
        id: batchId, mode: "eleven-engine", runtime: "Dev paired synthetic probe",
        model: "see archived profile snapshots", voice: "catalog only", instruction: "TEST",
        createdAt: batchCreatedAt, status: batchStatus, verification: "not a listening measurement",
        experiment,
      }] });
    await writeFile(`${out}/${batchId}.json`, JSON.stringify(experiment, null, 2));
  };
  const lab = new ElevenEngineLab(store), app = express();
  const server = createServer(app), wss = new WebSocketServer({ noServer: true });
  app.use(express.json({ limit: "128kb" }));
  app.post("/eleven-engine-llm/:capability/v1/chat/completions", (req, res) => {
    if (!active || interrupted || remaining() <= 0 || usage.engineRequests >= o.maxEngineRequests) {
      usage.rejectedEngineRequests++; res.sendStatus(429); stopActive?.(); return;
    }
    usage.engineRequests++;
    const c: Callback = { id: randomUUID(), scenarioId: current?.scenarioId ?? null,
      receivedMs: performance.now(), fingerprint: createHash("sha256").update(JSON.stringify(req.body?.messages ?? null)).digest("hex"),
      accepted: false, finished: false, closedEarly: false, streamCompleted: false,
      repeatedTranscript: active.callbacks.some(previous => previous.fingerprint ===
        createHash("sha256").update(JSON.stringify(req.body?.messages ?? null)).digest("hex")) };
    active.callbacks.push(c); current?.callbacks.push(c);
    res.on("finish", () => { c.finished = true; });
    res.on("close", () => { c.closedEarly = !res.writableFinished; });
    const write = res.write.bind(res);
    res.write = ((...args: any[]) => {
      if (String(args[0]).includes("data: [DONE]")) c.streamCompleted = true;
      return (write as any)(...args);
    }) as typeof res.write;
    const work = lab.completion(req.params.capability, req, res);
    c.accepted = res.headersSent && res.statusCode === 200;
    void work.catch(() => { if (!res.headersSent) res.sendStatus(503); else res.end(); });
  });
  server.on("upgrade", (req, socket, head) => void upgradeElevenAudio(req, socket, head,
    { server: wss, runtime: async () => lab, environment: "development" }));
  const oldSocket = globalThis.WebSocket;
  let listening = false;
  try {
    await mkdir(out, { recursive: true }); await archive();
    // Bind before any paid work. A busy Dev port is an error, never kill the app.
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject); server.listen(5000, "0.0.0.0", () => { listening = true; resolve(); });
    });
    Object.assign(globalThis, { WebSocket });
    const fixtures = await loadFixtures(out, o.maxFixtureCharacters, text => {
      check(); usage.fixtureCharacters += text.length;
    }, controller.signal, (key, sha256, bytes) => fixtureHashes.push({ key, sha256, bytes }));
    await archive();
    for (const item of plan) {
      let previous: string | null = null;
      for (let retry = 0; retry <= o.retries; retry++) {
        check();
        assert(usage.engineRequests < o.maxEngineRequests, "Engine request budget exhausted; no new paid session");
        // Preserve the actual adapter's six-per-hour gate, including failures.
        while (starts.filter(t => performance.now() - t < 3600_100).length >= 6) await delay(1000);
        assert(usage.sessions < o.maxSessions, "Session budget exhausted");
        active = { ...item, id: randomUUID(), attempt: retry, retryOf: previous,
          status: "running", observations: [], callbacks: [], timings: [], correlationValid: false };
        attempts.push(active); await archive();
        let sdk: WebSocketConnection | undefined, heartbeat: NodeJS.Timeout | undefined;
        let sessionExpired = false, sessionTimer: NodeJS.Timeout | undefined;
        try {
          starts.push(performance.now()); usage.sessions++;
          const id = active.id;
          stopActive = () => { sessionExpired = true; sdk?.close(); void lab.stop(owner, id).catch(() => undefined); };
          sessionTimer = setTimeout(stopActive, Math.max(1, Math.min(o.maxSessionSeconds * 1000, remaining())));
          const admission = await lab.create(owner, { clientRequestId: active.id, voice: "catalog",
            profileId: item.profile, consent: true,
            instruction: "Synthetic TEST only. Reply briefly in the speaker's English, Russian or Spanish. " +
              "Wait for the complete number or address including corrections before responding. Do not save, deliver, call, notify, book or perform any action." });
          if (sessionExpired) throw Error("Session budget exhausted during admission");
          heartbeat = setInterval(() => { void lab.report(owner, id).catch(() => undefined); }, 5000);
          let lastActivity = performance.now(), frames = 0, responses = 0;
          const ready = () => { check(); if (sessionExpired) throw Error("Session stopped/budget exhausted"); };
          sdk = await connectProbeSocket(`ws://127.0.0.1:5000${admission.websocketPath}`, (event: any) => {
            if (!event.audio_base_64) return;
            frames++; lastActivity = performance.now();
            current?.audioFrames.push({ atMs: lastActivity, eventId: Number.isSafeInteger(event.event_id) ? event.event_id : null });
          }, (event: any) => {
            if (event.type === "agent_response") { responses++; lastActivity = performance.now(); }
          });
          const settle = async (a: number, b: number) => {
            const until = performance.now() + 35_000;
            while (performance.now() < until) {
              ready();
              const callbacks = current?.callbacks ?? [];
              const lastCallback = callbacks.at(-1)?.receivedMs ?? 0;
              const completed = callbacks.length > 0 && callbacks.every(c =>
                c.accepted && c.finished && c.streamCompleted && !c.closedEarly);
              if (frames > a && responses > b && completed &&
                performance.now() - Math.max(lastActivity, lastCallback) > 1800) return;
              await delay(100);
            }
            throw Error("No settled provider response within 35s");
          };
          // Empty first_message: send a scenario immediately. There is no
          // unsolicited greeting/callback to wait for at startup.
          for (const s of item.scenarios) {
            ready();
            current = { scenarioId: s.id, language: s.language, kind: s.kind,
              startedMs: performance.now(), endedMs: 0, status: "ok", pauses: [], callbacks: [], timings: [], audioFrames: [] };
            active.observations.push(current);
            const a = frames, b = responses;
            try {
              const fixture = fixtures.get(s.id)!;
              if (s.kind === "text") sdk.sendMessage({ type: "user_message", text: fixture.text! });
              else {
                const send = async (audio: Buffer) => {
                  const origin = performance.now();
                  for (let n = 0; n < audio.length; n += 640) {
                    ready(); sdk!.sendMessage({ user_audio_chunk: audio.subarray(n, n + 640).toString("base64") });
                    await delay(Math.max(0, origin + (n + 640) / 32 - performance.now()));
                  }
                };
                await send(fixture.before!);
                const pause = { startMs: performance.now(), endMs: 0 }; current.pauses.push(pause);
                try { await send(Buffer.alloc(32_000)); } finally { pause.endMs = performance.now(); }
                await send(fixture.after!);
                await send(Buffer.alloc(64_000)); // endpoint allowance, not speech-end truth
              }
              await settle(a, b);
            } catch (e) {
              current.status = "error"; current.error = e instanceof Error ? e.message : "Scenario failed";
              // Never feed a new scenario into an unresolved response window.
              throw e;
            } finally {
              current.endedMs = performance.now(); current = undefined;
              // Keep partial/failed trials in the canonical store, not only a
              // convenience file written at the very end of the experiment.
              await archive();
            }
          }
          active.status = "ok";
        } catch (e) {
          active.status = "error"; active.error = e instanceof Error ? e.message : "Session failed";
        } finally {
          clearInterval(heartbeat); clearTimeout(sessionTimer); stopActive = undefined; current = undefined;
          // Cleanup failure blocks subsequent paid sessions; do not hide it.
          let cleanupError: unknown;
          try { await lab.stop(owner, active.id); } catch (e) {
            cleanupError = e; active.status = "cleanup_failed";
            active.error = e instanceof Error ? e.message : "Cleanup failed";
          }
          sdk?.close();
          const saved = await store.get(active.id);
          const run = saved?.runs[0];
          active.timings = (run?.timings ?? []) as ElevenTiming[];
          active.correlationValid = correlate(active.callbacks, active.timings);
          for (const obs of active.observations) obs.timings = active.timings.filter(t => obs.callbacks.some(c => c.timingId === t.id));
          for (const s of item.scenarios.filter(s => !active!.observations.some(obs => obs.scenarioId === s.id))) {
            active.observations.push({ scenarioId: s.id, language: s.language, kind: s.kind,
              startedMs: 0, endedMs: 0, status: "skipped", error: "Session failed before scenario",
              pauses: [], callbacks: [], timings: [], audioFrames: [] });
          }
          if (saved && run) await store.checkpoint(owner, active.id, { ...saved,
            runs: [{ ...run, syntheticProbe: { batchId, ...active, profileSnapshot: elevenProfiles[item.profile],
              physicalPlaybackTested: false, subjectiveRating: null } }] });
          await archive();
          console.log(JSON.stringify({ batchId, sessionId: active.id, pair: item.pair, phase: item.phase,
            profile: item.profile, attempt: retry, status: active.status }));
          if (cleanupError) throw cleanupError;
        }
        if (active.status === "ok") break;
        previous = active.id;
      }
    }
    batchStatus = attempts.some(a => a.status !== "ok") ? "completed_with_errors" : "completed";
  } catch (e) {
    batchStatus = interrupted ? "interrupted" : "failed";
    console.error(e instanceof Error ? e.message : "Experiment failed");
    process.exitCode = 1;
  } finally {
    try { await archive(); } finally {
      clearTimeout(wallTimer);
      lab.dispose(); Object.assign(globalThis, { WebSocket: oldSocket });
      for (const ws of wss.clients) ws.terminate(); wss.close();
      if (listening) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
      process.off("SIGINT", signal); process.off("SIGTERM", signal);
      await pool.end();
    }
  }
  if (attempts.some(a => a.status !== "ok")) process.exitCode = 1;
  console.log(JSON.stringify({ batchId, batchStatus, usage, sharedComparisonId: batchId }));
}
