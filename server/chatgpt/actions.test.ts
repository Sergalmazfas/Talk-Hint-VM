import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerChatGPTIntegration, type IntegrationConfig } from "./routes";
import { Credentials, fail, grantId, type Marker, type MarkerStore } from "./security";
import { talkHintActionsSchema } from "./actionsSchema";
import type { SecretaryBackend } from "./secretary";

vi.mock("../auth", () => ({ authMiddleware: (_q: any, res: any) => res.sendStatus(401) }));
const api = "/api/chatgpt-actions";
const origin = "https://example.test";
const clientId = "talkhint-personal-actions";
const secret = "mock-actions-secret-never-used-outside-tests-0000";
const key = () => "mock-signing-key-never-an-environment-secret-0000";
const redirectUri = "https://chatgpt.com/aip/g-TalkHintPersonal/oauth/callback";
const credentials = new Credentials(key, `${origin}${api}`);
const nativeAuth: RequestHandler = (req, res, next) => {
  const id = req.header("x-native-owner");
  if (!id) return void res.sendStatus(401);
  req.user = { id } as any;
  next();
};
let config: IntegrationConfig;
let app: ReturnType<typeof express>;
let store: MarkerStore;
let backend: SecretaryBackend;
let mockDial: ReturnType<typeof vi.fn>;
function setup(outbound = true) {
  const rows = new Map<string, Marker>();
  store = {
    async put(row) { if (!rows.has(row.id)) rows.set(row.id, row); },
    async get(id) { const row = rows.get(id); return row && row.expiresAt.getTime() > Date.now() ? row : undefined; },
    async consume(id) {
      const row = rows.get(id);
      if (!row || row.expiresAt.getTime() <= Date.now()) return;
      rows.delete(id); return row;
    },
    async list(userId) { return Array.from(rows.values()).filter(r => r.userId === userId &&
      r.id.startsWith("chatgpt:grant:") && r.expiresAt.getTime() > Date.now()); },
    async expire(id, userId) { if (rows.get(id)?.userId === userId) rows.delete(id); },
  };
  // Backend mock mirrors the native lease: only the winning request may dispatch.
  const tasks = new Map<string, any>();
  mockDial = vi.fn();
  backend = {
    history: vi.fn(async () => [{ id: "owned-call", status: "completed" }]),
    tasks: vi.fn(async () => Array.from(tasks.values())),
    call: vi.fn(async (_owner, id, transcript) => {
      if (id !== "owned-call") return fail(404, "Call not found");
      return { id, status: "completed", ...(transcript ? { transcript: "synthetic transcript" } : {}) };
    }),
    task: vi.fn(async (_owner, id) => {
      const task = Array.from(tasks.values()).find(t => t.id === id);
      return task ?? fail(404, "Task not found");
    }),
    incoming: vi.fn(),
    start: vi.fn(async (_owner, call) => {
      const previous = tasks.get(call.clientRequestId);
      if (previous) return { task: previous, reused: true };
      const task = { id: randomUUID(), status: "starting", clientRequestId: call.clientRequestId };
      tasks.set(call.clientRequestId, task);
      mockDial();
      return { task, reused: false };
    }),
  } as any;
  config = { enabled: true, outboundEnabled: outbound, origin, clientId, redirectUri, signingKey: key,
    actions: { ownerId: "alice", clientSecret: () => secret } };
  app = express();
  app.use(express.json({ limit: "32kb" }));
  registerChatGPTIntegration(app, { enabled: true, origin, clientId: "talkhint-chatgpt",
    redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect", signingKey: key }, store, backend, nativeAuth);
  registerChatGPTIntegration(app, config, store, backend, nativeAuth, {
    login: async (email, password) => {
      if (password !== "mock-password") throw new Error("No");
      return { id: email.startsWith("alice") ? "alice" : "bob", email };
    },
  });
}
async function token(scope = "calls:read offline_access", user = "alice") {
  const scopes = scope.split(" ") as any;
  const grant = grantId(clientId, scopes);
  await store.put({ id: grant, userId: user, expiresAt: new Date(Date.now() + 3600_000) });
  return credentials.issue({ type: "access", sub: user, client: clientId, grant, scopes, exp: Date.now() + 600_000 });
}
function fields(res: any) {
  return Object.fromEntries(["flow", "csrf"].map(name =>
    [name, new RegExp(`name="${name}" value="([^"]+)"`).exec(res.text)?.[1]]));
}
function browser() {
  const cookies = new Map<string, string>();
  const save = (res: any) => {
    for (const value of res.headers["set-cookie"] ?? []) {
      const [pair] = value.split(";"); const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return res;
  };
  const header = () => Array.from(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const path = (url: string) => { const u = new URL(url, origin); return u.pathname + u.search; };
  const get = async (url: string) => save(await request(app).get(path(url)).set("Accept", "text/html").set("Cookie", header()));
  const post = async (url: string, body: any) => save(await request(app).post(path(url))
    .set("Origin", origin).set("Cookie", header()).type("form").send(body));
  const login = async (review: string, email = "alice@example.test") => {
    const page = await get(review);
    const signed = await post(`${api}/browser/login`, { ...fields(page), email, password: "mock-password" });
    return signed.status === 303 ? get(signed.headers.location) : signed;
  };
  return { get, post, login, cookies };
}
const draft = () => ({ phoneNumber: "+12025550123",
  instruction: "Ask opening hours; literal /api/chatgpt/ is data, not a route", clientRequestId: randomUUID() });
const launch = (access: string, confirmation: string, extras = {}) => request(app).post(`${api}/launches`)
  .auth(access, { type: "bearer" }).send({ confirmation, ...extras });
async function approve(access: string, decision = "approve") {
  const prepared = await request(app).post(`${api}/drafts`).auth(access, { type: "bearer" }).send(draft());
  expect(prepared.status).toBe(200);
  const web = browser();
  const begin = await web.get(prepared.body.approval_url);
  const page = await web.login(begin.headers.location);
  expect(page.text).toContain("+12025550123");
  expect(page.text).toContain("literal /api/chatgpt/ is data");
  expect(page.text).toContain(`action="${api}/browser/approve"`);
  const done = await web.post(`${api}/browser/approve`, { ...fields(page), decision });
  expect(done.status).toBe(200);
  expect(mockDial).not.toHaveBeenCalled();
  return prepared.body;
}
const authorization = () => ({ response_type: "code", client_id: clientId, redirect_uri: redirectUri,
  scope: "calls:read offline_access", state: `random-${randomUUID()}` });
async function code(query = authorization()) {
  const web = browser();
  const begin = await request(app).get(`${api}/oauth/authorize`).query(query).set("Accept", "text/html");
  // Preserve the initial binding from the real authorization GET.
  for (const raw of begin.headers["set-cookie"] ?? []) {
    const pair = raw.split(";")[0]; const at = pair.indexOf("=");
    web.cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const consent = await web.login(begin.headers.location);
  expect(consent.status).toBe(200);
  const result = await web.post(`${api}/browser/consent`, { ...fields(consent), decision: "allow" });
  expect(result.status).toBe(303);
  const callback = new URL(result.headers.location);
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe(query.state);
  return callback.searchParams.get("code")!;
}
const exchange = (value: string, extra: object = {}) => request(app).post(`${api}/oauth/token`).type("form")
  .send({ client_id: clientId, client_secret: secret, grant_type: "authorization_code",
    redirect_uri: redirectUri, code: value, ...extra });
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden"); }));
  setup();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("personal Actions: isolated confidential OAuth and owner-only API", () => {
  it("completes browser code exchange without MCP resource/PKCE and rotates/revokes refresh", async () => {
    const value = await code();
    const result = await exchange(value);
    expect(result.status).toBe(200);
    expect((await exchange(value)).status).toBe(400);
    const refresh = (raw: string) => request(app).post(`${api}/oauth/token`).type("form")
      .send({ client_id: clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: raw });
    const rotated = await refresh(result.body.refresh_token);
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(result.body.refresh_token);
    expect((await refresh(result.body.refresh_token)).status).toBe(400);
    expect((await request(app).get(`${api}/calls`).auth(rotated.body.access_token, { type: "bearer" })).status).toBe(401);
  });
  it("rejects absent/wrong client secrets, resource and redirect without consuming a valid code", async () => {
    const value = await code();
    for (const bad of [{ client_secret: "" }, { client_secret: "wrong" }, { client_id: "other" }])
      expect((await exchange(value, bad)).status).toBe(401);
    for (const bad of [{ resource: "https://other.test" }, { redirect_uri: "https://attacker.test" }])
      expect((await exchange(value, bad)).status).toBe(400);
    expect((await exchange(value)).status).toBe(200);
  });
  it("accepts HTTP Basic exchange and rejects ambiguous dual authentication", async () => {
    const value = await code();
    const req = () => request(app).post(`${api}/oauth/token`).auth(clientId, secret).type("form");
    const args = { code: value, grant_type: "authorization_code", redirect_uri: redirectUri };
    expect((await req().send({ ...args, client_secret: secret })).status).toBe(401);
    expect((await req().send(args)).status).toBe(200);
  });
  it("accepts JSON token exchange, rejects unsupported scopes and partial PKCE", async () => {
    const value = await code();
    expect((await request(app).post(`${api}/oauth/token`).send({ grant_type: "authorization_code",
      client_id: clientId, client_secret: secret, redirect_uri: redirectUri, code: value })).status).toBe(200);
    for (const extra of [{ scope: "calls:read incoming:read" }, { code_challenge: "x".repeat(43) }]) {
      expect((await request(app).get(`${api}/oauth/authorize`).query({ ...authorization(), ...extra })
        .set("Accept", "text/html")).status).toBe(400);
    }
  });
  it("enforces optional S256 if Actions sends PKCE, without weakening MCP's mandatory PKCE", async () => {
    const { digest } = await import("./security");
    const verifier = "v".repeat(48);
    const value = await code({ ...authorization(), code_challenge: digest(verifier), code_challenge_method: "S256" } as any);
    expect((await exchange(value)).status).toBe(400);
    expect((await exchange(value, { code_verifier: verifier })).status).toBe(200);
    const badMcp = await request(app).get("/api/chatgpt/oauth/authorize").set("x-native-owner", "alice")
      .query({ ...authorization(), client_id: "talkhint-chatgpt",
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        resource: `${origin}/api/chatgpt/mcp` });
    expect(badMcp.status).toBe(400);
  });
  it("rejects unregistered redirects and non-owner browser login", async () => {
    const invalid = await request(app).get(`${api}/oauth/authorize`).query({ ...authorization(),
      redirect_uri: "https://attacker.test" }).set("Accept", "text/html");
    expect(invalid.status).toBe(400);
    expect(invalid.headers.location).toBeUndefined();
    const web = browser();
    const begin = await web.get(`${api}/oauth/authorize?${new URLSearchParams(authorization())}`);
    expect((await web.login(begin.headers.location, "bob@example.test")).status).toBe(403);
    expect(mockDial).not.toHaveBeenCalled();
  });
  it("requires a valid Actions token and rejects foreign account and MCP audiences", async () => {
    expect((await request(app).get(`${api}/calls`)).status).toBe(401);
    expect((await request(app).get(`${api}/calls`).auth("ordinary-native-session", { type: "bearer" })).status).toBe(401);
    expect((await request(app).get(`${api}/calls`).auth(await token("calls:read", "bob"), { type: "bearer" })).status).toBe(403);
    const access = await token();
    expect((await request(app).post("/api/chatgpt/tools/get_profile").auth(access, { type: "bearer" }).send({})).status).toBe(401);
    const result = await request(app).get(`${api}/calls`).auth(access, { type: "bearer" });
    expect(result.status).toBe(200);
    expect(backend.history).toHaveBeenCalledExactlyOnceWith("alice");
    expect((await request(app).get(`${api}/calls/foreign`).auth(access, { type: "bearer" })).status).toBe(404);
    expect(backend.call).toHaveBeenLastCalledWith("alice", "foreign", false);
  });
  it("requires separately granted transcript permission and forbids owner-id selection", async () => {
    const access = await token();
    expect((await request(app).get(`${api}/calls/owned-call?includeTranscript=true`).auth(access, { type: "bearer" })).status).toBe(403);
    expect(backend.call).not.toHaveBeenCalled();
    expect((await request(app).get(`${api}/calls?ownerId=bob`).auth(access, { type: "bearer" })).status).toBe(400);
    const allowed = await request(app).get(`${api}/calls/owned-call?includeTranscript=true`)
      .auth(await token("calls:read calls:transcript"), { type: "bearer" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.transcript).toBe("synthetic transcript");
  });
  it("revokes only this client's grant and stops future access without cancelling calls", async () => {
    const mcpGrant = grantId("talkhint-chatgpt", ["calls:read"]);
    await store.put({ id: mcpGrant, userId: "alice", expiresAt: new Date(Date.now() + 3600_000) });
    const access = await token();
    const listed = await request(app).get(`${api}/connections`).set("x-native-owner", "alice");
    expect(listed.body.connections).toHaveLength(1);
    expect(listed.body.connections[0].id).not.toBe(mcpGrant);
    expect((await request(app).post(`${api}/connections/revoke`).set("x-native-owner", "alice")
      .send({ id: mcpGrant })).status).toBe(404);
    const response = await request(app).post(`${api}/oauth/revoke`).type("form")
      .send({ client_id: clientId, client_secret: secret, token: access });
    expect(response.status).toBe(200);
    expect(await store.get(mcpGrant)).toBeDefined();
    expect((await request(app).get(`${api}/profile`).auth(access, { type: "bearer" })).status).toBe(401);
    expect(mockDial).not.toHaveBeenCalled();
  });
  it("keeps draft non-executable and rejects client-side confirmation or voice changes", async () => {
    const access = await token("calls:read secretary:start");
    const prepared = await request(app).post(`${api}/drafts`).auth(access, { type: "bearer" }).send(draft());
    expect(prepared.body.status).toBe("owner_approval_required");
    expect(prepared.body.approval_url).toContain(`${origin}${api}/approve?ticket=`);
    expect(prepared.body.approvalEndpoint).toBeUndefined();
    expect((await launch(access, prepared.body.confirmation, { confirmed: true })).status).toBe(400);
    expect((await launch(access, prepared.body.confirmation)).status).toBe(403);
    expect((await request(app).post(`${api}/drafts`).auth(access, { type: "bearer" })
      .send({ ...draft(), voiceProvider: "cartesia" })).status).toBe(400);
    expect(backend.start).not.toHaveBeenCalled();
    expect(mockDial).not.toHaveBeenCalled();
  });
  it("requires browser owner/CSRF and dispatches only once across concurrent approved launches", async () => {
    const access = await token("calls:read secretary:start");
    const prepared = await approve(access);
    const results = await Promise.all([launch(access, prepared.confirmation), launch(access, prepared.confirmation)]);
    expect(results.map(r => r.status)).toEqual([202, 202]);
    expect(mockDial).toHaveBeenCalledTimes(1);
    expect(results[0].body.task_id).toBe(results[1].body.task_id);
    const read = await request(app).get(`${api}/tasks/${results[0].body.task_id}`).auth(access, { type: "bearer" });
    expect(read.status).toBe(200);
    expect(read.body.status).toBe("starting");
    expect((await launch(access, prepared.confirmation, { phoneNumber: "+12025550124" })).status).toBe(400);
    expect(mockDial).toHaveBeenCalledTimes(1);
  });
  it("rejects forged CSRF and stolen browser review flows without approving", async () => {
    const access = await token("calls:read secretary:start");
    const prepared = await request(app).post(`${api}/drafts`).auth(access, { type: "bearer" }).send(draft());
    const web = browser();
    const begin = await web.get(prepared.body.approval_url);
    const page = await web.login(begin.headers.location);
    expect((await launch(access, prepared.body.confirmation)).status).toBe(403);
    expect((await web.post(`${api}/browser/approve`, { ...fields(page), csrf: "forged", decision: "approve" })).status).toBe(403);
    expect((await browser().post(`${api}/browser/approve`, { ...fields(page), decision: "approve" })).status).toBe(403);
    expect((await launch(access, prepared.body.confirmation)).status).toBe(403);
    expect(mockDial).not.toHaveBeenCalled();
  });
  it("respects denial, revoked grants and expires old approvals", async () => {
    const access = await token("calls:read secretary:start");
    const denied = await approve(access, "deny");
    expect((await launch(access, denied.confirmation)).status).toBe(409);
    const prepared = await approve(access);
    const claims = credentials.read(access, "access");
    await store.expire(claims.grant, "alice");
    expect((await launch(access, prepared.confirmation)).status).toBe(401);
    expect(mockDial).not.toHaveBeenCalled();
    const fresh = await token("calls:read secretary:start");
    const expiring = await approve(fresh);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    expect((await launch(fresh, expiring.confirmation)).status).toBe(401);
    clock.mockRestore();
    expect(mockDial).not.toHaveBeenCalled();
  });
  it("does not expose generic tools, self-approval, MCP, incoming, SMS or number purchase", async () => {
    for (const path of ["/tools/start_call", "/confirmations/approve", "/mcp", "/incoming", "/sms", "/numbers"])
      expect((await request(app).post(`${api}${path}`).send({})).status).toBe(404);
    expect(backend.incoming).not.toHaveBeenCalled();
    expect(mockDial).not.toHaveBeenCalled();
  });
  it("fails closed when not enabled or missing client secret/owner/callback; never falls back to public MCP", async () => {
    config.enabled = false;
    expect((await request(app).get(`${api}/calls`)).status).toBe(503);
    config.enabled = true;
    config.actions!.ownerId = "";
    expect((await request(app).get(`${api}/calls`)).status).toBe(503);
    config.actions!.ownerId = "alice";
    config.actions!.clientSecret = () => "";
    expect((await request(app).get(`${api}/calls`)).status).toBe(503);
    config.actions!.clientSecret = () => { throw new Error("Secret accessor unavailable"); };
    expect((await request(app).get(`${api}/calls`)).status).toBe(503);
    config.actions!.clientSecret = () => secret;
    config.redirectUri = "https://attacker.test/callback";
    expect((await request(app).get(`${api}/calls`)).status).toBe(503);
    expect(mockDial).not.toHaveBeenCalled();
  });
  it("advertises only read tools by default and never truncates large text silently", async () => {
    setup(false);
    const schema = await request(app).get(`${api}/openapi.json`);
    expect(Object.keys(schema.body.paths)).toHaveLength(6);
    expect((await request(app).post(`${api}/drafts`).send(draft())).status).toBe(404);
    vi.mocked(backend.call).mockResolvedValueOnce({ id: "owned-call", status: "completed", transcript: "x".repeat(100_001) } as any);
    const result = await request(app).get(`${api}/calls/owned-call?includeTranscript=true`)
      .auth(await token("calls:read calls:transcript"), { type: "bearer" });
    expect(result.status).toBe(413);
    expect(result.body.error).toContain("too large");
    expect(result.body.transcript).toBeUndefined();
    expect(mockDial).not.toHaveBeenCalled();
  });
});

describe("offline Actions schema and export", () => {
  it("matches all HTTP operations, scopes and consequential writes without external refs/secrets", () => {
    const schema = talkHintActionsSchema(origin, true);
    expect(schema.openapi).toBe("3.1.0");
    expect(Object.keys(schema.paths)).toHaveLength(8);
    const ids = new Set<string>();
    for (const [path, methods] of Object.entries(schema.paths)) {
      for (const [method, value] of Object.entries(methods as any)) {
        const operation = value as any;
        expect(operation.operationId).toMatch(/^[a-z_]+$/);
        expect(ids.has(operation.operationId)).toBe(false);
        ids.add(operation.operationId);
        expect(operation.description.length).toBeLessThanOrEqual(300);
        expect(operation["x-openai-isConsequential"]).toBe(method === "post");
        expect(operation.security[0].TalkHintOAuth).toEqual([method === "get" ? "calls:read" : "secretary:start"]);
        expect(operation.responses[method === "get" || path.endsWith("/drafts") ? "200" : "202"]).toBeDefined();
        if (path.includes("{id}")) expect(operation.parameters).toContainEqual(expect.objectContaining({
          name: "id", in: "path", required: true,
        }));
      }
    }
    expect(ids.size).toBe(8);
    expect(JSON.stringify(schema)).not.toMatch(/\$ref|client_secret|Route Leader|Road Ranger|confirmed/);
    expect(schema.components.securitySchemes.TalkHintOAuth.flows.authorizationCode.authorizationUrl)
      .toBe(`${origin}${api}/oauth/authorize`);
  });
  it("exports a repeatable non-secret draft without enabling or connecting anything", () => {
    execFileSync(process.execPath, [fileURLToPath(import.meta.resolve("tsx/cli")),
      "scripts/prepare-chatgpt-actions.ts", "--draft", "--outbound"]);
    const text = readFileSync("generated-artifacts/talkhint-actions/draft/talkhint-actions-NOT-FOR-CONNECTION.json", "utf8");
    const schema = JSON.parse(text);
    expect(schema.servers).toEqual([{ url: "https://talkhint-actions.invalid" }]);
    expect(Object.keys(schema.paths)).toHaveLength(8);
    expect(text).not.toContain(secret);
    expect(mockDial).not.toHaveBeenCalled();
  });
});
