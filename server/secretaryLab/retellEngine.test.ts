import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { SecretaryConversationEngine, type EngineStream } from "../secretary/conversationEngine";
import { RetellEngineApi, RetellEngineRegistry, RETELL_ENGINE_AGENT, engineCallbackBase } from "./retellEngine";
import { RetellSecretaryLab, type RetellLabProfile } from "./retell";
import { SECRETARY_TEST_CONTEXT } from "./testContext";
import { randomUUID } from "node:crypto";
const wait = () => new Promise<void>(resolve => setImmediate(resolve));
const turn = [{ role: "user" as const, content: "Hello, please take a message" }];
const done = { type: "complete" as const, output: [], tools: [] };
const registryList: RetellEngineRegistry[] = [];
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  sent: any[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close = vi.fn(() => { this.readyState = 3; this.emit("close"); });
  frame(frame: object) { this.emit("message", Buffer.from(JSON.stringify(frame)), false); }
}
function fixture(stream: EngineStream) {
  const registry = new RetellEngineRegistry(stream); registryList.push(registry);
  const r = registry.reserve("owner", "Take a message and verify details", "test-session");
  registry.registered("test-session", "web_call_1");
  const path = `/retell-engine-stream/${r.ticket}/web_call_1`;
  const ws = new Socket(); registry.attach(ws as any, path);
  return { registry, path, ws, r };
}
afterEach(() => { registryList.splice(0).forEach(r => r.dispose()); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("TalkHint text Engine, independent of voice provider", () => {
  it("uses core Secretary identity/rules, same fixture, OpenAI model and an explicit sandbox tool allowlist", async () => {
    const seen: any[] = [];
    const stream: EngineStream = async function* (r) { seen.push(r); yield { type: "text", text: "Здравствуйте." }; yield done; };
    const e = new SecretaryConversationEngine("owner", "Arrange a meeting", stream);
    const text: string[] = [];
    await e.respond(turn, new AbortController().signal, t => text.push(t));
    expect(text).toEqual(["Здравствуйте."]);
    expect(e.report.model).toBe("gpt-6.1-sol");
    expect(seen[0].instructions).toContain("Arrange a meeting");
    expect(seen[0].instructions).toContain("server-confirmed identity");
    expect(seen[0].instructions).toContain(JSON.stringify(SECRETARY_TEST_CONTEXT));
    expect(e.report.testOnly).toBe(true);
  });
  it("executes a sandbox tool and streams a tool-grounded response without production APIs", async () => {
    let count = 0;
    const stream: EngineStream = async function* (r) {
      count++;
      if (count === 1) {
        const t = { type: "function_call", call_id: "tool1", name: "save_test_message", arguments: '{"sender":"Test guest","message":"Meet tomorrow at eight"}' };
        yield { type: "complete", output: [t], tools: [t] };
      } else {
        expect(r.input.at(-1).type).toBe("function_call_output");
        expect(JSON.parse(r.input.at(-1).output)).toMatchObject({ ok: true, testOnly: true, delivered: false });
        yield { type: "text", text: "Тестовое сообщение сохранено, но не отправлено." }; yield done;
      }
    };
    const e = new SecretaryConversationEngine("owner", "Collect a message", stream);
    const result: string[] = []; await e.respond(turn, new AbortController().signal, t => result.push(t));
    expect(result.join("")).toContain("сохранено");
    expect(e.report.actions).toHaveLength(1);
    expect(e.report.actions[0].result.calendarWritten).toBe(false);
  });
  it("deduplicates actions across response ids and reconnects; changed arguments remain distinct", () => {
    const e = new SecretaryConversationEngine("owner", "Take a message");
    const signal = new AbortController().signal;
    const a = e.execute("save_test_message", '{"message":"Hello","sender":"A"}', signal);
    const b = e.execute("save_test_message", '{"sender":"A","message":"Hello"}', signal);
    expect(a).toEqual(b); expect(e.report.actions).toHaveLength(1);
    e.execute("save_test_message", '{"sender":"A","message":"Corrected"}', signal);
    expect(e.report.actions).toHaveLength(2);
  });
  it("enforces permissions, parameter schema, known slots and pending owner approval", () => {
    const e = new SecretaryConversationEngine("owner", "Prepare a test booking");
    const signal = new AbortController().signal;
    expect(() => e.execute("write_google_calendar", "{}", signal)).toThrow("not permitted");
    expect(() => e.execute("save_test_message", '{"sender":"A","message":"Hello","notify":true}', signal)).toThrow();
    const booking = e.execute("prepare_test_booking", JSON.stringify({ startsAt: SECRETARY_TEST_CONTEXT.availability[0], note: "Test" }), signal);
    expect(booking).toMatchObject({ status: "pending_owner_approval", calendarWritten: false });
    expect(e.execute("prepare_test_booking", '{"startsAt":"2026-01-01","note":"Test"}', signal).ok).toBe(false);
    const cancelled = new AbortController(); cancelled.abort();
    expect(() => e.execute("save_test_message", '{"sender":"A","message":"stale"}', cancelled.signal)).toThrow("Stale");
    expect(e.report.actions).toHaveLength(1);
  });
});
describe("Retell Custom LLM streaming, cancellation and lifecycle", () => {
  it("streams chunks before completion, speaks through Retell, and closes responses", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const f = fixture(async function* () {
      yield { type: "text", text: "Первая фраза." }; await gate;
      yield { type: "text", text: " Вторая фраза." }; yield done;
    });
    f.ws.frame({ interaction_type: "response_required", response_id: 1, transcript: turn });
    await wait();
    expect(f.ws.sent.filter(x => x.response_id === 1).map(x => x.content)).toEqual(["Первая фраза."]);
    release(); await wait();
    expect(f.ws.sent.filter(x => x.response_id === 1).map(x => x.content)).toEqual(["Первая фраза.", " Вторая фраза.", ""]);
    expect(f.ws.sent.at(-1).content_complete).toBe(true);
    expect(f.r.engine.connected).toBe(true);
  });
  it("aborts on barge-in, ignores late output/tools and accepts a later corrected turn", async () => {
    let release!: () => void, signal: AbortSignal | undefined, invocation = 0;
    const gate = new Promise<void>(r => { release = r; });
    const f = fixture(async function* (r) {
      invocation++; signal = r.signal;
      if (invocation === 1) {
        yield { type: "text", text: "Old." }; await gate;
        yield { type: "text", text: "Must never speak." };
        const tool = { call_id: "late", name: "save_test_message", arguments: '{"sender":"A","message":"obsolete"}' };
        yield { type: "complete", output: [], tools: [tool] };
      } else { yield { type: "text", text: "Corrected." }; yield done; }
    });
    f.ws.frame({ interaction_type: "response_required", response_id: 1, transcript: turn }); await wait();
    f.ws.frame({ interaction_type: "update_only", turntaking: "user_turn", transcript: turn });
    expect(signal?.aborted).toBe(true);
    release(); await wait();
    expect(f.r.engine.actions).toHaveLength(0);
    expect(JSON.stringify(f.ws.sent)).not.toContain("Must never speak");
    f.ws.frame({ interaction_type: "response_required", response_id: 2, transcript: [{ role: "user", content: "Correction" }] });
    await wait(); expect(JSON.stringify(f.ws.sent)).toContain("Corrected.");
  });
  it("new response IDs supersede old ones, replays never re-execute, and failures/timeout finish the turn", async () => {
    const failStream = vi.fn(async function* () { throw new Error("upstream"); yield done; });
    const f = fixture(failStream);
    f.ws.frame({ interaction_type: "response_required", response_id: 1, transcript: turn }); await wait();
    f.ws.frame({ interaction_type: "response_required", response_id: 1, transcript: turn }); await wait();
    expect(failStream).toHaveBeenCalledTimes(1);
    expect(f.ws.sent.at(-1)).toMatchObject({ response_id: 1, content_complete: true });
    expect(f.r.engine.events.some(e => e.type === "engine_error")).toBe(true);
  });
  it("cancels an unfinished response when a newer response arrives, not just on user_turn", async () => {
    const signals: AbortSignal[] = [];
    const f = fixture(async function* (r) {
      signals.push(r.signal);
      if (signals.length === 1) await new Promise<void>(resolve => r.signal.addEventListener("abort", () => resolve(), { once: true }));
      if (!r.signal.aborted) yield { type: "text", text: "Latest only" };
      yield done;
    });
    f.ws.frame({ interaction_type: "response_required", response_id: 1, transcript: turn }); await wait();
    f.ws.frame({ interaction_type: "response_required", response_id: 2, transcript: turn }); await wait();
    expect(signals[0].aborted).toBe(true);
    expect(f.ws.sent.filter(x => x.content === "Latest only").map(x => x.response_id)).toEqual([2]);
    expect(f.ws.sent.some(x => x.response_id === 1)).toBe(false);
  });
  it("bounds model silence and finalizes a timed-out response without selecting another model", async () => {
    vi.useFakeTimers();
    const f = fixture(async function* (r) {
      await new Promise<void>((_, reject) => r.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      yield done;
    });
    f.ws.frame({ interaction_type: "response_required", response_id: 1, transcript: turn });
    await vi.advanceTimersByTimeAsync(25_001);
    expect(f.r.engine.events.some(e => e.type === "engine_timeout")).toBe(true);
    expect(f.ws.sent.at(-1)).toMatchObject({ response_id: 1, content_complete: true });
  });
  it("supports keepalives, validates web identity and does not introduce itself again after reconnect", async () => {
    const stream = vi.fn(async function* () { yield { type: "text" as const, text: "Hello" }; yield done; });
    const f = fixture(stream);
    f.ws.frame({ interaction_type: "ping_pong", timestamp: 123 });
    expect(f.ws.sent.at(-1)).toEqual({ response_type: "ping_pong", timestamp: 123 });
    f.ws.frame({ interaction_type: "call_details", call: { call_id: "web_call_1", call_type: "web_call" } }); await wait();
    expect(stream).toHaveBeenCalledTimes(1);
    const second = new Socket(); f.registry.attach(second as any, f.path);
    expect(f.ws.close).toHaveBeenCalled();
    second.frame({ interaction_type: "call_details", call: { call_id: "web_call_1", call_type: "web_call" } }); await wait();
    expect(stream).toHaveBeenCalledTimes(1);
    second.frame({ interaction_type: "call_details", call: { call_id: "web_call_1", call_type: "phone_call" } });
    expect(second.close).toHaveBeenCalled();
  });
  it("stop aborts generation, invalidates capability, disconnects socket and prevents stale actions", async () => {
    let signal: AbortSignal | undefined;
    const f = fixture(async function* (r) { signal = r.signal; yield done; });
    f.ws.frame({ interaction_type: "response_required", response_id: 1, transcript: turn }); await wait();
    f.registry.ended("test-session");
    expect(signal?.aborted).toBe(true); expect(f.registry.permits(f.path)).toBe(false);
    expect(f.r.engine.connected).toBe(false); expect(f.ws.close).toHaveBeenCalled();
    expect(f.registry.permits(f.path.replace("web_call_1", "other_call"))).toBe(false);
  });
  it("uses a real websocket transport with capability admission and rejects cross-session calls", async () => {
    const registry = new RetellEngineRegistry(async function* () { yield { type: "text", text: "Live protocol reply." }; yield done; });
    registryList.push(registry);
    const reserved = registry.reserve("owner", "Check the test context", "transport-test");
    registry.registered("transport-test", "web_real");
    const http = createServer(); const wss = new WebSocketServer({ noServer: true });
    http.on("upgrade", (req, socket, head) => {
      if (!registry.permits(req.url!)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => registry.attach(ws, req.url!));
    });
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    const url = `ws://127.0.0.1:${(http.address() as any).port}/retell-engine-stream/${reserved.ticket}/web_real`;
    const client = new WebSocket(url);
    try {
      const frames: any[] = [];
      const complete = new Promise<void>((resolve, reject) => {
        client.on("error", reject);
        client.on("message", raw => {
          const f = JSON.parse(raw.toString()); frames.push(f);
          if (f.response_type === "config") client.send(JSON.stringify({ interaction_type: "response_required", response_id: 1, transcript: turn }));
          if (f.response_id === 1 && f.content_complete) resolve();
        });
      });
      await complete;
      expect(frames.find(f => f.content === "Live protocol reply.")).toBeTruthy();
      registry.ended("transport-test");
      await new Promise<void>(r => client.on("close", () => r()));
    } finally {
      client.terminate(); registry.dispose(); wss.close();
      await new Promise<void>(r => http.close(() => r()));
    }
  });
});
describe("Separate Custom LLM agent and existing session guard", () => {
  it("has a distinct response engine, exact comparable voice/settings and no managed LLM creation", async () => {
    const api = new RetellEngineApi(() => "wss://test.replit.dev/retell-engine-stream/{{talkhint_engine_ticket}}");
    vi.spyOn(api, "listAgents").mockResolvedValue([{ agent_id: "managed", agent_name: "TalkHint Secretary Lab — Retell Dev" }]);
    const request = vi.spyOn(api, "request").mockImplementation(async (path, body) => {
      if (path === "/create-agent") return { agent_id: "custom" };
      if (path === "/get-agent/custom") return { agent_id: "custom", version: 0, ...request.mock.calls.find(c => c[0] === "/create-agent")![1] as any };
      throw new Error("Unexpected API");
    });
    const result = await api.ensureAgent();
    expect(result.id).toBe("custom");
    expect(request.mock.calls[0][1]).toMatchObject({ agent_name: RETELL_ENGINE_AGENT,
      response_engine: { type: "custom-llm" }, voice_id: "retell-Merritt", interruption_sensitivity: 0.9, responsiveness: 1 });
    expect(request.mock.calls.some(c => c[0].includes("create-retell-llm"))).toBe(false);
  });
  it("fails closed if a managed agent is substituted or no Dev callback is configured", async () => {
    const api = new RetellEngineApi(() => "wss://test.replit.dev/custom");
    vi.spyOn(api, "request").mockResolvedValue({ agent_name: RETELL_ENGINE_AGENT, response_engine: { type: "retell-llm" } });
    await expect(api.inspectAgent("wrong")).rejects.toMatchObject({ status: 409 });
    vi.stubEnv("REPLIT_DEV_DOMAIN", "");
    expect(() => engineCallbackBase()).toThrow("Dev-домен");
  });
  it("preserves idempotent admission after async readiness and never exposes the engine capability", async () => {
    const registry = new RetellEngineRegistry(async function* () { yield done; }); registryList.push(registry);
    const api: any = {
      listAgents: async () => [{ agent_name: RETELL_ENGINE_AGENT, agent_id: "custom" }],
      ensureAgent: async () => ({ id: "custom", version: 0 }), inspectAgent: async () => ({ id: "custom", version: 0 }),
      request: vi.fn(async (_path, body) => ({ call_id: "web_only", access_token: "one-session", transport: "gateway", ice_servers: [],
        expires_at: Date.now() + 60000, retell_llm_dynamic_variables: body?.retell_llm_dynamic_variables })),
    };
    const profile: RetellLabProfile = {
      agentName: RETELL_ENGINE_AGENT, mode: "retell-engine", check: async () => { await wait(); return {}; },
      reserve: (...a) => registry.reserve(...a), registered: (...a) => registry.registered(...a), ended: id => registry.ended(id),
    };
    const lab = new RetellSecretaryLab(api, Date.now, () => true, profile);
    try {
      const body = { instruction: "Same approved test assignment", consent: true, clientRequestId: randomUUID() };
      const [a, b] = await Promise.all([lab.create("owner", body), lab.create("owner", body)]);
      expect(a.id).toBe(b.id); expect(api.request).toHaveBeenCalledTimes(1);
      expect(a.report.mode).toBe("retell-engine"); expect(a.report.engine.testOnly).toBe(true);
      expect(JSON.stringify(a)).not.toContain("talkhint_engine_ticket");
      expect(api.request.mock.calls[0][1].retell_llm_dynamic_variables.talkhint_engine_ticket).toMatch(/^[a-f0-9]{64}$/);
    } finally { lab.dispose(); }
  });
});
