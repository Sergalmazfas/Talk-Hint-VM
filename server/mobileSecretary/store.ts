import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool, dbReady } from "../db";

export const digest = (s:string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export const taskId = () => randomUUID();
export interface RecordRow { id:string; owner:string; kind:string; payload:any; expires:Date }
/** Scoped sessions and short-lived reviews; never consumed by the dial worker. */
export class MobileStore {
  private ready?:Promise<void>;
  private get table() { return process.env.NODE_ENV === "production" ? "mobile_secretary_state" : "mobile_secretary_dev"; }
  async init() {
    await dbReady;
    if (!pool) throw new Error("Mobile storage unavailable");
    this.ready ??= pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (
      id text PRIMARY KEY, owner text NOT NULL, kind text NOT NULL,
      payload jsonb NOT NULL, expires timestamptz NOT NULL
    )`).then(async()=>{
      await pool!.query(`DELETE FROM ${this.table} WHERE expires<now()`);
      // Only temporary Dev sessions/TEST state, never customer call history.
      const timer=setInterval(()=>{
        void pool?.query(`DELETE FROM ${this.table} WHERE expires<now()`).catch(()=>{
          console.warn("[MobileSecretary] Temporary state cleanup unavailable");
        });
      },3600000);
      timer.unref();
    });
    return this.ready;
  }
  async get(id:string,owner?:string):Promise<RecordRow|undefined> {
    await this.init();
    const r=await pool!.query(`SELECT * FROM ${this.table} WHERE id=$1 AND expires>now() AND ($2::text IS NULL OR owner=$2)`,[id,owner??null]);
    return r.rows[0];
  }
  async put(row:RecordRow) {
    await this.init();
    await pool!.query(`INSERT INTO ${this.table} VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,
      [row.id,row.owner,row.kind,JSON.stringify(row.payload),row.expires]);
    return (await this.get(row.id,row.owner))!;
  }
  async remove(id:string,owner:string) {await this.init();await pool!.query(`DELETE FROM ${this.table} WHERE id=$1 AND owner=$2`,[id,owner]);}
  async consume(id:string,owner:string) {
    await this.init();
    return !!(await pool!.query(`DELETE FROM ${this.table} WHERE id=$1 AND owner=$2 AND expires>now() RETURNING id`,[id,owner])).rowCount;
  }
  async list(owner:string,kind:string) {
    await this.init();
    return (await pool!.query(`SELECT * FROM ${this.table} WHERE owner=$1 AND kind=$2 AND expires>now() ORDER BY payload->>'createdAt' DESC LIMIT 100`,[owner,kind])).rows as RecordRow[];
  }
  async transition(id:string,owner:string,status:string) {
    await this.init();
    const r=await pool!.query(`UPDATE ${this.table} SET payload=payload||$3::jsonb
      WHERE id=$1 AND owner=$2 AND kind='task' AND expires>now() AND payload->>'status'='prepared' RETURNING *`,
      [id,owner,JSON.stringify({status,summary:status==="completed"?"TEST completed. No telephone call was placed; no conversation occurred.":"TEST cancelled. No telephone call was placed."})]);
    return r.rows[0] as RecordRow|undefined;
  }
  async claimLive(id:string,owner:string,status:"starting"|"cancelled") {
    await this.init();
    return (await pool!.query(`UPDATE ${this.table} SET payload=payload||$3::jsonb
      WHERE id=$1 AND owner=$2 AND kind='live-review' AND expires>now()
      AND payload->>'status'='prepared' RETURNING *`,
      [id,owner,JSON.stringify({status})])).rows[0] as RecordRow|undefined;
  }
  async linkLive(id:string,owner:string,taskId:string) {
    await this.init();
    await pool!.query(`UPDATE ${this.table} SET payload=payload||$3::jsonb
      WHERE id=$1 AND owner=$2 AND kind='live-review' AND payload->>'status'='starting'`,
      [id,owner,JSON.stringify({taskId})]);
  }
}
