import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { RetellSecretaryLab, retellSecretaryInstructions } from "./retell";
import { RetellApi, RetellApiError, RETELL_LAB_AGENT, RETELL_LAB_MODEL, RETELL_LAB_VOICE, RETELL_PROMPT_VARIABLE } from "./retellApi";
import { registerRetellLabRoutes } from "./retellRoutes";
import { buildSecretaryInstructions } from "../secretary/agent";
import { confirmedSecretaryOwnerName } from "../secretary/ownerIdentity";

vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: () => void) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!["alice", "bob", "ordinary"].includes(token)) return res.sendStatus(401);
    req.user = { id: token, email: token === "ordinary" ? "ordinary@example.test" : "admin@example.test" };
    next();
  },
}));
const input = () => ({ instruction: "Уточнить время встречи, ничего не выдумывать.", consent: true, clientRequestId: randomUUID() });
class Peer extends EventEmitter {
  close = vi.fn(() => this.emit("close", 1000, Buffer.from("local_close")));
}
describe("Retell web Secretary bench — never PSTN", () => {
  let api: any, lab: RetellSecretaryLab, peer: Peer, calls: Array<{ path: string; body?: any; method?: string }>;
  let now: number, providerStatus: string;
  const labs: RetellSecretaryLab[] = [];
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "admin@example.test");
    now = Date.now(); providerStatus = "ongoing"; calls = []; peer = new Peer();
    api = {
      listAgents: vi.fn(async () => [{ agent_id: "bench-agent", agent_name: RETELL_LAB_AGENT }]),
      inspectAgent: vi.fn(async () => ({ id: "bench-agent", version: 0, model: RETELL_LAB_MODEL, voice: RETELL_LAB_VOICE })),
      ensureAgent: vi.fn(async () => ({ id: "bench-agent", version: 0 })),
      monitor: vi.fn(() => peer),
      request: vi.fn(async (path: string, body?: any, method?: string) => {
        calls.push({ path, body, method });
        if (path === "/v3/create-web-call") return {
          call_id: "web-call", access_token: "browser-only-admission", transport: "gateway", ice_servers: [], expires_at: now + 60_000,
        };
        if (path === "/v2/get-call/web-call") return { call_id: "web-call", call_type: "web_call", call_status: providerStatus };
        if (path === "/v2/stop-call/web-call") return {};
        throw new Error(`Unexpected endpoint ${path}`);
      }),
    };
    lab = new RetellSecretaryLab(api, () => now);
    labs.push(lab);
  });
  afterEach(() => { labs.splice(0).forEach(x => x.dispose()); vi.unstubAllEnvs(); vi.useRealTimers(); });
  it("shares the actual Secretary's core policy and trusted owner identity, not a template agent", async () => {
    const draft = input();
    expect(retellSecretaryInstructions("alice", draft.instruction)).toBe(
      buildSecretaryInstructions(draft.instruction, confirmedSecretaryOwnerName("alice")));
    const result = await lab.create("alice", draft);
    const payload = calls.find(x => x.path === "/v3/create-web-call")!.body;
    expect(payload.retell_llm_dynamic_variables.talkhint_instructions).toContain(draft.instruction);
    expect(payload.retell_llm_dynamic_variables.talkhint_instructions).toContain("Russian, English or Spanish");
    expect(payload.agent_version).toBe(0);
    expect(result.report.model).toBe(RETELL_LAB_MODEL);
    expect(result.report.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.some(x => /phone|twilio/i.test(x.path))).toBe(false);
  });
  it("requires consent, rejects numbers and caller-selected agents before any provider call", async () => {
    for (const body of [{ ...input(), consent: false }, { ...input(), phoneNumber: "+15550000000" },
      { ...input(), agent_id: "customer-agent" }, { ...input(), instruction: "short" }]) {
      await expect(lab.create("alice", body)).rejects.toMatchObject({ status: 400 });
    }
    expect(api.ensureAgent).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it("deduplicates concurrent/repeated requests and rejects changed task or a second live attempt", async () => {
    const body = input();
    const [a, b] = await Promise.all([lab.create("alice", body), lab.create("alice", body)]);
    expect(a.id).toBe(b.id);
    expect((await lab.create("alice", body)).call.access_token).toBe("browser-only-admission");
    expect(calls.filter(x => x.path === "/v3/create-web-call")).toHaveLength(1);
    await expect(lab.create("alice", { ...body, instruction: "Changed authorized task" })).rejects.toMatchObject({ status: 409 });
    await expect(lab.create("alice", input())).rejects.toMatchObject({ status: 409 });
  });
  it("never retries an ambiguous provider create and never silently falls back", async () => {
    api.request.mockRejectedValue(new RetellApiError(503, "network timeout"));
    const body = input();
    await expect(lab.create("alice", body)).rejects.toMatchObject({ status: 503 });
    await expect(lab.create("alice", body)).rejects.toMatchObject({ status: 409 });
    await expect(lab.create("alice", input())).rejects.toMatchObject({ status: 409 });
    expect(api.request).toHaveBeenCalledTimes(1);
  });
  it("hides admissions in reports/history, scopes every operation to its owner", async () => {
    const created = await lab.create("alice", input());
    const text = JSON.stringify(await lab.readiness("alice")) + JSON.stringify(lab.report("alice", created.id));
    expect(text).not.toContain("browser-only-admission");
    expect((await lab.readiness("bob")).history).toEqual([]);
    expect(() => lab.report("bob", created.id)).toThrow("Сессия не найдена");
    await expect(lab.connected("bob", created.id)).rejects.toMatchObject({ status: 404 });
    await expect(lab.stop("bob", created.id)).rejects.toMatchObject({ status: 404 });
    expect(() => lab.observe("bob", created.id, { outcome: "stopped" })).toThrow();
  });
  it("relays server monitor snapshots by stable id without duplicates, tools, translations or invented speech boundaries", async () => {
    const created = await lab.create("alice", input());
    await lab.connected("alice", created.id);
    peer.emit("open");
    peer.emit("message", Buffer.from(JSON.stringify({ type: "transcript_updated", transcripts: [
      { id: "agent_0", role: "agent", content: "Добрый", time_sec: 0.2 },
    ] })));
    peer.emit("message", Buffer.from(JSON.stringify({ type: "transcript_snapshot", transcripts: [
      { id: "user_0", role: "user", content: "Стоп, перенесём на пятницу", time_sec: 2 },
      { id: "agent_0", role: "agent", content: "Добрый день", time_sec: 0.2 },
      { id: "tool_0", role: "tool_call_invocation", content: "sensitive arguments", time_sec: 1 },
    ] })));
    const report = lab.report("alice", created.id).report;
    expect(report.turns.map(t => t.text)).toEqual(["Добрый день", "Стоп, перенесём на пятницу"]);
    expect(report.metrics).toEqual({ guestTurns: 1, secretaryTurns: 1 });
    expect(report.monitorStatus).toBe("connected");
    expect(report.turns[0]).not.toHaveProperty("interrupted");
    expect(report.turns[0]).not.toHaveProperty("translation");
  });
  it("records interruption outcomes as explicit human observations, not measured latency", async () => {
    const { id } = await lab.create("alice", input());
    now += 5000;
    expect(lab.observe("alice", id, { outcome: "continued", note: "Continued obsolete answer" }).report.observations)
      .toEqual([{ atMs: 5000, outcome: "continued", note: "Continued obsolete answer" }]);
    expect(lab.report("alice", id).report.metrics).not.toHaveProperty("interruptionLatencyMs");
    expect(() => lab.observe("alice", id, { outcome: "success", callId: "other-call" })).toThrow();
  });
  it("stops one known web call idempotently and permits a new request only after confirmed stop", async () => {
    const created = await lab.create("alice", input());
    await Promise.all([lab.stop("alice", created.id), lab.stop("alice", created.id)]);
    await lab.stop("alice", created.id);
    expect(calls.filter(x => x.path === "/v2/stop-call/web-call")).toHaveLength(1);
    expect(lab.report("alice", created.id).report.status).toBe("ended");
    await expect(lab.create("alice", input())).resolves.toHaveProperty("id");
  });
  it("keeps stop failure visible and blocks another call until a safe stop retry succeeds", async () => {
    const created = await lab.create("alice", input());
    const original = api.request.getMockImplementation();
    api.request.mockImplementation(async (...args: any[]) => {
      if (args[0] === "/v2/stop-call/web-call") throw new RetellApiError(503, "stop timeout");
      return original(...args);
    });
    await expect(lab.stop("alice", created.id)).rejects.toMatchObject({ status: 503 });
    expect(lab.report("alice", created.id).report.status).toBe("stop_failed");
    await expect(lab.create("alice", input())).rejects.toMatchObject({ status: 409 });
    api.request.mockImplementation(original);
    expect((await lab.stop("alice", created.id)).status).toBe("ended");
  });
  it("ends on provider evidence, not transcript disconnection, and does not redial", async () => {
    const { id } = await lab.create("alice", input());
    await lab.connected("alice", id);
    peer.emit("open");
    peer.emit("close", 4003, Buffer.from("permission"));
    expect(lab.report("alice", id).report.status).toBe("live");
    expect(lab.report("alice", id).report.monitorStatus).toBe("disconnected");
    expect(api.monitor).toHaveBeenCalledTimes(1);
    providerStatus = "ended";
    await (lab as any).refresh((lab as any).sessions.get(id));
    expect(lab.report("alice", id).report.status).toBe("ended");
    expect(calls.filter(x => x.path === "/v3/create-web-call")).toHaveLength(1);
  });
  it("has a five-minute bound, browser-loss stop and one-hour report expiration", async () => {
    vi.useFakeTimers();
    const { id } = await lab.create("alice", input());
    await lab.connected("alice", id);
    now += 21_000;
    await vi.advanceTimersByTimeAsync(2000);
    expect(lab.report("alice", id).report.reason).toBe("browser_disconnected");
    now += 3_600_001; lab.sweep();
    expect(() => lab.report("alice", id)).toThrow("Сессия не найдена");
    const second = await lab.create("alice", input());
    await vi.advanceTimersByTimeAsync(300_000);
    expect(lab.report("alice", second.id).report.reason).toBe("duration_limit");
  });
  it("uses the existing admin gate and owner boundary for all routes; disables in production", async () => {
    const app = express(); registerRetellLabRoutes(app, lab);
    const base = "/api/admin/secretary-lab/retell";
    for (const path of [base, `${base}/sessions/fake`]) {
      expect((await request(app).get(path)).status).toBe(401);
      expect((await request(app).get(path).set("Authorization", "Bearer ordinary")).status).toBe(403);
    }
    const created = await request(app).post(`${base}/sessions`).set("Authorization", "Bearer alice").send(input());
    expect(created.status).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get(`${base}/sessions/${created.body.id}`).set("Authorization", "Bearer bob")).status).toBe(404);
    for (const suffix of ["/connected", "/observations"]) {
      expect((await request(app).post(`${base}/sessions/${created.body.id}${suffix}`)).status).toBe(401);
    }
    expect((await request(app).delete(`${base}/sessions/${created.body.id}`)).status).toBe(401);
    vi.stubEnv("NODE_ENV", "production");
    expect((await request(app).get(base).set("Authorization", "Bearer alice")).status).toBe(404);
  });
});

