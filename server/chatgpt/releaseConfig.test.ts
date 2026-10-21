import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { mcpReleaseConfiguration, isChatGPTMcpCallback, MCP_RELEASE_ORIGIN } from "./releaseConfig";
import { registerChatGPTIntegration } from "./routes";
import { Credentials, fail, grantId, type Marker, type MarkerStore, type Scope } from "./security";
import type { SecretaryBackend } from "./secretary";
import { serveStatic } from "../static";
import { verifyMcpBuild } from "../../script/mcp-build-verification";

const key = () => "synthetic-mcp-release-test-signing-key-not-a-real-secret";
const callback = "https://chatgpt.com/connector_platform_oauth_redirect"; // Official documented example, NOT a configured connection.
const ownerAuth: RequestHandler = (req, res, next) => {
  const id = req.header("x-test-owner");
  if (!id) return void res.sendStatus(401);
  req.user = { id } as any;
  next();
};

function fixture(redirectUri = "", extra: Record<string, string> = {}) {
  const config = mcpReleaseConfiguration({ CHATGPT_SECRETARY_REDIRECT_URI: redirectUri, ...extra }, true, key);
  const rows = new Map<string, Marker>();
  const store: MarkerStore = {
    async put(row) { if (!rows.has(row.id)) rows.set(row.id, { ...row }); },
    async get(id) { const row = rows.get(id); return row && row.expiresAt.getTime() > Date.now() ? row : undefined; },
    async consume(id) {
      const row = await store.get(id);
      if (!row) return undefined;
      rows.set(id, { ...row, expiresAt: new Date(0) }); return row;
    },
    async list(user) { return [...rows.values()].filter(r =>
      r.userId === user && r.id.startsWith("chatgpt:grant:") && r.expiresAt.getTime() > Date.now()); },
    async expire(id, user) { const row = rows.get(id);
      if (row?.userId === user) rows.set(id, { ...row, expiresAt: new Date(0) }); },
  };
  const owned = (owner: string, id: string, transcript: boolean) => {
    if (id !== `${owner}-record`) return fail(404, "Not found");
    return { id, status: "completed", summary: "Synthetic result", ...(transcript ? { transcript: "Synthetic transcript" } : {}) };
  };
  const backend = {
    history: vi.fn(async (owner: string) => [{ id: `${owner}-record`, status: "completed" }]),
    tasks: vi.fn(async (owner: string) => [{ id: `${owner}-record`, status: "completed" }]),
    call: vi.fn(async (owner: string, id: string, transcript: boolean) => owned(owner, id, transcript)),
    task: vi.fn(async (owner: string, id: string, transcript: boolean) => owned(owner, id, transcript)),
    incoming: vi.fn(), start: vi.fn(),
  } as unknown as SecretaryBackend;
  const app = express(); app.use(express.json());
  registerChatGPTIntegration(app, config, store, backend, ownerAuth);
  const credentials = new Credentials(key, `${config.origin}/api/chatgpt/mcp`);
  async function token(owner: string, scopes: Scope[] = ["calls:read"]) {
    const grant = grantId(config.clientId, scopes);
    await store.put({ id: grant, userId: owner, expiresAt: new Date(Date.now() + 60_000) });
    return { grant, value: credentials.issue({ type: "access", sub: owner, grant, scopes,
      client: config.clientId, exp: Date.now() + 60_000 }) };
  }
  function rpc(name: string, args = {}, bearer?: string) {
    const q = request(app).post("/api/chatgpt/mcp");
    if (bearer) q.set("Authorization", `Bearer ${bearer}`);
    return q.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  }
  return { app, backend, config, token, rpc, store, credentials };
}

afterEach(() => vi.restoreAllMocks());

