import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { applyOwnerCommand, initialState, type CrewState } from "./domain";
import { applyTestAction, authorizeTest, keyHash, revokeTest } from "./testGrant";
import { hasLegacyWriteoff, LEGACY_AMOUNT, LEGACY_TASK_ID, LEGACY_UNKNOWN_OUTCOME } from "./legacyUnknown";
import { HINT_AGENTS } from "./hintPilot";
import { projectHintEvidence } from "./hintEvidence";
import { CrewRuntime } from "./runtime";
import { registerTestMcp } from "./testMcp";

const at = "2026-11-02T10:00:00.000Z", oldAt = "2026-11-01T09:00:00.000Z";
const key = "fixture-not-a-secret-".repeat(4), amount = LEGACY_AMOUNT;
const models = HINT_AGENTS.map(a => a.modelId);
const evidence = () => projectHintEvidence({ calls: [{ latency: { e2eP95Ms: 4000 }, sla: 1000 }], reports: [], problems: [] });
function fixture() {
  const s = initialState();
  applyOwnerCommand(s, { kind: "hint_pilot_prepare", candidate: "latency", ratesConfirmed: true }, "real-owner", oldAt, models, evidence());
  s.tasks[0].id = LEGACY_TASK_ID; (s.journal[0].detail as any).taskId = LEGACY_TASK_ID;
  applyOwnerCommand(s, { kind: "control", enabled: true, dailyLimitMicroUsd: 5_000_000, staleHours: 24 }, "real-owner", oldAt);
  applyOwnerCommand(s, { kind: "hint_pilot_start", taskId: LEGACY_TASK_ID, ownerApproved: true }, "real-owner", oldAt);
  Object.assign(s.runs[0], { status: "unknown", reserved: amount, day: "2026-11-01" });
  s.budget["2026-11-01"] = { spent: 123, reserved: amount };
  s.control.enabled = false;
  authorizeTest(s, keyHash(key), at);
  return s;
}
const action = { action: "writeoff_legacy_unknown" };
class Memory {
  queue = Promise.resolve();
  constructor(public state: CrewState) {}
  async read() { return structuredClone(this.state); }
  async change<T>(fn: (s: CrewState) => T, revision?: number): Promise<T> {
    const job = this.queue.then(() => {
      if (revision !== undefined && revision !== this.state.revision) throw Error("STALE_REVISION");
      const copy = structuredClone(this.state), result = fn(copy);
      copy.revision++; this.state = copy; return result;
    });
    this.queue = job.then(() => {}, () => {}); return job;
  }
}
describe("one-off owner-approved emergency OFF writeoff", () => {
  it("reproduces unknown blocking, but still refuses the old free close", () => {
    const s = fixture(), before = structuredClone(s);
    expect(() => applyTestAction(s, { action: "prepare", candidate: "latency" }, at, models, evidence())).toThrow("NOT_SAFE");
    expect(() => applyTestAction(s, { action: "close_stalled", taskId: LEGACY_TASK_ID }, at, [])).toThrow("UNSAFE");
    expect(s).toEqual(before);
  });
  it("moves exactly $0.036716 reserve to spent once, closes with the owner's exact outcome and stays OFF", () => {
    const s = fixture(), before = structuredClone(s);
    applyTestAction(s, action, at, []);
    expect(s.budget["2026-11-01"]).toEqual({ reserved: 0, spent: 123 + amount });
    expect(s.budget["2026-11-01"].spent + s.budget["2026-11-01"].reserved)
      .toBe(before.budget["2026-11-01"].spent + before.budget["2026-11-01"].reserved);
    expect(s.control).toEqual(before.control);
    expect(s.testGrant).toEqual({ ...before.testGrant, spent: amount });
    expect(s.runs[0]).toMatchObject({ id: before.runs[0].id, status: "discarded", reserved: 0, cost: amount,
      legacyUnknownWriteoff: { amountMicroUsd: amount, providerOutcome: "unknown", reason: "owner_emergency_off" } });
    expect(s.runs[0].usage).toBeUndefined();
    expect(s.tasks[0]).toMatchObject({ closed: true, phase: "outcome",
      hintPilot: { status: "not_completed", ownerId: "real-owner" } });
    expect(s.tasks[0].steps.slice(0, -1)).toEqual(before.tasks[0].steps);
    expect(s.tasks[0].steps.at(-1)).toMatchObject({ met: false, actual: LEGACY_UNKNOWN_OUTCOME });
    expect(s.journal.slice(0, before.journal.length)).toEqual(before.journal);
    expect(s.journal.at(-1)).toMatchObject({ actor: "replit-test", kind: "legacy_unknown_written_off",
      detail: { amountMicroUsd: amount, originalReservedMicroUsd: amount, providerOutcome: "unknown", ownerAcceptance: false } });
    expect(hasLegacyWriteoff(s)).toBe(true); expect(s.documents).toHaveLength(0);
    const saved = structuredClone(s);
    expect(() => applyTestAction(s, action, at, [])).toThrow("NOT_WRITABLE");
    expect(s).toEqual(saved);
  });
  const rejected: [string, (s: CrewState) => void][] = [
    ["ON", s => { s.control.enabled = true; }],
    ["another running request", s => { s.runs.push({ ...s.runs[0], id: randomUUID(), taskId: "other", status: "running" }); }],
    ["another task ID", s => { s.tasks[0].id = randomUUID(); s.runs[0].taskId = s.tasks[0].id; }],
    ["not unknown", s => { s.runs[0].status = "queued"; }],
    ["already settled cost", s => { s.runs[0].cost = 0; }],
    ["usage present", s => { s.runs[0].usage = { input_tokens: 0, output_tokens: 0 }; }],
    ["reserved amount differs by one", s => { s.runs[0].reserved = amount + 1; }],
    ["daily reserve lost", s => { s.budget["2026-11-01"].reserved = 0; }],
    ["corrupt daily spent", s => { s.budget["2026-11-01"].spent = -1; }],
    ["day absent", s => { delete s.runs[0].day; }],
    ["proposal exists", s => { s.tasks[0].hintPilot!.proposalId = "proposal"; }],
    ["document exists", s => { s.documents.push({ id: "d", taskId: LEGACY_TASK_ID, runId: s.runs[0].id,
      agentId: s.runs[0].agentId, at, text: "not adoptable", status: "proposed" }); }],
    ["not author phase", s => { s.tasks[0].hintPilot!.status = "review"; }],
    ["not latency", s => { s.tasks[0].hintPilot!.candidate = "usefulness"; }],
    ["series task", s => { s.tasks[0].testSeriesId = s.testGrant!.id; }],
    ["series run", s => { s.runs[0].testSeriesId = s.testGrant!.id; }],
    ["wrong agent", s => { s.runs[0].agentId = HINT_AGENTS[1].agentId; }],
    ["multiple runs", s => { s.runs.push({ ...s.runs[0], id: randomUUID() }); }],
    ["series budget exhausted", s => { s.testGrant!.spent = 5_000_000 - amount + 1; }],
    ["revoked", s => { revokeTest(s, "owner", at); }],
  ];
  it.each(rejected)("rejects %s before any mutation", (_name, change) => {
    const s = fixture(); change(s); const before = structuredClone(s);
    expect(() => applyTestAction(s, action, at, [])).toThrow();
    expect(s).toEqual(before);
  });
  it("cannot choose task, run, amount or use the superseded generic isolation command", () => {
    const s = fixture(), before = structuredClone(s);
    for (const command of [{ ...action, taskId: LEGACY_TASK_ID }, { ...action, runId: s.runs[0].id },
      { ...action, expectedReservedMicroUsd: amount }, { action: "isolate_legacy_unknown" }, { ...action, force: true }])
      expect(() => applyTestAction(s, command, at, [])).toThrow();
    expect(() => applyTestAction(s, action, "2026-11-09T10:00:00Z", [])).toThrow("DENIED");
    expect(s).toEqual(before);
  });
  it("preserves unrelated money and refuses repeat debit even with a new UUID", () => {
    const s = fixture();
    s.budget["2026-11-01"].reserved += 456;
    s.budget["2026-10-31"] = { spent: 100, reserved: 99 };
    applyTestAction(s, action, at, []);
    expect(s.budget["2026-11-01"].reserved).toBe(456);
    expect(s.budget["2026-10-31"]).toEqual({ spent: 100, reserved: 99 });
    const saved = structuredClone(s);
    expect(() => applyTestAction(s, action, at, [])).toThrow();
    expect(s).toEqual(saved);
  });
  it("new chain works after json round-trip and next day, old run never restarts, automatic OFF remains", async () => {
    const s = fixture(); applyTestAction(s, action, at, []);
    const m = new Memory(JSON.parse(JSON.stringify(s)));
    const p = { listModels: vi.fn(async () => []), message: vi.fn(async (model: string) => ({
      model, text: model === models[1] ? '{"verdict":"not_confirmed","analysis":"Need more measurements."}' : "Proposal.",
      usage: { input_tokens: 100, output_tokens: 50 } })) };
    await new CrewRuntime(m, p, "production", () => new Date(at)).tick();
    expect(p.message).not.toHaveBeenCalled();
    await m.change(s => applyTestAction(s, { action: "prepare", candidate: "latency" }, at, models, evidence()));
    const taskId = m.state.tasks[1].id;
    await m.change(s => applyTestAction(s, { action: "enable", taskId }, at, []));
    await m.change(s => applyTestAction(s, { action: "start", taskId }, at, []));
    const rt = new CrewRuntime(m, p, "production", () => new Date(at));
    await rt.tick(); await rt.tick();
    expect(p.message).toHaveBeenCalledTimes(2);
    expect(m.state.runs[0].status).toBe("discarded");
    expect(m.state.budget["2026-11-01"]).toEqual({ spent: 123 + amount, reserved: 0 });
    expect(m.state.testGrant!.spent).toBe(amount + 2100);
    expect(m.state.testGrant!.reserved).toBe(0); expect(m.state.control.enabled).toBe(false);
    expect(m.state.tasks[1]).toMatchObject({ closed: false, hintPilot: { status: "owner", verdict: "not_confirmed" } });
    expect(m.state.documents).toHaveLength(2);
  });
  it("unrelated unknowns still block and old task cannot be re-enqueued", () => {
    const s = fixture(); applyTestAction(s, action, at, []);
    expect(() => applyOwnerCommand(s, { kind: "enqueue", taskId: LEGACY_TASK_ID,
      agentId: HINT_AGENTS[0].agentId, eventId: randomUUID() }, "real-owner", at)).toThrow();
    s.runs.push({ ...s.runs[0], id: randomUUID(), status: "unknown", taskId: "other" });
    expect(() => applyTestAction(s, { action: "prepare", candidate: "latency" }, at, models, evidence())).toThrow("NOT_SAFE");
  });
  it("late provider response cannot change the writeoff or adopt a result", async () => {
    const m = new Memory(fixture());
    m.state.control.enabled = true; m.state.runs[0].status = "queued"; m.state.runs[0].reserved = undefined;
    m.state.budget["2026-11-01"].reserved = 0;
    let release!: (value: any) => void, entered!: () => void;
    const requested = new Promise<void>(resolve => { entered = resolve; });
    const p = { listModels: vi.fn(async () => []), message: vi.fn(() => {
      entered(); return new Promise<any>(resolve => { release = resolve; });
    }) };
    const pending = new CrewRuntime(m, p, "production", () => new Date(oldAt)).tick();
    await requested;
    // Fixture reproduces exact approved ambiguous amount, not a production recovery.
    await m.change(s => { s.control.enabled = false; s.runs[0].status = "unknown";
      s.runs[0].reserved = amount; s.budget["2026-11-01"].reserved = amount; });
    await m.change(s => applyTestAction(s, action, at, []));
    const saved = await m.read();
    release({ model: models[0], text: "Too late", usage: { input_tokens: 1, output_tokens: 1 } });
    await pending;
    expect(await m.read()).toEqual({ ...saved, revision: saved.revision + 1 });
    expect(m.state.documents).toHaveLength(0); expect(p.message).toHaveBeenCalledTimes(1);
  });
  it("HTTP enforces key/CAS/strict args, concurrent one-time execution and readback without provider access", async () => {
    const m = new Memory(fixture()), app = express();
    const evidenceFn = vi.fn(async () => evidence()), modelsFn = vi.fn(async () => models);
    registerTestMcp(app, { environment: "production", store: () => m, secret: () => key,
      now: () => new Date(at), evidence: evidenceFn, models: modelsFn, model: async () => ({} as any) });
    const rpc = (params: any, useKey = key) => request(app).post("/api/crew-test/mcp")
      .set("X-API-Key", useKey).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params });
    const args = { revision: 0, requestId: randomUUID(), command: action };
    const params = { name: "crew_test_writeoff_legacy_unknown", arguments: args };
    expect((await rpc(params, "")).status).toBe(403);
    expect((await rpc({ ...params, name: "crew_test_close_stalled" })).status).toBe(409);
    expect((await rpc({ ...params, arguments: { ...args, revision: 999 } })).status).toBe(409);
    const both = await Promise.all([rpc(params), rpc({ ...params, arguments: { ...args, requestId: randomUUID() } })]);
    expect(both.map(r => r.status).sort()).toEqual([200, 409]);
    expect(m.state.testGrant!.spent).toBe(amount);
    expect((await rpc({ ...params, arguments: { ...args, revision: 1 } })).status).toBe(409);
    expect((await rpc({ ...params, arguments: { ...args, revision: 1, requestId: randomUUID() } })).status).toBe(409);
    const read = await rpc({ name: "crew_test_state" }), state = JSON.parse(read.body.result.content[0].text);
    expect(state.writtenOffLegacy[0]).toMatchObject({ status: "discarded", reserved: 0, cost: amount,
      dayBudget: { spent: 123 + amount, reserved: 0 } });
    expect(state.legacyStalledCandidates).toHaveLength(0); expect(state.control.enabled).toBe(false);
    expect(JSON.stringify(state)).not.toContain(keyHash(key));
    expect(evidenceFn).not.toHaveBeenCalled(); expect(modelsFn).not.toHaveBeenCalled();
  });
});
