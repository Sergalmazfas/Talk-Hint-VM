import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Integration tests for the benchmark admin gate (/api/admin/benchmark).
// Admin identity is derived from the ADMIN_PROVISION_USER secret (fail-closed):
//   - no auth            -> 401 (real authMiddleware path)
//   - authed non-admin   -> 403
//   - authed admin email -> 200 with data
//   - missing/broken secret -> nobody is admin (403 even for prior admins)
// We run the REAL authMiddleware (Bearer-token path) against a faked storage
// layer, and mount the real benchmark routes with the heavy orchestrator /
// seed / db modules stubbed out.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const sessions = new Map<string, string>(); // token -> userId
  const users = new Map<string, { id: string; email: string; language: string; plan: string | null }>();
  return { sessions, users };
});

vi.mock("../storage", () => ({
  storage: {
    getSession: async (token: string) =>
      h.sessions.has(token) ? { token, userId: h.sessions.get(token), expiresAt: new Date(Date.now() + 60_000) } : undefined,
    getUser: async (id: string) => h.users.get(id),
    getUserByEmail: async (email: string) =>
      [...h.users.values()].find((u) => u.email === email),
  },
}));

vi.mock("../db", () => ({
  db: {},
  pool: {},
  dbReady: Promise.resolve(),
  isDatabaseAvailable: () => true,
  isDevDatabase: true,
}));

vi.mock("../benchmark/ensureTables", () => ({
  ensureBenchmarkTables: async () => {},
}));

vi.mock("../benchmark/orchestrator", () => ({
  runAvailabilityCheck: vi.fn(async () => ({ ok: true })),
  startEarsRun: vi.fn(async () => ({ id: "run-ears" })),
  startBrainRun: vi.fn(async () => ({ id: "run-brain" })),
  getRun: vi.fn(async () => undefined),
  listRuns: vi.fn(async () => [
    { id: "r1", runType: "ears", results: [{ big: true }], report: { x: 1 } },
  ]),
  listFixtures: vi.fn(async () => []),
  getFixture: vi.fn(async () => undefined),
}));

vi.mock("../benchmark/seed", () => ({
  ensureGoldCallFixture: vi.fn(async () => ({ id: "gold" })),
}));

vi.mock("../benchmark/replay", () => ({
  buildReplay: vi.fn(() => ({})),
}));

const { registerBenchmarkRoutes } = await import("../benchmark/routes");
const { isBenchmarkAdmin, requireBenchmarkAdmin } = await import("../benchmark/adminGate");

const ADMIN_EMAIL = "owner@example.com";
const ORIGINAL_SECRET = process.env.ADMIN_PROVISION_USER;

function makeApp() {
  const app = express();
  app.use(express.json());
  registerBenchmarkRoutes(app as any);
  return app;
}

beforeEach(() => {
  h.sessions.clear();
  h.users.clear();
  h.users.set("admin-1", { id: "admin-1", email: ADMIN_EMAIL, language: "ru", plan: "pro" });
  h.users.set("user-2", { id: "user-2", email: "regular@example.com", language: "ru", plan: "free" });
  h.sessions.set("admin-token", "admin-1");
  h.sessions.set("user-token", "user-2");
  process.env.ADMIN_PROVISION_USER = JSON.stringify({ email: ADMIN_EMAIL, password: "x" });
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ADMIN_PROVISION_USER;
  else process.env.ADMIN_PROVISION_USER = ORIGINAL_SECRET;
});

describe("requireBenchmarkAdmin via /api/admin/benchmark", () => {
  it("401 without any credentials", async () => {
    const res = await request(makeApp()).get("/api/admin/benchmark/candidates");
    expect(res.status).toBe(401);
  });

  it("401 with an invalid bearer token", async () => {
    const res = await request(makeApp())
      .get("/api/admin/benchmark/candidates")
      .set("Authorization", "Bearer bogus");
    expect(res.status).toBe(401);
  });

  it("403 for an authenticated non-admin user", async () => {
    const res = await request(makeApp())
      .get("/api/admin/benchmark/candidates")
      .set("Authorization", "Bearer user-token");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it("200 with data for the admin from ADMIN_PROVISION_USER", async () => {
    const res = await request(makeApp())
      .get("/api/admin/benchmark/candidates")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ears");
    expect(res.body).toHaveProperty("brain");
  });

  it("admin can list run history (bulky results stripped)", async () => {
    const res = await request(makeApp())
      .get("/api/admin/benchmark/runs")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].results).toBeUndefined();
    expect(res.body[0].report).toBe(true);
  });

  it("fail-closed: missing secret means nobody is admin (403)", async () => {
    delete process.env.ADMIN_PROVISION_USER;
    const res = await request(makeApp())
      .get("/api/admin/benchmark/candidates")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(403);
  });

  it("fail-closed: malformed secret JSON means nobody is admin (403)", async () => {
    process.env.ADMIN_PROVISION_USER = "{not json";
    const res = await request(makeApp())
      .get("/api/admin/benchmark/candidates")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(403);
  });

  it("secret entries without an email string grant nobody admin", async () => {
    process.env.ADMIN_PROVISION_USER = JSON.stringify([{ password: "x" }, { email: 42 }]);
    const res = await request(makeApp())
      .get("/api/admin/benchmark/candidates")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(403);
  });

  it("POST endpoints are gated too (403 for non-admin)", async () => {
    const res = await request(makeApp())
      .post("/api/admin/benchmark/availability")
      .set("Authorization", "Bearer user-token");
    expect(res.status).toBe(403);
  });
});

describe("isBenchmarkAdmin unit behavior", () => {
  it("matches case-insensitively and trims whitespace", () => {
    process.env.ADMIN_PROVISION_USER = JSON.stringify({ email: " Owner@Example.COM " });
    expect(isBenchmarkAdmin("owner@example.com")).toBe(true);
    expect(isBenchmarkAdmin("  OWNER@EXAMPLE.COM  ")).toBe(true);
    expect(isBenchmarkAdmin("other@example.com")).toBe(false);
  });

  it("supports an array of provisioned users", () => {
    process.env.ADMIN_PROVISION_USER = JSON.stringify([
      { email: "a@x.com" },
      { email: "b@x.com" },
    ]);
    expect(isBenchmarkAdmin("b@x.com")).toBe(true);
    expect(isBenchmarkAdmin("c@x.com")).toBe(false);
  });

  it("rejects empty/undefined emails", () => {
    expect(isBenchmarkAdmin(undefined)).toBe(false);
    expect(isBenchmarkAdmin(null)).toBe(false);
    expect(isBenchmarkAdmin("")).toBe(false);
  });

  it("requireBenchmarkAdmin is exported and callable", () => {
    expect(typeof requireBenchmarkAdmin).toBe("function");
  });
});
