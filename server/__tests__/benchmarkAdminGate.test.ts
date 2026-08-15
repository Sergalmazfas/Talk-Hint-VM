import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Integration tests for the benchmark admin gate (/api/admin/benchmark).
// Admin identity comes SOLELY from BENCHMARK_ADMIN_EMAILS (comma-separated
// email list, fail-closed). ADMIN_PROVISION_USER is intentionally ignored —
// provisioned service accounts must never gain admin automatically:
//   - no auth            -> 401 (real authMiddleware path)
//   - authed non-admin   -> 403
//   - authed allowlisted -> 200 with data
//   - missing env var    -> nobody is admin (403 even for prior admins)
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
const ORIGINAL_ALLOWLIST = process.env.BENCHMARK_ADMIN_EMAILS;
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
  process.env.BENCHMARK_ADMIN_EMAILS = ADMIN_EMAIL;
  delete process.env.ADMIN_PROVISION_USER;
});

afterEach(() => {
  if (ORIGINAL_ALLOWLIST === undefined) delete process.env.BENCHMARK_ADMIN_EMAILS;
  else process.env.BENCHMARK_ADMIN_EMAILS = ORIGINAL_ALLOWLIST;
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

  it("200 with data for an email in BENCHMARK_ADMIN_EMAILS", async () => {
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

  it("fail-closed: missing allowlist means nobody is admin (403)", async () => {
    delete process.env.BENCHMARK_ADMIN_EMAILS;
    const res = await request(makeApp())
      .get("/api/admin/benchmark/candidates")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(403);
  });

  it("ADMIN_PROVISION_USER alone grants NOBODY admin (provisioned service account is not admin)", async () => {
    delete process.env.BENCHMARK_ADMIN_EMAILS;
    process.env.ADMIN_PROVISION_USER = JSON.stringify({ email: ADMIN_EMAIL, password: "x" });
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
    process.env.BENCHMARK_ADMIN_EMAILS = " Owner@Example.COM ";
    expect(isBenchmarkAdmin("owner@example.com")).toBe(true);
    expect(isBenchmarkAdmin("  OWNER@EXAMPLE.COM  ")).toBe(true);
    expect(isBenchmarkAdmin("other@example.com")).toBe(false);
  });

  it("supports a comma-separated list of admins", () => {
    process.env.BENCHMARK_ADMIN_EMAILS = "a@x.com, b@x.com";
    expect(isBenchmarkAdmin("b@x.com")).toBe(true);
    expect(isBenchmarkAdmin("c@x.com")).toBe(false);
  });

  it("empty entries in the list grant nobody admin", () => {
    process.env.BENCHMARK_ADMIN_EMAILS = " , ,";
    expect(isBenchmarkAdmin("")).toBe(false);
    expect(isBenchmarkAdmin("a@x.com")).toBe(false);
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
