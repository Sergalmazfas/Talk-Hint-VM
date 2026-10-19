import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { registerChatGPTIntegration, type IntegrationConfig } from "./routes";
import { Credentials, digest, grantId } from "./security";
import type { SecretaryBackend } from "./secretary";
import { testMarkerStore } from "./testSupport";

vi.mock("../auth", () => ({ authMiddleware: (_q: any, res: any) => res.sendStatus(401) }));
const config: IntegrationConfig = {
  enabled: true, origin: "https://stage-one.example.test", clientId: "talkhint-chatgpt",
  redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
  signingKey: () => "stage-one-isolated-fixture-not-a-secret-000000",
  // Deliberately omit outboundEnabled: production composition uses this default.
};
const resource = `${config.origin}/api/chatgpt/mcp`;
const verifier = "stage-one-pkce-verifier-at-least-forty-three-characters";
const ownerAuth: RequestHandler = (req, res, next) => {
  const id = req.header("x-fixture-owner");
  if (!id) return void res.sendStatus(401);
  req.user = { id } as any;
  next();
};
let store: ReturnType<typeof testMarkerStore>;
let app: ReturnType<typeof express>;
let backend: SecretaryBackend;
function rpc(method: string, params: object = {}, token?: string) {
  const q = request(app).post("/api/chatgpt/mcp");
  if (token) q.set("Authorization", `Bearer ${token}`);
  return q.send({ jsonrpc: "2.0", id: 1, method, params });
}
function call(name: string, token?: string, args: object = {}) {
  return rpc("tools/call", { name, arguments: args }, token);
}
function authorization(scope: string) {
  return { response_type: "code", client_id: config.clientId, resource, scope,
    redirect_uri: config.redirectUri, state: "fixture-state-not-a-credential",
    code_challenge_method: "S256", code_challenge: digest(verifier) };
}
async function link(user: string, scope = "calls:read calls:transcript offline_access") {
  const grant = await request(app).post("/api/chatgpt/connections").set("x-fixture-owner", user)
    .send({ approved: true, scope });
  expect(grant.status).toBe(201);
  const redirect = await request(app).get("/api/chatgpt/oauth/authorize")
    .set("x-fixture-owner", user).query(authorization(scope));
  const target = new URL(redirect.headers.location);
  expect(target.origin + target.pathname).toBe(config.redirectUri);
  expect(target.searchParams.get("state")).toBe(authorization(scope).state);
  expect(target.searchParams.get("iss")).toBe(config.origin);
  const tokens = await request(app).post("/api/chatgpt/oauth/token").type("form").send({
    client_id: config.clientId, resource, grant_type: "authorization_code",
    code: target.searchParams.get("code"), code_verifier: verifier, redirect_uri: config.redirectUri,
  });
  expect(tokens.status).toBe(200);
  return { ...tokens.body, grant: grant.body.id };
}
function refresh(token: string) {
  return request(app).post("/api/chatgpt/oauth/token").type("form")
    .send({ client_id: config.clientId, resource, grant_type: "refresh_token", refresh_token: token });
}
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden"); }));
  store = testMarkerStore();
  backend = {
    history: vi.fn(async (user: string) => [{ id: `${user}-call`, status: "completed" }]),
    call: vi.fn(async (user: string, id: string, transcript: boolean) => {
      if (id !== `${user}-call`) throw Object.assign(new Error("Call not found"), { status: 404 });
      return { id, status: "completed", ...(transcript ? { transcript: `${user} private text` } : {}) };
    }),
    tasks: vi.fn(async (user: string) => [{ id: `${user}-task`, status: "completed", summary: "Mock result" }]),
    task: vi.fn(async (user: string, id: string) => {
      if (id !== `${user}-task`) throw Object.assign(new Error("Task not found"), { status: 404 });
      return { id, status: "completed", summary: "Mock result" };
    }),
    incoming: vi.fn(), start: vi.fn(),
  } as any;
  app = express();
  app.use(express.json());
  registerChatGPTIntegration(app, config, store, backend, ownerAuth);
});
afterEach(() => vi.unstubAllGlobals());

