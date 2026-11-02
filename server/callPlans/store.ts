import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { callPlanSchema, type CallPlan } from "../../shared/callPlan";

export const planHash = (plan: CallPlan) => createHash("sha256").update(JSON.stringify(callPlanSchema.parse(plan))).digest("hex");
export const PLAN_TTL_MS = 24 * 60 * 60_000;
type Query = Pick<PoolClient, "query">;

/** A per-owner advisory transaction lock serializes save, supersession and consumption. */
export class CallPlanStore {
  constructor(private pool: Pick<Pool, "connect">) {}
  /** Read only: opening Prepare must never consume, extend or activate a plan. */
  async pending(owner: string) {
    const c = await this.pool.connect();
    try {
      const { rows } = await c.query(`SELECT id,plan,plan_hash,created_at,expires_at
        FROM hint_call_plans WHERE user_id=$1 AND status='pending' AND expires_at>now()
        ORDER BY created_at DESC,id LIMIT 50`, [owner]);
      return rows.map(row => {
        const plan = callPlanSchema.parse(row.plan);
        if (plan.executor !== "hint" || planHash(plan) !== row.plan_hash) throw new Error("CALL_PLAN_HASH_MISMATCH");
        return { id: row.id, planHash: row.plan_hash, plan,
          createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() };
      });
    } finally { c.release(); }
  }
  private async transaction<T>(owner: string, fn: (c: Query) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hint-call-plan:${owner}`]);
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  }
  async save(owner: string, requestId: string, raw: unknown) {
    const plan = callPlanSchema.parse(raw);
    if (plan.executor !== "hint") throw Object.assign(new Error("Hint executor required"), { status: 400 });
    const hash = planHash(plan);
    return this.transaction(owner, async c => {
      const old = (await c.query("SELECT * FROM hint_call_plans WHERE user_id=$1 AND request_id=$2", [owner, requestId])).rows[0];
      if (old) {
        if (old.plan_hash !== hash) throw Object.assign(new Error("Request ID already belongs to another plan"), { status: 409 });
        return { id: old.id, status: old.status, planHash: hash, expiresAt: old.expires_at, reused: true };
      }
      // A deliberate new request replaces only the same pending target, never a consumed plan.
      await c.query(`UPDATE hint_call_plans SET status='superseded'
        WHERE user_id=$1 AND status='pending' AND target_phone IS NOT DISTINCT FROM $2`, [owner, plan.targetPhone ?? null]);
      const id = randomUUID();
      const row = (await c.query(`INSERT INTO hint_call_plans
        (id,user_id,request_id,plan,plan_hash,target_phone,expires_at)
        VALUES($1,$2,$3,$4::jsonb,$5,$6,now()+interval '24 hours') RETURNING expires_at`,
      [id, owner, requestId, JSON.stringify(plan), hash, plan.targetPhone ?? null])).rows[0];
      return { id, status: "pending", planHash: hash, expiresAt: row.expires_at, reused: false };
    });
  }
  async bind(owner: string, sid: string) {
    return this.transaction(owner, async c => {
      const call = (await c.query("SELECT * FROM calls WHERE user_id=$1 AND call_sid=$2", [owner, sid])).rows[0];
      if (!call || call.direction !== "outgoing" ||
          (call.metadata?.mode && call.metadata.mode !== "hint")) return null;
      if (call.metadata?.callPlan) return call.metadata.callPlan;
      const old = (await c.query("SELECT * FROM hint_call_plans WHERE user_id=$1 AND call_sid=$2", [owner, sid])).rows[0];
      const row = old ?? (await c.query(`SELECT * FROM hint_call_plans
        WHERE user_id=$1 AND status='pending' AND expires_at>now()
        AND created_at<=$3 AND (target_phone=$2 OR target_phone IS NULL)
        ORDER BY (target_phone IS NOT NULL) DESC,created_at DESC,id LIMIT 1`,
      [owner, call.to_number, call.started_at])).rows[0];
      if (!row) return null;
      const plan = callPlanSchema.parse(row.plan);
      const snapshot = { id: row.id, hash: planHash(plan), createdAt: new Date(row.created_at).toISOString(), boundAt: new Date().toISOString(), plan };
      if (snapshot.hash !== row.plan_hash) throw new Error("CALL_PLAN_HASH_MISMATCH");
      await c.query("UPDATE hint_call_plans SET status='consumed',call_sid=$2 WHERE id=$1", [row.id, sid]);
      await c.query(`UPDATE calls SET metadata=coalesce(metadata,'{}'::jsonb)||$3::jsonb
        WHERE user_id=$1 AND call_sid=$2`, [owner, sid, JSON.stringify({ callPlan: snapshot, goalText: plan.goal, mode: "hint" })]);
      return snapshot;
    });
  }
}
