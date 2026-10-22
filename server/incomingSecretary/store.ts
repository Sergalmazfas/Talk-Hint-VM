import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { pool } from "../db";
import { defaults, type Settings, type RequestRecord } from "./policy";

const database = () => { if (!pool) throw new Error("Incoming Secretary database unavailable"); return pool; };
export interface RequestStore {
  begin(owner: string, numberId: string, callSid: string): Promise<RequestRecord>;
  update(owner: string, callSid: string, change: (r: RequestRecord) => RequestRecord): Promise<RequestRecord>;
}
export class IncomingStore implements RequestStore {
  constructor(private readonly table: "incoming_secretary_requests"|"incoming_secretary_dev_requests"="incoming_secretary_requests",
    private readonly connection?:Pool) {}
  private database(){return this.connection??database();}
  async settings(owner: string, numberId: string): Promise<Settings> {
    const r = await this.database().query("SELECT config,enabled FROM incoming_secretary_settings WHERE user_id=$1 AND number_id=$2", [owner,numberId]);
    return r.rows[0] ? { ...defaults(numberId), ...r.rows[0].config, enabled: r.rows[0].enabled, numberId } : defaults(numberId);
  }
  async saveSettings(owner: string, s: Settings) {
    const r = await this.database().query(`INSERT INTO incoming_secretary_settings(number_id,user_id,enabled,config)
      VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(number_id) DO UPDATE SET user_id=$2,enabled=$3,config=$4::jsonb,updated_at=now()
      WHERE incoming_secretary_settings.user_id=$2 RETURNING number_id`, [s.numberId, owner, s.enabled, JSON.stringify(s)]);
    if (!r.rowCount) throw new Error("Settings belong to another owner");
  }
  async begin(owner: string, numberId: string, callSid: string) {
    const record: RequestRecord = { id: randomUUID(),callSid,userId:owner,numberId,status:"collecting",fields:{},
      turns:[],missing:[],outcome:"Request collection started; no appointment booked.",updatedAt:new Date().toISOString(),
      ...(this.table==="incoming_secretary_dev_requests"?{testOnly:true}:{}) };
    const databaseNumber=this.table==="incoming_secretary_dev_requests"&&numberId==="dev-sandbox"?null:numberId;
    await this.database().query(`INSERT INTO ${this.table}(call_sid,id,user_id,number_id,payload)
      VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(call_sid) DO NOTHING`, [callSid,record.id,owner,databaseNumber,JSON.stringify(record)]);
    const r = await this.database().query(`SELECT payload FROM ${this.table} WHERE call_sid=$1 AND user_id=$2 AND number_id IS NOT DISTINCT FROM $3`, [callSid,owner,databaseNumber]);
    if (!r.rows[0]) throw new Error("Call ownership conflict");
    return r.rows[0].payload as RequestRecord;
  }
  async update(owner: string, callSid: string, change: (r: RequestRecord) => RequestRecord) {
    const client = await this.database().connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(`SELECT payload FROM ${this.table} WHERE call_sid=$1 AND user_id=$2 FOR UPDATE`, [callSid,owner]);
      if (!r.rows[0]) throw new Error("Request not found");
      const old = r.rows[0].payload as RequestRecord;
      const next = { ...change(old), id: old.id, userId: old.userId, numberId: old.numberId, callSid: old.callSid, updatedAt: new Date().toISOString() };
      await client.query(`UPDATE ${this.table} SET payload=$3::jsonb,updated_at=now() WHERE call_sid=$1 AND user_id=$2`, [callSid,owner,JSON.stringify(next)]);
      await client.query("COMMIT"); return next;
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }
  async list(owner: string) {
    const r = await this.database().query(`SELECT payload,notification_status FROM ${this.table} WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50`, [owner]);
    return r.rows.map(x => ({...x.payload, notificationStatus:x.notification_status})) as RequestRecord[];
  }
}
// Deterministic Dev preview/tests; never touches the real request table.
export class MemoryRequests implements RequestStore {
  records = new Map<string, RequestRecord>();
  failSave = false;
  async begin(owner: string, numberId: string, callSid: string) {
    if (this.failSave) throw new Error("Simulated save failure");
    const r = this.records.get(callSid) ?? { id:randomUUID(),userId:owner,numberId,callSid,status:"collecting" as const,
      fields:{},turns:[],missing:[],outcome:"No appointment booked.",updatedAt:new Date().toISOString() };
    if (r.userId !== owner || r.numberId !== numberId) throw new Error("Call ownership conflict");
    this.records.set(callSid,r); return r;
  }
  async update(owner: string, callSid: string, change: (r: RequestRecord) => RequestRecord) {
    if (this.failSave) throw new Error("Simulated save failure");
    const r=this.records.get(callSid); if (!r || r.userId!==owner) throw new Error("Request not found");
    const next={...change(structuredClone(r)),id:r.id,callSid:r.callSid,userId:r.userId,numberId:r.numberId};
    this.records.set(callSid,next); return next;
  }
}
