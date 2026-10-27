import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { LabStore } from "./store";
import { hintLabTick, unavailableReport } from "./service";

// Opt-in integration tests: session-local TEMP tables, never fake calls in product history.
describe.skipIf(process.env.CALL_LAB_DB_TESTS !== "1")("private queue PostgreSQL / synthetic transport", () => {
  let pool: Pool, client: PoolClient, store: LabStore, facade: Pool;
  let next: any;
  const env = "development", owner = "fixture-owner";
  beforeAll(async () => {
    const url = process.env.DATABASE_URL!;
    expect(new URL(url).hostname).toBe("helium");
    pool = new Pool({ connectionString: url, max: 1 });
    client = await pool.connect();
    await client.query(`CREATE TEMP TABLE calls(call_sid text PRIMARY KEY,user_id text,started_at timestamptz,
      ended_at timestamptz,transcript text,metadata jsonb);
      CREATE TEMP TABLE call_lab_controls(LIKE public.call_lab_controls INCLUDING ALL);
      CREATE TEMP TABLE call_lab_jobs(LIKE public.call_lab_jobs INCLUDING ALL);
      CREATE TEMP TABLE call_lab_outbox(
        key text PRIMARY KEY REFERENCES call_lab_jobs(key) ON DELETE CASCADE,environment text,owner_id text,
        message_id text UNIQUE,status text DEFAULT 'prepared',gmail_id text,reconcile_count integer DEFAULT 0,
        created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
    const c = { query: client.query.bind(client), release: () => {} };
    facade = { query: c.query, connect: async () => c } as unknown as Pool;
    store = new LabStore(c);
  });
  beforeEach(async () => {
    vi.stubEnv("LAB_OWNER_ID", owner); vi.stubEnv("LAB_ENABLED", "true");
    vi.stubEnv("LAB_TARGET_ENVIRONMENT", env);
    await client.query("TRUNCATE call_lab_outbox,call_lab_jobs,call_lab_controls,calls");
    await client.query(`INSERT INTO call_lab_controls(key,environment,owner_id,recipient,connection_id,enabled,activated_at)
      VALUES($1,$2,$3,'owner@example.invalid','fixture',true,now()-interval '2 minutes')`, [`${env}:${owner}`, env, owner]);
    await client.query(`INSERT INTO calls VALUES('call-1',$1,now()-interval '1 minute',now(),'Owner: price, not mobile',
      jsonb_build_object('labHintSource',jsonb_build_object('mode','hint','environment',$2::text,'closedAt',now())))`, [owner, env]);
    next = {
      run: vi.fn(async (source: any) => ({ ...unavailableReport({ call_sid: source.call_id }, "fixture-only"),
        synthetic: true, qa_status: "QA: принято", execution: "mocked_synthetic_analysis" })),
      mail: { verify: vi.fn(async () => {}),
        sent: vi.fn().mockResolvedValueOnce(null).mockResolvedValue("fixture-gmail-id"),
        send: vi.fn(async () => "fixture-gmail-id") },
    };
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { client.release(); await pool.end(); });
  it("deduplicates jobs and atomically prepares one outbox; crash after send never reclaims as prepared", async () => {
    const key = await store.enqueue(env, owner, "call-1");
    await store.enqueue(env, owner, "call-1");
    expect((await client.query("SELECT count(*)::int AS n FROM call_lab_jobs")).rows[0].n).toBe(1);
    expect(await store.claim("production", owner)).toBeNull();
    expect(await store.claim(env, "other")).toBeNull();
    expect((await store.claim(env, owner)).key).toBe(key);
    expect(await store.claim(env, owner)).toBeNull();
    await store.finish(key, { fixture: true }, { synthetic: true });
    await store.finish(key, {}, {});
    expect((await client.query("SELECT count(*)::int AS n FROM call_lab_outbox")).rows[0].n).toBe(1);
    expect((await store.claimMail(env, owner)).key).toBe(key);
    await client.query("UPDATE call_lab_outbox SET updated_at=now()-interval '3 minutes'");
    await store.recover(env, owner);
    expect((await client.query("SELECT status FROM call_lab_outbox")).rows[0].status).toBe("unknown");
    expect(await store.claimMail(env, owner)).toBeNull();
  });
  it("retries crash recovery of analysis once, then fails without a loop", async () => {
    await store.enqueue(env, owner, "call-1");
    await store.claim(env, owner);
    await client.query("UPDATE call_lab_jobs SET updated_at=now()-interval '13 minutes'");
    await store.recover(env, owner);
    expect((await store.claim(env, owner)).attempts).toBe(2);
    await client.query("UPDATE call_lab_jobs SET updated_at=now()-interval '13 minutes'");
    await store.recover(env, owner);
    expect(await store.claim(env, owner)).toBeNull();
    expect((await client.query("SELECT status FROM call_lab_jobs")).rows[0].status).toBe("failed");
  });
  it("runs one synthetic full tick and sends exactly once across duplicate ticks", async () => {
    await hintLabTick(facade, next); await hintLabTick(facade, next);
    expect(next.run).toHaveBeenCalledTimes(1);
    expect(next.mail.send).toHaveBeenCalledTimes(1);
    expect((await client.query("SELECT status FROM call_lab_outbox")).rows[0].status).toBe("sent_confirmed");
    expect(next.run.mock.calls[0][0].full_hint_history).toBe(false);
  });
  it("lost send response is reconciled by Message-ID, never resent", async () => {
    next.mail.send.mockRejectedValue(new Error("simulated lost response"));
    next.mail.sent = vi.fn().mockResolvedValueOnce(null).mockResolvedValue("lost-response-gmail-id");
    await hintLabTick(facade, next);
    expect((await client.query("SELECT status FROM call_lab_outbox")).rows[0].status).toBe("unknown");
    await client.query("UPDATE call_lab_outbox SET updated_at=now()-interval '3 minutes'");
    await hintLabTick(facade, next);
    expect(next.mail.send).toHaveBeenCalledTimes(1);
    expect((await client.query("SELECT status FROM call_lab_outbox")).rows[0].status).toBe("sent_confirmed");
  });
  it("scope rejects other owners, modes, environments and calls before activation", async () => {
    for (const [sid, who, mode, e, start] of [
      ["other", "other-owner", "hint", env, "1 minute"], ["translator", owner, "translator", env, "1 minute"],
      ["prod", owner, "hint", "production", "1 minute"], ["old", owner, "hint", env, "1 day"],
    ]) await client.query(`INSERT INTO calls VALUES($1,$2,now()-$5::interval,now(),'fixture',
      jsonb_build_object('labHintSource',jsonb_build_object('mode',$3::text,'environment',$4::text,'closedAt',now())))`, [sid, who, mode, e, start]);
    await hintLabTick(facade, next);
    expect(next.run).toHaveBeenCalledTimes(1);
    expect((await client.query("SELECT call_sid FROM call_lab_jobs")).rows.map(r => r.call_sid)).toEqual(["call-1"]);
  });
  it("kill switch prevents analysis and mail but retention still runs", async () => {
    await client.query("UPDATE call_lab_controls SET enabled=false");
    await hintLabTick(facade, next);
    expect(next.run).not.toHaveBeenCalled();
    expect(next.mail.verify).not.toHaveBeenCalled();
    expect(next.mail.send).not.toHaveBeenCalled();
  });
  it("missing source produces an honest blocked letter without invoking an agent", async () => {
    await client.query("UPDATE calls SET transcript=NULL");
    await hintLabTick(facade, next);
    expect(next.run).not.toHaveBeenCalled();
    expect(next.mail.send).toHaveBeenCalledTimes(1);
    expect(next.mail.send.mock.calls[0][2].qa_status).toBe("НЕ ПРОВЕРЕНО QA");
  });
  it("retains raw copy seven days, annotations ninety; removes source-deleted jobs", async () => {
    const key = await store.enqueue(env, owner, "call-1");
    await store.claim(env, owner); await store.finish(key, { private: "fixture" }, { annotations: "fixture" });
    await client.query("UPDATE call_lab_jobs SET created_at=now()-interval '8 days'");
    await store.retention(env, owner);
    expect((await client.query("SELECT source,report FROM call_lab_jobs")).rows[0]).toEqual({ source: null, report: { annotations: "fixture" } });
    await client.query("UPDATE call_lab_jobs SET created_at=now()-interval '91 days'");
    await store.retention(env, owner);
    expect((await client.query("SELECT count(*)::int AS n FROM call_lab_outbox")).rows[0].n).toBe(0);
    const k2 = await store.enqueue(env, owner, "call-1");
    await store.claim(env, owner); await store.finish(k2, {}, {});
    await client.query("DELETE FROM calls");
    await store.retention(env, owner);
    expect((await client.query("SELECT count(*)::int AS n FROM call_lab_jobs")).rows[0].n).toBe(0);
  });
});
