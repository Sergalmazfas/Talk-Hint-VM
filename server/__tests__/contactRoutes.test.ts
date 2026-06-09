import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Route-level coverage for the per-user Contact Memory API:
//   GET    /api/contacts        — list (own rows only)
//   PUT    /api/contacts/:id    — edit (own rows only -> 404 otherwise)
//   DELETE /api/contacts/:id    — delete (own rows only -> 404 otherwise)
//
// These integration tests exercise the real route handlers in server/routes.ts
// while swapping the database, auth middleware, and heavy service singletons for
// lightweight fakes — keeping the privacy-regression coverage hermetic (no
// Postgres / Twilio / OpenAI / Stripe required). The focus is that auth is
// required and that one user can never read, edit, or delete another user's
// contact memory.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const store: { rows: any[] } = { rows: [] };

  const toCamel = (snake: string) =>
    snake.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
  const fieldName = (col: any) => toCamel(String(col?.name ?? col));

  const matchPred = (row: any, pred: any): boolean => {
    if (!pred) return true;
    if (pred.__op === "eq") return row[pred.field] === pred.val;
    if (pred.__op === "and") return pred.conds.every((c: any) => matchPred(row, c));
    return true;
  };

  const eq = (col: any, val: any) => ({ __op: "eq", field: fieldName(col), val });
  const and = (...conds: any[]) => ({ __op: "and", conds });

  const db = {
    select() {
      return {
        from() {
          let pred: any = null;
          const run = () =>
            store.rows.filter((r) => matchPred(r, pred)).map((r) => ({ ...r }));
          const result: any = {
            where(p: any) {
              pred = p;
              return result;
            },
            orderBy() {
              return Promise.resolve(run());
            },
            then(resolve: any, reject: any) {
              return Promise.resolve(run()).then(resolve, reject);
            },
          };
          return result;
        },
      };
    },
    update() {
      return {
        set(values: any) {
          let pred: any = null;
          const exec = () => {
            const matched = store.rows.filter((r) => matchPred(r, pred));
            matched.forEach((r) => Object.assign(r, values));
            return matched.map((r) => ({ ...r }));
          };
          const builder: any = {
            where(p: any) {
              pred = p;
              return builder;
            },
            returning() {
              return Promise.resolve(exec());
            },
            then(resolve: any, reject: any) {
              return Promise.resolve(exec()).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
    delete() {
      let pred: any = null;
      const exec = () => {
        const matched = store.rows.filter((r) => matchPred(r, pred));
        store.rows = store.rows.filter((r) => !matchPred(r, pred));
        return matched.map((r) => ({ ...r }));
      };
      const builder: any = {
        where(p: any) {
          pred = p;
          return builder;
        },
        returning() {
          return Promise.resolve(exec());
        },
        then(resolve: any, reject: any) {
          return Promise.resolve(exec()).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  return { store, db, eq, and };
});

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: h.eq, and: h.and };
});

vi.mock("../db", () => ({
  db: h.db,
  pool: {},
  dbReady: Promise.resolve(),
  isDatabaseAvailable: () => true,
  testDatabaseConnection: async () => true,
  isDevDatabase: true,
}));

// authMiddleware double: authenticate via the `x-test-user-id` header.
vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user-id"];
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: String(uid), email: `${uid}@example.com`, language: "en", plan: "free" };
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

const OWNER = "owner-user-1";
const ATTACKER = "attacker-user-2";

function seedContact(overrides: Record<string, any> = {}) {
  const row = {
    id: "cm-1",
    userId: OWNER,
    phoneNumber: "+15559998888",
    name: "Jane",
    summary: "Regular client.",
    notes: "Prefers evenings.",
    importance: "high",
    lastCallAt: new Date("2026-03-01T10:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  h.store.rows.push(row);
  return row;
}

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
  h.store.rows = [];
  app = await makeApp();
});

describe("GET /api/contacts", () => {
  it("requires authentication (401 without a user)", async () => {
    const res = await request(app).get("/api/contacts");
    expect(res.status).toBe(401);
  });

  it("returns only the calling user's contacts", async () => {
    seedContact({ id: "cm-owner", userId: OWNER, phoneNumber: "+1111", summary: "owner row" });
    seedContact({ id: "cm-attacker", userId: ATTACKER, phoneNumber: "+2222", summary: "attacker row" });

    const res = await request(app).get("/api/contacts").set("x-test-user-id", OWNER);

    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.contacts[0].id).toBe("cm-owner");
  });
});

describe("PUT /api/contacts/:id", () => {
  it("requires authentication (401 without a user)", async () => {
    seedContact();
    const res = await request(app).put("/api/contacts/cm-1").send({ summary: "x" });
    expect(res.status).toBe(401);
  });

  it("lets the owner edit their own contact (control case)", async () => {
    seedContact({ id: "cm-1", userId: OWNER, summary: "old" });

    const res = await request(app)
      .put("/api/contacts/cm-1")
      .set("x-test-user-id", OWNER)
      .send({ summary: "new summary" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.contact.summary).toBe("new summary");
    expect(h.store.rows[0].summary).toBe("new summary");
  });

  it("returns 404 when editing a contact owned by another user and leaves it unchanged", async () => {
    seedContact({ id: "cm-1", userId: OWNER, summary: "owner's private summary" });

    const res = await request(app)
      .put("/api/contacts/cm-1")
      .set("x-test-user-id", ATTACKER)
      .send({ summary: "hacked" });

    expect(res.status).toBe(404);
    expect(h.store.rows[0].summary).toBe("owner's private summary");
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app)
      .put("/api/contacts/cm-missing")
      .set("x-test-user-id", OWNER)
      .send({ summary: "x" });

    expect(res.status).toBe(404);
  });

  it("rejects a non-string field with 400", async () => {
    seedContact({ id: "cm-1", userId: OWNER });

    const res = await request(app)
      .put("/api/contacts/cm-1")
      .set("x-test-user-id", OWNER)
      .send({ importance: 5 });

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/contacts/:id", () => {
  it("requires authentication (401 without a user)", async () => {
    seedContact();
    const res = await request(app).delete("/api/contacts/cm-1");
    expect(res.status).toBe(401);
    expect(h.store.rows).toHaveLength(1);
  });

  it("lets the owner delete their own contact (control case)", async () => {
    seedContact({ id: "cm-1", userId: OWNER });

    const res = await request(app).delete("/api/contacts/cm-1").set("x-test-user-id", OWNER);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(h.store.rows).toHaveLength(0);
  });

  it("returns 404 when deleting a contact owned by another user and leaves it intact", async () => {
    seedContact({ id: "cm-1", userId: OWNER });

    const res = await request(app).delete("/api/contacts/cm-1").set("x-test-user-id", ATTACKER);

    expect(res.status).toBe(404);
    expect(h.store.rows).toHaveLength(1);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app).delete("/api/contacts/cm-missing").set("x-test-user-id", OWNER);
    expect(res.status).toBe(404);
  });
});