describe("stage one: actual HTTP OAuth + MCP with fake identities, storage and telephony", () => {
  it("advertises only read scopes and only read-only tools by default", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"]) {
      const meta = await request(app).get(path);
      expect(meta.body.scopes_supported).toEqual(["calls:read", "calls:transcript", "offline_access"]);
      expect(meta.headers["cache-control"]).toBe("no-store");
    }
    const list = await rpc("tools/list");
    expect(list.body.result.tools.map((t: any) => t.name).sort()).toEqual([
      "get_call", "get_profile", "get_task", "list_calls", "list_tasks",
    ]);
    expect(list.body.result.tools.every((t: any) => t.annotations.readOnlyHint)).toBe(true);
    const profile = list.body.result.tools.find((t: any) => t.name === "get_profile");
    expect(profile._meta["openai/profile"]).toBe(true);
  });
  it("connects through PKCE, reads only own calls/status/results and isolates two accounts", async () => {
    const alice = await link("alice"), bob = await link("bob");
    expect((await call("get_profile", alice.access_token)).body.result.structuredContent).toEqual({ id: "alice" });
    expect((await call("list_calls", alice.access_token)).body.result.structuredContent.calls[0].id).toBe("alice-call");
    expect((await call("list_calls", bob.access_token)).body.result.structuredContent.calls[0].id).toBe("bob-call");
    const detail = await call("get_call", alice.access_token, { id: "alice-call", includeTranscript: true });
    expect(detail.body.result.structuredContent.transcript).toBe("alice private text");
    expect((await call("get_task", alice.access_token, { id: "alice-task" }))
      .body.result.structuredContent.summary).toBe("Mock result");
    for (const [name, id] of [["get_call", "bob-call"], ["get_task", "bob-task"]]) {
      const denied = await call(name, alice.access_token, { id, includeTranscript: true });
      expect(denied.body.result.isError).toBe(true);
      expect(JSON.stringify(denied.body)).not.toContain("bob private");
    }
    expect((await call("list_calls", alice.access_token, { userId: "bob" })).body.result.isError).toBe(true);
    expect(backend.start).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("requires separate transcript permission and supplies an OAuth scope challenge", async () => {
    const alice = await link("alice", "calls:read");
    const plain = await call("get_call", alice.access_token, { id: "alice-call" });
    expect(plain.body.result.structuredContent).not.toHaveProperty("transcript");
    const full = await call("get_call", alice.access_token, { id: "alice-call", includeTranscript: true });
    expect(full.body.result.isError).toBe(true);
    expect(full.body.result._meta["mcp/www_authenticate"][0]).toContain('scope="calls:transcript"');
    expect(full.headers["www-authenticate"]).toContain("insufficient_scope");
  });
  it("cannot enable writes with old broad grants, forged flags, approval API or hidden tool calls", async () => {
    const scopes = ["calls:read", "secretary:start"] as const;
    const grant = grantId(config.clientId, [...scopes]);
    await store.put({ id: grant, userId: "alice", expiresAt: new Date(Date.now() + 60_000) });
    const token = new Credentials(config.signingKey, resource).issue({
      type: "access", sub: "alice", grant, scopes: [...scopes], client: config.clientId, exp: Date.now() + 60_000,
    });
    for (const name of ["prepare_call", "start_call", "get_incoming"]) {
      expect((await call(name, token, { confirmed: true })).body.result.isError).toBe(true);
    }
    expect((await request(app).post("/api/chatgpt/confirmations/approve").set("x-fixture-owner", "alice")
      .send({ approved: true, confirmation: "anything" })).status).toBe(403);
    expect((await request(app).post("/api/chatgpt/connections").set("x-fixture-owner", "alice")
      .send({ approved: true, scope: "calls:read secretary:start" })).status).toBe(400);
    const invalid = await request(app).get("/api/chatgpt/oauth/authorize").set("x-fixture-owner", "alice")
      .query(authorization("calls:read secretary:start"));
    const target = new URL(invalid.headers.location);
    expect(target.searchParams.get("error")).toBe("invalid_scope");
    expect(target.searchParams.get("iss")).toBe(config.origin);
    expect(backend.start).not.toHaveBeenCalled();
    expect(backend.incoming).not.toHaveBeenCalled();
  });
  it("revokes access and refresh immediately, without affecting the other account", async () => {
    const alice = await link("alice"), bob = await link("bob");
    await request(app).post("/api/chatgpt/connections/revoke").set("x-fixture-owner", "bob")
      .send({ id: alice.grant });
    expect((await call("get_profile", alice.access_token)).body.result.isError).toBe(false);
    await request(app).post("/api/chatgpt/connections/revoke").set("x-fixture-owner", "alice")
      .send({ id: alice.grant });
    expect((await call("get_profile", alice.access_token)).body.result._meta["mcp/www_authenticate"]).toHaveLength(1);
    expect((await refresh(alice.refresh_token)).body.error).toBe("invalid_grant");
    expect((await call("get_profile", bob.access_token)).body.result.structuredContent.id).toBe("bob");
  });
  it("rotates refresh and revokes the entire family on replay", async () => {
    const alice = await link("alice");
    const rotated = await refresh(alice.refresh_token);
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(alice.refresh_token);
    expect((await call("get_profile", rotated.body.access_token)).body.result.isError).toBe(false);
    expect((await refresh(alice.refresh_token)).body.error).toBe("invalid_grant");
    expect((await call("get_profile", rotated.body.access_token)).body.result.isError).toBe(true);
    expect((await refresh(rotated.body.refresh_token)).status).toBe(400);
  });
  it("returns standard OAuth errors and never redirects to an untrusted callback", async () => {
    const base = { client_id: config.clientId, resource, grant_type: "authorization_code", code: "invalid" };
    for (const [override, error] of [
      [{}, "invalid_grant"], [{ client_id: "other" }, "invalid_client"],
      [{ resource: "https://other.test" }, "invalid_target"], [{ grant_type: "password" }, "unsupported_grant_type"],
    ] as const) {
      const response = await request(app).post("/api/chatgpt/oauth/token").type("form").send({ ...base, ...override });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error });
    }
    const bad = await request(app).get("/api/chatgpt/oauth/authorize").set("x-fixture-owner", "alice")
      .query({ ...authorization("calls:read"), redirect_uri: "https://other.test" });
    expect(bad.status).toBe(400);
    expect(bad.headers.location).toBeUndefined();
    expect(bad.body.iss).toBe(config.origin);
  });
  it("handles protocol initialization, notifications and malformed requests without exposing user data", async () => {
    for (const protocolVersion of ["2025-03-26", "2025-06-18", "2025-11-25"]) {
      expect((await rpc("initialize", { protocolVersion })).body.result.protocolVersion).toBe(protocolVersion);
    }
    expect((await request(app).post("/api/chatgpt/mcp")
      .send({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await request(app).post("/api/chatgpt/mcp").send({ method: "tools/list" }))
      .body.error.code).toBe(-32600);
    expect((await rpc("unknown")).body.error.code).toBe(-32601);
    expect((await request(app).get("/api/chatgpt/mcp")).status).toBe(405);
    expect((await call("get_profile")).body.result._meta["mcp/www_authenticate"][0])
      .toContain("resource_metadata=");
  });
});
