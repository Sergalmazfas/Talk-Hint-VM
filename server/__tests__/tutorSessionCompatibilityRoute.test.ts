// Route-level fail-closed coverage for the runtime compatibility handshake
// (contract §1): POST /api/tutor/sessions must verify the engine's published
// contract (GET /api/v1/capabilities) BEFORE creating a session. On an
// incompatible or unverifiable engine the session POST must NEVER be sent and
// the user gets an honest, safe error.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.hoisted(() => {
  if (!process.env.TUTOR_ENGINE_API_KEY && !process.env.API_KEY) {
    process.env.TUTOR_ENGINE_API_KEY = "offline-route-test-dummy-key";
  }
});

// Hermetic route tests: swap auth, DB-backed storage and heavy singletons for
// lightweight fakes — the real handlers in tutorRoutes.ts still run.
vi.mock("../auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", email: "test@example.com" };
    next();
  },
}));
vi.mock("../storage", () => ({
  storage: { getUserPhoneNumbers: vi.fn(async () => []) },
}));
vi.mock("../tutorStorage", () => ({
  createTutorSessionRow: vi.fn(async () => ({})),
  endTutorSessionRow: vi.fn(),
  getTutorSessionRow: vi.fn(),
  getCallMemoryByEngineSession: vi.fn(),
  listTutorSessions: vi.fn(),
  saveCallMemory: vi.fn(),
  listCallMemories: vi.fn(),
  getCallMemory: vi.fn(),
  updateCallMemoryFields: vi.fn(),
  confirmCallMemory: vi.fn(),
}));
vi.mock("../tutorTranslate", () => ({
  translateTutorText: vi.fn(),
  validateTranslateInput: vi.fn(() => ({ ok: false, error: "x", message: "x" })),
}));

import { registerTutorRoutes } from "../tutorRoutes";
import { resetCompatibilityCache, getTutorEngineBase } from "../tutorEngine";
import {
  FIXTURE_CAPABILITIES,
  FIXTURE_CONTRACT_META,
  FIXTURE_SESSION_CREATE_201,
} from "./fixtures/tutorEngineContractFixtures";

function makeApp() {
  const app = express();
  app.use(express.json());
  registerTutorRoutes(app);
  return app;
}

const realFetch = global.fetch;

// Fetch stub that routes by URL: capabilities vs session create. Records
// every request so we can assert the session POST never happens.
function stubEngine(capabilitiesBody: unknown, opts?: { capsError?: boolean }) {
  const calls: { url: string; method: string }[] = [];
  const spy = vi.fn(async (url: any, init: any) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method || "GET" });
    if (u.endsWith("/api/v1/capabilities")) {
      if (opts?.capsError) throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify(capabilitiesBody), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.endsWith("/api/v1/sessions")) {
      return new Response(JSON.stringify(FIXTURE_SESSION_CREATE_201), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  global.fetch = spy as any;
  return { calls };
}

const sessionPosts = (calls: { url: string; method: string }[]) =>
  calls.filter((c) => c.url.endsWith("/api/v1/sessions") && c.method === "POST");

describe("POST /api/tutor/sessions — compatibility handshake gates session creation", () => {
  beforeEach(() => resetCompatibilityCache());
  afterEach(() => {
    global.fetch = realFetch;
    vi.clearAllMocks();
  });

  it("compatible engine → 201, session POST goes out after the handshake", async () => {
    const { calls } = stubEngine(FIXTURE_CAPABILITIES);
    const res = await request(makeApp()).post("/api/tutor/sessions").send({});
    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBe(FIXTURE_SESSION_CREATE_201.session_id);
    expect(sessionPosts(calls)).toHaveLength(1);
    expect(calls[0].url).toBe(`${getTutorEngineBase()}/api/v1/capabilities`);
  });

  it("MAJOR-incompatible engine → 503 tutor_incompatible, NO session POST", async () => {
    const { calls } = stubEngine({
      ...FIXTURE_CAPABILITIES,
      contract: { ...FIXTURE_CONTRACT_META.contract, major: 2, version: "2.0.0" },
    });
    const res = await request(makeApp()).post("/api/tutor/sessions").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("tutor_incompatible");
    expect(res.body.message).toContain("несовместимая версия");
    expect(sessionPosts(calls)).toHaveLength(0);
  });

  it("wrong realtime protocol → 503, NO session POST", async () => {
    const { calls } = stubEngine({
      ...FIXTURE_CAPABILITIES,
      realtime: { protocol: "tutor-realtime", version: "2.0", protocol_version: "tutor-realtime/2.0" },
    });
    const res = await request(makeApp()).post("/api/tutor/sessions").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("tutor_incompatible");
    expect(sessionPosts(calls)).toHaveLength(0);
  });

  it("missing discovery metadata (unverifiable engine) → 503, NO session POST", async () => {
    const { calls } = stubEngine({ realtime_audio: true, avatar: true });
    const res = await request(makeApp()).post("/api/tutor/sessions").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("tutor_incompatible");
    expect(sessionPosts(calls)).toHaveLength(0);
  });

  it("capabilities outage → blocked with the safe connection error, NO session POST", async () => {
    const { calls } = stubEngine(null, { capsError: true });
    const res = await request(makeApp()).post("/api/tutor/sessions").send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("tutor_connection");
    expect(sessionPosts(calls)).toHaveLength(0);
  });

  it("incompatible verdict is cached — second request is refused without re-fetching", async () => {
    const { calls } = stubEngine({
      ...FIXTURE_CAPABILITIES,
      contract: { ...FIXTURE_CONTRACT_META.contract, major: 2 },
    });
    const app = makeApp();
    await request(app).post("/api/tutor/sessions").send({});
    const res2 = await request(app).post("/api/tutor/sessions").send({});
    expect(res2.status).toBe(503);
    expect(calls.filter((c) => c.url.endsWith("/api/v1/capabilities"))).toHaveLength(1);
    expect(sessionPosts(calls)).toHaveLength(0);
  });
});