describe("next-release MCP configuration (no environment mutations)", () => {
  it("enables only read-only MCP on the verified production origin; development stays opt-in", () => {
    expect(mcpReleaseConfiguration({}, true, key)).toMatchObject({
      enabled: true, origin: MCP_RELEASE_ORIGIN, outboundEnabled: false, redirectUri: "",
    });
    expect(mcpReleaseConfiguration({}, false, key).enabled).toBe(false);
    expect(mcpReleaseConfiguration({ CHATGPT_SECRETARY_ENABLED: "false" }, true, key).enabled).toBe(false);
    expect(mcpReleaseConfiguration({ CHATGPT_SECRETARY_OUTBOUND_ENABLED: "true" }, true, key).outboundEnabled).toBe(false);
  });
  it("allows only exact official MCP callback shapes, not Actions callbacks or arbitrary redirects", () => {
    for (const url of [callback, "https://chatgpt.com/connector/oauth/synthetic-callback-id"])
      expect(isChatGPTMcpCallback(url)).toBe(true);
    for (const url of ["", "https://chatgpt.com/aip/g-test/oauth/callback", "https://evil.test/callback",
      `${callback}?extra=1`, `${callback}#fragment`, `${callback}/`, "https://chatgpt.com.evil.test/connector/oauth/a",
      "https://user@chatgpt.com/connector/oauth/a", "https://chatgpt.com/connector/oauth/{callback_id}"]) {
      expect(isChatGPTMcpCallback(url)).toBe(false);
      expect(mcpReleaseConfiguration({ CHATGPT_SECRETARY_REDIRECT_URI: url }, true, key).redirectUri).toBe("");
    }
  });
  it("requires the new explicit outbound mode, a valid callback and an enabled integration", () => {
    const mode = { CHATGPT_SECRETARY_CALL_MODE: "owner-confirmed" };
    expect(mcpReleaseConfiguration(mode, true, key).outboundEnabled).toBe(false);
    expect(mcpReleaseConfiguration({ ...mode, CHATGPT_SECRETARY_REDIRECT_URI: callback,
      CHATGPT_SECRETARY_ENABLED: "false" }, true, key).outboundEnabled).toBe(false);
    expect(mcpReleaseConfiguration({ ...mode, CHATGPT_SECRETARY_REDIRECT_URI: callback },
      false, key).outboundEnabled).toBe(false);
    const config = mcpReleaseConfiguration({ ...mode, CHATGPT_SECRETARY_REDIRECT_URI: callback }, true, key);
    expect(config.outboundEnabled).toBe(true);
    expect(config.allowedScopes).toEqual(["calls:read", "calls:transcript", "offline_access", "secretary:start", "calls:listen"]);
    expect(config.allowedScopes).not.toContain("incoming:read");
    for (const value of ["true", "all", "enabled", ""])
      expect(mcpReleaseConfiguration({ CHATGPT_SECRETARY_CALL_MODE: value,
        CHATGPT_SECRETARY_REDIRECT_URI: callback }, true, key).outboundEnabled).toBe(false);
  });
  it("adds outbound tools only on opt-in, with separate scope escalation and no incoming permission", async () => {
    const f = fixture(callback, { CHATGPT_SECRETARY_CALL_MODE: "owner-confirmed" });
    const listed = await request(f.app).post("/api/chatgpt/mcp").send({
      jsonrpc: "2.0", id: 1, method: "tools/list",
    });
    expect(listed.body.result.tools.map((tool: any) => tool.name)).toEqual([
      "get_profile", "list_calls", "get_call", "list_tasks", "get_task", "read_call_turns", "prepare_call", "start_call", "confirm_call_from_card", "open_call_monitor",
    ]);
    expect((await request(f.app).get("/api/chatgpt/readiness")).body.mode).toBe("outbound");
    const initialized = await request(f.app).post("/api/chatgpt/mcp").send({
      jsonrpc: "2.0", id: 2, method: "initialize",
    });
    expect(initialized.body.result.instructions).toContain("Owner-approved outbound workflow is enabled");
    expect(initialized.body.result.instructions).not.toContain("Read only the authenticated");
    const callSkill = await request(f.app).get("/api/chatgpt/skills/secretary/SKILL.md");
    expect(callSkill.status).toBe(200);
    expect(callSkill.type).toBe("text/plain");
    expect(callSkill.text).toContain("## One explicit call");
    expect((await request(f.app).get("/.well-known/oauth-protected-resource")).body.scopes_supported)
      .toEqual(["calls:read", "offline_access"]);
    const base = await f.token("alice", ["calls:read", "offline_access"]);
    const input = { phoneNumber: "+12025550123", instruction: "Ask only for opening hours",
      clientRequestId: "56fa4264-8b0a-4692-bcb2-77b03c145631" };
    const missingPermission = await f.rpc("prepare_call", input, base.value);
    expect(missingPermission.body.result.isError).toBe(true);
    expect(missingPermission.headers["www-authenticate"]).toContain(
      'scope="calls:read offline_access secretary:start"');
    expect(missingPermission.headers["www-authenticate"]).not.toContain("calls:transcript");
    const write = await f.token("alice", ["calls:read", "offline_access", "secretary:start"]);
    const preview = await f.rpc("prepare_call", input, write.value);
    expect(preview.body.result.structuredContent).toMatchObject({
      status: "owner_approval_required", call: input,
    });
    const { confirmation } = preview.body.result.structuredContent;
    expect((await f.rpc("start_call", { confirmation }, write.value)).body.result.isError).toBe(true);
    expect((await f.rpc("start_call", { confirmation, confirmed: true }, write.value)).body.result.isError).toBe(true);
    expect((await request(f.app).post("/api/chatgpt/connections").set("x-test-owner", "alice")
      .send({ approved: true, scope: "calls:read incoming:read" })).status).toBe(400);
    expect((await f.rpc("get_incoming", {}, write.value)).body.result.isError).toBe(true);
    expect(f.backend.start).not.toHaveBeenCalled();
    expect(f.backend.incoming).not.toHaveBeenCalled();
  });
  it("bootstraps discovery, initialization and five read-only tools before a callback is supplied", async () => {
    const f = fixture();
    for (const path of ["/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/chatgpt/mcp"]) {
      const res = await request(f.app).get(path);
      expect(res.status).toBe(200); expect(res.type).toBe("application/json");
      expect(res.body).toEqual({ resource: `${MCP_RELEASE_ORIGIN}/api/chatgpt/mcp`,
        authorization_servers: [MCP_RELEASE_ORIGIN], scopes_supported: ["calls:read", "offline_access"] });
    }
    const discovery = await request(f.app).get("/.well-known/oauth-authorization-server");
    expect(discovery.body).toMatchObject({ issuer: MCP_RELEASE_ORIGIN,
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
      scopes_supported: ["calls:read", "offline_access"] });
    expect(discovery.body).not.toHaveProperty("registration_endpoint");
    expect(discovery.body).not.toHaveProperty("client_id_metadata_document_supported");
    const initialized = await request(f.app).post("/api/chatgpt/mcp").send({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" },
    });
    expect(initialized.body.result).toMatchObject({ protocolVersion: "2025-11-25", capabilities: { tools: {} } });
    expect((await request(f.app).post("/api/chatgpt/mcp").send({
      jsonrpc: "2.0", method: "notifications/initialized",
    })).status).toBe(202);
    const listed = await request(f.app).post("/api/chatgpt/mcp").send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(listed.body.result.tools.map((t: any) => t.name)).toEqual([
      "get_profile", "list_calls", "get_call", "list_tasks", "get_task", "read_call_turns",
    ]);
    expect(listed.body.result.tools.every((t: any) =>
      t.annotations.readOnlyHint && t.securitySchemes[0].type === "oauth2")).toBe(true);
    for (const tool of listed.body.result.tools) {
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: [
        tool.name === "read_call_turns" ? "calls:transcript" : "calls:read"] }]);
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
      if (["get_call", "get_task"].includes(tool.name))
        expect(tool.inputSchema.properties.includeTranscript.default).toBe(false);
    }
    const get = await request(f.app).get("/api/chatgpt/mcp");
    expect(get.status).toBe(405); expect(get.headers.allow).toBe("POST");
    const metadata = await request(f.app).get("/api/chatgpt/mcp.json");
    const setup = await request(f.app).get("/api/chatgpt/skills/setup/SKILL.md");
    expect(setup.status).toBe(200);
    expect(setup.text).toContain("get_profile");
    expect(setup.text).not.toContain("Expected outbound tools");
    expect(metadata.body.mcpServers.talkhint.extensions["com.openai"].auth.client).toEqual({
      mode: "provided", clientId: "talkhint-chatgpt", tokenEndpointAuthMethod: "none",
    });
    expect((await request(f.app).get("/api/chatgpt/readiness")).body).toMatchObject({
      mode: "read-only", callbackConfigured: false, registration: "provided",
    });
    expect(f.backend.history).not.toHaveBeenCalled(); expect(f.backend.start).not.toHaveBeenCalled();
  });
  it("gives an OAuth challenge, not HTML/503, for unauthenticated tools while linking is pending", async () => {
    const f = fixture();
    const res = await f.rpc("get_profile");
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result._meta["mcp/www_authenticate"][0]).toContain('error="invalid_token"');
    expect(res.headers["www-authenticate"]).toContain("/.well-known/oauth-protected-resource");
    expect(res.headers["www-authenticate"]).toContain('scope="calls:read offline_access"');
    expect(res.headers["www-authenticate"]).not.toContain("calls:transcript");
    const previouslyIssued = await f.token("alice");
    expect((await f.rpc("list_calls", {}, previouslyIssued.value)).status).toBe(401);
    expect(f.backend.history).not.toHaveBeenCalled();
    expect((await request(f.app).get("/api/chatgpt/oauth/authorize")).status).toBe(503);
    expect((await request(f.app).post("/api/chatgpt/oauth/token").send({})).status).toBe(503);
  });
  it("isolates accounts, requires separate transcript permission and never invokes outbound/incoming", async () => {
    const f = fixture(callback, { CHATGPT_SECRETARY_OUTBOUND_ENABLED: "true" });
    const alice = await f.token("alice"), bob = await f.token("bob");
    for (const [owner, access] of [["alice", alice], ["bob", bob]] as const) {
      expect((await f.rpc("get_profile", {}, access.value)).body.result.structuredContent.id).toBe(owner);
      for (const [name, field] of [["list_calls", "calls"], ["list_tasks", "tasks"]])
        expect((await f.rpc(name, {}, access.value)).body.result.structuredContent[field][0].id).toBe(`${owner}-record`);
    }
    for (const name of ["get_call", "get_task"]) {
      expect((await f.rpc(name, { id: "bob-record" }, alice.value)).body.result.isError).toBe(true);
      const own = await f.rpc(name, { id: "alice-record" }, alice.value);
      expect(own.body.result.structuredContent).not.toHaveProperty("transcript");
      expect((await f.rpc(name, { id: "alice-record", includeTranscript: true }, alice.value)).body.result.isError).toBe(true);
    }
    const permitted = await f.token("alice", ["calls:read", "calls:transcript"]);
    expect((await f.rpc("get_call", { id: "alice-record", includeTranscript: true }, permitted.value))
      .body.result.structuredContent.transcript).toBe("Synthetic transcript");
    expect((await f.rpc("list_calls", { userId: "bob" }, alice.value)).body.result.isError).toBe(true);
    for (const name of ["prepare_call", "start_call", "get_incoming"])
      expect((await f.rpc(name, {}, alice.value)).body.result.isError).toBe(true);
    await f.store.expire(alice.grant, "alice");
    expect((await f.rpc("get_profile", {}, alice.value)).body.result.isError).toBe(true);
    expect((await f.rpc("get_profile", {}, bob.value)).body.result.isError).toBe(false);
    expect(f.backend.start).not.toHaveBeenCalled(); expect(f.backend.incoming).not.toHaveBeenCalled();
  });
  it("uses baseline scopes after callback setup and requests transcript only as an explicit step-up", async () => {
    const f = fixture(callback);
    const anonymous = await f.rpc("list_calls");
    expect(anonymous.body.result.isError).toBe(true);
    expect(anonymous.headers["www-authenticate"]).toContain('scope="calls:read offline_access"');
    expect(anonymous.body.result._meta["mcp/www_authenticate"][0]).not.toContain("calls:transcript");
    const base = await f.token("alice", ["calls:read", "offline_access"]);
    const count = (await f.store.list("alice")).length;
    const noTranscript = await f.rpc("get_call", { id: "alice-record" }, base.value);
    expect(noTranscript.body.result.structuredContent).not.toHaveProperty("transcript");
    vi.mocked(f.backend.call).mockClear();
    const stepUp = await f.rpc("get_call", { id: "alice-record", includeTranscript: true }, base.value);
    expect(stepUp.body.result.isError).toBe(true);
    expect(stepUp.headers["www-authenticate"]).toContain(
      'scope="calls:read offline_access calls:transcript"');
    expect(stepUp.body.result._meta["mcp/www_authenticate"]).toEqual([stepUp.headers["www-authenticate"]]);
    expect(f.backend.call).not.toHaveBeenCalled();
    expect((await f.store.list("alice")).length).toBe(count);
    expect(f.credentials.read(base.value, "access").scopes).not.toContain("calls:transcript");
    // Only a separately authorized upgrade allows the requested transcript.
    const upgraded = await f.token("alice", ["calls:read", "offline_access", "calls:transcript"]);
    expect((await f.rpc("get_call", { id: "alice-record", includeTranscript: true }, upgraded.value))
      .body.result.structuredContent.transcript).toBe("Synthetic transcript");
    // Upgrading never changes the base connection or another owner's scope.
    expect((await f.rpc("get_call", { id: "alice-record", includeTranscript: true }, base.value))
      .body.result.isError).toBe(true);
  });
  it("supports provided public-client OAuth with S256/resource/issuer and rejects replay", async () => {
    const f = fixture(callback);
    await f.token("alice", ["calls:read", "offline_access"]);
    const verifier = "v".repeat(43);
    const query = { response_type: "code", client_id: f.config.clientId, redirect_uri: callback,
      resource: `${MCP_RELEASE_ORIGIN}/api/chatgpt/mcp`, scope: "calls:read offline_access",
      state: "synthetic-state-long-enough", code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url") };
    for (const change of [{ resource: "https://evil.test/mcp" }, { code_challenge_method: "plain" },
      { redirect_uri: "https://chatgpt.com/aip/g-test/oauth/callback" }, { client_id: "foreign-client" }]) {
      expect((await request(f.app).get("/api/chatgpt/oauth/authorize").set("x-test-owner", "alice")
        .query({ ...query, ...change })).status).toBe(400);
    }
    const redirect = await request(f.app).get("/api/chatgpt/oauth/authorize").set("x-test-owner", "alice").query(query);
    const target = new URL(redirect.headers.location);
    expect(target.searchParams.get("iss")).toBe(MCP_RELEASE_ORIGIN);
    expect(target.searchParams.get("state")).toBe(query.state);
    const exchange = { grant_type: "authorization_code", client_id: f.config.clientId,
      resource: query.resource, redirect_uri: callback, code: target.searchParams.get("code"),
      code_verifier: verifier };
    expect((await request(f.app).post("/api/chatgpt/oauth/token").type("form")
      .send({ ...exchange, resource: "https://evil.test/mcp" })).status).toBe(400);
    const tokens = await request(f.app).post("/api/chatgpt/oauth/token").type("form").send(exchange);
    expect(tokens.status).toBe(200);
    expect(f.credentials.read(tokens.body.access_token, "access").scopes).toEqual(["calls:read", "offline_access"]);
    expect((await f.rpc("get_profile", {}, tokens.body.access_token)).body.result.structuredContent.id).toBe("alice");
    expect((await request(f.app).post("/api/chatgpt/oauth/token").type("form").send(exchange)).status).toBe(400);
    const denied = await request(f.app).get("/api/chatgpt/oauth/authorize").set("x-test-owner", "unconsented").query(query);
    expect(new URL(denied.headers.location).searchParams.get("iss")).toBe(MCP_RELEASE_ORIGIN);
    expect(new URL(denied.headers.location).searchParams.get("error")).toBe("access_denied");
  });
});

