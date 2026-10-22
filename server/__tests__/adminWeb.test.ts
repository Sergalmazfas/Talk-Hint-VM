import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  users: new Map([
    ["owner", { id: "owner", email: "owner@example.test", language: "en", plan: "basic" }],
    ["regular", { id: "regular", email: "regular@example.test", language: "en", plan: "basic" }],
  ]),
}));
vi.mock("../storage", () => ({ storage: {
  getSession: async (token: string) => ["owner", "regular"].includes(token) ? { userId: token } : undefined,
  getUser: async (id: string) => h.users.get(id),
} }));
import { registerAdminWebBoundary } from "../adminWeb";
import { authMiddleware } from "../auth";
import { mayEnterAdminWeb } from "../adminIdentity";
import { issueAdminWebTicket, consumeAdminWebTicket } from "../adminWebTickets";

function app() {
  const a = express();
  a.use(express.json());
  // Simulated Passport session, only in this isolated test application.
  a.use((req, _res, next) => {
    const id = req.get("x-test-oauth");
    if (id) req.user = { claims: { sub: id } } as any;
    next();
  });
  registerAdminWebBoundary(a);
  a.get("/api/calls", authMiddleware, (req, res) => res.json({ owner: req.user!.id }));
  a.post("/twilio/status", (_req, res) => res.status(418).end());
  a.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({ issuer: "unchanged" }));
  a.all("/api/admin/*", (_req, res) => res.json({ action: "mock-only" }));
  a.get("/health", (_req, res) => res.send("health"));
  a.get("/expo", (_req, res) => res.send("expo"));
  a.get("/tutor", (_req, res) => res.send("native tutor document"));
  a.get("/tutor/preview", (_req, res) => res.send("tutor preview"));
  a.get("/translator-spike*", (_req, res) => res.send("translator stand"));
  a.get("/api/health", (_req, res) => res.json({ ok: true }));
  a.get("/admin*", (_req, res) => res.send("existing full workspace"));
  a.get("*", (_req, res) => res.send("static fallback"));
  return a;
}
beforeEach(() => vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "owner@example.test"));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("entire existing web workspace is owner-only", () => {
  it("serves a minimal public root and Google-only entry, with no old phone UI", async () => {
    const home = await request(app()).get("/");
    expect(home.status).toBe(200);
    expect(home.text).toContain('href="/admin"');
    expect(home.text).not.toContain("existing full workspace");
    const login = await request(app()).get("/admin/login");
    expect(login.status).toBe(200);
    expect(login.text).toContain('href="/api/login"');
    expect(login.text).not.toContain('type="password"');
  });
  const current = ["/admin", "/admin/app/", "/admin/app/script.js", "/admin/dashboard",
    "/admin/diagnostics", "/admin/voice-lab", "/admin/secretary-lab", "/admin/health",
    "/admin/incoming-secretary", "/admin/settings/call-profiles", "/admin/tutor/preview"];
  it.each(current)("denies guest and ordinary Google account at %s", async path => {
    expect((await request(app()).get(path)).status).toBe(401);
    expect((await request(app()).get(path).set("x-test-oauth", "regular")).status).toBe(403);
    expect((await request(app()).get(path).set("x-test-oauth", "owner")).status).toBe(200);
  });
  it.each(["/app", "/app/script.js", "/dashboard", "/onboarding", "/settings/call-profiles",
    "/incoming-secretary", "/incoming-secretary-preview", "/voice-lab", "/secretary-lab",
    "/health", "/expo", "/tutor/preview", "/translator-spike", "/translator-spike/copilot"])(
    "old direct address %s cannot bypass the boundary", async path => {
      expect((await request(app()).get(path)).status).toBe(401);
      expect((await request(app()).get(path).set("Authorization", "Bearer regular")).status).toBe(403);
      const owner = await request(app()).get(path).set("Authorization", "Bearer owner");
      expect(owner.status).toBe(307);
      expect(owner.headers.location).toBe("/admin" + path);
    });
  it.each(["/src/main.tsx", "/@vite/client", "/@fs/secret", "/assets/index.js"])(
    "blocks alternate application documents/modules %s", async path => {
      expect((await request(app()).get(path)).status).toBe(401);
    });
  it("does not turn normal native or provider APIs into admin-only APIs", async () => {
    expect((await request(app()).get("/api/calls").set("Authorization", "Bearer regular")).status).toBe(200);
    expect((await request(app()).get("/api/calls")).status).toBe(401);
    expect((await request(app()).post("/twilio/status")).status).toBe(418);
    expect((await request(app()).get("/.well-known/oauth-authorization-server")).body.issuer).toBe("unchanged");
    expect((await request(app()).get("/tutor")).status).toBe(200);
  });
  it("fails closed if owner configuration is missing; provisioning a user does not grant access", async () => {
    vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "");
    vi.stubEnv("ADMIN_PROVISION_USER", '{"email":"regular@example.test"}');
    expect((await request(app()).get("/admin").set("x-test-oauth", "owner")).status).toBe(403);
    expect((await request(app()).get("/admin").set("x-test-oauth", "regular")).status).toBe(403);
  });
});

