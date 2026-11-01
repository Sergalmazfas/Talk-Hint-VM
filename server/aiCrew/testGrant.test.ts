import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { initialState, type CrewState } from "./domain";
import { applyTestAction, authorizeTest, checkTestKey, enforceTestSafety, keyHash,
  revokeTest, SERIES_LIMIT, TEST_ACTOR } from "./testGrant";
import { projectHintEvidence } from "./hintEvidence";
import { HINT_AGENTS } from "./hintPilot";
import { CrewRuntime } from "./runtime";
import { crewTestTools, registerTestMcp } from "./testMcp";
import { startCrewMaintenance } from "./maintenance";

const at = "2026-11-01T18:00:00.000Z", key = "test-only-not-a-real-secret-".repeat(3);
const models = HINT_AGENTS.map(a => a.modelId);
const evidence = () => projectHintEvidence({ calls: [{ latency: { e2eP95Ms: 4063 }, sla: 1000 }], reports: [], problems: [] });
class Memory {
  state = initialState(); queue = Promise.resolve();
  async read() { return structuredClone(this.state); }
  async change<T>(fn: (s: CrewState) => T, revision?: number): Promise<T> {
    const job = this.queue.then(() => {
      if (revision !== undefined && revision !== this.state.revision) throw Error("STALE_REVISION");
      const s = structuredClone(this.state), result = fn(s);
      s.revision++; this.state = s; return result;
    });
    this.queue = job.then(() => {}, () => {}); return job;
  }
}
function ready() {
  const m = new Memory(), s = m.state;
  authorizeTest(s, keyHash(key), at);
  applyTestAction(s, { action: "prepare", candidate: "latency" }, at, models, evidence());
  const task = s.tasks[0];
  applyTestAction(s, { action: "enable", taskId: task.id }, at, []);
  applyTestAction(s, { action: "start", taskId: task.id }, at, []);
  return m;
}
const provider = () => ({
  listModels: vi.fn(async () => []),
  message: vi.fn(async (model: string) => ({ model,
    text: model === models[1] ? '{"verdict":"confirmed","analysis":"Compared numeric facts; no live claim."}' : "Facts and hypotheses.",
    usage: { input_tokens: 100, output_tokens: 50 } })),
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe("durable delegated crew-test series", () => {
  it("only accepts a separate sufficiently long key and never treats owner/OAuth as authority", () => {
    expect(checkTestKey(key, key)).toBe(true);
    for (const k of [undefined, "", "short", "other".repeat(12)]) expect(checkTestKey(k, key)).toBe(false);
    expect(checkTestKey(key, undefined)).toBe(false);
  });
  it("fixes $5 and 7 days once, never refreshes by day, restart, use or key rotation", () => {
    const s = ready().state, grant = structuredClone(s.testGrant);
    authorizeTest(s, keyHash(key), "2026-11-02T18:00:00Z");
    expect(s.testGrant!.expiresAt).toBe("2026-11-08T18:00:00.000Z");
    expect(s.testGrant!.limit).toBe(SERIES_LIMIT);
    expect(s.testGrant!.createdAt).toBe(grant!.createdAt);
    expect(() => authorizeTest(s, keyHash("new-key"), at)).toThrow("DENIED");
    expect(() => authorizeTest(s, keyHash(key), "2026-11-08T18:00:00Z")).toThrow("DENIED");
    revokeTest(s, "owner", at);
    expect(() => authorizeTest(s, keyHash(key), at)).toThrow("DENIED");
    const neverUsed = initialState(); revokeTest(neverUsed, "owner", at);
    expect(() => authorizeTest(neverUsed, keyHash(key), at)).toThrow("DENIED");
  });
  it("completes Pasha/Foma, accounts actual usage, records actor and auto OFF without acceptance", async () => {
    const m = ready(), p = provider(), rt = new CrewRuntime(m, p, "production", () => new Date(at));
    await rt.tick(); await rt.tick();
    const s = await m.read();
    expect(p.message).toHaveBeenCalledTimes(2);
    expect(s.testGrant!.spent).toBe(2100); expect(s.testGrant!.reserved).toBe(0);
    expect(s.control.enabled).toBe(false);
    expect(s.tasks[0].hintPilot!.status).toBe("owner");
    expect(s.tasks[0].closed).toBe(false);
    expect(s.documents).toHaveLength(2);
    expect(s.journal.filter(e => ["run_reserved", "run_settled", "hint_pilot_handoff", "hint_pilot_auto_off"].includes(e.kind))
      .every(e => e.actor === TEST_ACTOR)).toBe(true);
    expect(s.journal.some(e => e.kind === "crew_test_granted" && JSON.stringify(e).includes(key))).toBe(false);
    applyTestAction(s, { action: "prepare", candidate: "latency" }, at, models, evidence());
    expect(s.tasks).toHaveLength(2); expect(s.tasks[0].closed).toBe(false);
    expect(s.testGrant!.spent).toBe(2100);
  });
  it("does not run unrelated queues or schedules under delegated ON", async () => {
    const m = ready(), p = provider();
    m.state.runs.unshift({ ...m.state.runs[0], id: "other", taskId: "other", agentId: "other" });
    m.state.schedules.push({ agentId: "other", taskId: "other", everyMinutes: 5, nextAt: at });
    const rt = new CrewRuntime(m, p, "production", () => new Date(at));
    await rt.tick();
    expect(p.message).toHaveBeenCalledTimes(1); expect(m.state.runs[0].status).toBe("queued");
  });
  it("reserves under a lock; a second runtime cannot duplicate claim or exceed remaining series", async () => {
    const m = ready(), p = provider();
    m.state.testGrant!.spent = SERIES_LIMIT - 10;
    const a = new CrewRuntime(m, p, "production", () => new Date(at));
    const b = new CrewRuntime(m, p, "production", () => new Date(at));
    await Promise.all([a.tick(), b.tick()]);
    expect(p.message).not.toHaveBeenCalled(); expect(m.state.control.enabled).toBe(false);
    expect(m.state.testGrant!.spent).toBe(SERIES_LIMIT - 10);
  });
  it("two runtime instances cannot send the same delegated run twice", async () => {
    const m = ready(), p = provider();
    await Promise.all([
      new CrewRuntime(m, p, "production", () => new Date(at)).tick(),
      new CrewRuntime(m, p, "production", () => new Date(at)).tick(),
    ]);
    expect(p.message).toHaveBeenCalledTimes(1);
    expect(m.state.testGrant!.reserved).toBe(0);
    expect(m.state.testGrant!.spent).toBe(700);
  });
  it("a late response after the five-minute watchdog never refunds unknown or adopts its document", async () => {
    const m = ready();
    let finish!: (value: any) => void;
    const p = provider();
    p.message.mockImplementation(() => new Promise(r => { finish = r; }));
    const tick = new CrewRuntime(m, p, "production", () => new Date(at)).tick();
    while (!finish) await new Promise(r => setImmediate(r));
    await m.change(s => enforceTestSafety(s, "2026-11-01T18:05:00Z"));
    const charged = m.state.testGrant!.spent;
    finish({ model: models[0], text: "late", usage: { input_tokens: 1, output_tokens: 1 } });
    await tick;
    expect(m.state.runs[0].status).toBe("unknown"); expect(m.state.documents).toHaveLength(0);
    expect(m.state.testGrant!.spent).toBe(charged); expect(charged).toBeGreaterThan(0);
    expect(m.state.control.enabled).toBe(false);
  });
  it("expired grant after preparation does not call a provider, even under an owner-toggled ON", async () => {
    const m = ready(), p = provider();
    await new CrewRuntime(m, p, "production", () => new Date("2026-11-08T18:00:00Z")).tick();
    expect(p.message).not.toHaveBeenCalled(); expect(m.state.control.enabled).toBe(false);
    expect(m.state.testGrant!.spent).toBe(0);
  });
  it("safe legacy cleanup preserves task owner, zero execution and no acceptance", () => {
    const s = ready().state, task = s.tasks[0];
    task.testSeriesId = undefined; task.hintPilot!.ownerId = "real-owner"; s.control.enabled = false;
    applyTestAction(s, { action: "close_stalled", taskId: task.id }, at, []);
    expect(task.hintPilot!.ownerId).toBe("real-owner");
    expect(task.closed).toBe(true); expect(s.runs[0].status).toBe("discarded");
    expect(task.steps.at(-1)?.met).toBe(false); expect(s.testGrant!.spent).toBe(0);
    expect(s.journal.at(-1)?.actor).toBe(TEST_ACTOR);
  });
  it("counts unknown as spent forever; day changes and new runtime never refund or retry", async () => {
    const m = ready(), p = provider(); p.message.mockRejectedValue(Error("secret-do-not-print"));
    await new CrewRuntime(m, p, "production", () => new Date(at)).tick();
    const s = await m.read(), charged = s.runs[0].reserved!;
    expect(s.runs[0].status).toBe("unknown");
    expect(s.testGrant!.spent).toBe(charged); expect(s.testGrant!.reserved).toBe(0);
    expect(s.control.enabled).toBe(false);
    await new CrewRuntime(m, p, "production", () => new Date("2026-11-02T18:00:00Z")).tick();
    expect(p.message).toHaveBeenCalledTimes(1);
    expect(m.state.testGrant!.spent).toBe(charged);
    expect(() => applyTestAction(s, { action: "close_stalled", taskId: s.tasks[0].id }, at, [])).toThrow();
  });
  it("enforces expiry and recovers a crashed running reservation even after emergency OFF", async () => {
    const m = ready();
    enforceTestSafety(m.state, "2026-11-08T18:00:00Z");
    expect(m.state.control.enabled).toBe(false);
    const s = ready().state, r = s.runs[0];
    Object.assign(r, { status: "running", testSeriesId: s.testGrant!.id, reserved: 100, startedAt: at });
    s.testGrant!.reserved = 100; s.control.enabled = false;
    enforceTestSafety(s, "2026-11-01T18:05:00Z");
    expect(r.status).toBe("unknown"); expect(s.testGrant!.spent).toBe(100);
    enforceTestSafety(s, "2026-11-01T18:06:00Z"); expect(s.testGrant!.spent).toBe(100);
  });
  it("five-minute queued watchdog turns OFF but cannot discard automatically", () => {
    const s = ready().state;
    enforceTestSafety(s, "2026-11-01T18:05:00Z");
    expect(s.control.enabled).toBe(false); expect(s.runs[0].status).toBe("queued");
    applyTestAction(s, { action: "close_stalled", taskId: s.tasks[0].id }, at, []);
    expect(s.runs[0].status).toBe("discarded"); expect(s.tasks[0].closed).toBe(true);
  });
  it("rejects foreign task, arbitrary tools, product changes and acceptance", () => {
    const s = ready().state;
    for (const action of ["agent", "advance", "publication", "enqueue", "schedule", "model", "call"])
      expect(() => applyTestAction(s, { action }, at, [])).toThrow();
    expect(() => applyTestAction(s, { action: "start", taskId: crypto.randomUUID() }, at, [])).toThrow("SCOPE");
  });
});
describe("separate MCP transport", () => {
  function setup() {
    const m = new Memory(), app = express(), modelsFn = vi.fn(async () => models), evidenceFn = vi.fn(async () => evidence());
    registerTestMcp(app, { environment: "production", store: () => m, secret: () => key, now: () => new Date(at),
      models: modelsFn, evidence: evidenceFn, model: async () => ({ revision: 1, documents: [] } as any) });
    const rpc = (method: string, params?: unknown, k = key) => request(app).post("/api/crew-test/mcp")
      .set("X-API-Key", k).send({ jsonrpc: "2.0", id: 1, method, params });
    return { m, app, rpc, modelsFn, evidenceFn };
  }
  it("refuses absent/wrong key, Origin and broad tools without reading owner evidence", async () => {
    const { rpc, app, evidenceFn } = setup();
    expect((await rpc("tools/list", undefined, "")).status).toBe(403);
    expect((await rpc("tools/list", undefined, "wrong".repeat(15))).status).toBe(403);
    expect((await request(app).post("/api/crew-test/mcp").set("X-API-Key", key).set("Origin", "https://talkhint.app")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(403);
    for (const name of ["update_structure", "hint_pilot_start", "advance", "probe", "get_team"])
      expect((await rpc("tools/call", { name, arguments: {} })).status).toBe(409);
    expect(evidenceFn).not.toHaveBeenCalled();
  });
  it("lists narrow tools, fresh CAS and duplicate UUID stop; returns only series data without key/hash", async () => {
    const { rpc, m } = setup();
    const list = await rpc("tools/list");
    expect(list.body.result.tools.map((t: any) => t.name)).toEqual(crewTestTools);
    let state = await rpc("tools/call", { name: "crew_test_state" });
    const snap = JSON.parse(state.body.result.content[0].text);
    expect(JSON.stringify(snap)).not.toContain(keyHash(key));
    const args = { revision: snap.revision, requestId: crypto.randomUUID(), command: { action: "prepare", candidate: "latency" } };
    expect((await rpc("tools/call", { name: "crew_test_prepare", arguments: args })).status).toBe(200);
    expect((await rpc("tools/call", { name: "crew_test_prepare", arguments: args })).status).toBe(409);
    const before = await m.read();
    expect((await rpc("tools/call", { name: "crew_test_enable", arguments: { ...args, revision: before.revision } })).status).toBe(409);
    expect(m.state.tasks).toHaveLength(1);
    revokeTest(m.state, "owner", at);
    expect((await rpc("tools/list")).status).toBe(409);
  });
  it("read-only structural command calls no provider catalog or generation", async () => {
    const { rpc, evidenceFn, modelsFn } = setup();
    const r = await rpc("tools/call", { name: "crew_structure_check" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body.result.content[0].text).modelsCalled).toBe(0);
    expect(evidenceFn).not.toHaveBeenCalled(); expect(modelsFn).not.toHaveBeenCalled();
  });
});
describe("independent maintenance", () => {
  it("is absent in Dev; in production saves one daily report, expires ON without a provider tick", async () => {
    vi.useFakeTimers();
    const m = ready(), model = vi.fn(async () => ({ revision: 1, documents: [] } as any)), stop = vi.fn();
    expect(startCrewMaintenance({ environment: "development", store: () => m, model, stopLocal: stop })).toBeUndefined();
    startCrewMaintenance({ environment: "production", store: () => m, model, stopLocal: stop,
      now: () => new Date("2026-11-08T18:00:00Z") });
    await vi.advanceTimersByTimeAsync(180000);
    expect(m.state.control.enabled).toBe(false); expect(stop).toHaveBeenCalled();
    expect(model).toHaveBeenCalledTimes(1);
    expect(m.state.structureReports).toHaveLength(1);
  });
});
