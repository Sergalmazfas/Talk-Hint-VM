/**
 * Explicit isolated lab continuation; no live imports, owner sessions or retries.
 * Waits for the already-started 1x batch, tests, then runs bounded C factors.
 */
import {readFileSync,writeFileSync,existsSync,watch,openSync,closeSync,readdirSync}from"node:fs";
import {spawn}from"node:child_process";
import {canContinueKnownFormatStop}from"../server/hintPolygon/continuationSafety.ts";
const root="generated-artifacts/hint-polygon";
const load=p=>JSON.parse(readFileSync(p,"utf8"));
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2),{mode:0o600});
const controlName=process.argv.find(x=>x.startsWith("--control="))?.slice(10)??"c-followup-control-v2.json";
if(!/^[a-z0-9-]+\.json$/.test(controlName))throw Error("INVALID_CONTROL_NAME");
const checkTag=process.argv.find(x=>x.startsWith("--check-tag="))?.slice(12)??"c-followups";
if(!/^[a-z0-9-]+$/.test(checkTag))throw Error("INVALID_CHECK_TAG");
const control=`${root}/${controlName}`;
const fd=openSync(control,"wx",0o600);closeSync(fd);
const panel=["a2850364-b22e-4675-bb99-7f4fdf39e132","507a0fb9-ac2e-4695-95a2-1d66112864cd","dcb4d03e-ced6-4e42-95c4-9d3ce0ca618a"];
const base=load(`${root}/recipe-c.json`);
const variants=[
 {trial:"c-short-three",recipe:{...base,id:"c-short-three",prompt:"reduced"}},
 {trial:"c-flux-060",recipe:{...base,id:"c-flux-060",eotThreshold:.6}},
 {trial:"c-cards-addon",recipe:{...base,id:"c-cards-addon",architecture:"hint-first-cards"}},
 {trial:"c-flux-050",recipe:{...base,id:"c-flux-050",eotThreshold:.5}},
];
const state={status:"waiting_for_expansion",panel,variants,steps:[],maximumSeriesMicro:15_000_000,
 oneFactorReference:base,previousUnknownNeverRetried:true,
 qualityJudgeFrozen:base.judgeModel,liveEnable:false,providerAutoCacheOrderNotRandomized:true};
