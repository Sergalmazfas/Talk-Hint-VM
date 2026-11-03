import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { initialState, type CrewState } from "./domain";
import { COMPLETED_HINT_TASK, finalizeHintSeries } from "./finalizeHintSeries";
import { FAILED_PILOT_RUN, FAILED_PILOT_TASK } from "./failedPilot";
import { HINT_AGENTS } from "./hintPilot";
import { applyTestAction, authorizeTest, keyHash, revokeTest, validGrant } from "./testGrant";
import { registerTestMcp } from "./testMcp";
import { configureSecretary, SECRETARY_AGENTS } from "./secretaryReview";

const at = "2026-11-03T14:00:00.000Z", series = "56a644e1-7ceb-4463-a3ef-4d112928ac1d";
const key = "unit-test-only-not-a-real-secret-".repeat(3);
function fixture(): CrewState {
  const s = initialState();
  authorizeTest(s, keyHash(key), at);
  s.testGrant!.id = series; s.testGrant!.spent = 191334;
  s.control = { enabled: false, epoch: 11, testSeriesId: series, dailyLimitMicroUsd: 5e6, staleHours: 24 };
  s.tasks = [
    { id: COMPLETED_HINT_TASK, title: "Hint latency", closed: false, phase: "analysis", testSeriesId: series,
      steps: [{ phase: "analysis", actor: "replit-test", holder: "replit-test", updatedAt: at, note: "готово" }],
      hintPilot: { candidate: "latency", ownerId: "replit-test", status: "owner", verdict: "not_confirmed",
        proposalId: "proposal", reviewId: "review", evidence: {} as any, evidenceHash: "hash",
        pricingUrl: "https://example.test", ratesConfirmedBy: "replit-test" } },
    { id: FAILED_PILOT_TASK, title: "unknown", closed: true, phase: "outcome", testSeriesId: series, steps: [],
      hintPilot: { candidate: "latency", ownerId: "replit-test", status: "not_completed",
        evidence: {} as any, evidenceHash: "old", pricingUrl: "https://example.test", ratesConfirmedBy: "replit-test" } },
  ];
  s.runs = HINT_AGENTS.map((a, i) => ({ id: `done-${i}`, taskId: COMPLETED_HINT_TASK,
    agentId: a.agentId, modelId: a.modelId, status: "done", at, day: "2026-11-02",
    eventId: `event-${i}`, testSeriesId: series, cost: [23914, 57272][i], reserved: [36716, 140676][i] }));
  s.runs.push({ id: FAILED_PILOT_RUN, taskId: FAILED_PILOT_TASK, agentId: HINT_AGENTS[0].agentId,
    status: "unknown", at, day: "2026-11-02", eventId: "old", testSeriesId: series, reserved: 36716 });
  s.documents = HINT_AGENTS.map((a, i) => ({ id: ["proposal", "review"][i], taskId: COMPLETED_HINT_TASK,
    runId: `done-${i}`, agentId: a.agentId, at, text: i ? '{"verdict":"not_confirmed","analysis":"ошибка"}' : "Разбор Паши",
    status: "proposed" }));
  s.budget = { "2026-11-01": { spent: 36716, reserved: 0 }, "2026-11-02": { spent: 117902, reserved: 36716 } };
  s.journal.push(
    { id: "charged", actor: "replit-test", at, kind: "crew_test_unknown_charged",
      detail: { runId: FAILED_PILOT_RUN, chargedMicroUsd: 36716 } },
    { id: "superseded", actor: "replit-test", at, kind: "failed_pilot_superseded",
      detail: { runId: FAILED_PILOT_RUN, seriesId: series } });
  return s;
}
describe("one owner-approved Hint series completion", () => {
  it("closes the completed analysis without acceptance, settles only daily reserve, leaves OFF and key revocable", () => {
    const s = fixture(), before = structuredClone(s);
    applyTestAction(s, { action: "finalize_hint_series" }, at, []);
    expect(s.control).toEqual({ enabled: false, epoch: 12, dailyLimitMicroUsd: 5e6, staleHours: 24 });
    expect(s.testGrant).toEqual(before.testGrant); // Already charged; NOT another 36716 against the series.
    expect(s.budget["2026-11-02"]).toEqual({ spent: 154618, reserved: 0 });
    expect(s.budget["2026-11-01"]).toEqual(before.budget["2026-11-01"]);
    expect(s.runs.slice(0, 2)).toEqual(before.runs.slice(0, 2));
    expect(s.runs[2]).toEqual({ ...before.runs[2], reserved: 0, cost: 36716, status: "unknown" });
    expect(s.documents).toEqual(before.documents);
    expect(s.tasks[1]).toEqual(before.tasks[1]);
    expect(s.tasks[0]).toMatchObject({ closed: true, phase: "outcome", hintPilot: { verdict: "not_confirmed" } });
    expect(s.tasks[0].steps.at(-1)?.approved).toBeUndefined();
    expect(s.tasks[0].steps.at(-1)?.met).toBeUndefined();
    expect(s.hintSeriesCompletion).toMatchObject({ amountMicroUsd: 36716, ownerAcceptance: false, providerOutcome: "unknown" });
    expect(s.journal.at(-1)).toMatchObject({ actor: "replit-test", kind: "hint_series_finalized" });
    expect(validGrant(s, Date.parse(at))).toBe(true);
    expect(() => configureSecretary(s, true, 20e6, "owner", at, SECRETARY_AGENTS.map(a => a.modelId), 1e6)).not.toThrow();
    expect(s.control.enabled).toBe(true); // Only this explicit owner command activates it.
    revokeTest(s, "owner", at);
    expect(s.testGrant?.revokedAt).toBe(at);
  });
  it("a second command cannot double charge or re-open the paid pilot", () => {
    const s = fixture(); applyTestAction(s, { action: "finalize_hint_series" }, at, []);
    const after = structuredClone(s);
    expect(() => applyTestAction(s, { action: "finalize_hint_series" }, at, [])).toThrow("ALREADY_FINALIZED");
    expect(() => applyTestAction(s, { action: "prepare", candidate: "latency" }, at, [])).toThrow("NO_NEW_PILOTS");
    expect(s).toEqual(after);
  });
  const unsafe: Record<string, (s: CrewState) => void> = {
    ON: s => { s.control.enabled = true; },
    secretaryOn: s => { s.secretarySettings = { enabled: true, ownerId: "owner", activatedAt: at, monthlyLimitMicroUsd: 20e6 }; },
    queued: s => { s.runs[0].status = "queued"; },
    running: s => { s.runs[0].status = "running"; },
    schedules: s => { s.schedules.push({ taskId: "x", agentId: "x", everyMinutes: 60, nextAt: at }); },
    wrongSeries: s => { s.control.testSeriesId = "other"; },
    reservedGrant: s => { s.testGrant!.reserved = 1; },
    missingCharge: s => { s.journal = []; },
    missingRun: s => { s.runs.pop(); },
    wrongRun: s => { s.runs[2].id = "other"; },
    wrongAmount: s => { s.runs[2].reserved = 36715; },
    settledAlready: s => { s.runs[2].cost = 36716; },
    missingDocument: s => { s.documents.pop(); },
    crossLinkedDocument: s => { s.documents[1].runId = s.runs[0].id; },
    sameModel: s => { s.runs[1].modelId = s.runs[0].modelId; },
    closedTask: s => { s.tasks[0].closed = true; },
    wrongVerdict: s => { s.tasks[0].hintPilot!.verdict = "confirmed"; },
    anotherUnknown: s => { s.runs.push({ ...s.runs[2], id: "other" }); },
    duplicateUnknown: s => { s.runs.push({ ...s.runs[2] }); },
    duplicateTask: s => { s.tasks.push(structuredClone(s.tasks[0])); },
    anotherOpenTask: s => { s.tasks.push({ ...s.tasks[0], id: "other" }); },
    extraReserve: s => { s.budget.other = { spent: 0, reserved: 1 }; },
    badSpent: s => { s.budget["2026-11-02"].spent = -1; },
    revoked: s => { s.testGrant!.revokedAt = at; },
    expired: s => { s.testGrant!.expiresAt = at; },
  };
  it.each(Object.entries(unsafe))("refuses %s before any mutation", (_name, change) => {
    const s = fixture(); change(s); const before = structuredClone(s);
    expect(() => applyTestAction(s, { action: "finalize_hint_series" }, at, [])).toThrow();
    expect(s).toEqual(before);
  });
  it("survives jsonb-style object reordering and preserves unknown fields", () => {
    const reorder = (x: any): any => Array.isArray(x) ? x.map(reorder) :
      x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, reorder(x[k])])) : x;
    const s = reorder({ ...fixture(), futureField: { accepted: "preserve" } });
    finalizeHintSeries(s, at);
    expect(s.futureField).toEqual({ accepted: "preserve" });
    expect(JSON.parse(JSON.stringify(s)).hintSeriesCompletion.ownerAcceptance).toBe(false);
  });
  it("MCP requires key, scope, fresh revision and UUID; readback, replay and concurrent CAS are safe", async () => {
    let state = fixture();
    const store = { read: async () => structuredClone(state), change: async (fn: any, rev?: number) => {
      if (rev !== undefined && rev !== state.revision) throw Error("STALE_REVISION");
      const draft = structuredClone(state), result = fn(draft);
      draft.revision++; state = draft; return result;
    } };
    const app = express(), models = vi.fn(), evidence = vi.fn();
    registerTestMcp(app, { environment: "production", store: () => store, secret: () => key,
      models, evidence, model: vi.fn(), now: () => new Date(at) });
    const args = { revision: 0, requestId: "362865bd-be5a-41e8-8084-64a5f4b6022e", command: { action: "finalize_hint_series" } };
    const rpc = (a: any, suppliedKey = key, origin = "") => {
      let r = request(app).post("/api/crew-test/mcp").set("X-API-Key", suppliedKey);
      if (origin) r = r.set("Origin", origin);
      return r.send({ jsonrpc: "2.0", id: "test", method: "tools/call",
        params: { name: "crew_test_finalize_hint_series", arguments: a } });
    };
    expect((await rpc(args, "")).status).toBe(403);
    expect((await rpc(args, key, "https://talkhint.app")).status).toBe(403);
    expect((await rpc({ ...args, revision: 1 })).body.error).toBeTruthy();
    expect((await rpc({ ...args, command: { action: "finalize_hint_series", taskId: "other" } })).body.error).toBeTruthy();
    expect(state.revision).toBe(0);
    const results = await Promise.all([rpc(args), rpc(args)]);
    expect(results.filter(r => r.body.result)).toHaveLength(1);
    expect(state.revision).toBe(1);
    const spent = state.testGrant!.spent, budget = structuredClone(state.budget);
    expect((await rpc({ ...args, revision: 1 })).body.error).toBeTruthy();
    const read = await request(app).post("/api/crew-test/mcp").set("X-API-Key", key).send({
      jsonrpc: "2.0", id: "read", method: "tools/call", params: { name: "crew_test_state", arguments: {} },
    });
    const result = JSON.parse(read.body.result.content[0].text);
    expect(result.hintSeriesCompletion.ownerAcceptance).toBe(false);
    expect(result.control.enabled).toBe(false);
    expect(result.control.testSeriesId).toBeUndefined();
    expect(result.grant.keyHash).toBeUndefined();
    expect(state.testGrant!.spent).toBe(spent); expect(state.budget).toEqual(budget);
    expect(models).not.toHaveBeenCalled(); expect(evidence).not.toHaveBeenCalled();
  });
});
