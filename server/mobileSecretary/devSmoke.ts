/**
 * Real Dev HTTP / PostgreSQL proof with two temporary synthetic accounts.
 * Creates no phone assignments or production Secretary tasks. Never dials.
 * Run: NODE_ENV=development npx tsx server/mobileSecretary/devSmoke.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { dbReady, pool } from "../db";

if(process.env.NODE_ENV!=="development"||!process.env.REPLIT_DEV_DOMAIN)throw Error("Dev workspace only");
const origin=`https://${process.env.REPLIT_DEV_DOMAIN}`;
const ids=[randomUUID(),randomUUID()];
const password=randomUUID();
let count=0;
const test=(value:unknown)=>{assert.ok(value);count++;};
async function api(path:string,body?:unknown,token?:string,method?:string) {
  const r=await fetch(origin+"/api/mobile-secretary"+path,{method:method??(body===undefined?"GET":"POST"),
    headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  return {status:r.status,body:await r.json()};
}
async function main() {
await dbReady;
assert.ok(pool,"Dev database must be available");
try {
  for(const id of ids) {
    await pool.query("INSERT INTO users(id,email,password,language) VALUES($1,$2,$3,'en')",[id,`${id}@secretary-dev.example.invalid`,await bcrypt.hash(password,10)]);
    await pool.query("INSERT INTO knowledge_cards(id,user_id,card_type,title,body,profile_scope) VALUES($1,$2,'company','Demo service','Hours: Saturday 10–16. Часы. ¿Horario? ¡Sí!','work')",[id+"-card",id]);
  }
  const credentials=await Promise.all(ids.map(id=>api("/login",{email:`${id}@secretary-dev.example.invalid`,password})));
  credentials.forEach(r=>test(r.status===200&&r.body.token.startsWith("thmobile.")));
  let a=credentials[0].body.token;const b=credentials[1].body.token;
  const me=await api("/me",undefined,a);test(me.body.testOnly&&me.body.model.model==="gpt-live-1"&&!me.body.legal.approved);
  const cards=await api("/cards",undefined,a);test(cards.body.cards.length===1&&cards.body.cards[0].userId===ids[0]);
  const edited=await api("/cards/"+ids[0]+"-card",{title:"Reviewed",body:"Суббота. ¿Horario? ¡Sí!",profileScope:"work"},a,"PATCH");
  test(edited.status===200&&edited.body.card.body==="Суббота. ¿Horario? ¡Sí!");
  test((await api("/cards/"+ids[0]+"-card",{title:"Foreign edit",body:"bad",profileScope:"work"},b,"PATCH")).status===404);
  const draft={clientRequestId:randomUUID(),recipient:"Synthetic demo",phoneNumber:"+12025550123",instruction:"Ask opening hours. Уточнить время. ¿Abierto?",cardIds:[ids[0]+"-card"]};
  const prepared=await api("/prepare",draft,a);test(prepared.status===200&&prepared.body.status==="prepared");
  test((await api("/test-tasks/"+prepared.body.id,undefined,b)).status===404);
  test((await api("/prepare",draft,b)).status===403);
  const confirms=await Promise.all(Array.from({length:6},()=>api(`/test-tasks/${prepared.body.id}/confirm`,{},a)));
  confirms.forEach(r=>test(r.status===200&&r.body.task.id===prepared.body.id&&r.body.task.status==="completed"));
  test((await api("/prepare",draft,a)).body.id===prepared.body.id);
  test((await api("/prepare",{...draft,instruction:"Changed"},a)).status===409);
  const recovered=await api("/test-tasks/"+prepared.body.id,undefined,a);
  test(recovered.body.task.summary.includes("No telephone call")&&recovered.body.task.transcript==="");
  const state=await pool.query("SELECT count(*)::int AS n FROM mobile_secretary_dev WHERE owner=$1 AND kind='task'",[ids[0]]);
  test(state.rows[0].n===1);
  const realTasks=await pool.query("SELECT count(*)::int AS n FROM secretary_tasks WHERE user_id=ANY($1::text[])",[ids]);
  test(realTasks.rows[0].n===0);
  test((await api("/profiles",undefined,a)).body.numbers.length===0);
  test((await api("/history",undefined,a)).status===200);
  const legacy=await fetch(origin+"/api/auth/me",{headers:{Authorization:"Bearer "+a}});
  test(legacy.status===401);
  const fresh=await api("/refresh",{},a);test(fresh.status===200);a=fresh.body.token;
  test((await api("/me",undefined,credentials[0].body.token)).status===401);
  test((await api("/logout",{},a)).status===200);
  test((await api("/me",undefined,a)).status===401);
  console.log(`PASS: ${count} real Dev HTTP/DB checks; synthetic accounts cleaned; no assignments or external actions.`);
} finally {
  await pool.query("DELETE FROM mobile_secretary_dev WHERE owner=ANY($1::text[])",[ids]);
  await pool.query("DELETE FROM knowledge_cards WHERE user_id=ANY($1::text[])",[ids]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::text[])",[ids]);
  await pool.end();
}
}
void main().catch(()=>{console.error("FAIL: Dev smoke check. Synthetic fixture cleanup attempted; no credentials logged.");process.exitCode=1;});