describe("server-side administrative actions", () => {
  it.each(["get", "post", "put", "delete"] as const)("protects every legacy admin %s handler", async method => {
    expect((await request(app())[method]("/api/admin/seed-numbers")).status).toBe(401);
    expect((await request(app())[method]("/api/admin/seed-numbers").set("Authorization", "Bearer regular")).status).toBe(403);
  });
  it("denies cross-site and missing-origin cookie actions, permits same-origin admin action", async () => {
    expect((await request(app()).post("/api/admin/action").set("x-test-oauth", "owner")
      .set("Origin", "https://attacker.invalid")).status).toBe(403);
    expect((await request(app()).post("/api/admin/action").set("x-test-oauth", "owner")).status).toBe(403);
    expect((await request(app()).post("/api/admin/action").set("x-test-oauth", "owner")
      .set("Origin", "http://talkhint.test").set("Host", "talkhint.test")).status).toBe(200);
  });
  it("requires owner and stored OIDC subject/email match, never a spoken/display name", () => {
    const owner = h.users.get("owner")!;
    expect(mayEnterAdminWeb(owner, { sub: owner.id, email: owner.email })).toBe(true);
    expect(mayEnterAdminWeb(owner, { sub: "regular", email: owner.email })).toBe(false);
    expect(mayEnterAdminWeb(owner, { sub: owner.id, email: "regular@example.test", name: "Owner" })).toBe(false);
    expect(mayEnterAdminWeb(owner, { sub: owner.id, name: "Owner" })).toBe(false);
    expect(mayEnterAdminWeb(h.users.get("regular")!, { sub: "regular", email: "regular@example.test" })).toBe(false);
  });
  it("issues only short-lived, one-use admin technical transport tickets", async () => {
    expect((await request(app()).post("/api/admin/websocket-ticket")).status).toBe(401);
    expect((await request(app()).post("/api/admin/websocket-ticket").set("Authorization", "Bearer regular")).status).toBe(403);
    const r = await request(app()).post("/api/admin/websocket-ticket").set("Authorization", "Bearer owner");
    const req = { headers: { origin: "https://talkhint.test", host: "talkhint.test" } } as any;
    expect(consumeAdminWebTicket(req, r.body.ticket)).toBe(true);
    expect(consumeAdminWebTicket(req, r.body.ticket)).toBe(false);
    const wrongOrigin = issueAdminWebTicket("owner@example.test")!;
    expect(consumeAdminWebTicket({ headers: { host: "talkhint.test", origin: "https://attacker.invalid" } } as any, wrongOrigin)).toBe(false);
    const expired = issueAdminWebTicket("owner@example.test")!;
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 31000);
    expect(consumeAdminWebTicket(req, expired)).toBe(false);
    expect(issueAdminWebTicket("regular@example.test")).toBeUndefined();
  });
});
