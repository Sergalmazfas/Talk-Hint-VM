import express from "express";
import request from "supertest";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerChatGPTIntegration, type IntegrationConfig } from "./routes";
import { Credentials, fail, grantId, grantScopes, markerId, type Scope } from "./security";
import { testMarkerStore } from "./testSupport";
import { publishSecretaryFeedEvent } from "../secretary/feed";
import { selectCallTurns } from "./turns";

// No native auth, DB, providers, real phone numbers or credentials.
const config: IntegrationConfig = {
  enabled: true, origin: "https://example.test", clientId: "fixture-public-client",
  redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
  signingKey: () => "isolated-monitor-fixture-signing-key", outboundEnabled: true,
};
const credentials = new Credentials(config.signingKey, `${config.origin}/api/chatgpt/mcp`);
let app: ReturnType<typeof express>, store: ReturnType<typeof testMarkerStore>, backend: any;
let server: Server | undefined, local: string, state: string;
const stops: AbortController[] = [];
const turns = [{ id: "turn-one", role: "guest", text: "We open at nine.", translation: "Мы открываемся в девять.", language: "ru" },
  { id: "turn-two", role: "secretary", text: "Thank you." }];
async function connect(owner = "alice", scopes: Scope[] = ["calls:read", "calls:listen", "calls:transcript", "offline_access"]) {
  const grant = grantId(config.clientId, scopes);
  await store.put({ id: grant, userId: owner, expiresAt: new Date(Date.now() + 600_000) });
  return { grant, token: credentials.issue({ type: "access", sub: owner, grant,
    client: config.clientId, scopes, exp: Date.now() + 120_000 }) };
}
async function tool(name: string, args: object, token: string) {
  return request(app).post("/api/chatgpt/mcp").auth(token, { type: "bearer" })
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}
async function ticket(token: string) {
  const response = await tool("open_call_monitor", { id: "task-alice" }, token);
  expect(response.body.result.isError).toBe(false);
  return response.body.result;
}
async function listen(token: string) {
  if (!server) {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    local = `http://127.0.0.1:${(server.address() as any).port}`;
  }
  const stop = new AbortController(); stops.push(stop);
  const response = await fetch(`${local}/api/chatgpt/monitor`, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, Origin: "https://web-sandbox.oaiusercontent.com",
      "Content-Type": "application/json" }, body: "{}", signal: stop.signal });
  return { response, stop };
}
function events(response: globalThis.Response) {
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const queue: any[] = [];
  return async (type: string) => {
    for (;;) {
      const found = queue.findIndex(e => e.type === type);
      if (found >= 0) return queue.splice(found, 1)[0];
      const data = await reader.read();
      if (data.done) throw new Error("Fixture stream ended before event " + type);
      buffer += decoder.decode(data.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (frame.startsWith("data: ")) queue.push(JSON.parse(frame.slice(6)));
      }
    }
  };
}
beforeEach(() => {
  state = "connected"; store = testMarkerStore();
  backend = { history: vi.fn(), call: vi.fn(), tasks: vi.fn(), incoming: vi.fn(), start: vi.fn(),
    task: vi.fn(async (owner: string, id: string, transcript: boolean) => {
      if (owner !== "alice" || id !== "task-alice") return fail(404, "Task not found");
      return { id, status: state, summary: state === "completed" ? "Hours confirmed" : null,
        ...(transcript ? { transcriptTurns: turns, transcript: "fixture" } : {}) };
    }) };
  app = express(); app.use(express.json());
  registerChatGPTIntegration(app, config, store, backend, (_q, r) => { r.sendStatus(401); });
});
afterEach(async () => {
  stops.splice(0).forEach(s => s.abort());
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  }
  vi.useRealTimers();
});
describe("owner-only ChatGPT live monitoring; native telephony untouched", () => {
  it("requests one combined explicit audio/transcript upgrade, not a new login per call", async () => {
    const { token } = await connect("alice", ["calls:read", "offline_access"]);
    const r = await tool("open_call_monitor", { id: "task-alice" }, token);
    expect(r.body.result.isError).toBe(true);
    const challenge = r.body.result._meta["mcp/www_authenticate"][0];
    expect(challenge).toContain('scope="calls:read offline_access calls:listen calls:transcript"');
    expect(challenge).toContain("insufficient_scope");
    expect(backend.task).not.toHaveBeenCalled();
    const allowed = await connect();
    expect((await ticket(allowed.token))._meta["talkhint/monitor"].task_id).toBe("task-alice");
    expect((await ticket(allowed.token)).isError).toBe(false);
    const caller = await connect("alice", ["calls:read", "offline_access", "secretary:start"]);
    const upgrade = (await tool("open_call_monitor", { id: "task-alice" }, caller.token)).body.result;
    expect(upgrade._meta["mcp/www_authenticate"][0])
      .toContain('scope="calls:read offline_access secretary:start calls:listen calls:transcript"');
  });
  it("reissues the same-task result and monitor only to the current owner after logout or account change", async () => {
    const alice = await connect();
    const oldTicket = (await ticket(alice.token))._meta["talkhint/monitor"].token;
    const tools = (await request(app).post("/api/chatgpt/mcp").send({
      jsonrpc: "2.0", id: 1, method: "tools/list",
    })).body.result.tools;
    const metadata = tools.find((t: any) => t.name === "get_task")._meta;
    expect(metadata.ui.resourceUri).toBe(metadata["openai/outputTemplate"]);
    expect(metadata.ui.resourceUri).toContain("/v4.html");
    await store.expire(alice.grant, "alice");
    for (const name of ["get_task", "open_call_monitor"]) {
      expect((await tool(name, { id: "task-alice" }, alice.token)).body.result.isError).toBe(true);
    }
    expect((await request(app).post("/api/chatgpt/monitor").auth(oldTicket, { type: "bearer" }).send({})).status).toBe(401);
    const bob = await connect("bob");
    for (const name of ["get_task", "open_call_monitor"]) {
      const denied = (await tool(name, { id: "task-alice" }, bob.token)).body.result;
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toBeUndefined();
      expect(denied._meta?.["talkhint/task"]).toBeUndefined();
      expect(denied._meta?.["talkhint/monitor"]).toBeUndefined();
    }
    const reconnected = await connect("alice");
    state = "completed";
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = (await tool("get_task", { id: "task-alice" }, reconnected.token)).body.result;
      expect(result.structuredContent).toMatchObject({ id: "task-alice", status: "completed", summary: "Hours confirmed" });
      expect(result.structuredContent.transcriptTurns).toBeUndefined();
      expect(result._meta["talkhint/task"].fallbackUrl).toBe("https://example.test/api/chatgpt/secretary/tasks/task-alice");
    }
    const freshTicket = (await ticket(reconnected.token))._meta["talkhint/monitor"].token;
    expect(credentials.read(freshTicket, "monitor").grant).toBe(reconnected.grant);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("isolates owners and keeps short-lived tickets out of the model-visible result", async () => {
    const alice = await connect(), bob = await connect("bob");
    expect((await tool("open_call_monitor", { id: "task-alice" }, bob.token)).body.result.isError).toBe(true);
    const result = await ticket(alice.token), hidden = result._meta["talkhint/monitor"];
    expect(JSON.stringify([result.content, result.structuredContent])).not.toContain(hidden.token);
    expect(hidden.url).not.toContain("?");
    expect(credentials.read(hidden.token, "monitor")).toMatchObject({ sub: "alice", taskId: "task-alice" });
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("rejects missing credentials, general OAuth tokens, task selectors, hostile hosts and expired/revoked tickets", async () => {
    expect((await request(app).post("/api/chatgpt/monitor").send({})).status).toBe(401);
    const { token, grant } = await connect();
    expect((await request(app).post("/api/chatgpt/monitor").auth(token, { type: "bearer" }).send({})).status).toBe(401);
    const cap = (await ticket(token))._meta["talkhint/monitor"].token;
    expect((await request(app).post("/api/chatgpt/monitor").auth(cap, { type: "bearer" }).send({ id: "other" })).status).toBe(400);
    expect((await request(app).post("/api/chatgpt/monitor?token=forbidden").auth(cap, { type: "bearer" }).send({})).status).toBe(400);
    expect((await request(app).post("/api/chatgpt/monitor").set("Origin", "https://evil.test").auth(cap, { type: "bearer" }).send({})).status).toBe(403);
    expect((await request(app).post("/api/chatgpt/monitor").set("Origin", "https://web-sandbox.oaiusercontent.com.evil.test").auth(cap, { type: "bearer" }).send({})).status).toBe(403);
    const claims = credentials.read(cap, "monitor");
    const expired = credentials.issue({ ...claims, exp: Date.now() - 1 });
    expect((await request(app).post("/api/chatgpt/monitor").auth(expired, { type: "bearer" }).send({})).status).toBe(401);
    await store.expire(grant, "alice");
    expect((await request(app).post("/api/chatgpt/monitor").auth(cap, { type: "bearer" }).send({})).status).toBe(401);
  });
  it("only permits CORS on the isolated bearer monitor, not on consent or other data mutations", async () => {
    const origin = "https://widget.web-sandbox.oaiusercontent.com";
    const preflight = await request(app).options("/api/chatgpt/monitor").set("Origin", origin);
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
    expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
    expect((await request(app).options("/api/chatgpt/monitor").set("Origin", "null")).status).toBe(403);
    expect((await request(app).post("/api/chatgpt/browser/consent").set("Origin", origin).send({})).status).toBe(403);
  });
  it("streams both audio roles, text and Russian translation, resumes durable text after disconnect, never dials", async () => {
    const { token } = await connect();
    const hidden = (await ticket(token))._meta["talkhint/monitor"];
    const first = await listen(hidden.token), next = events(first.response);
    expect(first.response.status).toBe(200);
    expect((await next("snapshot")).task.transcriptTurns[0].translation).toBe("Мы открываемся в девять.");
    // Another task's event is never visible to this subscriber.
    publishSecretaryFeedEvent("task-bob", { type: "turn", turnId: "foreign", role: "guest", text: "not yours" });
    for (const role of ["guest", "secretary"] as const) {
      publishSecretaryFeedEvent("task-alice", { type: "audio", role, payload: "/w==" });
      expect((await next("audio")).role).toBe(role);
    }
    publishSecretaryFeedEvent("task-alice", { type: "turn", turnId: "three", role: "guest", text: "Live words" });
    expect((await next("turn")).turnId).toBe("three");
    publishSecretaryFeedEvent("task-alice", { type: "subtitle", turnId: "three", translation: "Живые реплики", language: "ru" });
    expect((await next("subtitle")).language).toBe("ru");
    state = "finalizing";
    publishSecretaryFeedEvent("task-alice", { type: "status", status: "finalizing" });
    expect((await next("status")).status).toBe("finalizing");
    first.stop.abort();
    const secondCap = (await ticket(token))._meta["talkhint/monitor"];
    const second = await listen(secondCap.token);
    expect((await events(second.response)("snapshot")).task.id).toBe("task-alice");
    expect(backend.start).not.toHaveBeenCalled();
  }, 10000);
  it("expires only the short listening ticket, not the call; same-task reconnection remains possible", async () => {
    const { token } = await connect();
    const cap = (await ticket(token))._meta["talkhint/monitor"];
    const claims = credentials.read(cap.token, "monitor");
    const short = credentials.issue({ ...claims, exp: Date.now() + 800 });
    const stream = await listen(short), next = events(stream.response);
    expect((await next("snapshot")).task.status).toBe("connected");
    expect((await next("ended")).reason).toBe("expired");
    const fresh = (await ticket(token))._meta["talkhint/monitor"];
    const resumed = await listen(fresh.token);
    expect((await events(resumed.response)("snapshot")).task.id).toBe("task-alice");
    expect(backend.start).not.toHaveBeenCalled();
  }, 10000);
  it("refreshes an existing authorized connection without dropping call/listen/transcript rights", async () => {
    const scopes: Scope[] = ["calls:read", "secretary:start", "calls:listen", "calls:transcript", "offline_access"];
    const { grant } = await connect("alice", scopes);
    const refresh = credentials.issue({ type: "refresh", sub: "alice", grant,
      client: config.clientId, scopes, exp: Date.now() + 120_000 });
    await store.put({ id: markerId(refresh), userId: "alice", expiresAt: new Date(Date.now() + 120_000) });
    const exchanged = await request(app).post("/api/chatgpt/oauth/token").type("form").send({
      grant_type: "refresh_token", client_id: config.clientId,
      resource: credentials.resource, refresh_token: refresh,
    });
    expect(exchanged.status).toBe(200);
    expect(new Set(exchanged.body.scope.split(" "))).toEqual(new Set(scopes));
    expect((await ticket(exchanged.body.access_token)).isError).toBe(false);
    const preview = await tool("prepare_call", { phoneNumber: "+12025550123",
      instruction: "Fixture only", clientRequestId: "11111111-1111-4111-8111-111111111111" },
    exchanged.body.access_token);
    expect(preview.body.result.isError).toBe(false);
    expect(backend.start).not.toHaveBeenCalled();
  });
  it("closes live access after revocation and publishes the durable final result without retrying a call", async () => {
    const { token, grant } = await connect();
    const cap = (await ticket(token))._meta["talkhint/monitor"];
    const stream = await listen(cap.token), next = events(stream.response);
    await next("snapshot");
    await store.expire(grant, "alice");
    expect((await next("ended")).reason).toBe("revoked");
    const fresh = await connect();
    state = "completed";
    const doneCap = (await ticket(fresh.token))._meta["talkhint/monitor"];
    const done = await listen(doneCap.token), result = events(done.response);
    expect((await result("snapshot")).task.summary).toBe("Hours confirmed");
    expect((await result("ended")).reason).toBe("completed");
    expect(backend.start).not.toHaveBeenCalled();
  }, 10000);
  it("bounds concurrent monitors and revokes already issued capabilities when the task owner changes", async () => {
    const { token } = await connect();
    const cap = (await ticket(token))._meta["talkhint/monitor"];
    await listen(cap.token); await listen(cap.token);
    expect((await listen(cap.token)).response.status).toBe(429);
    backend.task.mockImplementation(() => fail(404, "Task not found"));
    expect((await request(app).post("/api/chatgpt/monitor").auth(cap.token, { type: "bearer" }).send({})).status).toBe(404);
  });
  it("gives ChatGPT text only on request with transcript permission and a bounded continuation cursor", async () => {
    const denied = await connect("alice", ["calls:read"]);
    expect((await tool("read_call_turns", { id: "task-alice" }, denied.token)).body.result.isError).toBe(true);
    const allowed = await connect(), bob = await connect("bob");
    const first = (await tool("read_call_turns", { id: "task-alice", limit: 1 }, allowed.token)).body.result.structuredContent;
    expect(first.turns[0].translation).toBe("Мы открываемся в девять.");
    expect(first.nextCursor).toBe("turn-one");
    expect(first.hasMore).toBe(true);
    const more = (await tool("read_call_turns", { id: "task-alice", afterTurnId: first.nextCursor }, allowed.token)).body.result.structuredContent;
    expect(more.turns.map((t: any) => t.id)).toEqual(["turn-two"]);
    expect((await tool("read_call_turns", { id: "task-alice" }, bob.token)).body.result.isError).toBe(true);
    expect(JSON.stringify(more)).not.toContain("payload");
    expect(selectCallTurns({ id: "task", status: "connected", transcriptTurns: turns }, "missing").resetRequired).toBe(true);
  });
  it("preserves existing persisted grant masks when adding the independent listening permission", () => {
    expect(grantScopes(`chatgpt:grant:old:11011:fixture`)).toEqual([
      "calls:read", "calls:transcript", "secretary:start", "offline_access",
    ]);
    expect(grantScopes(`chatgpt:grant:old:11011:fixture`)).not.toContain("calls:listen");
  });
});
