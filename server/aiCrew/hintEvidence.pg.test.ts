import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { readHintEvidence } from "./hintEvidence";
describe.skipIf(process.env.CREW_RUNTIME_PG_TEST !== "true")("Hint excerpt actual PostgreSQL owner isolation", () => {
  it("reads only owner production Hint; strips raw text/PII and rolls back on errors", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, max: 1 });
    const c = await pool.connect();
    try {
      await c.query("CREATE TEMP TABLE calls(user_id text,metadata jsonb,started_at timestamptz)");
      await c.query("CREATE TEMP TABLE call_lab_jobs(owner_id text,environment text,report jsonb,created_at timestamptz)");
      await c.query("CREATE TEMP TABLE call_lab_controls(owner_id text,environment text,watchdog jsonb)");
      const meta = { labHintSource: { mode: "hint", environment: "production" },
        transcript: "Guest Alice +1 555-222-3333", hintLatency: { slaMs: 1000,
          summary: { e2eP95Ms: 4063, stageNotes: ["Alice"] },
          entries: [{ text: "Alice +1 555-222-3333", dropReason: "stale" }] },
        hintUsage: { delivered: 15, usageRatePct: 20, matchedOwnerText: "Alice" } };
      await c.query("INSERT INTO calls VALUES($1,$2,now()),($3,$4,now()),($1,$5,now()),($1,$6,now())",
        ["owner", JSON.stringify(meta), "other", JSON.stringify({ ...meta, hintLatency: { summary: { e2eP95Ms: 99999 } } }),
          JSON.stringify({ ...meta, labHintSource: { mode: "secretary", environment: "production" } }),
          JSON.stringify({ ...meta, labHintSource: { mode: "hint", environment: "development" } })]);
      const report = { mode: "hint", synthetic: false, qa_status: "QA: принято",
        analysis: { findings: [{ category: "неизвестно", evidence: "Alice" }], summary_ru: "Alice" } };
      await c.query("INSERT INTO call_lab_jobs VALUES($1,'production',$2,now()),('other','production',$2,now()),($1,'development',$2,now())",
        ["owner", JSON.stringify(report)]);
      await c.query("INSERT INTO call_lab_controls VALUES('owner','production',$1),('other','production',$1)",
        [JSON.stringify({ x: { code: "ANALYSIS_UNAVAILABLE", reason: "Alice" } })]);
      const wrapper: any = { connect: async () => ({ query: (...a: any[]) => c.query(...a as [any]), release() {} }) };
      const e = await readHintEvidence(wrapper, "owner");
      expect(e.calls).toHaveLength(1); expect(e.reports).toHaveLength(1);
      expect(e.calls[0].latency.e2eP95Ms).toBe(4063); expect(e.calls[0].errors.stale).toBe(1);
      expect(e.problems).toEqual([{ ref: "problem-1", code: "ANALYSIS_UNAVAILABLE", count: 1 }]);
      expect(JSON.stringify(e)).not.toContain("Alice"); expect(JSON.stringify(e)).not.toContain("555");
      expect((await readHintEvidence(wrapper, "unbound")).calls).toEqual([]);
      // Independent failure path: sanitized error and no transaction left open.
      const failing: any = { connect: async () => ({ query: async (sql: string) => {
        if (sql.startsWith("\n      SELECT c.")) throw Error("private connection or query text");
        return c.query(sql);
      }, release() {} }) };
      await expect(readHintEvidence(failing, "owner")).rejects.toThrow("HINT_EVIDENCE_UNAVAILABLE");
      expect((await c.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally { c.release(); await pool.end(); }
  });
});
