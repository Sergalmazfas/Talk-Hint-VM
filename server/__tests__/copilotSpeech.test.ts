import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  clearVerifiedCopilotRepliesForTests, consumeVerifiedCopilotReply,
  isLatinCopilotReply, registerVerifiedCopilotReply,
} from "../copilotVerifiedReplies";

const state = vi.hoisted(() => ({
  clone: null as any,
  cartesiaClone: null as any,
  authorized: true,
}));

vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const userId = req.headers["x-test-user-id"];
    if (!userId) return res.status(401).json({ error: "Invalid session" });
    req.user = { id: userId };
    next();
  },
}));
vi.mock("../copilotStream", () => ({
  lookupAuthorizedCopilotCall: vi.fn(async () => state.authorized),
}));
vi.mock("../voiceLab/store", () => ({
  getClone: vi.fn(async (userId: string) => state.clone?.userId === userId ? state.clone : null),
  getCartesiaClone: vi.fn(async (userId: string) => state.cartesiaClone?.userId === userId ? state.cartesiaClone : null),
}));

const { registerCopilotSpeechRoute } = await import("../copilotSpeech");
const originalFetch = global.fetch;
const originalKey = process.env.ELEVENLABS_API_KEY;
const originalCartesiaKey = process.env.CARTESIA_API_KEY;
let callSequence = 0;
let callSid = "CA1234567890abcdef1234567890abcdef";
const holdId = "hold-a";
const responseId = "response-a";
const phrase = "I will be there soon.";
let app: express.Express;

function auth(userId = "user-a") {
  return { Authorization: "Bearer session-token", "x-test-user-id": userId };
}

function send(overrides: Record<string, unknown> = {}, userId = "user-a") {
  return request(app).post("/api/copilot/clone-speech").set(auth(userId)).send({
    callSid, holdId, responseId, text: phrase, ...overrides,
  });
}

function verified(userId = "user-a", id = responseId, text = phrase, sid = callSid, hold = holdId) {
  registerVerifiedCopilotReply(userId, sid, hold, id, text);
}

beforeEach(() => {
  clearVerifiedCopilotRepliesForTests();
  callSid = `CA${(++callSequence).toString(16).padStart(32, "0")}`;
  state.clone = { userId: "user-a", voiceId: "own-voice", status: "ready" };
  state.cartesiaClone = { userId: "user-a", voiceId: "own-cartesia-voice", status: "ready" };
  state.authorized = true;
  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.CARTESIA_API_KEY = "test-cartesia-key";
  app = express();
  app.use(express.json());
  registerCopilotSpeechRoute(app);
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originalKey;
  if (originalCartesiaKey === undefined) delete process.env.CARTESIA_API_KEY;
  else process.env.CARTESIA_API_KEY = originalCartesiaKey;
});

