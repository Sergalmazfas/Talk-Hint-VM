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

  it("reports which alert channels are configured and ready", async () => {
    const prev = { ...process.env };
    delete process.env.WRITE_HEALTH_ALERT_PHONE;
    delete process.env.WRITE_HEALTH_ALERT_EMAIL;
    delete process.env.DISABLE_WRITE_HEALTH_ALERTS;

    try {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body.alertChannels).toBeDefined();
      expect(res.body.alertChannels).toHaveProperty("anyReady", false);
      expect(res.body.alertChannels).toHaveProperty("disabled", false);
      // Nothing configured → both channels off, no secrets leaked.
      expect(res.body.alertChannels.sms).toEqual({
        configured: false,
        ready: false,
        missing: [],
      });
      expect(res.body.alertChannels.email).toEqual({
        configured: false,
        ready: false,
        missing: [],
      });
    } finally {
      process.env = prev;
    }
  });

  it("flags a partially-configured channel as not-ready and names what's missing", async () => {
    const prev = { ...process.env };
    process.env.WRITE_HEALTH_ALERT_EMAIL = "ops@example.com";
    delete process.env.WRITE_HEALTH_ALERT_EMAIL_FROM;
    delete process.env.SENDGRID_API_KEY;

    try {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body.alertChannels.email.configured).toBe(true);
      expect(res.body.alertChannels.email.ready).toBe(false);
      expect(res.body.alertChannels.email.missing).toContain("SENDGRID_API_KEY");
      expect(res.body.alertChannels.email.missing).toContain(
        "WRITE_HEALTH_ALERT_EMAIL_FROM",
      );
      // No secret values appear anywhere in the response.
      expect(JSON.stringify(res.body)).not.toContain("ops@example.com");
    } finally {
      process.env = prev;
    }
  });

  it("shows a recipient set to a malformed value as configured-but-not-ready", async () => {
    const prev = { ...process.env };
    process.env.WRITE_HEALTH_ALERT_EMAIL = "   ";
    process.env.WRITE_HEALTH_ALERT_EMAIL_FROM = "alerts@example.com";
    process.env.SENDGRID_API_KEY = "sg-key";

    try {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body.alertChannels.email.configured).toBe(true);
      expect(res.body.alertChannels.email.ready).toBe(false);
      expect(res.body.alertChannels.email.missing).toContain(
        "WRITE_HEALTH_ALERT_EMAIL (no valid recipients)",
      );
    } finally {
      process.env = prev;
    }
  });

  it("flags a partially-configured SMS channel as not-ready", async () => {
    const prev = { ...process.env };
    process.env.WRITE_HEALTH_ALERT_PHONE = "+15551234567";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.WRITE_HEALTH_ALERT_FROM;
    delete process.env.TWILIO_PHONE_NUMBER;

    try {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body.alertChannels.sms.configured).toBe(true);
      expect(res.body.alertChannels.sms.ready).toBe(false);
      expect(res.body.alertChannels.sms.missing).toContain("TWILIO_ACCOUNT_SID");
      expect(res.body.alertChannels.sms.missing).toContain("TWILIO_AUTH_TOKEN");
      // The recipient phone number must not leak into the response.
      expect(JSON.stringify(res.body)).not.toContain("+15551234567");
    } finally {
      process.env = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Production access gate for the save-health endpoints. The gate is opt-in:
// it only restricts access in production AND only when HEALTH_STATUS_TOKEN is
// set. Outside production, or with no token configured, both endpoints stay
// open (frictionless dev / today's behavior). When locked, the JSON endpoint
// returns 401 with no internals, and the HTML page returns a token prompt
// rather than the dashboard.
// ---------------------------------------------------------------------------
describe("save-health access gate", () => {
  function withEnv(
    env: Record<string, string | undefined>,
    run: () => Promise<void>,
  ) {
    const prev = { ...process.env };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return run().finally(() => {
      process.env = prev;
    });
  }

  it("stays open outside production even when a token is configured", async () => {
    await withEnv(
      { NODE_ENV: "test", HEALTH_STATUS_TOKEN: "s3cret" },
      async () => {
        const api = await request(app).get("/api/health");
        expect(api.status).toBe(200);
        const page = await request(app).get("/health");
        expect(page.status).toBe(200);
        expect(page.text).toContain("Database Save Health");
      },
    );
  });

  it("stays open in production when no token is configured (opt-in)", async () => {
    await withEnv(
      { NODE_ENV: "production", HEALTH_STATUS_TOKEN: undefined },
      async () => {
        const api = await request(app).get("/api/health");
        expect(api.status).toBe(200);
        const page = await request(app).get("/health");
        expect(page.status).toBe(200);
        expect(page.text).toContain("Database Save Health");
      },
    );
  });

  it("blocks /api/health in production without a valid token", async () => {
    await withEnv(
      { NODE_ENV: "production", HEALTH_STATUS_TOKEN: "s3cret" },
      async () => {
        const res = await request(app).get("/api/health");
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: "Unauthorized" });
        // No internals leak in the unauthorized body.
        expect(JSON.stringify(res.body)).not.toContain("writeSuccesses");
      },
    );
  });

  it("blocks /api/health when the token is wrong", async () => {
    await withEnv(
      { NODE_ENV: "production", HEALTH_STATUS_TOKEN: "s3cret" },
      async () => {
        const res = await request(app).get("/api/health?token=nope");
        expect(res.status).toBe(401);
      },
    );
  });

  it("allows /api/health with the token via query, x-health-token, or Bearer", async () => {
    await withEnv(
      { NODE_ENV: "production", HEALTH_STATUS_TOKEN: "s3cret" },
      async () => {
        const viaQuery = await request(app).get("/api/health?token=s3cret");
        expect(viaQuery.status).toBe(200);
        expect(viaQuery.body.status).toBe("ok");

        const viaHeader = await request(app)
          .get("/api/health")
          .set("x-health-token", "s3cret");
        expect(viaHeader.status).toBe(200);

        const viaBearer = await request(app)
          .get("/api/health")
          .set("Authorization", "Bearer s3cret");
        expect(viaBearer.status).toBe(200);
      },
    );
  });

  it("serves a token prompt (no internals) for /health when locked", async () => {
    await withEnv(
      { NODE_ENV: "production", HEALTH_STATUS_TOKEN: "s3cret" },
      async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(401);
        expect(res.text).toContain("On-call token required");
        // The real dashboard markup must not be served when locked.
        expect(res.text).not.toContain("Per-table status");
      },
    );
  });

  it("serves the dashboard for /health with a valid token", async () => {
    await withEnv(
      { NODE_ENV: "production", HEALTH_STATUS_TOKEN: "s3cret" },
      async () => {
        const res = await request(app).get("/health?token=s3cret");
        expect(res.status).toBe(200);
        expect(res.text).toContain("Per-table status");
      },
    );
  });
});
