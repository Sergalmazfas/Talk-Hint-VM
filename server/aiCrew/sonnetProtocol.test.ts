import { describe, it, expect, vi } from "vitest";
import { AnthropicCrewProvider, CrewProviderError, CREW_SYSTEM } from "./anthropic";
import { applyOwnerCommand, initialState, log, type CrewState } from "./domain";
import { HINT_AGENTS, hintMaxOutput } from "./hintPilot";
import { projectHintEvidence } from "./hintEvidence";
import { applyTestAction, authorizeTest, keyHash } from "./testGrant";
import { FAILED_PILOT_RUN, FAILED_PILOT_TASK, isSupersededChargedUnknown } from "./failedPilot";
import { CrewRuntime } from "./runtime";

const at = "2026-11-02T02:00:00.000Z", key = "test-fixture-never-real-key".repeat(3);
const models = HINT_AGENTS.map(a => a.modelId);
const evidence = () => projectHintEvidence({ calls: [{ latency: { e2eP95Ms: 4200 }, sla: 1000 }], reports: [], problems: [] });
function fixture() {
  const s = initialState();
  authorizeTest(s, keyHash(key), at);
  applyOwnerCommand(s, { kind: "hint_pilot_prepare", candidate: "latency", ratesConfirmed: true }, "replit-test", at, models, evidence());
  s.tasks[0].id = FAILED_PILOT_TASK; s.tasks[0].testSeriesId = s.testGrant!.id;
  applyOwnerCommand(s, { kind: "control", enabled: true, dailyLimitMicroUsd: 5_000_000, staleHours: 24 }, "owner", at);
  applyOwnerCommand(s, { kind: "hint_pilot_start", taskId: FAILED_PILOT_TASK, ownerApproved: true }, "replit-test", at);
  Object.assign(s.runs[0], { id: FAILED_PILOT_RUN, status: "unknown", reserved: 36716,
    day: at.slice(0, 10), testSeriesId: s.testGrant!.id });
  s.control.enabled = false; s.control.testSeriesId = s.testGrant!.id;
  s.testGrant!.spent = 73432;
  s.budget[at.slice(0, 10)] = { spent: 0, reserved: 36716 };
  log(s, "replit-test", "crew_test_unknown_charged", { runId: FAILED_PILOT_RUN, chargedMicroUsd: 36716 }, at);
  return s;
}
class Memory {
  constructor(public state: CrewState) {}
  async read() { return structuredClone(this.state); }
  async change<T>(fn: (s: CrewState) => T) {
    const copy = structuredClone(this.state), result = fn(copy);
    copy.revision++; this.state = copy; return result;
  }
}
function successfulBody(model: string) {
  return { model, usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "text",
    text: model === models[1] ? '{"verdict":"not_confirmed","analysis":"Need measured data."}' : "Measured proposal." }] };
}
describe("Sonnet 5.5 protocol fix and safe HTTP trace", () => {
  it.each(models)("uses the documented %s protocol and role output limit, no tools/fallback", async model => {
    const maxTokens = hintMaxOutput(HINT_AGENTS.find(a => a.modelId === model)!.agentId);
    const fetcher = vi.fn(async (_url: any, init: any) => {
      const b = JSON.parse(init.body);
      const opus = model === "claude-opus-5-5";
      if (b.thinking.type !== (opus ? "adaptive" : "between_tools")) return new Response(JSON.stringify({ error: {
        type: "invalid_request_error", message: 'To turn thinking off, send "thinking": {"type":"between_tools"} instead of disabled.' } }), { status: 400 });
      expect(b).toEqual({ model, max_tokens: maxTokens, system: CREW_SYSTEM,
        thinking: opus ? { type: "adaptive", display: "omitted" } : { type: "between_tools" },
        output_config: { effort: opus ? "low" : "high" }, messages: [{ role: "user", content: "same input" }] });
      return new Response(JSON.stringify(successfulBody(model)), { status: 200, headers: { "request-id": "req_protocol_123" } });
    });
    const p = new AnthropicCrewProvider(fetcher as any, () => key);
    const result = await p.message(model, "same input", maxTokens, new AbortController().signal);
    expect(result.http).toEqual({ httpStatus: 200, requestId: "req_protocol_123" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps the approved Haiku protocol unchanged, without activating Haiku", async () => {
    const fetcher = vi.fn(async (_u: any, i: any) => {
      expect(JSON.parse(i.body).thinking).toEqual({ type: "disabled" });
      return new Response(JSON.stringify(successfulBody("claude-haiku-5-5")));
    });
    await new AnthropicCrewProvider(fetcher as any, () => key).message("claude-haiku-5-5", "OK", 8, new AbortController().signal);
  });
  it.each([400, 401, 403, 404, 429, 500])("retains HTTP %i + request-id, never raw error/key, never retries", async status => {
    const fetcher = vi.fn(async () => new Response(`private error ${key}`, {
      status, headers: { "request-id": "req_error_123" },
    }));
    const p = new AnthropicCrewProvider(fetcher as any, () => key);
    let e: any; try { await p.message(models[0], "input", 2000, new AbortController().signal); } catch (error) { e = error; }
    expect(e).toBeInstanceOf(CrewProviderError);
    expect(e.http).toEqual({ httpStatus: status, requestId: "req_error_123" });
    expect(e.category).toBe("http_rejected"); expect(JSON.stringify(e)).not.toContain(key);
    expect(e.message).not.toContain("private"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["malformed header", key, "req_" + key])("does not store unsafe request-id %s", async id => {
    const p = new AnthropicCrewProvider(async () => new Response(JSON.stringify(successfulBody(models[0])),
      { headers: { "request-id": id } }), () => key);
    expect((await p.message(models[0], "", 2000, new AbortController().signal)).http?.requestId).toBeNull();
  });
  it("keeps HTTP 200 metadata when JSON/usage validation fails", async () => {
    for (const body of ["{invalid", JSON.stringify({ usage: {}, model: models[0] })]) {
      const p = new AnthropicCrewProvider(async () => new Response(body, { headers: { "request-id": "req_invalid_123" } }), () => key);
      await expect(p.message(models[0], "", 2000, new AbortController().signal))
        .rejects.toMatchObject({ http: { httpStatus: 200, requestId: "req_invalid_123" } });
    }
  });
  it("classifies transport/abort with null HTTP metadata, never guesses status", async () => {
    const c = new AbortController(); c.abort();
    const p = new AnthropicCrewProvider(async () => { throw Error(key); }, () => key);
    await expect(p.message(models[0], "", 2000, c.signal))
      .rejects.toMatchObject({ category: "aborted", http: { httpStatus: null, requestId: null } });
  });
  it("journals a real-shaped rejected response, charges conservatively and OFF; no retry", async () => {
    const s = fixture(); s.tasks = []; s.runs = []; s.journal = []; s.budget = {}; s.testGrant!.spent = 0;
    applyTestAction(s, { action: "prepare", candidate: "latency" }, at, models, evidence());
    const id = s.tasks[0].id;
    applyTestAction(s, { action: "enable", taskId: id }, at, []);
    applyTestAction(s, { action: "start", taskId: id }, at, []);
    const m = new Memory(s), fetcher = vi.fn(async () => new Response(key, { status: 400, headers: { "request-id": "req_rejected_123" } }));
    const rt = new CrewRuntime(m, new AnthropicCrewProvider(fetcher as any, () => key), "production", () => new Date(at));
    await rt.tick(); await rt.tick();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(m.state.control.enabled).toBe(false);
    expect(m.state.journal.find(e => e.kind === "anthropic_http_response")?.detail)
      .toMatchObject({ httpStatus: 400, requestId: "req_rejected_123", category: "http_rejected", stage: "provider" });
    expect(m.state.runs[0].status).toBe("unknown");
    expect(m.state.testGrant!.spent).toBeGreaterThan(0);
    expect(JSON.stringify(m.state)).not.toContain(key);
  });
});
describe("new task after the specifically approved charged failure", () => {
  it("preserves old unknown/reserve/spending, makes a NEW task, executes Sonnet→Opus and auto OFF", async () => {
    const s = fixture(), oldRun = structuredClone(s.runs[0]), money = structuredClone(s.budget);
    applyTestAction(s, { action: "prepare", candidate: "latency" }, at, models, evidence());
    expect(s.runs).toEqual([oldRun]);
    expect(s.budget).toEqual({ ...money, [at.slice(0, 10)]: { ...money[at.slice(0, 10)], spent: 36716 } });
    expect(s.testGrant!.spent).toBe(73432 + 36716);
    expect(s.journal.filter(e => e.kind === "sonnet_direct_diagnostic_accounted")).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ closed: true, phase: "outcome", hintPilot: { status: "not_completed" } });
    expect(isSupersededChargedUnknown(s, oldRun)).toBe(true);
    const id = s.tasks[1].id; expect(id).not.toBe(FAILED_PILOT_TASK);
    expect(s.control.enabled).toBe(false);
    applyTestAction(s, { action: "enable", taskId: id }, at, []);
    applyTestAction(s, { action: "start", taskId: id }, at, []);
    const m = new Memory(s), requests: string[] = [];
    const fetcher = vi.fn(async (_u: any, i: any) => {
      const b = JSON.parse(i.body); requests.push(b.model);
      expect(b.thinking.type).toBe(b.model === models[1] ? "adaptive" : "between_tools");
      expect(b.max_tokens).toBe(b.model === models[1] ? 4000 : 2000);
      return new Response(JSON.stringify(successfulBody(b.model)), { headers: { "request-id": "req_success_123" } });
    });
    const rt = new CrewRuntime(m, new AnthropicCrewProvider(fetcher as any, () => key), "production", () => new Date(at));
    await rt.tick(); await rt.tick(); await rt.tick();
    expect(requests).toEqual(models);
    expect(m.state.runs[0]).toEqual(oldRun); expect(m.state.runs).toHaveLength(3);
    expect(m.state.documents).toHaveLength(2); expect(m.state.control.enabled).toBe(false);
    expect(m.state.tasks[1].hintPilot).toMatchObject({ status: "owner", verdict: "not_confirmed" });
    expect(m.state.testGrant!.spent).toBe(73432 + 36716 + 2100);
    expect(m.state.journal.filter(e => e.kind === "anthropic_http_response")).toHaveLength(2);
    expect(m.state.budget[at.slice(0, 10)].reserved).toBe(36716);
  });
  it.each(["charge", "spent", "reserve", "identity", "models", "running", "otherUnknown"])("rejects unsafe %s without partial closure", mode => {
    const s = fixture();
    if (mode === "charge") s.journal = [];
    if (mode === "spent") s.testGrant!.spent = 0;
    if (mode === "reserve") s.budget[at.slice(0, 10)].reserved = 0;
    if (mode === "identity") s.runs[0].id = "other";
    if (mode === "running") s.runs[0].status = "running";
    if (mode === "otherUnknown") s.runs.push({ ...s.runs[0], id: "other", taskId: "other" });
    const before = structuredClone(s);
    expect(() => applyTestAction(s, { action: "prepare", candidate: "latency" }, at,
      mode === "models" ? [] : models, evidence())).toThrow();
    expect(s).toEqual(before);
  });
  it("bare closed-task marker never bypasses unknown protection", () => {
    const s = fixture(); s.tasks[0].closed = true; s.tasks[0].phase = "outcome"; s.tasks[0].hintPilot!.status = "not_completed";
    expect(isSupersededChargedUnknown(s, s.runs[0])).toBe(false);
    expect(() => applyTestAction(s, { action: "prepare", candidate: "latency" }, at, models, evidence())).toThrow();
  });
});