describe("Copilot OWN clone speech route", () => {
  it("requires Bearer auth and rejects calls that are not authorized for this owner", async () => {
    const noAuth = await request(app).post("/api/copilot/clone-speech").send({});
    expect(noAuth.status).toBe(401);
    verified();
    state.authorized = false;
    const denied = await send();
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/owned by this user/);
  });

  it("binds verified speech to exact owner, call, hold, response and text", async () => {
    global.fetch = vi.fn(async () => { throw new Error("network unavailable in test"); }) as any;
    verified();
    state.clone = { userId: "user-b", voiceId: "other-user-voice", status: "ready" };
    expect((await send({}, "user-b")).status).toBe(409);
    state.clone = { userId: "user-a", voiceId: "own-voice", status: "ready" };
    expect((await send({ callSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).status).toBe(409);
    expect((await send({ text: "Invented text." })).status).toBe(409);
    const valid = await send();
    expect(valid.status).toBe(502); // no provider mock; the registered reply was accepted and consumed
  });

  it("requires a ready clone belonging to the authenticated user", async () => {
    verified();
    state.clone = null;
    const absent = await send();
    expect(absent.status).toBe(409);
    expect(absent.body.error).toMatch(/No ready OWN ElevenLabs voice clone/);
    state.clone = { userId: "other-user", voiceId: "other-voice", status: "ready" };
    expect((await send()).status).toBe(409);
  });

  it("streams bounded MP3 from only the stored owned voice and consumes a reply once", async () => {
    verified();
    const fetchMock = vi.fn(async (url: any, init: any) => {
      expect(init.headers["xi-api-key"]).toBe("test-key");
      expect(JSON.parse(init.body)).toEqual({ text: phrase, model_id: "eleven_multilingual_v2" });
      return new Response(Buffer.from("mock mp3 bytes"), { status: 200 });
    });
    global.fetch = fetchMock as any;
    const audio = await send({ voiceId: "attacker-selected-voice" });
    expect(audio.status).toBe(200);
    expect(audio.headers["content-type"]).toMatch(/audio\/mpeg/);
    expect(audio.headers["cache-control"]).toBe("no-store");
    expect(audio.body.toString()).toBe("mock mp3 bytes");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/own-voice/stream?output_format=mp3_44100_128",
    );
    expect((await send()).status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("defaults older clients to ElevenLabs and rejects unknown providers", async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from("eleven-mp3"), { status: 200 }));
    global.fetch = fetchMock as any;
    verified("user-a", "legacy-client");
    const legacy = await send({ responseId: "legacy-client" });
    expect(legacy.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.elevenlabs.io");

    verified("user-a", "invalid-provider");
    const invalid = await send({ provider: "openai", responseId: "invalid-provider" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/provider must be elevenlabs or cartesia/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses only the authenticated user's Cartesia clone and synthesizes the exact verified text", async () => {
    verified("user-a", "cartesia-reply");
    const fetchMock = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe("https://api.cartesia.ai/tts/bytes");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer test-cartesia-key", "Cartesia-Version": "2026-08-14",
      });
      expect(JSON.parse(init.body)).toMatchObject({
        model_id: "sonic-3.6", transcript: phrase,
        voice: { mode: "id", id: "own-cartesia-voice" }, locale: "en",
      });
      return new Response(Buffer.from("cartesia-mp3"), { status: 200 });
    });
    global.fetch = fetchMock as any;
    const audio = await send({ provider: "cartesia", responseId: "cartesia-reply" });
    expect(audio.status).toBe(200);
    expect(audio.headers["content-type"]).toMatch(/audio\/mpeg/);
    expect(audio.body.toString()).toBe("cartesia-mp3");
    expect((await send({ provider: "cartesia", responseId: "cartesia-reply" })).status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to ElevenLabs for a missing, unowned, or unavailable Cartesia clone", async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from("mp3"), { status: 200 }));
    global.fetch = fetchMock as any;
    verified("user-a", "cartesia-no-clone");
    state.cartesiaClone = null;
    expect((await send({ provider: "cartesia", responseId: "cartesia-no-clone" })).status).toBe(409);
    state.cartesiaClone = { userId: "user-b", voiceId: "other-cartesia-voice", status: "ready" };
    expect((await send({ provider: "cartesia", responseId: "cartesia-no-clone" })).status).toBe(409);
    state.cartesiaClone = { userId: "user-a", voiceId: "own-cartesia-voice", status: "creating" };
    expect((await send({ provider: "cartesia", responseId: "cartesia-no-clone" })).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    state.cartesiaClone = { userId: "user-a", voiceId: "own-cartesia-voice", status: "ready" };
    expect((await send({ provider: "cartesia", responseId: "cartesia-no-clone" })).status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.cartesia.ai/tts/bytes");
  });

  it("fails before consuming a verified reply if the selected provider key is missing", async () => {
    verified("user-a", "cartesia-no-key");
    delete process.env.CARTESIA_API_KEY;
    const missingKey = await send({ provider: "cartesia", responseId: "cartesia-no-key" });
    expect(missingKey.status).toBe(503);
    expect(missingKey.body.error).toMatch(/Cartesia speech service is not configured/);

    process.env.CARTESIA_API_KEY = "test-cartesia-key";
    const fetchMock = vi.fn(async () => new Response(Buffer.from("mp3"), { status: 200 }));
    global.fetch = fetchMock as any;
    const retrySameVerifiedReply = await send({ provider: "cartesia", responseId: "cartesia-no-key" });
    expect(retrySameVerifiedReply.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects Russian and other non-Latin speech at registration and synthesis", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    expect(isLatinCopilotReply("Я скоро буду.")).toBe(false);
    expect(isLatinCopilotReply("你好，Bob")).toBe(false);
    expect(isLatinCopilotReply("مرحبا Bob")).toBe(false);
    expect(isLatinCopilotReply("I’m here—“soon”…")).toBe(true);
    expect(isLatinCopilotReply("Bob will be there.")).toBe(true);
    expect(isLatinCopilotReply("Hello 👋")).toBe(false);
    expect(isLatinCopilotReply("Bob will be there.")).toBe(true);
    verified("user-a", "russian-reply", "Я скоро буду.");
    const result = await send({ responseId: "russian-reply", text: "Я скоро буду." });
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/verified English text/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows only one concurrent request to consume a verified reply", async () => {
    verified("user-a", "racing-response");
    const fetchMock = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(Buffer.from("mp3"), { status: 200 });
    });
    global.fetch = fetchMock as any;
    const results = await Promise.all([
      send({ responseId: "racing-response" }),
      send({ responseId: "racing-response" }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expires verified replies after the bounded retention period", async () => {
    vi.useFakeTimers();
    try {
      verified("user-a", "expires-response");
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(consumeVerifiedCopilotReply("user-a", callSid, holdId, "expires-response", phrase)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies per-call request limits and returns explicit provider errors", async () => {
    const fetchMock = vi.fn(async () => new Response("provider unavailable", { status: 503 }));
    global.fetch = fetchMock as any;
    verified("user-a", "limited-0");
    const first = await send({ responseId: "limited-0" });
    expect(first.status).toBe(502);
    expect(first.body.error).toMatch(/HTTP 503/);
    for (let index = 1; index < 8; index++) {
      verified("user-a", `limited-${index}`);
      await send({ responseId: `limited-${index}` });
    }
    verified("user-a", "limited-8");
    const limited = await send({ responseId: "limited-8" });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/request limit/);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });
});