import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Shared in-memory store + fake drizzle `db` (hoisted so vi.mock can use it).
//
// These integration tests exercise the real route handlers in server/routes.ts
// (authorization logic, TwiML generation) while swapping out the database,
// auth middleware, and heavy service singletons for lightweight fakes. This
// keeps the security regression coverage hermetic — no Postgres / Twilio /
// OpenAI / Stripe required to run.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const store: { rows: any[] } = { rows: [] };

  // drizzle columns expose a snake_case `.name`; our rows use camelCase keys.
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
    update() {
      return {
        set(values: any) {
          let pred: any = null;
          const exec = () => {
            const matched = store.rows.filter((r) => matchPred(r, pred));
            matched.forEach((r) => Object.assign(r, values));
            return matched;
          };
          const whereResult = {
            returning() {
              return Promise.resolve(exec().map((r) => ({ id: r.id })));
            },
            then(resolve: any, reject: any) {
              return Promise.resolve(exec()).then(resolve, reject);
            },
          };
          return {
            where(p: any) {
              pred = p;
              return whereResult;
            },
          };
        },
      };
    },
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
            limit() {
              return Promise.resolve(run());
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
    insert() {
      return {
        values(v: any) {
          const rows = Array.isArray(v) ? v : [v];
          const doInsert = () => rows.forEach((r) => store.rows.push({ ...r }));
          return {
            onConflictDoUpdate() {
              doInsert();
              return Promise.resolve();
            },
            returning() {
              doInsert();
              return Promise.resolve(rows.map((r) => ({ id: r.id })));
            },
            then(resolve: any, reject: any) {
              doInsert();
              return Promise.resolve().then(resolve, reject);
            },
          };
        },
      };
    },
    delete() {
      let pred: any = null;
      const exec = () => {
        store.rows = store.rows.filter((r) => !matchPred(r, pred));
      };
      return {
        where(p: any) {
          pred = p;
          return Promise.resolve().then(exec);
        },
      };
    },
  };

  return { store, db, eq, and };
});

// Keep real drizzle (schema needs sql/pgTable etc.) but route the query
// predicate helpers through the fake so the in-memory store can evaluate them.
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

// Import AFTER mocks are registered.
const { registerRoutes } = await import("../routes");
const { setCallOwner } = await import("../websocket");

const OWNER = "owner-user-1";
const ATTACKER = "attacker-user-2";
const CALL_SID = "CA-test-123";

function futureDate() {
  return new Date(Date.now() + 120000);
}