describe("Retell API migration/configuration boundary", () => {
  afterEach(() => vi.unstubAllEnvs());
  const config = () => ({
    agent_id: "dedicated", agent_name: RETELL_LAB_AGENT, version: 0, voice_id: RETELL_LAB_VOICE,
    response_engine: { type: "retell-llm", llm_id: "llm" }, data_storage_setting: "basic_attributes_only",
    interruption_sensitivity: 0.9, enable_backchannel: false, max_call_duration_ms: 300_000,
    language: ["en-US", "ru-RU", "es-ES"], webhook_events: [],
    contact_memory_config: { enable_read: false, enable_update: false },
  });
  const llm = () => ({ model_config: { type: "cascading", primary: { model: RETELL_LAB_MODEL }, backup: null },
    general_prompt: RETELL_PROMPT_VARIABLE, general_tools: [] });
  it("uses POST /v2/list-agents and reads/paginates items, never the removed GET method", async () => {
    vi.stubEnv("RETELL_API_KEY", "test-key");
    const net = { fetch: vi.fn(async (_url: any, init: any) => new Response(JSON.stringify({
      items: [{ agent_id: init.body.includes("next-page") ? "b" : "a" }],
      has_more: !init.body.includes("next-page"), pagination_key: "next-page",
    }), { status: 200 })), socket: vi.fn() };
    const api = new RetellApi(net as any);
    expect((await api.listAgents()).map(x => x.agent_id)).toEqual(["a", "b"]);
    expect(net.fetch.mock.calls[0][0]).toBe("https://api.retellai.com/v2/list-agents");
    expect(net.fetch.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(net.fetch.mock.calls[1][1].body).pagination_key).toBe("next-page");
  });
  it.each([401, 402, 403, 429, 500])("categorizes HTTP %s without echoing raw provider secrets", async status => {
    vi.stubEnv("RETELL_API_KEY", "test-key");
    const api = new RetellApi({ fetch: vi.fn(async () => new Response('{"message":"secret-provider-echo"}', { status })), socket: vi.fn() } as any);
    const e = await api.request("/list-voices").catch(e => e);
    expect(e.status).toBe(status);
    expect(e.message).not.toContain("secret-provider-echo");
    expect(e.message).not.toContain("test-key");
  });
  it("reuses only the dedicated bench, verifies no fallback, tools, contact memory or recording", async () => {
    const api = new RetellApi();
    vi.spyOn(api, "request").mockImplementation(async path => path.includes("get-agent") ? config() : llm());
    vi.spyOn(api, "listAgents").mockResolvedValue([{ agent_id: "dedicated", agent_name: RETELL_LAB_AGENT }]);
    expect((await api.ensureAgent()).model).toBe(RETELL_LAB_MODEL);
    expect(api.request).toHaveBeenCalledTimes(2);
    (api.request as any).mockImplementation(async (path: string) => path.includes("get-agent") ? { ...config(), pre_session_tools: [{ name: "external-action" }] } : llm());
    await expect(api.inspectAgent("dedicated")).rejects.toMatchObject({ status: 409 });
    (api.request as any).mockImplementation(async (path: string) => path.includes("get-agent") ? config()
      : { ...llm(), model_config: { ...llm().model_config, backup: { model: "cheaper" } } });
    await expect(api.inspectAgent("dedicated")).rejects.toMatchObject({ status: 409 });
  });
  it("provisions one isolated agent, never modifies or deletes the user's template agents", async () => {
    const api = new RetellApi();
    vi.spyOn(api, "listAgents").mockResolvedValue([{ agent_id: "customer-agent", agent_name: "Patient Screening" }]);
    const call = vi.spyOn(api, "request").mockImplementation(async path => {
      if (path === "/create-retell-llm") return { llm_id: "new-llm" };
      if (path === "/create-agent") return { agent_id: "dedicated" };
      if (path.startsWith("/get-agent")) return config();
      return llm();
    });
    await api.ensureAgent();
    expect(call.mock.calls.map(c => c[0])).toEqual([
      "/create-retell-llm", "/create-agent", "/get-agent/dedicated", "/get-retell-llm/llm",
    ]);
    expect(call.mock.calls[1][1]).toMatchObject({ data_storage_setting: "basic_attributes_only",
      contact_memory_config: { enable_read: false, enable_update: false }, webhook_events: [] });
  });
});
