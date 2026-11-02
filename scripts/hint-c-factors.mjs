/** Resume only never-started factors after the read-only pricing hold. */
import{readFileSync,writeFileSync,existsSync,openSync,closeSync,readdirSync}from"node:fs";
import{spawn}from"node:child_process";
import{canContinueKnownFormatStop}from"../server/hintPolygon/continuationSafety.ts";
const root="generated-artifacts/hint-polygon";
const load=p=>JSON.parse(readFileSync(p,"utf8"));
const prior=load(`${root}/c-followup-control-v3.json`);
const tests=load(`${root}/tests-c-followups-budget-final.json`);
if(tests.numFailedTests||tests.numPassedTests!==119||!existsSync(`${root}/typecheck-c-followups-budget-final.log`)||
 readFileSync(`${root}/typecheck-c-followups-budget-final.log`,"utf8").length)throw Error("CHECKS_NOT_GREEN");
const journal=`${root}/c-factor-runs.json`;
closeSync(openSync(journal,"wx",0o600));
const state={status:"running",panel:prior.panel,steps:[],ratesIncludeCacheWrites:true,noRetry:true,limitMicro:15_000_000};
const save=()=>writeFileSync(journal,JSON.stringify(state,null,2),{mode:0o600});
const entries=()=>load(`${root}/series-ledger.json`).entries;
const held=()=>entries().reduce((s,e)=>s+(e.status==="spent"?e.charged:e.reserve),0);
save();
try{
 for(const v of prior.variants){
  const prefix=`hint-polygon-owner-36-v1-${v.trial}-`;
  if(entries().some(e=>e.id.startsWith(prefix)))throw Error(`ALREADY_STARTED_NO_RETRY:${v.trial}`);
  if(15_000_000-held()<700_000){
   state.steps.push({trial:v.trial,status:"not_started_insufficient_whole_panel_headroom",heldMicro:held()});save();continue;
  }
  const recipe=`${root}/recipe-${v.trial}.json`;
  if(existsSync(recipe)){
   if(JSON.stringify(load(recipe))!==JSON.stringify(v.recipe))throw Error("RECIPE_CHANGED");
  }else writeFileSync(recipe,JSON.stringify(v.recipe),{flag:"wx",mode:0o600});
  const step={trial:v.trial,status:"started",heldBefore:held(),time:new Date().toISOString()};
  state.steps.push(step);save();
  const log=openSync(`${root}/${v.trial}-final.log`,"wx",0o600);
  const code=await new Promise((resolve,reject)=>{
   const p=spawn("npx",["tsx","scripts/hint-polygon.ts","--execute","--limit=3","--concurrency=3","--group=saved-goal",
    `--trial=${v.trial}`,`--recipe=${recipe}`,"--owner-authorized-lab-continuation",`--ids=${prior.panel.join(",")}`],{stdio:["ignore",log,log]});
   closeSync(log);p.once("error",reject);p.once("exit",resolve);
  });
  if(code!==0)throw Error(`CLI_EXIT_${code}:${v.trial}`);
  const execution=load(`${root}/trials/${v.trial}/execution.json`);
  const dir=`${root}/trials/${v.trial}/rows`;
  const rows=readdirSync(dir).filter(n=>n.endsWith(".json")).map(n=>load(`${dir}/${n}`));
  const own=entries().filter(e=>e.id.startsWith(prefix));
  Object.assign(step,{status:execution.status,heldAfter:held(),attempted:rows.length,valid:rows.filter(r=>r.valid).length,finished:new Date().toISOString()});
  save();
  if(rows.length!==3)throw Error("INCOMPLETE_PANEL_NO_RETRY");
  if(!["completed_baseline","paused_cleanly"].includes(execution.status)){
   if(!canContinueKnownFormatStop(own,rows))throw Error("PROVIDER_OR_CLOCK_UNKNOWN_STOP_NO_RETRY");
   step.knownFormatFailureExcludedNotRetried=true;save();
  }
 }
 state.status="completed_bounded_factors";state.heldMicro=held();save();console.log(JSON.stringify(state));
}catch(e){state.status="blocked_no_retry";state.error=e.message;state.heldMicro=held();save();console.error(JSON.stringify(state));process.exitCode=1;}
