import { EventEmitter } from "node:events";
import { describe, expect, it, vi, afterEach } from "vitest";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import { SecretaryConversationEngine, streamSecretaryResponse, type EngineStream } from "./conversationEngine";
import { retellPhoneConfiguration, verifyRetellPhoneAgent, registerRetellPhone, endRetellPhone, retellPhoneApi } from "./retellPhone";
const f = vi.hoisted(() => ({ update: vi.fn(), lookup: vi.fn(), call: vi.fn() }));
vi.mock("../db", () => ({ db: { update: f.update } }));
vi.mock("./tasks", () => ({ getSecretaryTaskForCall: f.lookup }));
vi.mock("../storage", () => ({ storage: { getCallByCallSid: f.call } }));
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent: any[] = [];
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close = vi.fn(() => { this.readyState = 3; this.emit("close"); });
  frame(f: object) { this.emit("message", Buffer.from(JSON.stringify(f)), false); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const registries: RetellEngineRegistry[] = [];
afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
describe("Telephone Retell + the same TalkHint text Engine", () => {
  it("isolates phone configuration from the Dev bench and another backend origin", () => {
    const origin = "https://dev.example.com", config = retellPhoneConfiguration(origin);
    expect(config.voice_id).toBe("retell-Merritt");
    expect(config.interruption_sensitivity).toBe(0.9);
    expect(config.responsiveness).toBe(1);
    expect(config.response_engine.type).toBe("custom-llm");
    const agent = { ...config, agent_id: "agent_test" };
    expect(verifyRetellPhoneAgent(agent, origin)).toBe("agent_test");
    expect(() => verifyRetellPhoneAgent(agent, "https://prod.example.com")).toThrow();
    expect(() => verifyRetellPhoneAgent({ ...agent, voice_id: "other" }, origin)).toThrow();
    expect(() => verifyRetellPhoneAgent({ ...agent, pre_session_tools: [{}] }, origin)).toThrow();
  });
  it("does not inject the fictional fixture or permit TEST/business tools into real phone calls", async () => {
    const requests: any[] = [];
    const stream: EngineStream = async function* (request) {
      requests.push(request);
      yield { type: "text", text: "Hello" };
      yield { type: "complete", output: [], tools: [] };
    };
    const engine = new SecretaryConversationEngine("owner", "Ask about a meeting", stream, true);
    expect(engine.report.testOnly).toBe(false);
    expect(engine.instructions).not.toContain("secretary-dev-fixture");
    expect(engine.instructions).toContain("authorized telephone call");
    expect(() => engine.execute("save_test_message", "{}", new AbortController().signal)).toThrow();
    await engine.respond([{ role: "user", content: "Hello" }], new AbortController().signal, () => {});
    expect(JSON.stringify(requests[0].input)).not.toContain("TEST action ledger");
  });
  it("admits only a registered phone identity, streams, persists transcript and deduplicates response IDs", async () => {
    const persist = vi.fn(async () => {});
    let calls = 0;
    const stream: EngineStream = async function* () {
      calls++; yield { type: "text", text: "Hello" }; yield { type: "complete", output: [], tools: [] };
    };
    const registry = new RetellEngineRegistry(stream, { phone: true, onTranscript: persist }); registries.push(registry);
    const { ticket } = registry.reserve("owner", "Confirm meeting details", "task");
    registry.registered("task", "call_phone");
    const ws = new Socket();
    const path = `/retell-phone-engine/${ticket}/call_phone`;
    expect(registry.permits(path)).toBe(true);
    expect(registry.permits(`/retell-engine-stream/${ticket}/call_phone`)).toBe(false);
    registry.attach(ws as any, path);
    ws.frame({ interaction_type: "call_details", call: { call_id: "call_phone", call_type: "phone_call" } }); await tick();
    const turns = [{ role: "agent", content: "Hello" }, { role: "user", content: "Tuesday please" }];
    const request = { interaction_type: "response_required", response_id: 1, transcript: turns };
    ws.frame(request); await tick(); ws.frame(request); await tick(); await registry.flush("task");
    expect(calls).toBe(2); // opening and one response, no extra model call for replay
    expect(persist).toHaveBeenCalledWith("task", turns);
    expect(ws.sent.some(f => f.content === "Hello" && f.content_complete === false)).toBe(true);
    registry.ended("task"); expect(registry.permits(path)).toBe(false);
  });
  it("rejects web-call identity on the phone admission", async () => {
    const registry = new RetellEngineRegistry(undefined, { phone: true }); registries.push(registry);
    const { ticket } = registry.reserve("owner", "Actual task", "task");
    registry.registered("task", "call_phone");
    const ws = new Socket(); registry.attach(ws as any, `/retell-phone-engine/${ticket}/call_phone`);
    ws.frame({ interaction_type: "call_details", call: { call_id: "call_phone", call_type: "web_call" } });
    expect(ws.close).toHaveBeenCalledWith(1008, "Registered call identity required");
  });
  function admissionFixture(origin: string, canReserve = true) {
    for (const key of ["RETELL_API_KEY", "OPENAI_API_KEY", "SESSION_SECRET"]) vi.stubEnv(key, "fixture-only");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "gpt-6.1-sol" }))));
    vi.spyOn(retellPhoneApi, "listAgents").mockResolvedValue([]);
    const request = vi.spyOn(retellPhoneApi, "request").mockImplementation(async path => {
      if (path === "/v2/register-phone-call") return { call_type: "phone_call", call_id: "call_admitted" };
      return { ...retellPhoneConfiguration(origin), agent_id: "agent_fixture", version: 0 };
    });
    f.lookup.mockImplementation(async id => ({ id, userId: "owner", voiceProvider: "retell",
      instruction: "Confirm meeting time", phoneNumber: "+15555550100" }));
    f.call.mockResolvedValue({ fromNumber: "+15555550200" });
    f.update.mockImplementation(() => ({ set: () => ({ where: () => Object.assign(Promise.resolve([]), {
      returning: async () => canReserve ? [{ id: "history" }] : [],
    }) }) }));
    return request;
  }
  it("parallel/repeated voice callbacks register one SIP admission, never originate a second telephone call", async () => {
    const origin = "https://admission.example.com", request = admissionFixture(origin);
    const args = ["task-admission", "CA" + "1".repeat(32), origin] as const;
    const [one, two] = await Promise.all([registerRetellPhone(...args), registerRetellPhone(...args)]);
    expect(one).toBe("sip:call_admitted@sip.retellai.com;transport=tls"); expect(two).toBe(one);
    expect(await registerRetellPhone(...args)).toBe(one);
    expect(request.mock.calls.filter(c => c[0] === "/v2/register-phone-call")).toHaveLength(1);
    expect(request.mock.calls.some(c => /create-phone-call/.test(c[0]))).toBe(false);
    expect(f.update).toHaveBeenCalledTimes(2);
    await endRetellPhone("task-admission");
  });
  it("a durable prior/ambiguous admission is not retried after in-memory state loss", async () => {
    const origin = "https://ambiguous.example.com", request = admissionFixture(origin, false);
    const args = ["task-ambiguous", "CA" + "3".repeat(32), origin] as const;
    await expect(registerRetellPhone(...args)).rejects.toThrow("automatic retry prohibited");
    await expect(registerRetellPhone(...args)).rejects.toThrow("automatic retry prohibited");
    expect(request.mock.calls.filter(c => c[0] === "/v2/register-phone-call")).toHaveLength(0);
    await endRetellPhone("task-ambiguous");
  });
});
