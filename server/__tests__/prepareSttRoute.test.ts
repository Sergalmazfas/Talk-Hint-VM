import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Route-level tests for POST /api/prepare/stt.
//
// Task #185: long voice dictation must never be silently lost on network
// failure. These tests lock in that:
//   - a network-level fetch error from OpenAI returns an explicit { error }
//     body (not a 200 with empty text, not a silent hang)
//   - an HTTP error response from OpenAI returns an explicit { error } body
//   - missing audio data returns 400 + { error } (no silent pass-through)
//   - a successful transcription returns { text } as expected
//
// No Postgres, Twilio, OpenAI, or Stripe credentials are required.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------------
// Minimal mocks to satisfy all of routes.ts's static imports
// ------------------------------------------------------------------

vi.mock("../db", () => ({
  db: {},
  pool: { query: async () => ({ rows: [] }) },
  dbReady: Promise.resolve(),
  isDatabaseAvailable: () => true,
  testDatabaseConnection: async () => true,
  isDevDatabase: true,
}));

vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user-id"];
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: String(uid), email: `${uid}@example.com`, language: "ru", plan: "free" };
    next();
  },
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSessionUserId: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("../websocket", () => ({
  setupWebSocket: vi.fn(),
  setCallOwner: vi.fn(),
  clearCallOwner: vi.fn(),
  getHintFallbackStats: vi.fn(() => ({})),
  TALKHINT_GOLDEN_PROMPT: "",
  PREP_PROMPT: "",
  LANGUAGE_NAMES: {},
}));

vi.mock("../pushService", () => ({
  saveSubscription: vi.fn(),
  sendIncomingCallPush: vi.fn().mockResolvedValue(undefined),
  getVapidPublicKey: vi.fn(() => null),
}));

vi.mock("../stripeService", () => ({
  stripeService: new Proxy({}, { get: () => vi.fn() }),
}));

vi.mock("../stripeClient", () => ({
  getStripePublishableKey: vi.fn(async () => null),
  getStripeSecretKey: vi.fn(async () => null),
  getUncachableStripeClient: vi.fn(async () => null),
}));

vi.mock("../twilioService", () => ({
  searchAvailableNumbers: vi.fn(),
  purchasePhoneNumber: vi.fn(),
  configureVoiceWebhook: vi.fn(),
  configureAllPoolWebhooks: vi.fn(),
  configureWebhookByPhone: vi.fn(),
}));

vi.mock("../training", () => ({
  startTrainingSession: vi.fn(),
  processTrainingTurn: vi.fn(),
  resetTrainingSession: vi.fn(),
  generateTTS: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: new Proxy({}, { get: () => vi.fn(async () => null) }),
  getContactMemoryHealth: vi.fn(() => ({})),
  getWriteHealth: vi.fn(() => ({})),
  checkSchemaDrift: vi.fn(async () => ({ checked: false, tables: [] })),
}));

vi.mock("../writeHealthAlerter", () => ({
  getAlertChannelStatus: vi.fn(() => ({})),
  getWriteHealthAlertState: vi.fn(() => ({})),
}));

vi.mock("../airatomaRetryWorker", () => ({
  deliverCallToAirAtoma: vi.fn(async () => {}),
}));

vi.mock("../airatomaWebhook", () => ({
  validateUserWebhookUrl: vi.fn(),
  parseTranscriptText: vi.fn((t: string) => t),
}));

vi.mock("../contactMemory", () => ({
  deriveOtherPartyPhone: vi.fn(() => null),
  formatStaticCards: vi.fn(() => []),
}));

vi.mock("../dialogueLibraryGenerator", () => ({
  generateDialogueLibrary: vi.fn(async () => []),
  MIN_DIALOGUE_ENTRIES: 3,
}));

vi.mock("../tutorRoutes", () => ({
  registerTutorRoutes: vi.fn(),
}));

vi.mock("../benchmark/routes", () => ({
  registerBenchmarkRoutes: vi.fn(),
}));

vi.mock("../benchmark/adminGate", () => ({
  isBenchmarkAdmin: vi.fn(() => false),
}));

vi.mock("../benchmark/diagnosticRecording", () => ({
  isDiagnosticRecordingUser: vi.fn(() => false),
  stampRecordingPolicy: vi.fn(async () => {}),
  scheduleAutoBenchmark: vi.fn(),
  RECORDING_NOTICE_TEXT: "",
}));

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: any) => ({ __op: "eq", col, val }),
    and: (...conds: any[]) => ({ __op: "and", conds }),
  };
});

// ------------------------------------------------------------------
// Load the routes module after all mocks are in place
// ------------------------------------------------------------------
const { registerRoutes } = await import("../routes");

const USER_ID = "user-prepare-stt-test";

async function makeApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: false }));
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

// A tiny valid base64 webm blob (>2 KB so the size gate passes)
const FAKE_AUDIO_B64 = Buffer.alloc(3000, 0).toString("base64");
const VALID_BODY = { audio: FAKE_AUDIO_B64, mimeType: "audio/webm" };

const originalFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;

let app: express.Express;

beforeEach(async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  app = await makeApp();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

// ------------------------------------------------------------------
describe("POST /api/prepare/stt — authentication", () => {
  it("returns 401 when no user is authenticated", async () => {
    const res = await request(app).post("/api/prepare/stt").send(VALID_BODY);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/prepare/stt — input validation", () => {
  it("returns 400 with an explicit error when audio field is missing", async () => {
    const res = await request(app)
      .post("/api/prepare/stt")
      .set("x-test-user-id", USER_ID)
      .send({ mimeType: "audio/webm" }); // no audio
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBeTruthy();
  });
});

describe("POST /api/prepare/stt — OpenAI upstream errors", () => {
  it("returns 500 with explicit { error } when fetch throws (network failure)", async () => {
    // Simulate a network-level failure during the STT upload
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET: connection reset"));

    const res = await request(app)
      .post("/api/prepare/stt")
      .set("x-test-user-id", USER_ID)
      .send(VALID_BODY);

    // Must never be a silent success — the client needs an explicit error
    // so it can show a message and preserve the user's text for retry.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBeTruthy();
  });

  it("returns 502 with explicit { error } when OpenAI returns a 5xx status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    const res = await request(app)
      .post("/api/prepare/stt")
      .set("x-test-user-id", USER_ID)
      .send(VALID_BODY);

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/503/); // includes the upstream status
  });

  it("returns 502 with explicit { error } when OpenAI returns a 401 (bad key)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const res = await request(app)
      .post("/api/prepare/stt")
      .set("x-test-user-id", USER_ID)
      .send(VALID_BODY);

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBeTruthy();
  });
});

describe("POST /api/prepare/stt — successful transcription", () => {
  it("returns { text } on a normal OpenAI response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: "Хочу договориться о возврате платежа за август." }),
    });

    const res = await request(app)
      .post("/api/prepare/stt")
      .set("x-test-user-id", USER_ID)
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("text");
    expect(res.body.text).toContain("возврате платежа");
  });

  it("returns { text: '' } (empty string) when OpenAI returns no text — not an error, caller shows its own message", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: "" }),
    });

    const res = await request(app)
      .post("/api/prepare/stt")
      .set("x-test-user-id", USER_ID)
      .send(VALID_BODY);

    // Empty recognition is not a server error; the client handles it with its own UI message.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("text");
    expect(res.body.text).toBe("");
  });
});

describe("POST /api/prepare/stt — missing API key", () => {
  it("returns 500 with explicit { error } when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY;

    const res = await request(app)
      .post("/api/prepare/stt")
      .set("x-test-user-id", USER_ID)
      .send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBeTruthy();
  });
});
