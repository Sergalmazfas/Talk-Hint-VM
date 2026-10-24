import type { Pool } from "pg";
import { verifyNumberRouting, numberProfile } from "./policy";

export type Choice = "frames" | "work" | "both";
export type Purpose = "personal" | "work";
export class NumberSetupError extends Error {
  constructor(readonly status:number, readonly code:string) { super(code); }
}
export const purposes = (choice:Choice):Purpose[] => choice==="both" ? ["personal","work"] : [choice==="frames"?"personal":"work"];
export const safeNumber = (n:any) => ({id:n.id,phoneNumber:n.twilio_number??n.twilioNumber,name:n.name,type:n.type});

/** One owner lock + locked pool rows + one transaction. No purchase, repoint or activation. */
export async function assignProfiles(pool:Pool, owner:string, choice:Choice,
  inspect:(number:string)=>Promise<Parameters<typeof verifyNumberRouting>[0]>,
  selected:Partial<Record<Purpose,string>>={}, name?:string) {
  const c=await pool.connect();
  try {
    await c.query("BEGIN");
    const u=await c.query("SELECT id,plan FROM users WHERE id=$1 FOR UPDATE",[owner]);
    if(!u.rows.length)throw new NumberSetupError(404,"account_not_found");
    const current=await c.query("SELECT * FROM phone_numbers WHERE user_id=$1 ORDER BY created_at,id",[owner]);
    const wanted=purposes(choice), missing=wanted.filter(p=>!current.rows.some(n=>numberProfile(n.type)===p));
    // Recovery is permitted even after a subscription ends; it never allocates.
    if(missing.length && (!u.rows[0].plan || ["free","none"].includes(u.rows[0].plan)))
      throw new NumberSetupError(403,"subscription_required");
    for(const p of wanted.filter(p=>!missing.includes(p))) {
      if(selected[p]) {
        const candidate=await c.query("SELECT twilio_number FROM available_numbers WHERE id=$1",[selected[p]]);
        if(!current.rows.some(n=>numberProfile(n.type)===p&&n.twilio_number===candidate.rows[0]?.twilio_number))
          throw new NumberSetupError(409,"purpose_already_connected");
      }
    }
    const chosen:any[]=[];
    for(const purpose of missing) {
      const rows=await c.query(`SELECT a.* FROM available_numbers a
        WHERE a.is_assigned=false AND NOT EXISTS(SELECT 1 FROM phone_numbers p WHERE p.twilio_number=a.twilio_number)
          AND NOT(a.id=ANY($1::varchar[])) ${selected[purpose] ? "AND a.id=$2" : ""}
        ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1`,
        selected[purpose] ? [chosen.map(n=>n.id),selected[purpose]] : [chosen.map(n=>n.id)]);
      if(!rows.rows.length)throw new NumberSetupError(409,"pool_unavailable");
      chosen.push({...rows.rows[0],purpose});
    }
    // Verify before the first mutation; a provider error cannot leave half a pair.
    for(const n of chosen)
      if(!verifyNumberRouting(await inspect(n.twilio_number)))throw new NumberSetupError(409,"number_route_not_ready");
    for(const n of chosen) {
      await c.query("UPDATE available_numbers SET is_assigned=true WHERE id=$1",[n.id]);
      const inserted=await c.query(`INSERT INTO phone_numbers(user_id,twilio_number,twilio_number_sid,name,type)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [owner,n.twilio_number,n.twilio_sid,name?.trim()|| (n.purpose==="work"?"Work":"Frames"),n.purpose]);
      const row=inserted.rows[0];
      await c.query(`INSERT INTO user_prompts(user_id,phone_number_id,name,content,is_active)
        VALUES($1,$2,$3,$4,true)`,[owner,row.id,n.purpose==="work"?"Work":"Frames",
          "Use only the owner's approved context cards. Do not invent identity, business facts or services."]);
      current.rows.push(row);
    }
    await c.query("COMMIT");
    return {phoneNumbers:current.rows.map(safeNumber),reused:missing.length===0};
  } catch(e) {
    await c.query("ROLLBACK").catch(()=>{});
    if((e as any)?.code==="55P03" || (e as any)?.code==="23505")
      throw new NumberSetupError(409,"number_assignment_conflict");
    throw e;
  } finally { c.release(); }
}
