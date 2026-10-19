import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { registerChatGPTIntegration, type IntegrationConfig } from "./routes";
import { Credentials, digest, grantId, markerId, type Marker, type MarkerStore } from "./security";
import type { SecretaryBackend } from "./secretary";
import { evaluateIncomingSecretaryPolicy } from "./incoming";

vi.mock("../auth", () => ({ authMiddleware: (_q: any, r: any) => r.sendStatus(401) }));
const config: IntegrationConfig = {
  enabled: true, origin: "https://example.test", clientId: "talkhint-chatgpt",
  redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
  signingKey: () => "isolated-test-key-never-an-environment-secret-000",
};
const resource = `${config.origin}/api/chatgpt/mcp`;
const ownerAuth: RequestHandler = (req, res, next) => {
  const id = req.header("x-test-owner");
  if (!id) return void res.sendStatus(401);
  req.user = { id } as any;
  next();
};
function memoryStore() {
  const rows = new Map<string, Marker>();
  const store: MarkerStore = {
    async put(row) { if (!rows.has(row.id)) rows.set(row.id, { ...row }); },
    async get(id) { const row = rows.get(id); return row && row.expiresAt.getTime() > Date.now() ? row : undefined; },
    async consume(id) {
      const row = rows.get(id);
      if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
      rows.set(id, { ...row, expiresAt: new Date(0) });
      return row;
    },
    async list(userId) { return Array.from(rows.values()).filter(r =>
      r.userId === userId && r.id.startsWith("chatgpt:grant:") && r.expiresAt.getTime() > Date.now()); },
    async expire(id, userId) {
      const row = rows.get(id);
      if (row?.userId === userId) rows.set(id, { ...row, expiresAt: new Date(0) });
    },
  };
  return { rows, store };
}
let store: MarkerStore;
let rows: Map<string, Marker>;
let backend: SecretaryBackend;
let app: ReturnType<typeof express>;
const credentials = new Credentials(config.signingKey, resource);
async function access(scope = "calls:read incoming:read calls:transcript secretary:start offline_access", user = "alice") {
  const scopes = scope.split(" ") as any;
  const grant = grantId(config.clientId, scopes);
  await store.put({ id: grant, userId: user, expiresAt: new Date(Date.now() + 3600_000) });
  return { grant, token: credentials.issue({ type: "access", sub: user, grant, scopes,
    client: config.clientId, exp: Date.now() + 600_000 }) };
}
function tool(name: string, token?: string, args: unknown = {}) {
  const req = request(app).post(`/api/chatgpt/tools/${name}`);
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(args);
}
const call = () => ({
  phoneNumber: "+12025550123", instruction: "Ask for opening hours",
  clientRequestId: randomUUID(), voiceProvider: "elevenlabs", translationLanguage: "ru",
});
beforeEach(() => {
  ({ store, rows } = memoryStore());
  backend = {
    history: vi.fn().mockResolvedValue([]), call: vi.fn().mockResolvedValue({ id: "c1", transcript: "guest text" }),
    tasks: vi.fn().mockResolvedValue([]), task: vi.fn().mockResolvedValue({ id: "t1", status: "finalizing" }),
    incoming: vi.fn().mockResolvedValue({ calls: [], handling: "native_talkhint", aiAnswerEnabled: false }),
    start: vi.fn().mockResolvedValue({ task: { id: "t1", status: "starting" }, reused: false }),
  } as any;
  app = express();
  app.use(express.json({ limit: "32kb" }));
  registerChatGPTIntegration(app, config, store, backend, ownerAuth);
});