function seedPendingCall(overrides: Record<string, any> = {}) {
  h.store.rows = [
    {
      id: "pc-1",
      userId: OWNER,
      callSid: CALL_SID,
      fromNumber: "+15550001111",
      toNumber: "+15559998888",
      status: "ringing",
      clientType: "browser",
      createdAt: new Date(),
      expiresAt: futureDate(),
      ...overrides,
    },
  ];
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

describe("POST /api/call/accept authorization", () => {
  it("returns 404 for a non-owner and does not change call state", async () => {
    seedPendingCall({ status: "ringing", clientType: "browser" });

    const res = await request(app)
      .post("/api/call/accept")
      .set("x-test-user-id", ATTACKER)
      .send({ callSid: CALL_SID });

    expect(res.status).toBe(404);
    // State untouched: still ringing, still default clientType.
    expect(h.store.rows[0].status).toBe("ringing");
    expect(h.store.rows[0].clientType).toBe("browser");
  });

  it("allows the owner to accept (control case)", async () => {
    seedPendingCall({ status: "ringing", clientType: "browser" });

    const res = await request(app)
      .post("/api/call/accept")
      .set("x-test-user-id", OWNER)
      .send({ callSid: CALL_SID });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(h.store.rows[0].status).toBe("accepted");
  });
});

describe("POST /api/call/reject authorization", () => {
  it("returns 404 for a non-owner and does not hang up / change state", async () => {
    seedPendingCall({ status: "ringing" });

    const res = await request(app)
      .post("/api/call/reject")
      .set("x-test-user-id", ATTACKER)
      .send({ callSid: CALL_SID });

    expect(res.status).toBe(404);
    // Not rejected — the Twilio hangup only runs after a successful ownership update.
    expect(h.store.rows[0].status).toBe("ringing");
  });
});

describe("/twilio/voice conference join authorization", () => {
  async function join(identity: string, room: string) {
    return request(app)
      .post("/twilio/voice")
      .type("form")
      .send({ From: `client:${identity}`, conferenceRoom: room });
  }

  it("denies join when the joining identity does not own the pending call", async () => {
    seedPendingCall({ userId: OWNER, status: "accepted", clientType: "ios" });

    const res = await join(`user-${ATTACKER}`, `call-${CALL_SID}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("no longer available");
    expect(res.text).toContain("<Hangup");
    expect(res.text).not.toContain("<Conference");
  });

  it("denies join when the pending call status is not 'accepted'", async () => {
    seedPendingCall({ userId: OWNER, status: "ringing", clientType: "ios" });

    const res = await join(`user-${OWNER}`, `call-${CALL_SID}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("no longer available");
    expect(res.text).toContain("<Hangup");
    expect(res.text).not.toContain("<Conference");
  });

  it("denies join when the pending call is not an iOS call", async () => {
    seedPendingCall({ userId: OWNER, status: "accepted", clientType: "browser" });

    const res = await join(`user-${OWNER}`, `call-${CALL_SID}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("no longer available");
    expect(res.text).toContain("<Hangup");
    expect(res.text).not.toContain("<Conference");
  });

  it("denies join when the client identity is malformed", async () => {
    seedPendingCall({ userId: OWNER, status: "accepted", clientType: "ios" });

    const res = await join("not-a-user-identity", `call-${CALL_SID}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("no longer available");
    expect(res.text).not.toContain("<Conference");
  });

  it("allows join for the owner of an accepted iOS call (control case)", async () => {
    seedPendingCall({ userId: OWNER, status: "accepted", clientType: "ios" });

    const res = await join(`user-${OWNER}`, `call-${CALL_SID}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("<Conference");
    expect(res.text).toContain(`call-${CALL_SID}`);
    expect(res.text).not.toContain("no longer available");
  });
});

describe("/api/twilio/hold browser bridge (regression)", () => {
  it("routes an accepted browser call via <Dial><Client> in the hold loop", async () => {
    // Browser accept omits clientType -> defaults to 'browser'.
    seedPendingCall({ status: "ringing", clientType: "browser" });

    const acceptRes = await request(app)
      .post("/api/call/accept")
      .set("x-test-user-id", OWNER)
      .send({ callSid: CALL_SID });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.clientType).toBe("browser");

    const holdRes = await request(app).post(
      `/api/twilio/hold?callSid=${CALL_SID}&userId=${OWNER}`
    );

    expect(holdRes.status).toBe(200);
    expect(holdRes.text).toContain("<Dial");
    expect(holdRes.text).toContain(`<Client>user-${OWNER}</Client>`);
    // Browser path must NOT use a conference bridge.
    expect(holdRes.text).not.toContain("<Conference");
  });

  it("routes an accepted iOS call via <Conference> in the hold loop (contrast)", async () => {
    seedPendingCall({ status: "accepted", clientType: "ios" });

    const holdRes = await request(app).post(
      `/api/twilio/hold?callSid=${CALL_SID}&userId=${OWNER}`
    );

    expect(holdRes.status).toBe(200);
    expect(holdRes.text).toContain("<Conference");
    expect(holdRes.text).not.toContain("<Client>");
  });
});

describe("/twilio/voice outbound call ownership (regression)", () => {
  beforeEach(() => {
    (setCallOwner as any).mockClear();
  });

  it("registers the call owner for a browser outbound call so hints route to that user", async () => {
    // Browser outbound: From is the signed client identity, To is the dialed PSTN number.
    const res = await request(app)
      .post("/twilio/voice")
      .type("form")
      .send({
        From: `client:user-${OWNER}`,
        To: "+15559998888",
        CallSid: CALL_SID,
      });

    expect(res.status).toBe(200);
    // Outbound TwiML must start the media stream and dial the target.
    expect(res.text).toContain("<Stream");
    expect(res.text).toContain("<Dial");
    // The fix: without this the media stream has no owner and every
    // transcript/hint is dropped fail-closed (empty screen during the call).
    expect(setCallOwner).toHaveBeenCalledWith(CALL_SID, OWNER);
  });

  it("does NOT register an owner for a line-based outbound call (unowned by design)", async () => {
    const res = await request(app)
      .post("/twilio/voice")
      .type("form")
      .send({
        From: "client:line_1",
        To: "+15559998888",
        CallSid: CALL_SID,
      });

    expect(res.status).toBe(200);
    expect(setCallOwner).not.toHaveBeenCalled();
  });
});