save(control,state);
const held=()=>load(`${root}/series-ledger.json`).entries.reduce((s,e)=>s+(e.status==="spent"?e.charged:e.reserve),0);
function waitForExpansion(){
 return new Promise((resolve,reject)=>{
  const path=`${root}/trials/c-expanded-goal/execution.json`;
  const watchers=[];
  const timer=setTimeout(()=>finish(Error("EXPANSION_WAIT_TIMEOUT_NO_RETRY")),25*60_000);
  function finish(error){clearTimeout(timer);watchers.forEach(w=>w.close());error?reject(error):resolve();}
  function check(){
   try{const s=load(path);
    if(s.status!=="running"&&!existsSync(`${root}/series-ledger.json.lock`)){
     if(!["paused_cleanly","completed_baseline"].includes(s.status)){
      const entries=load(`${root}/series-ledger.json`).entries.filter(e=>e.id.startsWith("hint-polygon-owner-36-v1-c-expanded-goal-"));
      const dir=`${root}/trials/c-expanded-goal/rows`;
      const rows=readdirSync(dir).filter(p=>p.endsWith(".json")).map(p=>load(`${dir}/${p}`));
      if(!canContinueKnownFormatStop(entries,rows))return finish(Error("EXPANSION_BLOCKED_NO_RETRY"));
      state.knownFormatStopReviewed={entries:entries.length,allExpensesKnown:true,failedNotRetried:rows.filter(r=>!r.valid).map(r=>r.fixtureId)};
     }
     finish();
    }
   }catch(e){if(e.code!=="ENOENT")finish(e);}
  }
  watchers.push(watch(root,check),watch(`${root}/trials/c-expanded-goal`,check));check();
 });
}
function run(command,args,log){
 return new Promise((resolve,reject)=>{
  const out=openSync(log,"wx",0o600);
  const child=spawn(command,args,{stdio:["ignore",out,out]});closeSync(out);
  child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(Error(`CHECK_OR_RUN_EXIT_${code}: ${log}`)));
 });
}
try{
 await waitForExpansion();state.status="testing";save(control,state);
 await run("npx",["vitest","run","server/hintPolygon","server/__tests__/benchmarkLiveParity.test.ts","server/__tests__/benchmarkEarsEotScoring.test.ts","server/__tests__/benchmarkEarsAlignment.test.ts","server/__tests__/hintProvider.test.ts","--maxWorkers=1","--reporter=json",`--outputFile=${root}/tests-${checkTag}.json`],`${root}/tests-${checkTag}.log`);
 await run("npx",["tsc","--noEmit"],`${root}/typecheck-${checkTag}.log`);
 // Finish ONLY never-started corpus members. Do not resume the failed CLI
 // lease or rerun the malformed-response recording.
 const tail=["dcb4d03e-ced6-4e42-95c4-9d3ce0ca618a","b260a8c5-befd-4f46-a858-515211ee4107"]
  .filter(id=>!existsSync(`${root}/trials/c-expanded-goal/rows/${id}.json`));
 if(tail.length){
  const entries=load(`${root}/series-ledger.json`).entries;
  if(entries.some(e=>tail.some(id=>e.id.startsWith(`hint-polygon-owner-36-v1-c-expanded-goal-${id}-`))))
   throw Error("TAIL_ALREADY_STARTED_NO_RETRY");
  state.tail={ids:tail,status:"started",heldBefore:held()};save(control,state);
  await run("npx",["tsx","scripts/hint-polygon.ts","--execute",`--limit=${tail.length}`,`--concurrency=${tail.length}`,"--group=saved-goal","--trial=c-expanded-tail",`--recipe=${root}/recipe-c.json`,"--owner-authorized-lab-continuation",`--ids=${tail.join(",")}`],`${root}/c-expanded-tail.log`);
  const s=load(`${root}/trials/c-expanded-tail/execution.json`);
  state.tail.status=s.status;state.tail.heldAfter=held();save(control,state);
  if(!["paused_cleanly","completed_baseline"].includes(s.status)){
   const entries=load(`${root}/series-ledger.json`).entries.filter(e=>e.id.startsWith("hint-polygon-owner-36-v1-c-expanded-tail-"));
   const dir=`${root}/trials/c-expanded-tail/rows`;
   const rows=readdirSync(dir).filter(p=>p.endsWith(".json")).map(p=>load(`${dir}/${p}`));
   if(!canContinueKnownFormatStop(entries,rows))throw Error("TAIL_BLOCKED_NO_RETRY");
   state.tail.knownFormatFailureNotRetried=true;save(control,state);
  }
 }
 state.status="running_factors";save(control,state);
 for(const v of variants){
  // A whole small panel needs headroom, not just one cheap next request.
  if(15_000_000-held()<700_000){
   state.steps.push({trial:v.trial,status:"not_started_insufficient_panel_headroom",heldMicro:held()});save(control,state);continue;
  }
  const recipePath=`${root}/recipe-${v.trial}.json`;save(recipePath,v.recipe);
  state.steps.push({trial:v.trial,status:"started",heldBefore:held(),time:new Date().toISOString()});save(control,state);
  await run("npx",["tsx","scripts/hint-polygon.ts","--execute","--limit=3","--concurrency=3","--group=saved-goal",`--trial=${v.trial}`,`--recipe=${recipePath}`,"--owner-authorized-lab-continuation",`--ids=${panel.join(",")}`],`${root}/${v.trial}.log`);
  const execution=load(`${root}/trials/${v.trial}/execution.json`);
  Object.assign(state.steps.at(-1),{status:execution.status,heldAfter:held(),finished:new Date().toISOString()});save(control,state);
  if(!["paused_cleanly","completed_baseline"].includes(execution.status)){
   const entries=load(`${root}/series-ledger.json`).entries.filter(e=>e.id.startsWith(`hint-polygon-owner-36-v1-${v.trial}-`));
   const dir=`${root}/trials/${v.trial}/rows`;
   const rows=readdirSync(dir).filter(p=>p.endsWith(".json")).map(p=>load(`${dir}/${p}`));
   if(!canContinueKnownFormatStop(entries,rows))throw Error("FACTOR_BLOCKED_NO_RETRY");
   state.steps.at(-1).knownFormatFailureNotRetried=true;save(control,state);
  }
  const rows=panel.map(id=>`${root}/trials/${v.trial}/rows/${id}.json`);
  if(rows.some(p=>!existsSync(p)))throw Error("FACTOR_INCOMPLETE_NO_RETRY");
 }
 state.status="completed_bounded_followups";save(control,state);
 console.log(JSON.stringify({status:state.status,heldMicro:held(),steps:state.steps}));
}catch(e){
 state.status="blocked_no_retry";state.error=e.message;state.heldMicro=held();save(control,state);
 console.error(JSON.stringify({status:state.status,error:e.message,heldMicro:held()}));process.exitCode=1;
}
