import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { CrewStore } from "./store";
import { applyOwnerCommand, initialState } from "./domain";
import { HINT_AGENTS } from "./hintPilot";
import { projectHintEvidence } from "./hintEvidence";
import { applyTestAction, authorizeTest, keyHash } from "./testGrant";
import { hasLegacyWriteoff, LEGACY_TASK_ID } from "./legacyUnknown";

describe.skipIf(process.env.CREW_RUNTIME_PG_TEST !== "true")("legacy unknown actual PostgreSQL jsonb/CAS", () => {
  it("atomically transfers the exact reserve to spent across jsonb/restart, stale/replay/rollback", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
    const c = await pool.connect();
    try {
      const s = initialState(), oldAt = "2026-11-01T09:00:00Z", at = "2026-11-02T10:00:00Z";
      applyOwnerCommand(s, { kind: "hint_pilot_prepare", candidate: "latency", ratesConfirmed: true },
        "owner", oldAt, HINT_AGENTS.map(a => a.modelId),
        projectHintEvidence({ calls: [{ latency: { e2eP95Ms: 4000 }, sla: 1000 }], reports: [], problems: [] }));
      s.tasks[0].id = LEGACY_TASK_ID; (s.journal[0].detail as any).taskId = LEGACY_TASK_ID;
      applyOwnerCommand(s, { kind: "control", enabled: true, dailyLimitMicroUsd: 5_000_000, staleHours: 24 }, "owner", oldAt);
      applyOwnerCommand(s, { kind: "hint_pilot_start", taskId: s.tasks[0].id, ownerApproved: true }, "owner", oldAt);
      s.control.enabled = false;
      Object.assign(s.runs[0], { status: "unknown", day: "2026-11-01", reserved: 36716 });
      s.budget["2026-11-01"] = { spent: 123, reserved: 36716 };
      authorizeTest(s, keyHash("fixture".repeat(10)), at);
      // Connection-local TEMP table in Dev. Never initializes/mutates production.
      await c.query("CREATE TEMP TABLE ai_crew_runtime_state(environment text PRIMARY KEY,state jsonb NOT NULL,updated_at timestamptz DEFAULT now())");
      await c.query("INSERT INTO ai_crew_runtime_state(environment,state) VALUES($1,$2::jsonb)", ["development", JSON.stringify(s)]);
      const wrapper: any = { query: (...a: any[]) => c.query(...a as [any]),
        connect: async () => ({ query: (...a: any[]) => c.query(...a as [any]), release: () => {} }) };
      const store = new CrewStore(wrapper, "development");
      const command = { action: "writeoff_legacy_unknown" };
      await expect(store.change(x => { applyTestAction(x, command, at, []); throw Error("rollback"); }, 0)).rejects.toThrow("rollback");
      expect(await store.read()).toEqual(s);
      await expect(store.change(x => applyTestAction(x, command, at, []), 99)).rejects.toThrow("STALE_REVISION");
      await store.change(x => applyTestAction(x, command, at, []), 0);
      const restarted = new CrewStore(wrapper, "development"), saved = await restarted.read();
      expect(saved.revision).toBe(1); expect(saved.testGrant!.spent).toBe(36716);
      expect(saved.budget["2026-11-01"]).toEqual({ spent: 123 + 36716, reserved: 0 });
      expect(saved.runs[0]).toMatchObject({ status: "discarded", reserved: 0, cost: 36716 });
      expect(hasLegacyWriteoff(saved)).toBe(true);
      await expect(restarted.change(x => applyTestAction(x, command, at, []), 1)).rejects.toThrow("NOT_WRITABLE");
      expect(await store.read()).toEqual(saved);
    } finally { c.release(); await pool.end(); }
  });
});
