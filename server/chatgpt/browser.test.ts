import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request, { type Response as TestResponse } from "supertest";
import { randomUUID } from "node:crypto";
import { registerChatGPTIntegration, type IntegrationConfig } from "./routes";
import { Credentials, digest, grantId } from "./security";
import { BrowserSecurity } from "./browserSecurity";
import { testMarkerStore } from "./testSupport";
import type { SecretaryBackend } from "./secretary";

vi.mock("../auth", () => ({ authMiddleware: (_req: any, res: any) => res.sendStatus(401) }));
const base = "https://browser.example.test";
const path = "/api/chatgpt/browser";
const verifier = "browser-fixture-verifier-with-more-than-forty-three-characters";
let app: ReturnType<typeof express>;
let config: IntegrationConfig;
let store: ReturnType<typeof testMarkerStore>;
let backend: SecretaryBackend;
let login: ReturnType<typeof vi.fn>;
const ownerAuth: RequestHandler = (req, res, next) => {
  const owner = req.headers.authorization?.replace("Bearer fixture-owner-", "");
  if (owner !== "alice" && owner !== "bob") return void res.sendStatus(401);
  req.user = { id: owner, email: `${owner}@example.test` } as any;
  next();
};
function setup(outbound = false) {
  store = testMarkerStore();
  config = { enabled: true, origin: base, clientId: "talkhint-chatgpt",
    redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
    signingKey: () => "browser-test-fixture-not-a-real-signing-secret-000000",
    outboundEnabled: outbound };
  const tasks = new Map<string, any>();
  backend = {
    history: vi.fn(async () => []), call: vi.fn(), tasks: vi.fn(async () => []),
    task: vi.fn(async (owner, id) => ({ id, status: "completed", summary: `fixture result for ${owner}` })),
    incoming: vi.fn(),
    start: vi.fn(async (owner, input) => {
      if (!tasks.has(input.clientRequestId)) tasks.set(input.clientRequestId,
        { id: randomUUID(), userId: owner, status: "dialing" });
      return { task: tasks.get(input.clientRequestId), created: true };
    }),
  };
  login = vi.fn(async (email: string, password: string) => {
    if (!["alice@example.test", "bob@example.test"].includes(email) || password !== "fixture-password")
      throw new Error("Invalid credentials");
    return { id: email.split("@")[0], email };
  });
  app = express();
  app.use(express.json());
  registerChatGPTIntegration(app, config, store, backend, ownerAuth, { login });
}
function authorization(scope = "calls:read calls:transcript offline_access") {
  return { response_type: "code", client_id: config.clientId, resource: `${base}/api/chatgpt/mcp`,
    redirect_uri: config.redirectUri, scope, state: "browser-test-state-long-enough",
    code_challenge: digest(verifier), code_challenge_method: "S256" };
}
const hidden = (html: string, name: string) => {
  const value = html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const fields = (res: TestResponse) => ({ csrf: hidden(res.text, "csrf"), flow: hidden(res.text, "flow") });
class Browser {
  cookies = new Map<string, string>();
  remember(res: TestResponse) {
    for (const value of (res.headers["set-cookie"] ?? []) as string[]) {
      const first = value.split(";")[0];
      const index = first.indexOf("=");
      this.cookies.set(first.slice(0, index), first.slice(index + 1));
    }
    return res;
  }
  cookie() { return Array.from(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  async get(url: string) {
    return this.remember(await request(app).get(url).set("Accept", "text/html").set("Cookie", this.cookie()));
  }
  async post(url: string, body: object, origin: string | null = base) {
    const q = request(app).post(url).set("Cookie", this.cookie()).type("form");
    if (origin) q.set("Origin", origin);
    return this.remember(await q.send(body));
  }
  async follow(res: TestResponse) {
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/api\/chatgpt\/browser\/review\?flow=/);
    return this.get(res.headers.location);
  }
  async begin(scope?: string) {
    const query = new URLSearchParams(authorization(scope)).toString();
    return this.follow(await this.get(`/api/chatgpt/oauth/authorize?${query}`));
  }
  async signIn(page: TestResponse, owner = "alice") {
    return this.follow(await this.post(`${path}/login`,
      { ...fields(page), email: `${owner}@example.test`, password: "fixture-password" }));
  }
}
async function accessFromConsent(redirect: TestResponse) {
  expect(redirect.status).toBe(303);
  const target = new URL(redirect.headers.location);
  expect(target.origin + target.pathname).toBe(config.redirectUri);
  expect(target.searchParams.get("state")).toBe(authorization().state);
  expect(target.searchParams.get("iss")).toBe(base);
  const token = await request(app).post("/api/chatgpt/oauth/token").type("form").send({
    grant_type: "authorization_code", client_id: config.clientId,
    resource: `${base}/api/chatgpt/mcp`, redirect_uri: config.redirectUri,
    code: target.searchParams.get("code"), code_verifier: verifier,
  });
  expect(token.status).toBe(200);
  return token.body.access_token as string;
}
async function prepare(owner = "alice", instruction = "Ask about the deposit.") {
  const scopes = ["calls:read", "secretary:start"] as const;
  const grant = { id: grantId(config.clientId, [...scopes]), userId: owner, expiresAt: new Date(Date.now() + 60_000) };
  await store.put(grant);
  const credentials = new Credentials(config.signingKey, `${base}/api/chatgpt/mcp`);
  const token = credentials.issue({ type: "access", sub: owner, client: config.clientId,
    grant: grant.id, scopes: [...scopes], exp: grant.expiresAt.getTime() });
  const result = await request(app).post("/api/chatgpt/tools/prepare_call")
    .auth(token, { type: "bearer" }).send({
      phoneNumber: "+12025550123", instruction, clientRequestId: randomUUID(),
    });
  expect(result.status).toBe(200);
  return { ...result.body, token, grant };
}
const start = (prepared: any, extra = {}) => request(app).post("/api/chatgpt/tools/start_call")
  .auth(prepared.token, { type: "bearer" }).send({ confirmation: prepared.confirmation, ...extra });
beforeEach(() => {
  setup();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("isolated browser OAuth consent", () => {
  it("shows login, consent and exact scopes, never grants on GET; then performs PKCE", async () => {
    const browser = new Browser();
    const signIn = await browser.begin();
    expect(signIn.status).toBe(200);
    expect(signIn.text).toContain("Войдите в TalkHint");
    expect(await store.list("alice")).toEqual([]);
    expect(signIn.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(signIn.headers["referrer-policy"]).toBe("no-referrer");
    const consent = await browser.signIn(signIn);
    expect(consent.text).toContain("alice@example.test");
    expect(consent.text).toContain("calls:transcript");
    expect(await store.list("alice")).toEqual([]);
    const allowed = await browser.post(`${path}/consent`, { ...fields(consent), decision: "allow" });
    const token = await accessFromConsent(allowed);
    const calls = await request(app).post("/api/chatgpt/tools/list_calls").auth(token, { type: "bearer" }).send({});
    expect(calls.status).toBe(200);
    expect(backend.history).toHaveBeenCalledWith("alice");
    expect((await store.list("alice")).length).toBe(1);
    expect((await browser.post(`${path}/consent`, { ...fields(consent), decision: "allow" })).status).toBe(403);
    expect(backend.start).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires explicit allow; deny preserves state/issuer without issuing a grant", async () => {
    const browser = new Browser();
    const consent = await browser.signIn(await browser.begin("calls:read"));
    expect((await browser.post(`${path}/consent`, fields(consent))).status).toBe(400);
    const denied = await browser.post(`${path}/consent`, { ...fields(consent), decision: "deny" });
    const target = new URL(denied.headers.location);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("iss")).toBe(base);
    expect(target.searchParams.has("code")).toBe(false);
    expect(await store.list("alice")).toEqual([]);
  });
  it("rejects wrong callbacks, write scopes in read-only mode and disabled integration", async () => {
    const browser = new Browser();
    const invalid = await browser.get(`/api/chatgpt/oauth/authorize?${new URLSearchParams({
      ...authorization(), redirect_uri: "https://attacker.example/callback",
    })}`);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.location).toBeUndefined();
    expect((await browser.get(`/api/chatgpt/oauth/authorize?${new URLSearchParams(
      authorization("secretary:start"))}`)).status).toBe(400);
    config.enabled = false;
    expect((await browser.get("/api/chatgpt/connections/manage")).status).toBe(503);
  });
  it("requires same-origin, browser-bound CSRF and refuses another browser's flow", async () => {
    const browser = new Browser();
    const loginPage = await browser.begin();
    for (const origin of [null, "https://attacker.example"]) {
      expect((await browser.post(`${path}/login`, { ...fields(loginPage),
        email: "alice@example.test", password: "fixture-password" }, origin)).status).toBe(403);
    }
    expect((await browser.post(`${path}/login`, { ...fields(loginPage), csrf: "forged",
      email: "alice@example.test", password: "fixture-password" })).status).toBe(403);
    const other = new Browser();
    await other.begin();
    expect((await other.get(`${path}/review?flow=${hidden(loginPage.text, "flow")}`)).status).toBe(403);
    expect(login).not.toHaveBeenCalled();
  });
  it("sets secure scoped credentials, expires them and does not expose passwords", async () => {
    const browser = new Browser();
    const initial = await browser.begin();
    const result = await browser.post(`${path}/login`, { ...fields(initial),
      email: "alice@example.test", password: "fixture-password" });
    const cookie = (result.headers["set-cookie"] as string[]).find(row => row.startsWith("__Host-thcg-owner="))!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("alice"); expect(cookie).not.toContain("fixture-password");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60_000);
    expect((await browser.get(result.headers.location)).status).toBe(400);
  });
  it("limits failed password attempts and does not enumerate accounts in errors", async () => {
    const browser = new Browser();
    const initial = await browser.begin();
    for (let i = 0; i < 5; i++) {
      const failed = await browser.post(`${path}/login`, { ...fields(initial),
        email: "unknown@example.test", password: "wrong-fixture-password" });
      expect(failed.status).toBe(401);
      expect(failed.text).not.toContain("unknown@example.test");
      expect(failed.text).not.toContain("wrong-fixture-password");
    }
    expect((await browser.post(`${path}/login`, { ...fields(initial),
      email: "alice@example.test", password: "fixture-password" })).status).toBe(429);
    expect(login).toHaveBeenCalledTimes(5);
  });
  it("reuses an existing TalkHint login only by explicit same-origin session exchange", async () => {
    const browser = new Browser();
    const page = await browser.begin();
    const exchange = await request(app).post(`${path}/session`).set("Origin", base)
      .set("Cookie", browser.cookie()).auth("fixture-owner-bob", { type: "bearer" }).send(fields(page));
    browser.remember(exchange);
    expect(exchange.status).toBe(200);
    const consent = await browser.get(exchange.body.next);
    expect(consent.text).toContain("bob@example.test");
    expect(login).not.toHaveBeenCalled();
    const credential = browser.cookies.get("__Host-thcg-owner")!;
    expect((await request(app).post("/api/chatgpt/tools/list_calls").auth(credential, { type: "bearer" }).send({})).status).toBe(401);
  });
  it("lists and revokes only this owner and invalidates MCP access; logout leaves native auth alone", async () => {
    const browser = new Browser();
    const consent = await browser.signIn(await browser.begin("calls:read"));
    const token = await accessFromConsent(await browser.post(`${path}/consent`, { ...fields(consent), decision: "allow" }));
    const bobGrant = grantId(config.clientId, ["calls:read"]);
    await store.put({ id: bobGrant, userId: "bob", expiresAt: new Date(Date.now() + 60_000) });
    let management = await browser.follow(await browser.get("/api/chatgpt/connections/manage"));
    expect(management.text).not.toContain(bobGrant);
    expect((await browser.post(`${path}/revoke`, { ...fields(management), id: bobGrant })).status).toBe(404);
    const aliceGrant = (await store.list("alice"))[0].id;
    expect((await browser.post(`${path}/revoke`, { ...fields(management), id: aliceGrant })).status).toBe(303);
    expect((await request(app).post("/api/chatgpt/tools/list_calls").auth(token, { type: "bearer" }).send({})).status).toBe(401);
    expect(await store.get(bobGrant)).toBeDefined();
    const priorCookie = browser.cookie();
    expect((await browser.post(`${path}/logout`, fields(management))).status).toBe(200);
    browser.cookies = new Map(priorCookie.split("; ").map(row => row.split("=") as [string, string]));
    management = await browser.follow(await browser.get("/api/chatgpt/connections/manage"));
    expect(management.text).toContain("Войдите в TalkHint");
  });
});

describe("separate owner approval, never a browser dialer", () => {
  it("reviews exact escaped number/task, rejects self-confirmation, then one logical mock task", async () => {
    setup(true);
    const prepared = await prepare("alice", '<img src=x onerror="alert(1)"> Ask only about the deposit.');
    expect(prepared.approval_url).not.toContain(prepared.confirmation);
    expect(prepared.approval_url).not.toContain("12025550123");
    const browser = new Browser();
    let page = await browser.follow(await browser.get(prepared.approval_url.replace(base, "")));
    expect(page.text).not.toContain("12025550123");
    page = await browser.signIn(page);
    expect(page.text).toContain("+12025550123");
    expect(page.text).toContain("&lt;img");
    expect(page.text).not.toContain('<img src=x');
    expect((await start(prepared)).status).toBe(403);
    expect((await start(prepared, { confirmed: true })).status).toBe(400);
    const approval = await browser.post(`${path}/approve`, { ...fields(page), decision: "approve" });
    expect(approval.status).toBe(200);
    expect(backend.start).not.toHaveBeenCalled();
    expect((await browser.post(`${path}/approve`, { ...fields(page), decision: "approve" })).status).toBe(403);
    const [first, second] = await Promise.all([start(prepared), start(prepared)]);
    expect(first.status).toBe(202); expect(second.status).toBe(202);
    expect(first.body.task_id).toBe(second.body.task_id);
    const read = await request(app).post("/api/chatgpt/tools/get_task")
      .auth(prepared.token, { type: "bearer" }).send({ id: first.body.task_id });
    expect(read.body.status).toBe("completed");
    // The fake task service above deduplicates; native single dial lease is
    // independently covered by secretary.test.ts and existing integration tests.
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never reveals another owner's call, and rejects MCP credentials as browser login", async () => {
    setup(true);
    const prepared = await prepare();
    const browser = new Browser();
    const loginPage = await browser.follow(await browser.get(prepared.approval_url.replace(base, "")));
    expect((await browser.signIn(loginPage, "bob")).status).toBe(404);
    const other = new Browser();
    const initial = await other.begin();
    const selfLogin = await request(app).post(`${path}/session`).set("Origin", base)
      .set("Cookie", other.cookie()).auth(prepared.token, { type: "bearer" }).send(fields(initial));
    expect(selfLogin.status).toBe(401);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("records denial, blocks API bypass, and revoked/expired/tampered tickets never approve", async () => {
    setup(true);
    const prepared = await prepare();
    const browser = new Browser();
    const page = await browser.signIn(await browser.follow(await browser.get(prepared.approval_url.replace(base, ""))));
    expect((await browser.post(`${path}/approve`, { ...fields(page), decision: "deny" })).status).toBe(200);
    expect((await start(prepared)).status).toBe(409);
    expect((await request(app).post("/api/chatgpt/confirmations/approve")
      .auth("fixture-owner-alice", { type: "bearer" })
      .send({ confirmation: prepared.confirmation, approved: true })).status).toBe(409);
    const fresh = await prepare();
    await store.expire(fresh.grant.id, "alice");
    expect((await browser.get(fresh.approval_url.replace(base, ""))).status).toBe(401);
    const url = new URL((await prepare()).approval_url);
    const raw = url.searchParams.get("ticket")!;
    url.searchParams.set("ticket", raw.slice(0, -4) + "AAAA");
    expect((await browser.get(url.pathname + url.search)).status).toBe(400);
    const security = new BrowserSecurity(config.signingKey, base);
    const expired = security.seal({ kind: "approval-link", confirmation: fresh.confirmation, exp: Date.now() - 1 });
    expect((await browser.get(`/api/chatgpt/approve?ticket=${expired}`)).status).toBe(400);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("validates approval again after owner review, so revocation cannot be bypassed by an open page", async () => {
    setup(true);
    const prepared = await prepare();
    const browser = new Browser();
    const page = await browser.signIn(await browser.follow(await browser.get(prepared.approval_url.replace(base, ""))));
    await store.expire(prepared.grant.id, "alice");
    expect((await browser.post(`${path}/approve`, { ...fields(page), decision: "approve" })).status).toBe(401);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("survives a new adapter instance using the same durable-store contract, without in-memory approvals", async () => {
    setup(true);
    const prepared = await prepare();
    const browser = new Browser();
    const page = await browser.signIn(await browser.follow(await browser.get(prepared.approval_url.replace(base, ""))));
    app = express();
    app.use(express.json());
    registerChatGPTIntegration(app, config, store, backend, ownerAuth, { login });
    expect((await browser.post(`${path}/approve`, { ...fields(page), decision: "approve" })).status).toBe(200);
    expect(backend.start).not.toHaveBeenCalled();
    expect((await start(prepared)).status).toBe(202);
  });
});
