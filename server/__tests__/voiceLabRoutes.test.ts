import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const testState = vi.hoisted(() => ({
  clones: new Map<string, any>(),
  runs: new Map<string, any>(),
  nextId: 0,
}));

vi.mock("../benchmark/adminGate", () => ({
  requireBenchmarkAdmin: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user-id"] && req.headers["x-test-admin"] !== "yes") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (req.headers["x-test-admin"] !== "yes") return res.status(403).json({ error: "Admin access required" });
    req.user = { id: req.headers["x-test-user-id"] || "admin-1" };
    next();
  },
}));

vi.mock("../voiceLab/store", async () => {
  const { withAbsolutePlaybackTimings } = await import("../voiceLab/timings");
  return {
  getClone: vi.fn(async (userId: string) => testState.clones.get(userId) ?? null),
  reserveClone: vi.fn(async (userId: string, durationMs: number) => {
    const existing = testState.clones.get(userId);
    if (existing?.status === "retryable") {
      Object.assign(existing, { status: "creating", voiceId: null, durationMs, createdAt: new Date() });
      return existing;
    }
    if (existing) return null;
    const clone = { userId, voiceId: null, status: "creating", durationMs, createdAt: new Date() };
    testState.clones.set(userId, clone);
    return clone;
  }),
  finishClone: vi.fn(async (userId: string, voiceId: string) => {
    const clone = testState.clones.get(userId);
    if (!clone) return undefined;
    Object.assign(clone, { voiceId, status: "ready" });
    return clone;
  }),
  failClone: vi.fn(async (userId: string, status: string) => {
    const clone = testState.clones.get(userId);
    if (clone?.status === "creating") clone.status = status;
  }),
  listVoiceLab: vi.fn(async (userId: string) => ({
    clone: testState.clones.get(userId) ?? null,
    runs: [...testState.runs.values()].filter((run) => run.userId === userId),
  })),
  insertRun: vi.fn(async (userId: string, values: any) => {
    const run = { id: `run-${++testState.nextId}`, userId, ...values, playResult: null, createdAt: new Date() };
    testState.runs.set(run.id, run);
    return run;
  }),
  getRun: vi.fn(async (userId: string, id: string) => {
    const run = testState.runs.get(id);
    return run?.userId === userId ? run : null;
  }),
  recordPlayback: vi.fn(async (userId: string, id: string, details: any) => {
    const run = testState.runs.get(id);
    if (!run || run.userId !== userId) return null;
    run.playResult = details.playResult;
    run.timings = withAbsolutePlaybackTimings(run.timings, details);
    return run;
  }),
  toPublicRun: (run: any) => ({
    id: run.id, transcript: run.transcript, english: run.english, voiceId: run.voiceId,
    provider: run.provider, timings: run.timings, playResult: run.playResult, createdAt: run.createdAt,
  }),
  toPublicClone: (clone: any) => clone && ({
    voiceId: clone.voiceId, status: clone.status, durationMs: clone.durationMs, createdAt: clone.createdAt,
  }),
  };
});

const { registerVoiceLabRoutes } = await import("../voiceLab/routes");
const originalFetch = global.fetch;
const originalElevenLabsKey = process.env.ELEVENLABS_API_KEY;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const audioBase64 = Buffer.alloc(2048, 2).toString("base64");
const validAudio = { audioBase64, mimeType: "audio/webm", durationMs: 1800 };
const runAudio = (releasedAtMs = Date.now() - 1000) => ({ ...validAudio, releasedAtMs });
let app: express.Express;

function admin(userId = "admin-1") {
  return { "x-test-admin": "yes", "x-test-user-id": userId };
}

function makeApp() {
  const instance = express();
  instance.use(express.json({ limit: "20mb" }));
  registerVoiceLabRoutes(instance);
  return instance;
}

beforeEach(() => {
  testState.clones.clear();
  testState.runs.clear();
  testState.nextId = 0;
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  app = makeApp();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalElevenLabsKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originalElevenLabsKey;
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
});

