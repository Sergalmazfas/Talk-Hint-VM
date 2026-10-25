import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerChatGPTIntegration, type IntegrationConfig } from "./routes";
import { Credentials, grantId, type Scope } from "./security";
import { testMarkerStore } from "./testSupport";
import { CALL_APPROVAL_RESOURCE } from "./callApprovalWidget";
import { LEGACY_CALL_APPROVAL_RESOURCES, hostUiSupport, uiResourceLabel } from "./uiResources";

vi.mock("../auth", () => ({ authMiddleware: (_req: any, res: any) => res.sendStatus(401) }));
const config: IntegrationConfig = {
  enabled: true, origin: "https://example.test", clientId: "talkhint-chatgpt",
  redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
  signingKey: () => "isolated-card-fixture-key-not-a-production-secret",
  outboundEnabled: true,
};
const credentials = new Credentials(config.signingKey, `${config.origin}/api/chatgpt/mcp`);
const input = {
  phoneNumber: "+12025550123", instruction: "Ask for opening hours",
  clientRequestId: "11111111-1111-4111-8111-111111111111",
  voiceProvider: "elevenlabs", translationLanguage: "ru",
};
let app: ReturnType<typeof express>;
let store: ReturnType<typeof testMarkerStore>;
let backend: any;
const ownerAuth = (_req: any, res: any) => res.sendStatus(401);
async function connect(owner = "alice", scopes: Scope[] = ["calls:read", "secretary:start", "offline_access"]) {
  const grant = grantId(config.clientId, scopes);
  await store.put({ id: grant, userId: owner, expiresAt: new Date(Date.now() + 3600_000) });
  return { grant, token: credentials.issue({
    type: "access", sub: owner, grant, client: config.clientId, scopes, exp: Date.now() + 600_000,
  }) };
}
function rpc(method: string, params: object = {}, token?: string) {
  const req = request(app).post("/api/chatgpt/mcp");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send({ jsonrpc: "2.0", id: 1, method, params });
}
async function tool(name: string, args: object, token?: string) {
  return (await rpc("tools/call", { name, arguments: args }, token)).body.result;
}
async function prepare(token: string, extra = {}) {
  const result = await tool("prepare_call", { ...input, ...extra }, token);
  expect(result.isError).toBe(false);
  return result;
}
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external network in card tests"); }));
  store = testMarkerStore();
  backend = {
    history: vi.fn().mockResolvedValue([]), call: vi.fn(), tasks: vi.fn().mockResolvedValue([]),
    task: vi.fn().mockResolvedValue({ id: "mock-task-1", status: "completed", summary: "Open at nine" }),
    incoming: vi.fn(), start: vi.fn().mockResolvedValue({
      task: { id: "mock-task-1", status: "starting" }, reused: false,
    }),
  };
  app = express();
  app.use(express.json());
  registerChatGPTIntegration(app, config, store, backend, ownerAuth);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("owner decision inside ChatGPT; no external confirmation site", () => {
  it("advertises a self-contained resource and app-only consequential tool", async () => {
    const initialized = await rpc("initialize");
    expect(initialized.body.result.capabilities.resources).toEqual({});
    expect(initialized.body.result.serverInfo.version).toBe("1.7.0");
    const catalog = (await rpc("tools/list")).body.result.tools;
    const preview = catalog.find((t: any) => t.name === "prepare_call");
    expect(preview.inputSchema.properties.voiceProvider).toMatchObject({
      enum: ["openai", "retell"],
    });
    expect(preview._meta.ui.resourceUri).toBe(CALL_APPROVAL_RESOURCE);
    const approval = catalog.find((t: any) => t.name === "confirm_call_from_card");
    expect(approval._meta.ui.visibility).toEqual(["app"]);
    expect(approval._meta["openai/visibility"]).toBe("private");
    expect(approval.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    const resource = (await rpc("resources/read", { uri: CALL_APPROVAL_RESOURCE })).body.result.contents[0];
    expect(resource.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource.text).toContain("Подтвердить и позвонить");
    expect(resource._meta.ui.csp).toEqual({ connectDomains: [config.origin], resourceDomains: [] });
    expect(resource._meta["openai/widgetCSP"].redirect_domains).toEqual([config.origin]);
    expect((await rpc("resources/read", { uri: "file:///etc/passwd" })).status).toBe(404);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("keeps cached installed-plugin resource URIs working without new OAuth or a new draft", async () => {
    const current = (await rpc("resources/read", { uri: CALL_APPROVAL_RESOURCE })).body.result.contents[0];
    for (const uri of LEGACY_CALL_APPROVAL_RESOURCES) {
      const reply = await rpc("resources/read", { uri });
      expect(reply.status).toBe(200);
      expect(reply.body.result.contents[0]).toMatchObject({
        uri, mimeType: current.mimeType, text: current.text,
      });
      expect(reply.body.result.contents[0].text).toContain("Подтвердить и позвонить");
    }
    expect((await rpc("resources/templates/list")).body.result.resourceTemplates).toEqual([]);
    const readiness = await request(app).get("/api/chatgpt/readiness");
    expect(readiness.body.ui.compatibleResourceUris).toEqual([...LEGACY_CALL_APPROVAL_RESOURCES]);
    expect(readiness.body.clientId).toBe(config.clientId);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("never resolves arbitrary resources or logs input-derived secrets in diagnostic labels", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      for (const uri of ["file:///etc/passwd", "https://attacker.test", "ui://talkhint/call-approval/v99.html",
        "ui://talkhint/call-approval/v3.html?token=must-not-appear"]) {
        expect((await rpc("resources/read", { uri })).status).toBe(404);
        expect(uiResourceLabel(uri)).toBe("unknown");
      }
      await rpc("initialize", { clientInfo: { name: "must-not-appear" }, capabilities: {
        extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
      } });
      expect(JSON.stringify(log.mock.calls)).not.toContain("must-not-appear");
      expect(log.mock.calls.some(([line]) => String(line).includes("ui=advertised"))).toBe(true);
      expect(hostUiSupport({ capabilities: {} })).toBe("not-advertised");
    } finally { log.mockRestore(); }
  });
  it("keeps the capability only in widget metadata and binds the recipient label", async () => {
    const { token } = await connect();
    const result = await prepare(token, { recipient: "Reception" });
    expect(result.structuredContent.call.recipient).toBe("Reception");
    expect(result.structuredContent.confirmationMethod).toBe("inline_card");
    expect(result.structuredContent).not.toHaveProperty("approval_url");
    expect(result.structuredContent).not.toHaveProperty("fallbackUrl");
    const cap = result._meta["talkhint/cardApproval"];
    expect(cap.call.recipient).toBe("Reception");
    expect(JSON.stringify([result.structuredContent, result.content])).not.toContain(cap.approvalToken);
    expect(result.structuredContent).not.toHaveProperty("approvalToken");
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("defaults to native OpenAI and reports the actual model/voice without clone identifiers", async () => {
    const { token } = await connect();
    const { voiceProvider: _ignored, ...draft } = input;
    const result = await tool("prepare_call", draft, token);
    expect(result.isError).toBe(false);
    expect(result.structuredContent.call.voiceProvider).toBe("openai");
    expect(result.structuredContent.execution).toEqual({
      provider: "openai", model: "gpt-live-1", voice: "marin", mode: "native_audio",reasoningModel:"gpt-6.1-sol",
    });
    expect(result.content[0].text).toContain("gpt-live-1");
    expect(result.content[0].text).not.toContain("fallback link");
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("one explicit click starts exactly the signed native parameters; status/result stay readable", async () => {
    const { token } = await connect();
    const result = await prepare(token, { recipient: "Reception" });
    const { confirmation, approvalToken } = result._meta["talkhint/cardApproval"];
    expect((await tool("start_call", { confirmation }, token)).isError).toBe(true);
    expect((await tool("start_call", { confirmation, confirmed: true }, token)).isError).toBe(true);
    expect(backend.start).not.toHaveBeenCalled();
    const start = await tool("confirm_call_from_card", { confirmation, approvalToken, decision: "approve" }, token);
    expect(start.isError).toBe(false);
    expect(start.structuredContent).toMatchObject({ task_id: "mock-task-1", asynchronous: true });
    expect(backend.start).toHaveBeenCalledExactlyOnceWith("alice", input);
    const outcome = await tool("get_task", { id: "mock-task-1" }, token);
    expect(outcome.structuredContent).toMatchObject({ status: "completed", summary: "Open at nine" });
    expect(backend.task).toHaveBeenCalledWith("alice", "mock-task-1", false);
  });
  it("does not accept model-visible confirmation as the hidden capability, chat yes, or altered parameters", async () => {
    const { token } = await connect();
    const result = await prepare(token);
    const cap = result._meta["talkhint/cardApproval"];
    for (const args of [
      { confirmation: cap.confirmation, approvalToken: cap.confirmation, decision: "approve" },
      { confirmation: cap.confirmation, confirmed: true },
      { confirmation: cap.confirmation, approvalToken: cap.approvalToken, decision: "approve", phoneNumber: "+12025550999" },
    ]) expect((await tool("confirm_call_from_card", args, token)).isError).toBe(true);
    const second = await prepare(token, { instruction: "A different goal" });
    expect((await tool("confirm_call_from_card", {
      confirmation: second.structuredContent.confirmation, approvalToken: cap.approvalToken, decision: "approve",
    }, token)).isError).toBe(true);
    expect(backend.start).not.toHaveBeenCalled();
    expect((await request(app).post("/api/chatgpt/tools/confirm_call_from_card")
      .set("Authorization", `Bearer ${token}`).send({ ...cap, decision: "approve" })).status).toBe(404);
  });
  it("denial prevents a later launch or approval using the same card", async () => {
    const { token } = await connect();
    const cap = (await prepare(token))._meta["talkhint/cardApproval"];
    const { call, ...args } = cap;
    expect((await tool("confirm_call_from_card", { ...args, decision: "deny" }, token)).structuredContent.status).toBe("denied");
    expect((await tool("confirm_call_from_card", { ...args, decision: "approve" }, token)).isError).toBe(true);
    expect((await tool("start_call", { confirmation: cap.confirmation }, token)).isError).toBe(true);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("allows a new card with the same request key after a pre-start 403, without bypassing owner review", async () => {
    const { token } = await connect();
    const first = (await prepare(token))._meta["talkhint/cardApproval"];
    const other = (await prepare(token, { instruction: "A different goal" }))._meta["talkhint/cardApproval"];
    const rejected = await tool("confirm_call_from_card", {
      confirmation: first.confirmation, approvalToken: other.approvalToken, decision: "approve",
    }, token);
    expect(rejected.structuredContent).toMatchObject({
      code: "CALL_APPROVAL_REJECTED", requestNotStarted: true,
    });
    expect(backend.start).not.toHaveBeenCalled();
    const fresh = (await prepare(token))._meta["talkhint/cardApproval"];
    expect(fresh.call.clientRequestId).toBe(input.clientRequestId);
    expect(backend.start).not.toHaveBeenCalled();
    const approved = await tool("confirm_call_from_card", {
      confirmation: fresh.confirmation, approvalToken: fresh.approvalToken, decision: "approve",
    }, token);
    expect(approved.structuredContent.task_id).toBe("mock-task-1");
    expect(backend.start).toHaveBeenCalledExactlyOnceWith("alice", input);
  });
  it("does not advertise safe re-preparation after a 403 from the call backend itself", async () => {
    const { token } = await connect();
    const { call, ...cap } = (await prepare(token))._meta["talkhint/cardApproval"];
    backend.start.mockRejectedValueOnce(Object.assign(new Error("Backend refused"), { status: 403 }));
    const result = await tool("confirm_call_from_card", { ...cap, decision: "approve" }, token);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(backend.start).toHaveBeenCalledTimes(1);
  });
  it("rejects missing OAuth, wrong owner/grant, read-only scope and revoked grants", async () => {
    const alice = await connect();
    const cap = (await prepare(alice.token))._meta["talkhint/cardApproval"];
    const args = { confirmation: cap.confirmation, approvalToken: cap.approvalToken, decision: "approve" };
    const bob = await connect("bob");
    const another = await connect();
    const readOnly = await connect("alice", ["calls:read"]);
    for (const token of [undefined, bob.token, another.token, readOnly.token]) {
      expect((await tool("confirm_call_from_card", args, token)).isError).toBe(true);
    }
    await store.expire(alice.grant, "alice");
    expect((await tool("confirm_call_from_card", args, alice.token)).isError).toBe(true);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("rejects expired cards after the access token is refreshed", async () => {
    const { token } = await connect();
    const cap = (await prepare(token))._meta["talkhint/cardApproval"];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 601_000);
    const old = credentials.read.bind(credentials);
    // Independently issue a fresh access credential for the same still-active grant.
    vi.setSystemTime(Date.now() - 601_000);
    const claims = old(token, "access");
    vi.setSystemTime(Date.now() + 601_000);
    const refreshed = credentials.issue({ ...claims, exp: Date.now() + 600_000 });
    expect((await tool("confirm_call_from_card", {
      confirmation: cap.confirmation, approvalToken: cap.approvalToken, decision: "approve",
    }, refreshed)).isError).toBe(true);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("preserves origin protections even with a valid UI capability", async () => {
    const { token } = await connect();
    const { call, ...cap } = (await prepare(token))._meta["talkhint/cardApproval"];
    const r = await request(app).post("/api/chatgpt/mcp").set("Origin", "https://attacker.test")
      .set("Authorization", `Bearer ${token}`).send({ jsonrpc: "2.0", id: 1,
        method: "tools/call", params: { name: "confirm_call_from_card", arguments: { ...cap, decision: "approve" } } });
    expect(r.status).toBe(403);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("does not expose resources or UI approval in the read-only deployment profile", async () => {
    const readonly = express();
    readonly.use(express.json());
    registerChatGPTIntegration(readonly, { ...config, outboundEnabled: false }, store, backend, ownerAuth);
    const r = await request(readonly).post("/api/chatgpt/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.body.result.tools.map((t: any) => t.name)).not.toContain("confirm_call_from_card");
    expect(backend.start).not.toHaveBeenCalled();
  });
});
