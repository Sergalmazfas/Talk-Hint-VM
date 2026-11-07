import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const auth = vi.hoisted(() => ({ fail: false }));
vi.mock("openid-client", () => ({ discovery: vi.fn(async () => ({})) }));
vi.mock("openid-client/passport", () => ({ Strategy: class {} }));
vi.mock("./storage", () => ({
  authStorage: { getUser: vi.fn(async () => ({ id: "synthetic-owner" })) },
}));
vi.mock("../../auth", () => ({ createSession: vi.fn(async () => "synthetic-session") }));
vi.mock("../../adminIdentity", () => ({ mayEnterAdminWeb: () => true }));
vi.mock("../../mobileSecretary/routes", () => ({ mobileBrowserReturn: () => undefined }));
vi.mock("passport", () => ({
  default: {
    initialize: () => (_req: any, _res: any, next: any) => next(),
    session: () => (req: any, _res: any, next: any) => {
      req.login = (_user: any, cb: any) => {
        // Passport can replace the session: the chosen target must survive.
        req.session.chatDevOAuth = undefined;
        cb();
      };
      next();
    },
    use: vi.fn(), serializeUser: vi.fn(), deserializeUser: vi.fn(),
    authenticate: (_strategy: string, options: any) =>
      (req: any, res: any) => typeof options === "function"
        ? options(auth.fail ? new Error("synthetic-auth-error") : null,
          auth.fail ? undefined : { claims: { sub: "synthetic-owner" } })
        : res.redirect("/synthetic-oidc-provider"),
  },
}));

import { setupAuth } from "./replitAuth";

afterEach(() => { vi.unstubAllEnvs(); auth.fail = false; });

async function agent(environment = "development") {
  vi.stubEnv("NODE_ENV", environment);
  // Synthetic fixture secret only; no deployment credentials or provider calls.
  vi.stubEnv("SESSION_SECRET", "native-dev-oauth-test-fixture-only");
  const app = express();
  await setupAuth(app);
  return request.agent(app);
}

describe("native Dev OAuth HTTP routing (provider mocked)", () => {
  it("round-trips through the same browser session to the Dev scheme", async () => {
    const browser = await agent();
    await browser.get("/api/login/ios?client=chatdev").expect(302);
    const callback = await browser.get("/api/callback").expect(302);
    expect(callback.headers.location).toBe("talkhint-chatdev://auth?token=synthetic-session");
    // Consumed marker must not cause later callbacks to target the Dev scheme.
    const again = await browser.get("/api/callback").expect(302);
    expect(again.headers.location).not.toContain("talkhint-chatdev:");
  });
  it("returns authentication errors to Dev without minting a successful login", async () => {
    const browser = await agent();
    await browser.get("/api/login/ios?client=chatdev").expect(302);
    auth.fail = true;
    const callback = await browser.get("/api/callback").expect(302);
    expect(callback.headers.location).toBe("talkhint-chatdev://auth?error=auth_failed");
  });
  it("preserves legacy native return and cannot select Dev at callback", async () => {
    const browser = await agent();
    await browser.get("/api/login/ios").expect(302);
    const callback = await browser.get("/api/callback?client=chatdev").expect(302);
    expect(callback.headers.location).toBe("talkhint://auth?token=synthetic-session");
  });
  it("web login clears an earlier Dev target", async () => {
    const browser = await agent();
    await browser.get("/api/login/ios?client=chatdev").expect(302);
    await browser.get("/api/login").expect(302);
    const callback = await browser.get("/api/callback").expect(302);
    expect(callback.headers.location).toBe("/admin?token=synthetic-session");
  });
  it("does not enable the Dev entry in production", async () => {
    const browser = await agent("production");
    const response = await browser.get("/api/login/ios?client=chatdev").expect(400);
    expect(response.body).toEqual({ error: "NATIVE_DEV_LOGIN_UNAVAILABLE" });
  });
  it("rejects arbitrary redirect targets before starting authentication", async () => {
    const browser = await agent();
    await browser.get("/api/login/ios?client=evil").expect(400);
    await browser.get("/api/login/ios?client=chatdev&client=evil").expect(400);
  });
});
