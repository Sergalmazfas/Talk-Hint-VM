import { pool } from "../db";

export type CalendarGrant = { owner: string; numberId: string; secret: string; calendarId: string | null; revision: string };
export type CalendarAttempt = { owner: string; numberId: string; secret: string };
export interface OwnerCalendarStore {
  get(owner: string, numberId: string): Promise<CalendarGrant | undefined>;
  begin(hash: string, browserHash: string, attempt: CalendarAttempt): Promise<void>;
  consume(hash: string, browserHash: string): Promise<CalendarAttempt | undefined>;
  finish(hash: string, grant: CalendarGrant): Promise<boolean>;
  select(grant: CalendarGrant, calendarId: string): Promise<boolean>;
  disconnect(owner: string, numberId: string): Promise<void>;
}
export class PgOwnerCalendarStore implements OwnerCalendarStore {
  private db() { if (!pool) throw new Error("Calendar storage unavailable"); return pool; }
  async get(owner: string, numberId: string) {
    const r = await this.db().query(`SELECT secret,calendar_id,revision FROM secretary_calendar_grants WHERE user_id=$1 AND number_id=$2`, [owner, numberId]);
    return r.rows[0] && { owner, numberId, secret:r.rows[0].secret, calendarId:r.rows[0].calendar_id, revision:r.rows[0].revision };
  }
  async begin(hash: string, browserHash: string, a: CalendarAttempt) {
    // One pending attempt per profile: a later connect/disconnect invalidates old callbacks.
    await this.db().query(`INSERT INTO secretary_calendar_attempts(number_id,user_id,state_hash,browser_hash,secret,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes') ON CONFLICT(number_id) DO UPDATE
      SET state_hash=$3,browser_hash=$4,secret=$5,expires_at=now()+interval '10 minutes',consumed=false
      WHERE secretary_calendar_attempts.user_id=$2`, [a.numberId,a.owner,hash,browserHash,a.secret]);
  }
  async consume(hash: string, browserHash: string) {
    const r = await this.db().query(`UPDATE secretary_calendar_attempts SET consumed=true
      WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() AND consumed=false RETURNING user_id,number_id,secret`, [hash,browserHash]);
    return r.rows[0] && {owner:r.rows[0].user_id,numberId:r.rows[0].number_id,secret:r.rows[0].secret};
  }
  async finish(hash: string, g: CalendarGrant) {
    const client=await this.db().connect();
    try {
      await client.query("BEGIN");
      // Lock the attempt until commit; disconnect racing a token exchange cannot resurrect it.
      const a=await client.query(`SELECT number_id FROM secretary_calendar_attempts WHERE user_id=$1 AND number_id=$2
        AND state_hash=$3 AND consumed=true AND expires_at>now() FOR UPDATE`,[g.owner,g.numberId,hash]);
      if (!a.rowCount) { await client.query("ROLLBACK"); return false; }
      await client.query(`INSERT INTO secretary_calendar_grants(number_id,user_id,secret,calendar_id,revision)
        VALUES($1,$2,$3,NULL,$4) ON CONFLICT(number_id) DO UPDATE SET secret=$3,calendar_id=NULL,revision=$4,updated_at=now()
        WHERE secretary_calendar_grants.user_id=$2`,[g.numberId,g.owner,g.secret,g.revision]);
      await client.query("DELETE FROM secretary_calendar_attempts WHERE state_hash=$1",[hash]);
      await client.query("COMMIT"); return true;
    } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }
  async select(g: CalendarGrant, calendarId: string) {
    const r=await this.db().query(`UPDATE secretary_calendar_grants SET calendar_id=$4,updated_at=now()
      WHERE user_id=$1 AND number_id=$2 AND revision=$3`,[g.owner,g.numberId,g.revision,calendarId]);
    return !!r.rowCount;
  }
  async disconnect(owner: string, numberId: string) {
    const client=await this.db().connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM secretary_calendar_attempts WHERE user_id=$1 AND number_id=$2",[owner,numberId]);
      await client.query("DELETE FROM secretary_calendar_grants WHERE user_id=$1 AND number_id=$2",[owner,numberId]);
      await client.query("COMMIT");
    } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }
}
