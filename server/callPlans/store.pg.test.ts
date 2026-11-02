import { Pool } from "pg";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { CallPlanStore } from "./store";

const plan = { goal: "Ask stock", ownerFacts: [], sayAsk: ["Stock?"], expectedQuestions: [],
  unknowns: [], disclosurePolicy: { allowed: ["Tire"], forbidden: [] }, language: "en", executor: "hint" };

describe("durable call plan binding in PostgreSQL (temporary tables only)", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let c: Awaited<ReturnType<Pool["connect"]>>;
  let store: CallPlanStore;
  beforeAll(async () => {
    c = await pool.connect();
    await c.query(`CREATE TEMP TABLE hint_call_plans(
      id varchar PRIMARY KEY,user_id varchar NOT NULL,request_id varchar NOT NULL,plan jsonb NOT NULL,
      plan_hash text NOT NULL,target_phone text,status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,call_sid text,
      UNIQUE(user_id,request_id),UNIQUE(call_sid));
      CREATE TEMP TABLE calls(id varchar,user_id varchar,call_sid text UNIQUE,direction text,to_number text,
        started_at timestamptz DEFAULT now(),metadata jsonb);`);
    // The same real PG connection retains temporary tables; service commits remain real.
    store = new CallPlanStore({ connect: async () => ({ query: c.query.bind(c), release() {} }) } as any);
  });
  beforeEach(async () => { await c.query("TRUNCATE pg_temp.hint_call_plans,pg_temp.calls"); });
  afterAll(async () => { c?.release(); await pool.end(); });
  const call = (sid: string, owner = "alice", phone = "+12025550123", direction = "outgoing", mode = "hint") =>
    c.query("INSERT INTO pg_temp.calls(id,user_id,call_sid,direction,to_number,metadata) VALUES($1::varchar,$2,$1::text,$3,$4,$5::jsonb)",
      [sid, owner, direction, phone, JSON.stringify({ mode, unrelated: "preserved" })]);
  it("persists canonical hash despite jsonb reordering and consumes once with metadata intact", async () => {
    const saved = await store.save("alice", randomUUID(), plan);
    await call("one");
    const bound = await store.bind("alice", "one");
    expect(bound).toMatchObject({ id: saved.id, hash: saved.planHash, plan });
    expect(await store.bind("alice", "one")).toEqual(bound);
    const row = (await c.query("SELECT metadata FROM pg_temp.calls")).rows[0];
    expect(row.metadata).toMatchObject({ unrelated: "preserved", goalText: plan.goal, callPlan: bound });
    await call("two");
    expect(await store.bind("alice", "two")).toBeNull();
  });
  it("reuses a request without extending TTL, including after consumption; rejects changed payload", async () => {
    const id = randomUUID(), saved = await store.save("alice", id, plan);
    const replay = await store.save("alice", id, plan);
    expect(replay).toMatchObject({ ...saved, reused: true });
    await expect(store.save("alice", id, { ...plan, goal: "Changed" })).rejects.toMatchObject({ status: 409 });
    await call("one");
    await store.bind("alice", "one");
    expect(await store.save("alice", id, plan)).toMatchObject({ id: saved.id, status: "consumed", reused: true });
  });
  it("enforces 24h expiration and never binds a plan created after the call began", async () => {
    const saved = await store.save("alice", randomUUID(), plan);
    const row = (await c.query("SELECT extract(epoch from expires_at-created_at) AS seconds FROM pg_temp.hint_call_plans")).rows[0];
    expect(Number(row.seconds)).toBe(86400);
    await call("one");
    await c.query("UPDATE pg_temp.calls SET started_at=now()-interval '1 day'");
    expect(await store.bind("alice", "one")).toBeNull();
    await c.query("UPDATE pg_temp.hint_call_plans SET expires_at=now()-interval '1 second' WHERE id=$1", [saved.id]);
    await call("two");
    expect(await store.bind("alice", "two")).toBeNull();
  });
  it("matches specific number before generic; other numbers and owners cannot steal it", async () => {
    const generic = await store.save("alice", randomUUID(), plan);
    const specific = await store.save("alice", randomUUID(), { ...plan, targetPhone: "+12025550123" });
    await call("foreign", "bob");
    expect(await store.bind("bob", "foreign")).toBeNull();
    expect(await store.bind("bob", "missing")).toBeNull();
    await call("exact");
    expect((await store.bind("alice", "exact")).id).toBe(specific.id);
    await call("other", "alice", "+12025550124");
    expect((await store.bind("alice", "other")).id).toBe(generic.id);
  });
  it("does not consume on incoming, Copilot, Translator or Secretary calls", async () => {
    await store.save("alice", randomUUID(), plan);
    for (const mode of ["copilot", "translator", "secretary"]) {
      await call(mode, "alice", "+12025550123", "outgoing", mode);
      expect(await store.bind("alice", mode)).toBeNull();
    }
    await call("incoming", "alice", "+12025550123", "incoming");
    expect(await store.bind("alice", "incoming")).toBeNull();
    expect((await c.query("SELECT status FROM pg_temp.hint_call_plans")).rows[0].status).toBe("pending");
  });
  it("supersedes only a matching pending target, never deletes history", async () => {
    await store.save("alice", randomUUID(), plan);
    await store.save("alice", randomUUID(), { ...plan, targetPhone: "+12025550124" });
    await store.save("alice", randomUUID(), { ...plan, goal: "Updated" });
    const rows = (await c.query("SELECT status FROM pg_temp.hint_call_plans")).rows;
    expect(rows).toHaveLength(3);
    expect(rows.filter(r => r.status === "superseded")).toHaveLength(1);
  });
  it("rolls back consumption on a hash mismatch and rejects Secretary payloads", async () => {
    await expect(store.save("alice", randomUUID(), { ...plan, executor: "secretary" })).rejects.toMatchObject({ status: 400 });
    await store.save("alice", randomUUID(), plan);
    await call("one");
    await c.query("UPDATE pg_temp.hint_call_plans SET plan_hash='tampered'");
    await expect(store.bind("alice", "one")).rejects.toThrow("CALL_PLAN_HASH_MISMATCH");
    expect((await c.query("SELECT status FROM pg_temp.hint_call_plans")).rows[0].status).toBe("pending");
    expect((await c.query("SELECT metadata FROM pg_temp.calls")).rows[0].metadata.callPlan).toBeUndefined();
  });
});