describe("production build/static regressions", () => {
  it("never returns SPA HTML for missing OAuth discovery, without changing normal fallback", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const app = express();
    app.use((_req, res, next) => {
      res.sendFile = (() => { res.type("html").send("SPA fixture"); return res; }) as any;
      next();
    });
    serveStatic(app);
    for (const path of ["/.well-known/oauth-authorization-server?probe=1",
      "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/chatgpt/mcp"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404); expect(res.type).toBe("application/json");
    }
    expect((await request(app).get("/some-client-route")).text).toBe("SPA fixture");
  });
  it("rejects stale/stripped production artifacts, rather than trusting source-file presence", () => {
    expect(() => verifyMcpBuild({ outputs: {} } as any, "")).toThrow("MCP build gate");
    const files = ["server/routes.ts", "server/chatgpt/routes.ts", "server/chatgpt/releaseConfig.ts",
      "server/chatgpt/security.ts", "server/chatgpt/browser.ts", "server/chatgpt/store.ts", "server/chatgpt/secretary.ts"];
    const meta = { outputs: { bundle: { inputs: Object.fromEntries(files.map(f => [f, { bytesInOutput: 1 }])) } } } as any;
    expect(() => verifyMcpBuild(meta, "old bundle without MCP routes")).toThrow("missing public contract");
    expect(verifyMcpBuild(meta, "/api/chatgpt/mcp /.well-known/oauth-protected-resource /.well-known/oauth-authorization-server talkhint-chatgpt").passed).toBe(true);
  });
});
