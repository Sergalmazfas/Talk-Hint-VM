import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { CrewStore } from "./store";
import { applyOwnerCommand, initialState, log } from "./domain";
import { HINT_AGENTS } from "./hintPilot";
import { projectHintEvidence } from "./hintEvidence";
import { authorizeTest, applyTestAction, keyHash } from "./testGrant";
import { FAILED_PILOT_TASK, FAILED_PILOT_RUN, isSupersededChargedUnknown } from "./failedPilot";

describe.skipIf(process.env.CREW_RUNTIME_PG_TEST !== "true")("new Sonnet pilot PostgreSQL", () => {
  it("keeps old unknown/daily reserve, atomically accounts one diagnostic and new task through jsonb/restart", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
    const c = await pool.connect();
    try {
      const at = "2026-11-02T02:00:00Z", s = initialState(), models = HINT_AGENTS.map(a => a.modelId);
      const e = projectHintEvidence({ calls: [{ latency: { e2eP95Ms: 4200 }, sla: 1000 }], reports: [], problems: [] });
      authorizeTest(s, keyHash("fixture".repeat(10)), at);
      applyOwnerCommand(s, { kind: "hint_pilot_prepare", candidate: "latency", ratesConfirmed: true }, "replit-test", at, models, e);
      s.tasks[0].id = FAILED_PILOT_TASK; s.tasks[0].testSeriesId = s.testGrant!.id;
      applyOwnerCommand(s, { kind: "control", enabled: true, dailyLimitMicroUsd: 5_000_000, staleHours: 24 }, "owner", at);
      applyOwnerCommand(s, { kind: "hint_pilot_start", taskId: FAILED_PILOT_TASK, ownerApproved: true }, "replit-test", at);
      Object.assign(s.runs[0], { id: FAILED_PILOT_RUN, status: "unknown", day: "2026-11-02",
        reserved: 36716, testSeriesId: s.testGrant!.id });
      s.control.enabled = false; s.control.testSeriesId = s.testGrant!.id;
      s.testGrant!.spent = 73432; s.budget["2026-11-02"] = { spent: 0, reserved: 36716 };
      log(s, "replit-test", "crew_test_unknown_charged", { runId: FAILED_PILOT_RUN, chargedMicroUsd: 36716 }, at);
      await c.query("CREATE TEMP TABLE ai_crew_runtime_state(environment text PRIMARY KEY,state jsonb NOT NULL,updated_at timestamptz DEFAULT now())");
      await c.query("INSERT INTO ai_crew_runtime_state(environment,state) VALUES($1,$2::jsonb)", ["development", JSON.stringify(s)]);
      const wrapper: any = { query: (...a: any[]) => c.query(...a as [any]),
        connect: async () => ({ query: (...a: any[]) => c.query(...a as [any]), release: () => {} }) };
      const store = new CrewStore(wrapper, "development"), command = { action: "prepare", candidate: "latency" };
      await expect(store.change(x => { applyTestAction(x, command, at, models, e); throw Error("rollback"); }, 0)).rejects.toThrow("rollback");
      expect(await store.read()).toEqual(s);
      await expect(store.change(x => applyTestAction(x, command, at, models, e), 99)).rejects.toThrow("STALE");
      await store.change(x => applyTestAction(x, command, at, models, e), 0);
      const after = await new CrewStore(wrapper, "development").read();
      expect(after.revision).toBe(1);
      expect(after.runs).toEqual(s.runs);
      expect(after.tasks).toHaveLength(2); expect(after.tasks[0].closed).toBe(true);
      expect(isSupersededChargedUnknown(after, after.runs[0])).toBe(true);
      expect(after.testGrant!.spent).toBe(110148);
      expect(after.budget["2026-11-02"]).toEqual({ spent: 36716, reserved: 36716 });
      await expect(store.change(x => applyTestAction(x, command, at, models, e), 1)).rejects.toThrow();
      expect(await store.read()).toEqual(after);
    } finally { c.release(); await pool.end(); }
  });
});