describe("admin Voice Lab routes", () => {
  it("gates every endpoint and makes no provider calls just by loading the lab", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    expect((await request(app).get("/api/admin/voice-lab")).status).toBe(401);
    expect((await request(app).get("/api/admin/voice-lab").set({ "x-test-user-id": "regular" })).status).toBe(403);
    const res = await request(app).get("/api/admin/voice-lab").set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clone: null, runs: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires explicit consent and validates MIME, duration, and decoded audio size", async () => {
    const noConsent = await request(app).post("/api/admin/voice-lab/clone").set(admin()).send(validAudio);
    expect(noConsent.status).toBe(400);
    const badMime = await request(app).post("/api/admin/voice-lab/run").set(admin()).send({ ...validAudio, mimeType: "text/plain" });
    expect(badMime.status).toBe(400);
    const tooLong = await request(app).post("/api/admin/voice-lab/run").set(admin()).send({ ...validAudio, durationMs: 30_001 });
    expect(tooLong.status).toBe(400);
    const cloneTooLong = await request(app).post("/api/admin/voice-lab/clone").set(admin())
      .send({ ...validAudio, durationMs: 180_001, consent: true });
    expect(cloneTooLong.status).toBe(400);
    const missingRelease = await request(app).post("/api/admin/voice-lab/run").set(admin()).send(validAudio);
    expect(missingRelease.status).toBe(400);
    expect(missingRelease.body.error).toMatch(/releasedAtMs/);
    const implausibleRelease = await request(app).post("/api/admin/voice-lab/run").set(admin())
      .send({ ...runAudio(Date.now() - 20 * 60_000) });
    expect(implausibleRelease.status).toBe(400);
    const oversized = await request(app).post("/api/admin/voice-lab/run").set(admin())
      .send({ ...validAudio, audioBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") });
    expect(oversized.status).toBe(413);
  });

  it("creates one clone after consent and will not overwrite or repeat its paid provider request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ voice_id: "voice-one" }), { status: 200 }));
    global.fetch = fetchMock as any;
    const created = await request(app).post("/api/admin/voice-lab/clone").set(admin())
      .send({ ...validAudio, durationMs: 120_000, consent: true });
    expect(created.status).toBe(200);
    expect(created.body.clone).toMatchObject({ voiceId: "voice-one", status: "ready", durationMs: 120_000 });
    const duplicate = await request(app).post("/api/admin/voice-lab/clone").set(admin()).send({ ...validAudio, consent: true });
    expect(duplicate.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.elevenlabs.io/v1/voices/add");
  });

  it("runs Russian transcription then faithful English translation and stores only text/metadata", async () => {
    testState.clones.set("admin-1", {
      userId: "admin-1", voiceId: "private-voice", status: "ready", durationMs: 1000, createdAt: new Date(),
    });
    const signals: AbortSignal[] = [];
    global.fetch = vi.fn(async (_input: any, init: any) => {
      signals.push(init.signal);
      if (String(_input).includes("audio/transcriptions")) return new Response(JSON.stringify({ text: "Мне нужна помощь с возвратом." }));
      return new Response(JSON.stringify({ choices: [{ message: { content: "I need help with a refund." } }] }));
    }) as any;
    const releasedAtMs = Date.now() - 5000;
    const res = await request(app).post("/api/admin/voice-lab/run").set(admin())
      .send({ ...runAudio(releasedAtMs), durationMs: 30_000 });
    expect(res.status).toBe(200);
    expect(res.body.run).toMatchObject({
      transcript: "Мне нужна помощь с возвратом.",
      english: "I need help with a refund.",
      voiceId: "private-voice",
      provider: "elevenlabs",
      timings: { micRelease: releasedAtMs },
    });
    expect(res.body.run.timings.transcriptionComplete).toBeGreaterThanOrEqual(releasedAtMs);
    expect(res.body.run.timings.englishReady).toBeGreaterThanOrEqual(res.body.run.timings.transcriptionComplete);
    expect(testState.runs.get(res.body.run.id)).not.toHaveProperty("audio");
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("returns explicit errors on empty STT and upstream failures without inventing transcript", async () => {
    testState.clones.set("admin-1", { userId: "admin-1", voiceId: "v", status: "ready" });
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ text: "  " }))) as any;
    const empty = await request(app).post("/api/admin/voice-lab/run").set(admin()).send(runAudio());
    expect(empty.status).toBe(422);
    expect(empty.body.error).toMatch(/No speech/);
    expect(testState.runs.size).toBe(0);
    global.fetch = vi.fn(async () => { throw new Error("connection reset"); }) as any;
    const failed = await request(app).post("/api/admin/voice-lab/run").set(admin()).send(runAudio());
    expect(failed.status).toBe(502);
    expect(failed.body.error).toBeTruthy();
  });

  it("enforces per-admin ownership for audio/play and streams MP3 only for an owned run", async () => {
    testState.runs.set("run-owned", {
      id: "run-owned", userId: "admin-1", voiceId: "owned-voice", english: "Hello there.",
      transcript: "Привет.", provider: "elevenlabs",
      timings: { micRelease: 1_700_000_000_000, transcriptionComplete: 1_700_000_000_500, englishReady: 1_700_000_000_700 },
      playResult: null, createdAt: new Date(),
    });
    const fetchMock = vi.fn(async () => new Response(Buffer.from("mp3-data"), { status: 200 }));
    global.fetch = fetchMock as any;
    const hidden = await request(app).get("/api/admin/voice-lab/runs/run-owned/audio").set(admin("admin-2"));
    expect(hidden.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    const audio = await request(app).get("/api/admin/voice-lab/runs/run-owned/audio").set(admin());
    expect(audio.status).toBe(200);
    expect(audio.headers["content-type"]).toMatch(/audio\/mpeg/);
    expect(audio.body.toString()).toBe("mp3-data");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.elevenlabs.io/v1/text-to-speech/owned-voice/stream?output_format=mp3_44100_128");
    const inconsistent = await request(app).post("/api/admin/voice-lab/runs/run-owned/play").set(admin())
      .send({ firstAudioMs: 100, elevenlabsRequestMs: 110, playResult: "success" });
    expect(inconsistent.status).toBe(400);
    const play = await request(app).post("/api/admin/voice-lab/runs/run-owned/play").set(admin())
      .send({ firstAudioMs: 320, elevenlabsRequestMs: 110, playResult: "success" });
    expect(play.status).toBe(200);
    const micRelease = play.body.run.timings.micRelease;
    expect(play.body.run).toMatchObject({
      playResult: "success",
      timings: { firstAudio: micRelease + 320, elevenlabsRequest: micRelease + 110 },
    });
    expect(play.body.run.timings.firstAudio).toBeGreaterThanOrEqual(play.body.run.timings.elevenlabsRequest);
    const reloaded = await request(app).get("/api/admin/voice-lab").set(admin());
    const reloadedRun = reloaded.body.runs.find((run: any) => run.id === "run-owned");
    expect(reloadedRun.timings).toMatchObject({
      micRelease,
      elevenlabsRequest: micRelease + 110,
      firstAudio: micRelease + 320,
    });
    expect(reloadedRun.timings.firstAudio - reloadedRun.timings.micRelease).toBe(320);
    expect(reloadedRun.timings.elevenlabsRequest - reloadedRun.timings.micRelease).toBe(110);
    expect((await request(app).post("/api/admin/voice-lab/runs/run-owned/play").set(admin("admin-2"))
      .send({ firstAudioMs: null, playResult: "success" })).status).toBe(404);
  });

  it("reports TTS upstream HTTP failures and applies the per-admin run rate limit", async () => {
    testState.runs.set("run-owned", {
      id: "run-owned", userId: "admin-1", voiceId: "voice", english: "Hello.",
      transcript: "Привет.", provider: "elevenlabs", timings: {}, createdAt: new Date(),
    });
    global.fetch = vi.fn(async () => new Response("unavailable", { status: 503 })) as any;
    const tts = await request(app).get("/api/admin/voice-lab/runs/run-owned/audio").set(admin());
    expect(tts.status).toBe(502);
    testState.clones.set("rate-admin", { userId: "rate-admin", voiceId: "v", status: "ready" });
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ text: "тест" }))) as any;
    for (let i = 0; i < 6; i++) {
      const response = await request(app).post("/api/admin/voice-lab/run").set(admin("rate-admin")).send(runAudio());
      expect(response.status).toBe(502); // mock returns STT shape to the translation endpoint too
    }
    const limited = await request(app).post("/api/admin/voice-lab/run").set(admin("rate-admin")).send(runAudio());
    expect(limited.status).toBe(429);
  });

  it("allows explicit retry only after a definitive provider 4xx; locks ambiguous outcomes with guidance", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("invalid sample", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ voice_id: "voice-after-retry" }), { status: 200 }));
    global.fetch = fetchMock as any;
    const rejected = await request(app).post("/api/admin/voice-lab/clone").set(admin()).send({ ...validAudio, consent: true });
    expect(rejected.status).toBe(502);
    expect(rejected.body.clone.status).toBe("retryable");
    expect(rejected.body.error).toMatch(/explicitly submit another attempt/i);
    const retried = await request(app).post("/api/admin/voice-lab/clone").set(admin()).send({ ...validAudio, consent: true });
    expect(retried.status).toBe(200);
    expect(retried.body.clone.voiceId).toBe("voice-after-retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const ambiguousFetch = vi.fn(async () => { throw new Error("connection reset"); });
    global.fetch = ambiguousFetch as any;
    const ambiguous = await request(app).post("/api/admin/voice-lab/clone").set(admin("admin-ambiguous"))
      .send({ ...validAudio, consent: true });
    expect(ambiguous.status).toBe(502);
    expect(ambiguous.body.clone.status).toBe("uncertain");
    expect(ambiguous.body.error).toMatch(/do not retry/i);
    const blocked = await request(app).post("/api/admin/voice-lab/clone").set(admin("admin-ambiguous"))
      .send({ ...validAudio, consent: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/check the ElevenLabs account/i);
    expect(ambiguousFetch).toHaveBeenCalledTimes(1);
  });
});