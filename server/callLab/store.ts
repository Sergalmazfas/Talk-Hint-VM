import { createHash } from "node:crypto";
import type { Pool } from "pg";
export type Query = Pick<Pool, "query">;
export const labKey = (env: string, owner: string, call: string) =>
  createHash("sha256").update(JSON.stringify([env, owner, call, "plab-report-v1"])).digest("hex");
export const messageIdFor = (key: string) => `${key}@talkhint-lab.invalid`;

export class LabStore {
  constructor(readonly db: Query) {}
  async note(key: string, phase: string) {
    await this.db.query(`UPDATE call_lab_jobs SET updated_at=now(),
      journal=journal || $2::jsonb WHERE key=$1`, [key, JSON.stringify([{ phase, at: new Date().toISOString() }])]);
  }
  async enqueue(environment: string, owner: string, sid: string) {
    const key = labKey(environment, owner, sid);
    await this.db.query(`INSERT INTO call_lab_jobs(key,environment,owner_id,call_sid)
      VALUES($1,$2,$3,$4) ON CONFLICT(key) DO NOTHING`, [key, environment, owner, sid]);
    return key;
  }
  async claim(environment: string, owner: string) {
    const q = await this.db.query(`UPDATE call_lab_jobs SET status='running',attempts=attempts+1,updated_at=now()
      WHERE key=(SELECT key FROM call_lab_jobs WHERE environment=$1 AND owner_id=$2 AND status='pending'
      AND attempts<2 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [environment, owner]);
    return q.rows[0] ?? null;
  }
  async finish(key: string, source: unknown, report: unknown) {
    // Report + durable outbox are one atomic statement. There is no "sent" state here.
    await this.db.query(`WITH saved AS (UPDATE call_lab_jobs SET status='report_ready',source=$2::jsonb,
      report=$3::jsonb,updated_at=now() WHERE key=$1 AND status='running'
      RETURNING key,environment,owner_id)
      INSERT INTO call_lab_outbox(key,environment,owner_id,message_id)
      SELECT key,environment,owner_id,$4 FROM saved ON CONFLICT(key) DO NOTHING`,
    [key, JSON.stringify(source), JSON.stringify(report), messageIdFor(key)]);
  }
  async fail(key: string, code: string) {
    await this.db.query("UPDATE call_lab_jobs SET status='failed',updated_at=now() WHERE key=$1 AND status='running'", [key]);
    await this.note(key, code); // fixed codes only; no raw provider exceptions.
  }
  async recover(environment: string, owner: string) {
    // The old child has a ten-minute hard deadline. Only stale analysis may retry, once.
    await this.db.query(`UPDATE call_lab_jobs SET status=CASE WHEN attempts<2 THEN 'pending' ELSE 'failed' END,
      updated_at=now() WHERE environment=$1 AND owner_id=$2 AND status='running'
      AND updated_at<now()-interval '12 minutes'`, [environment, owner]);
    // Sending could have succeeded before the crash: never resend this state automatically.
    await this.db.query(`UPDATE call_lab_outbox SET status='unknown',updated_at=now()
      WHERE environment=$1 AND owner_id=$2 AND status IN ('sending','gmail_accepted')
      AND updated_at<now()-interval '2 minutes'`, [environment, owner]);
  }
  async claimMail(environment: string, owner: string) {
    const q = await this.db.query(`UPDATE call_lab_outbox SET status='sending',updated_at=now()
      WHERE key=(SELECT o.key FROM call_lab_outbox o JOIN call_lab_jobs j ON j.key=o.key
        JOIN calls c ON c.call_sid=j.call_sid AND c.user_id=j.owner_id
        WHERE o.environment=$1 AND o.owner_id=$2 AND o.status='prepared' AND j.report IS NOT NULL
        ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1) RETURNING *`, [environment, owner]);
    if (!q.rows[0]) return null;
    const report = await this.db.query("SELECT report FROM call_lab_jobs WHERE key=$1", [q.rows[0].key]);
    return { ...q.rows[0], report: report.rows[0]?.report };
  }
  async mailState(key: string, status: string, gmailId: string | null = null) {
    await this.db.query("UPDATE call_lab_outbox SET status=$2,gmail_id=coalesce($3,gmail_id),updated_at=now() WHERE key=$1",
      [key, status, gmailId]);
    await this.note(key, `mail:${status}`);
  }
  async retention(environment: string, owner: string) {
    await this.db.query(`DELETE FROM call_lab_jobs j WHERE environment=$1 AND owner_id=$2
      AND report->>'synthetic' IS DISTINCT FROM 'true'
      AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.call_sid=j.call_sid AND c.user_id=j.owner_id)`, [environment, owner]);
    await this.db.query(`UPDATE call_lab_jobs SET source=NULL WHERE environment=$1 AND owner_id=$2
      AND source IS NOT NULL AND created_at<now()-interval '7 days'`, [environment, owner]);
    await this.db.query(`DELETE FROM call_lab_jobs WHERE environment=$1 AND owner_id=$2
      AND created_at<now()-interval '90 days'`, [environment, owner]);
  }
}
