/**
 * Explicit offline operator, no HTTP backdoor and no import by the live app.
 * Usage: npx tsx scripts/hint-polygon.ts [--execute --limit=1|36]
 * Manifest/ledger are private generated artifacts, never Git or deployment data.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as asyncFs from"node:fs/promises";
import { BASELINE, ARCHITECTURES, FACTOR_PLAN, SERIES, LIMIT_MICRO_USD, sha, assertAdapter, money, RecipeSchema, assertOneFactor } from "../server/hintPolygon/contracts";
import { Ledger } from "../server/hintPolygon/ledger";
import { replay, type Fixture } from "../server/hintPolygon/replay";
import { summarize, type Row } from "../server/hintPolygon/metrics";
import { promptRequest } from "../server/hintPolygon/provider";
import { runQueue,selectBatch } from "../server/hintPolygon/scheduler";
import { channels } from "../server/hintPolygon/audio";
import{verifyLabContinuation}from"../server/hintPolygon/labContinuation";
import{nativeEngine}from"../server/hintPolygon/experimental/nativeEngine";
import{textEngine}from"../server/hintPolygon/experimental/textEngine";
import{geminiEngine}from"../server/hintPolygon/experimental/gemini";

const root="generated-artifacts/hint-polygon";
mkdirSync(root,{recursive:true,mode:0o700});
const trial=process.argv.find(a=>a.startsWith("--trial="))?.split("=")[1]??"initial";
if(!/^[a-z0-9-]{1,80}$/.test(trial))throw Error("INVALID_TRIAL_ID");
const trialRoot=trial==="initial"?root:`${root}/trials/${trial}`;
mkdirSync(trialRoot,{recursive:true,mode:0o700});
const manifest=JSON.parse(readFileSync(`${root}/private-manifest.json`,"utf8"));
const fixtures:Fixture[]=manifest.fixtures;
if(fixtures.length!==36 || new Set(fixtures.map(f=>f.id)).size!==36)throw Error("REQUIRE_THE_FROZEN_36");
const identity=fixtures.map(f=>({id:f.id,audio:f.audioSha256,vad:f.vadHash,goal:f.goalHash,roles:f.roles})).sort((a,b)=>a.id.localeCompare(b.id));
const corpusHash=sha(JSON.stringify(identity));
if(corpusHash!==manifest.corpusHash)throw Error("CORPUS_CHANGED");
for(const f of fixtures)if(sha(f.goal)!==f.goalHash)throw Error("GOAL_CHANGED");
const group=process.argv.find(a=>a.startsWith("--group="))?.split("=")[1]??"saved-goal";
if(!["saved-goal","no-goal"].includes(group))throw Error("GOALS_MUST_BE_SEPARATE_GROUPS");
let groupFixtures=fixtures.filter(f=>group==="saved-goal"?!!f.goal:!f.goal).sort((a,b)=>a.durationMs-b.durationMs);
const panel=process.argv.find(a=>a.startsWith("--ids="))?.slice("--ids=".length).split(",");
if(panel){
 if(!panel.length||new Set(panel).size!==panel.length||panel.some(id=>!groupFixtures.some(f=>f.id===id)))
  throw Error("INVALID_OR_MIXED_GOAL_PANEL");
 groupFixtures=groupFixtures.filter(f=>panel.includes(f.id));
}
const prefix=process.argv.find(a=>a.startsWith("--fixture="))?.split("=")[1];
if(prefix&&groupFixtures.filter(f=>f.id.startsWith(prefix)).length!==1)throw Error("FIXTURE_NOT_UNIQUE_OR_WRONG_GROUP");
const recipeFile=process.argv.find(a=>a.startsWith("--recipe="))?.slice("--recipe=".length);
const recipe=recipeFile?RecipeSchema.parse(JSON.parse(readFileSync(recipeFile,"utf8"))):BASELINE;
let labAuthorization:ReturnType<typeof verifyLabContinuation>|undefined;
if(JSON.stringify(recipe)!==JSON.stringify(BASELINE)){
  if(process.argv.includes("--owner-authorized-lab-continuation")){
    const proof=JSON.parse(readFileSync(`${root}/qc30-report/primary-baseline.json`,"utf8"));
    const dir=`${root}/trials/a-qc30-goal-full/rows`;
    const baselineRows=readdirSync(dir).filter(f=>f.endsWith(".json")).map(f=>JSON.parse(readFileSync(`${dir}/${f}`,"utf8")));
    labAuthorization=verifyLabContinuation(proof,corpusHash,baselineRows);
  }else{
    const reviewPath=`${root}/baseline-validation.json`;
    if(!existsSync(reviewPath))throw Error("BASELINE_NOT_VERIFIED_OTHER_RECIPES_LOCKED");
    const review=JSON.parse(readFileSync(reviewPath,"utf8"));
    if(review.corpusHash!==corpusHash || review.status!=="independently_verified" ||
        !review.evidenceHash || !review.reviewer || review.reviewer==="Replit")throw Error("INDEPENDENT_BASELINE_REVIEW_REQUIRED");
  }
  if(recipe.architecture==="stt-brain")assertOneFactor(BASELINE,recipe);
}
assertAdapter(recipe);
function sourceTree(path:string):string[]{
 return readdirSync(path,{withFileTypes:true}).flatMap(d=>d.isDirectory()?sourceTree(path+"/"+d.name):d.name.endsWith(".ts")?[path+"/"+d.name]:[]);
}
const sourceFiles=[
  ...sourceTree("server/hintPolygon").sort(),
  "scripts/hint-polygon.ts","shared/prompts.ts","server/hintProvider.ts","server/hintActionResults.ts","server/hintShape.ts",
];
const harnessHash=sha(sourceFiles.map(p=>`${p}:${sha(readFileSync(p))}`).join("\n"));
const codeCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const files=groupFixtures.filter(f=>existsSync(`${trialRoot}/rows/${f.id}.json`));
let rows:Row[]=files.map(f=>JSON.parse(readFileSync(`${trialRoot}/rows/${f.id}.json`,"utf8")));
function save(path:string,value:unknown){
  writeFileSync(path+".tmp",JSON.stringify(value,null,2),{mode:0o600});renameSync(path+".tmp",path);
}
async function saveDuringReplay(path:string,value:unknown){
 await asyncFs.writeFile(path+".tmp",JSON.stringify(value,null,2),{mode:0o600});
 await asyncFs.rename(path+".tmp",path);
}
function report(ledger?:Ledger){
  const summary=summarize(rows,groupFixtures.length);
  const unknownStt=ledger?.snapshot().entries.filter(e=>e.kind==="stt"&&e.status==="unknown")??[];
  const withheldUnknownFixtureIds=groupFixtures.filter(f=>unknownStt.some(e=>e.id.includes(f.id))).map(f=>f.id);
  save(`${trialRoot}/summary.json`,{...summary,series:SERIES,trial,limitMicro:LIMIT_MICRO_USD,
    withheldUnknownFixtureIds,goalGroup:group,validationPolicy:"owner-qc30-v1",badTurnThreshold:.30,
    seriesHeldMicro:ledger?.held()??null,recipe,corpusHash,harnessHash,codeCommit,labAuthorization,
    panelFixtureIds:panel??null,
    clock:recipe.stream?"1x audio clock; VAD unpadded end; streamed displayable English word, full parsed hint":"1x audio clock; VAD unpadded end per channel; nonstream parsed English word, not first byte/token",
    isolation:"offline lab only; no old bench/live Hint mutation",priceSources:money,
    limitations:["Recorded owner responses are fixed, not causal reactions to new hints.","VAD is automatic, not human verified.",
      "Full live runtime gates/cards/strategy and matched production clock telemetry are not captured.","Judge scores hints, not STT accuracy against audio.",
      "Only explicitly registered adapters execute; controlled Flux-EOT native audio is NOT autonomous native turn detection.","Cache is provider-auto, not falsely reported off."],
    unavailableArchitectures:ARCHITECTURES,factorPlan:FACTOR_PLAN});
  const allPaths=[`${root}/summary.json`,...(existsSync(`${root}/trials`)?readdirSync(`${root}/trials`).map(id=>`${root}/trials/${id}/summary.json`):[])];
  const csv=["trial,recipe,goal_group,validation_policy,expected,withheld,attempted,valid_calls,invalid_calls,rejected_turns,first_word_p50_ms,first_word_p95_ms,full_hint_p50_ms,full_hint_p95_ms,quality_0_to_5,estimated_cost_per_attempt_usd,total_series_held_usd,parity"];
  for(const path of allPaths.filter(existsSync)){
    const s=JSON.parse(readFileSync(path,"utf8"));
    csv.push([s.trial??"initial",s.recipe.id,s.goalGroup??"legacy-mixed",s.validationPolicy??"legacy-strict",s.expectedCorpusSize,s.withheldUnknownFixtureIds?.length??0,s.attempted,s.validCalls,s.invalidCalls,s.rejectedTurns??"",
      s.timings.firstHintWord.p50Ms??"",s.timings.firstHintWord.p95Ms??"",
      s.timings.fullHint.p50Ms??"",s.timings.fullHint.p95Ms??"",s.quality??"",
      s.meanCostPerAttemptMicro===null?"":(s.meanCostPerAttemptMicro/1e6).toFixed(6),
      ledger?(ledger.held()/1e6).toFixed(6):"",s.status].join(","));
  }
  writeFileSync(`${root}/comparison.csv`,csv.join("\n")+"\n",{mode:0o600});
  save(`${root}/current-summary.json`,{trial,path:`${trialRoot}/summary.json`,seriesHeldMicro:ledger?.held()??null});
}
if(!process.argv.includes("--execute")){
  report();
  console.log(JSON.stringify({mode:"READINESS_ONLY_NO_REQUESTS",recordings:36,corpusHash,harnessHash,
    durationMinutes:fixtures.reduce((s,f)=>s+f.durationMs,0)/60000,missingGoals:fixtures.filter(f=>!f.goal).length,
    baseline:recipe,limitUsd:15,otherRecipes:labAuthorization?
      "owner-authorized LAB continuation, not LIVE acceptance; only explicit adapters execute":
      "other recipes require independent baseline review or explicit owner-authorized LAB continuation"}));
}else{
  if(!process.env.OPENAI_API_KEY || !process.env.DEEPGRAM_API_KEY || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_ACCOUNT_SID)throw Error("MISSING_PROVIDER_SECRET");
  const limit=Number(process.argv.find(a=>a.startsWith("--limit="))?.split("=")[1]??"1");
  if(!Number.isInteger(limit)||limit<1||limit>36)throw Error("LIMIT_MUST_BE_1_TO_36");
  const concurrency=Number(process.argv.find(a=>a.startsWith("--concurrency="))?.split("=")[1]??(limit===1?"1":"4"));
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>6)throw Error("CONCURRENCY_MUST_BE_1_TO_6");
  const leasePath=`${trialRoot}/execution.json`,previous=existsSync(leasePath)?JSON.parse(readFileSync(leasePath,"utf8")):null;
  if(previous && (previous.harnessHash!==harnessHash || previous.corpusHash!==corpusHash || previous.goalGroup!==group || previous.recipeHash!==sha(JSON.stringify(recipe))))throw Error("FROZEN_EXECUTION_CHANGED");
  if(previous && !["paused_cleanly","completed_baseline"].includes(previous.status))throw Error("PRIOR_RUN_REQUIRES_REVIEW_NO_RETRY");
  mkdirSync(`${trialRoot}/rows`,{recursive:true,mode:0o700});
  // Preserve exact executable sources, not just an uncommitted tree's hash.
  const snapshotPath=`${trialRoot}/source-snapshot.json`;
  if(!existsSync(snapshotPath)){
    const fd=openSync(snapshotPath,"wx",0o600);
    try{writeFileSync(fd,JSON.stringify({harnessHash,files:sourceFiles.map(path=>({path,text:readFileSync(path,"utf8")}))}));fsyncSync(fd);}
    finally{closeSync(fd);}
  }else if(JSON.parse(readFileSync(snapshotPath,"utf8")).harnessHash!==harnessHash)throw Error("SOURCE_SNAPSHOT_CHANGED");
  const ledger=new Ledger(`${root}/series-ledger.json`,true);
  const run=`${SERIES}-${trial}`;
  let status="unknown";
  save(leasePath,{status:"running",goalGroup:group,concurrency,harnessHash,corpusHash,recipeHash:sha(JSON.stringify(recipe)),started:new Date().toISOString()});
  const template=promptRequest(recipe,"","","");
  save(`${trialRoot}/prompt-registry.json`,{id:"hint-live-brain-prompt",version:template.version,hash:template.systemHash,
    unicodeChars:template.systemChars,utf8Bytes:Buffer.byteLength(template.system),text:template.system,
    history:[{change:"registered template only; no product change",speed:null,quality:null}],livePromotionRequiresOwnerYes:true,
    source:"local shared LIVE builder; production snapshot not independently captured"});
  const stop=()=>{save(leasePath,{status:"unknown",harnessHash,corpusHash,recipeHash:sha(JSON.stringify(recipe)),reason:"process_interrupted"});Promise.resolve(ledger.close()).finally(()=>process.exit(1));};
  process.once("SIGTERM",stop);process.once("SIGINT",stop);
  try{
    const unknownStt=ledger.snapshot().entries.filter(e=>e.kind==="stt"&&e.status==="unknown");
    const remaining=groupFixtures.filter(f=>(!prefix||f.id.startsWith(prefix))&&!files.some(done=>done.id===f.id)&&!unknownStt.some(e=>e.id.includes(f.id)));
    let stopLaunching=false;
    // Decode this bounded corpus BEFORE any 1x clock starts. CPU-heavy PCM→μlaw
    // preparation of the next WAV must not stall an already-running stream.
    const prepared:{f:Fixture;wav:Buffer;audio:Buffer[];maxNativeTurns:number}[]=[];
    for(const f of selectBatch(remaining,limit)){
      const url=`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${f.recordingSid}.wav?RequestedChannels=2`;
      const response=await fetch(url,{headers:{Authorization:"Basic "+Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")},signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error(`RECORDING_READ_HTTP_${response.status}`);
      const wav=Buffer.from(await response.arrayBuffer());
      if(sha(wav)!==f.audioSha256)throw Error("AUDIO_CHANGED_NO_PAID_REQUEST_SENT");
      const reference=`${root}/trials/a-qc30-${group==="saved-goal"?"goal":"no-goal"}-full/rows/${f.id}.json`;
      const n=existsSync(reference)?JSON.parse(readFileSync(reference,"utf8")).turns.length:30;
      prepared.push({f,wav,audio:channels(wav),maxNativeTurns:Math.min(64,n+3)});
    }
    console.log(JSON.stringify({phase:"audio_prepared_no_paid_requests_yet",records:prepared.length,goalGroup:group,concurrency}));
    await runQueue(prepared,concurrency,async ({f,wav,audio,maxNativeTurns})=>{
     try{
      await saveDuringReplay(`${trialRoot}/inflight-${f.id}.json`,{fixtureId:f.id,status:"started",audioSha256:f.audioSha256,time:new Date().toISOString()});
      const engine=recipe.architecture==="stt-brain"?undefined:recipe.architecture==="audio-direct"?
        recipe.model==="gemini-3.8-live"?geminiEngine(f,recipe,ledger,run,maxNativeTurns):nativeEngine(f,recipe,ledger,run):
        textEngine(f,recipe,ledger,run);
      const row={...await replay(f,wav,recipe,ledger,run,corpusHash,codeCommit,audio,engine),harnessHash,goalHash:f.goalHash,vadHash:f.vadHash,workerConcurrency:concurrency};
      await saveDuringReplay(`${trialRoot}/rows/${f.id}.json`,row);rows.push(row);
      // Cross-trial JSON/CSV scans are synchronous: defer them until ALL audio
      // clocks stop. Finishing one call must not stall the other three streams.
      await saveDuringReplay(`${trialRoot}/inflight-${f.id}.json`,{fixtureId:f.id,status:"finished",valid:row.valid});
      console.log(JSON.stringify({fixture:f.id,valid:row.valid,reasons:row.reasons,guestFinals:row.turns.length,
        hints:row.turns.filter(t=>t.fullHintMs!==null).length,chargedMicro:row.chargedMicro,seriesHeldMicro:ledger.held()}));
      if(row.reasons.some(r=>r.includes("BUDGET_EXHAUSTED")||r.includes("REPLAY_CLOCK_DRIFT")||r.includes("PROVIDER_FAILURE")||r.startsWith("NATIVE_")||r.startsWith("GEMINI_"))){stopLaunching=true;}
     }catch(e){
       stopLaunching=true;
       await saveDuringReplay(`${trialRoot}/setup-error-${f.id}.json`,{fixtureId:f.id,error:(e as Error).message,noRetry:true});
       console.error(JSON.stringify({fixture:f.id,setupError:(e as Error).message,noRetry:true}));
     }
    },()=>stopLaunching);
    status=stopLaunching?"blocked":rows.length===groupFixtures.length?"completed_baseline":"paused_cleanly";
  }catch(e){
    status="blocked";
    console.error(JSON.stringify({status,reason:(e as Error).message,automaticRetry:false,seriesHeldMicro:ledger.held()}));
    process.exitCode=1;
  }finally{
    report(ledger);
    save(leasePath,{status,goalGroup:group,concurrency,harnessHash,corpusHash,recipeHash:sha(JSON.stringify(recipe)),finished:new Date().toISOString()});
    await ledger.close();
    process.removeListener("SIGTERM",stop);process.removeListener("SIGINT",stop);
  }
}