describe("isolated owner-authorized ChatGPT adapter", () => {
  it("is fail-closed by default and never reaches data/dialing", async () => {
    const disabled = express();
    disabled.use(express.json());
    registerChatGPTIntegration(disabled, { ...config, enabled: false }, store, backend, ownerAuth);
    expect((await request(disabled).post("/api/chatgpt/tools/start_call").send({})).status).toBe(503);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("requires integration credentials, not owner headers or ordinary app bearer", async () => {
    expect((await tool("list_calls")).status).toBe(401);
    expect((await tool("list_calls", "ordinary-app-session")).status).toBe(401);
    const res = await request(app).post("/api/chatgpt/tools/list_calls").set("x-test-owner", "alice").send({});
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("oauth-protected-resource");
    expect(backend.history).not.toHaveBeenCalled();
  });
  it("resolves identity from token and rejects caller-supplied user IDs", async () => {
    const { token } = await access();
    expect((await tool("list_calls", token)).status).toBe(200);
    expect(backend.history).toHaveBeenCalledWith("alice");
    expect((await tool("list_calls", token, { userId: "bob" })).status).toBe(400);
  });
  it("keeps transcript access separate and defaults it off", async () => {
    const { token } = await access("calls:read");
    expect((await tool("get_call", token, { id: "c1" })).status).toBe(200);
    expect(backend.call).toHaveBeenCalledWith("alice", "c1", false);
    expect((await tool("get_call", token, { id: "c1", includeTranscript: true })).status).toBe(403);
    const full = await access("calls:read calls:transcript");
    expect((await tool("get_task", full.token, { id: "t1", includeTranscript: true })).status).toBe(200);
    expect(backend.task).toHaveBeenCalledWith("alice", "t1", true);
  });
  it("rejects revoked, expired, tampered and wrong-audience credentials", async () => {
    const { token, grant } = await access();
    const expired = credentials.issue({ ...credentials.read(token, "access"), exp: Date.now() - 1 });
    const wrong = new Credentials(config.signingKey, "https://elsewhere.test").issue({
      ...credentials.read(token, "access"), exp: Date.now() + 1000,
    });
    for (const invalid of [expired, wrong, `${token.slice(0, -4)}abcd`]) {
      expect((await tool("list_calls", invalid)).status).toBe(401);
    }
    await store.expire(grant, "alice");
    expect((await tool("list_calls", token)).status).toBe(401);
  });
  it("requires owner authentication for grants and revocation, and denies cross-origin writes", async () => {
    expect((await request(app).post("/api/chatgpt/connections").send({ approved: true, scope: "calls:read" })).status).toBe(401);
    const blocked = await request(app).post("/api/chatgpt/connections").set("x-test-owner", "alice")
      .set("Origin", "https://attacker.test").send({ approved: true, scope: "calls:read" });
    expect(blocked.status).toBe(403);
    expect((await request(app).post("/api/chatgpt/connections").set("x-test-owner", "alice")
      .send({ approved: true, scope: "calls:read" })).status).toBe(201);
    const { token, grant } = await access();
    await request(app).post("/api/chatgpt/connections/revoke").set("x-test-owner", "bob").send({ id: grant });
    expect((await tool("list_calls", token)).status).toBe(200);
    await request(app).post("/api/chatgpt/connections/revoke").set("x-test-owner", "alice").send({ id: grant });
    expect((await tool("list_calls", token)).status).toBe(401);
  });
  it("requires separate owner approval and exact immutable call details", async () => {
    const { token } = await access();
    const input = call();
    const preview = await tool("prepare_call", token, input);
    expect(preview.status).toBe(200);
    const { confirmation } = preview.body;
    expect(backend.start).not.toHaveBeenCalled();
    expect((await tool("start_call", token, { confirmation })).status).toBe(403);
    expect((await tool("start_call", token, { confirmation, confirmed: true })).status).toBe(400);
    expect((await request(app).post("/api/chatgpt/confirmations/approve")
      .set("Authorization", `Bearer ${token}`).send({ approved: true, confirmation })).status).toBe(401);
    expect((await request(app).post("/api/chatgpt/confirmations/approve").set("x-test-owner", "bob")
      .send({ approved: true, confirmation })).status).toBe(404);
    expect((await request(app).post("/api/chatgpt/confirmations/approve").set("x-test-owner", "alice")
      .send({ approved: true, confirmation })).status).toBe(200);
    const started = await tool("start_call", token, { confirmation });
    expect(started.status).toBe(202);
    expect(started.body.asynchronous).toBe(true);
    expect(backend.start).toHaveBeenCalledWith("alice", input);
    expect((await tool("start_call", token, { confirmation, phoneNumber: "+12025550999" })).status).toBe(400);
    const other = await access();
    expect((await tool("start_call", other.token, { confirmation })).status).toBe(403);
  });
  it("invalidates approved calls on revocation and never accepts expired approvals", async () => {
    const { token, grant } = await access();
    const { confirmation } = (await tool("prepare_call", token, call())).body;
    await request(app).post("/api/chatgpt/confirmations/approve").set("x-test-owner", "alice")
      .send({ approved: true, confirmation });
    rows.set(markerId(confirmation), { id: markerId(confirmation), userId: "alice", expiresAt: new Date(0) });
    expect((await tool("start_call", token, { confirmation })).status).toBe(403);
    await store.expire(grant, "alice");
    expect((await tool("start_call", token, { confirmation })).status).toBe(401);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("cannot use read-only access to prepare or start outgoing calls", async () => {
    const { token } = await access("calls:read incoming:read");
    expect((await tool("prepare_call", token, call())).status).toBe(403);
    expect((await tool("start_call", token, { confirmation: "fake" })).status).toBe(403);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("does not accept unsafe destinations, arbitrary tools or automatic incoming answering", async () => {
    const { token } = await access();
    expect((await tool("prepare_call", token, { ...call(), phoneNumber: "911" })).status).toBe(400);
    expect((await tool("forward_call", token, {})).status).toBe(404);
    expect((await tool("get_incoming", token)).body.aiAnswerEnabled).toBe(false);
    expect(evaluateIncomingSecretaryPolicy({ ownerId: "alice", condition: "no_answer", explicitlyApproved: true }))
      .toMatchObject({ action: "preserve_native", aiAnswerEnabled: false });
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("publishes stateless MCP discovery, strict schemas and auth challenges without leaking data", async () => {
    const init = await request(app).post("/api/chatgpt/mcp").send({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" },
    });
    expect(init.body.result.protocolVersion).toBe("2025-11-25");
    const list = await request(app).post("/api/chatgpt/mcp").send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const start = list.body.result.tools.find((t: any) => t.name === "start_call");
    expect(start.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    expect(start.securitySchemes[0].scopes).toEqual(["secretary:start"]);
    const result = await request(app).post("/api/chatgpt/mcp").send({
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_calls", arguments: {} },
    });
    expect(result.body.result.isError).toBe(true);
    expect(result.body.result._meta["mcp/www_authenticate"]).toHaveLength(1);
    expect(backend.history).not.toHaveBeenCalled();
    const { token } = await access();
    const read = await request(app).post("/api/chatgpt/mcp").set("Authorization", `Bearer ${token}`).send({
      jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_profile", arguments: {} },
    });
    expect(read.body.result.structuredContent).toEqual({ id: "alice" });
  });
});

describe("OAuth authorization code + PKCE and rotated refresh", () => {
  const verifier = "test-verifier-that-is-at-least-forty-three-characters-long";
  const query = () => ({
    response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, resource,
    scope: "calls:read offline_access", state: "random-state-with-sufficient-length",
    code_challenge: digest(verifier), code_challenge_method: "S256",
  });
  async function code() {
    await access("calls:read offline_access");
    const response = await request(app).get("/api/chatgpt/oauth/authorize").set("x-test-owner", "alice").query(query());
    expect(response.status).toBe(302);
    const url = new URL(response.headers.location);
    expect(url.searchParams.get("iss")).toBe(config.origin);
    expect(url.searchParams.get("state")).toBe(query().state);
    return url.searchParams.get("code")!;
  }
  function exchange(value: string, override: object = {}) {
    return request(app).post("/api/chatgpt/oauth/token").type("form").send({
      grant_type: "authorization_code", client_id: config.clientId, resource,
      code: value, redirect_uri: config.redirectUri, code_verifier: verifier, ...override,
    });
  }
  it("advertises S256, exact resource and predefined-client metadata", async () => {
    expect((await request(app).get("/.well-known/oauth-protected-resource")).body.resource).toBe(resource);
    const meta = (await request(app).get("/.well-known/oauth-authorization-server")).body;
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(meta.scopes_supported).toContain("offline_access");
    expect(meta.registration_endpoint).toBeUndefined();
  });
  it("does not issue codes without prior owner consent or for unapproved scopes/redirects", async () => {
    expect((await request(app).get("/api/chatgpt/oauth/authorize").set("x-test-owner", "alice").query(query())).status).toBe(403);
    await access("calls:read");
    expect((await request(app).get("/api/chatgpt/oauth/authorize").set("x-test-owner", "alice").query(query())).status).toBe(403);
    expect((await request(app).get("/api/chatgpt/oauth/authorize").set("x-test-owner", "alice")
      .query({ ...query(), redirect_uri: "https://attacker.test" })).status).toBe(400);
  });
  it("rejects wrong resource, PKCE, client and redirect without consuming valid code", async () => {
    const value = await code();
    for (const bad of [{ resource: "https://attacker.test" }, { code_verifier: "bad" },
      { client_id: "attacker" }, { redirect_uri: "https://attacker.test" }]) {
      expect((await exchange(value, bad)).status).toBe(400);
    }
    expect((await exchange(value)).status).toBe(200);
    expect((await exchange(value)).status).toBe(400);
  });
  it("allows exactly one concurrent code exchange", async () => {
    const value = await code();
    const responses = await Promise.all([exchange(value), exchange(value)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
  });
  it("rejects authorization codes after revocation or expiry", async () => {
    const value = await code();
    const claims = credentials.read(value, "code");
    await store.expire(claims.grant, "alice");
    expect((await exchange(value)).status).toBe(401);
    expect(rows.get(markerId(value))!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const next = await code();
    rows.set(markerId(next), { ...rows.get(markerId(next))!, expiresAt: new Date(0) });
    expect((await exchange(next)).status).toBe(400);
  });
  it("rotates refresh credentials and revokes all tokens for the connection", async () => {
    const issued = await exchange(await code());
    expect(issued.body.expires_in).toBeLessThanOrEqual(600);
    const refresh = () => request(app).post("/api/chatgpt/oauth/token").type("form").send({
      grant_type: "refresh_token", client_id: config.clientId, resource, refresh_token: issued.body.refresh_token,
    });
    const rotated = await refresh();
    expect(rotated.status).toBe(200);
    expect((await refresh()).status).toBe(400);
    expect((await tool("list_calls", rotated.body.access_token)).status).toBe(200);
    expect((await request(app).post("/api/chatgpt/oauth/revoke").type("form")
      .send({ client_id: config.clientId, token: rotated.body.refresh_token })).status).toBe(200);
    expect((await tool("list_calls", issued.body.access_token)).status).toBe(401);
    expect((await tool("list_calls", rotated.body.access_token)).status).toBe(401);
    // Expiry markers only; no records/transcripts deleted.
    expect(rows.size).toBeGreaterThan(0);
  });
});
