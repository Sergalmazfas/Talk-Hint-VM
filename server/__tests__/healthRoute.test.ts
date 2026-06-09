import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Route-level coverage for /api/health: the endpoint must surface the
// contact-memory write-health counters and the schema-drift report so the
// silent caller-details failure can be monitored. We exercise the real route
// handler in server/routes.ts while swapping the database, auth, and heavy
// service singletons for lightweight fakes (no Postgres / Twilio / OpenAI /
// Stripe required).
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const ALL_COLUMNS = [
    "id",
    "user_id",
    "phone_number",
    "name",
    "summary",
    "notes",
    "importance",
    "last_call_at",
    "created_at",
    "updated_at",
  ];
  const pool = {
    query: async (_sql: string, _params: any[]) => ({
      rows: ALL_COLUMNS.map((c) => ({ column_name: c })),
    }),
  };
  return { pool };
});

vi.mock("../db", () => ({
  db: {},
  pool: h.pool,
  dbReady: Promise.resolve(),
  isDatabaseAvailable: () => true,
  testDatabaseConnection: async () => true,
  isDevDatabase: true,
}));

vi.mock("../auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "u1", email: "u1@example.com", language: "en", plan: "free" };
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

// Avoid heavy / network-bound singletons (OpenAI, WebSocket, Stripe, Twilio mgmt).
vi.mock("../websocket", () => ({
  setupWebSocket: vi.fn(),
  setCallOwner: vi.fn(),
  clearCallOwner: vi.fn(),
  TALKHINT_GOLDEN_PROMPT: "",
  PREP_PROMPT: "",
  LANGUAGE_NAMES: {},
  getHintFallbackStats: vi.fn(() => ({
    geminiAttempts: 0,
    geminiFallbacks: 0,
    fallbackRatePct: 0,
  })),
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

const { registerRoutes } = await import("../routes");

async function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

let app: express.Express;

beforeEach(async () => {
  app = await makeApp();
});

describe("GET /api/health", () => {
  it("includes the contactMemory.{writes, drift} shape", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");

    expect(res.body.contactMemory).toBeDefined();

    // writes — the per-table write-health counters.
    expect(res.body.contactMemory.writes).toBeDefined();
    expect(res.body.contactMemory.writes).toHaveProperty("writeSuccesses");
    expect(res.body.contactMemory.writes).toHaveProperty("writeFailures");
    expect(res.body.contactMemory.writes).toHaveProperty("lastError");

    // drift — the schema-drift report.
    expect(res.body.contactMemory.drift).toBeDefined();
    expect(res.body.contactMemory.drift).toHaveProperty("checked");
    expect(res.body.contactMemory.drift).toHaveProperty("ok");
    expect(res.body.contactMemory.drift).toHaveProperty("table", "contact_memory");
    expect(res.body.contactMemory.drift).toHaveProperty("missingColumns");
    expect(Array.isArray(res.body.contactMemory.drift.missingColumns)).toBe(true);
  });
});
