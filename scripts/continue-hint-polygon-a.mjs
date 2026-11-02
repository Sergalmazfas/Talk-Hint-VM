import{existsSync,readFileSync,readdirSync,openSync,writeFileSync,closeSync,watch}from"node:fs";
import{spawn}from"node:child_process";
const root="generated-artifacts/hint-polygon",marker=`${root}/qc30-continuation.once.json`;
const fd=openSync(marker,"wx",0o600);writeFileSync(fd,JSON.stringify({status:"waiting-primary",time:new Date().toISOString()}));closeSync(fd);
let started=false;
const save=x=>writeFileSync(marker,JSON.stringify({...x,time:new Date().toISOString()}));
const run=(args,log)=>new Promise((resolve,reject)=>{
 const output=openSync(log,"w",0o600),p=spawn("npx",args,{stdio:["ignore",output,output],env:process.env});closeSync(output);
 p.once("error",reject);p.once("exit",code=>code===0?resolve():reject(Error("CHILD_EXIT_"+code)));
});
const w=watch(root,(_event,file)=>{if(String(file)==="series-ledger.json.lock")void advance();});
const timer=setTimeout(()=>{w.close();save({status:"stopped",reason:"PRIMARY_WAIT_TIMEOUT_NO_SECONDARY_STARTED"});process.exitCode=1;},30*60_000);
async function advance(){
 if(started||existsSync(`${root}/series-ledger.json.lock`))return;
 const path=`${root}/trials/a-qc30-goal-full/execution.json`;
 if(!existsSync(path))return;
 const state=JSON.parse(readFileSync(path,"utf8"));
 if(state.status==="running")return;
 started=true;w.close();clearTimeout(timer);
 try{
  if(!["paused_cleanly","completed_baseline"].includes(state.status))throw Error("PRIMARY_UNSAFE_STOP_NO_CONTINUATION");
  const dir=`${root}/trials/a-qc30-goal-full/rows`,rows=readdirSync(dir).filter(f=>f.endsWith(".json")).map(f=>JSON.parse(readFileSync(`${dir}/${f}`,"utf8")));
  if(rows.length!==14||!rows.some(r=>r.valid&&r.quality!==null))throw Error("PRIMARY_COVERAGE_OR_JUDGE_NOT_READY");
  if(rows.some(r=>r.reasons.some(s=>/REPLAY_CLOCK|DEEPGRAM_|OPENAI_HTTP_|MODEL_SUBSTITUTION|SERIES_BUDGET|QUALITY_UNAVAILABLE/.test(s))))
   throw Error("PRIMARY_TRANSPORT_OR_CLOCK_FAILURE_NO_BLIND_CONTINUATION");
  const ledger=JSON.parse(readFileSync(`${root}/series-ledger.json`,"utf8"));
  if(ledger.entries.some(e=>e.status==="reserved"))throw Error("PRIMARY_HAS_RESERVED_REQUESTS");
  if(existsSync(`${root}/trials/a-qc30-no-goal-full/execution.json`))throw Error("SECONDARY_ALREADY_EXISTS_NO_REPEAT");
  await run(["tsx","scripts/report-hint-polygon-qc30.ts"],`${root}/qc30-primary-report.log`);
  save({status:"secondary-starting",primaryRows:rows.length});
  await run(["tsx","scripts/hint-polygon.ts","--execute","--trial=a-qc30-no-goal-full","--group=no-goal","--limit=36","--concurrency=4"],`${root}/a-qc30-no-goal-full.log`);
  await run(["tsx","scripts/report-hint-polygon-qc30.ts"],`${root}/qc30-final-report.log`);
  save({status:"finished-A",note:"B–F are not claimed executed by this A continuation"});
  console.log("A finished; separate goal/no-goal report ready; no requests repeated automatically.");
 }catch(e){save({status:"stopped",reason:e.message});console.error(e.message);process.exitCode=1;}
}
void advance();
