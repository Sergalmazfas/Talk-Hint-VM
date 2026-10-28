/** Owner-authorized text bench only. Never imported by the application. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,open,appendFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import OpenAI from "openai";
import {buildOpenAIChatBody} from "../server/hintProvider";
import {parseJson,normalizeCandidate,codeMetrics} from "./unified-hint-metrics";
import {validateV3} from "./unified-hint-rescore-checks";

const dir="generated-artifacts/hint-unknown-owner-rule-v1";
await mkdir(dir,{recursive:true});
const read=async(p:string)=>JSON.parse(await readFile(p,"utf8"));
const base="generated-artifacts/hint-unified-preflight";
const frozen=await read(`${base}/frozen-reference-v1.json`);
const gens=await read(`${base}/execution/generations.json`);
const previous=await read("generated-artifacts/hint-unified-rescore-final/execution/judgments.json");
const good=new Map(previous.filter((r:any)=>r.sourceGroup==="current"&&r.qualityStatus==="usable_ai_estimate")
  .map((r:any)=>[r.sourceId,r]));
const models=["gpt-4.1-mini","gpt-5.6-luna","gpt-5.6-terra","gpt-5.2","gpt-5.6-sol"];
const common=frozen.filter((f:any)=>models.every(m=>gens.some((g:any)=>g.fixtureId===f.id&&g.model===m&&good.has(g.id))));
assert.equal(common.length,83);
const rule=`\nLAB-ONLY UNKNOWN OWNER STATE RULE:
A proposed reply must not assert a fact about the owner's current/past state or action
unless explicitly present in the goal as a FACT or in the owner's previous utterances.
Examples requiring evidence: "I see the button", "calls work", "I have not restarted".
A guest instruction/question is NOT proof the owner did it. Goal INTENT is NOT completion.
If the owner's state is unknown, use a neutral question/reply, or TWO clearly conditional
options for the owner to choose. Do not assume either option happened.
Questions, conditional choices and already evidenced facts are not this violation.
Keep the actual owner's goal and perspective; do not invent third-party facts either.
`;
const judgeSystem=await readFile("generated-artifacts/hint-unified-rescore-final/JUDGE.txt","utf8");
const rates:any={"gpt-4.1-mini":[.4,1.6],"gpt-5.6-terra":[2,12],"gpt-5.4-2026-03-05":[2.5,15]};
const matching=common.flatMap((f:any)=>models.map(m=>gens.find((g:any)=>g.fixtureId===f.id&&g.model===m)));
const audit=matching.map((g:any)=>{const j:any=good.get(g.id);return {fixtureId:g.fixtureId,model:g.model,
  inventedFacts:j.parsed.inventedFacts,speakingForOwner:j.parsed.speakingForOwner,claims:j.parsed.claims,reason:j.parsed.reason};});
const calibration=await read("generated-artifacts/hint-unified-rescore-final/execution/calibration-results.json");
await writeFile(`${dir}/FLAG_AUDIT.json`,JSON.stringify({commonMoments:83,
  codeDoesNotForceEquality:true,disagreeingCases:audit.filter((r:any)=>r.inventedFacts!==r.speakingForOwner),
  positiveCases:audit.filter((r:any)=>r.inventedFacts===true||r.speakingForOwner===true),
  asymmetricCalibration:calibration.filter((r:any)=>r.id.includes("third-party-not-owner"))},null,2));
await writeFile(`${dir}/PREFLIGHT.json`,JSON.stringify({version:1,scope:"saved text only",
  commonFixtureIds:common.map((f:any)=>f.id),models:["gpt-4.1-mini","gpt-5.6-terra"],
  generationRequests:166,judgeRequestsMaximum:166,maximumUSD:5,retries:0,
  authorization:{answer:"Да, до $5",scope:"Only this bench, no live/product changes"},
  rule,judgeSystemSHA256:createHash("sha256").update(judgeSystem).digest("hex"),publicRates:rates,
  originalAnswersUsedAsControl:true,livePromptChanged:false},null,2));
if(!process.argv.includes("--authorized-5-usd"))process.exit(0);
const lock=await open(`${dir}/RUN_ONCE.json`,"wx");await lock.writeFile(JSON.stringify({at:new Date().toISOString(),cap:5}));await lock.close();
const sdk=new OpenAI({maxRetries:0,timeout:60000});
let used=0,reserved=0,attempted=0,stop:string|null=null;
const rows:any[]=[];
async function request(model:string,messages:any[],max:number,kind:string,f:any,candidate?:any,candidateModel?:string){
 const rate=rates[model],bound=((Buffer.byteLength(JSON.stringify(messages))+256)*rate[0]+max*rate[1])/1e6;
 const r:any={id:`${kind}:${f.id}:${candidateModel??model}`,fixtureId:f.id,kind,model,candidateModel,
  status:"blocked",qualityStatus:"unknown",accountedUSD:0};
 rows.push(r);if(stop||used+reserved+bound>5){r.error=stop??"budget_bound";return r;}
 reserved+=bound;r.requestNumber=++attempted;r.reservedUpperUSD=bound;r.status="started";
 r.messageSHA256=createHash("sha256").update(JSON.stringify(messages)).digest("hex");
 const path=`${dir}/request-${String(attempted).padStart(4,"0")}.json`;
 await writeFile(path,JSON.stringify(r,null,2));const start=performance.now();
 try{
  const body=kind==="generation"?buildOpenAIChatBody(model,messages[0].content,messages[1].content,max):
   {model,messages,max_completion_tokens:max,reasoning_effort:"none",response_format:{type:"json_object"}};
  const stream=await sdk.chat.completions.create({...body,stream:true,stream_options:{include_usage:true}} as any) as any;
  r.rawOutput="";
  for await(const chunk of stream){if(chunk.usage)r.usage=chunk.usage;r.providerModel=chunk.model;
   const c=chunk.choices?.[0];if(c?.finish_reason)r.finishReason=c.finish_reason;
   if(c?.delta?.content){r.firstContentMs??=performance.now()-start;r.rawOutput+=c.delta.content;}}
  r.fullOutputMs=performance.now()-start;r.parsed=parseJson(r.rawOutput);assert(r.parsed);
  assert.equal(r.finishReason,"stop");
  if(kind==="generation"){r.normalized=normalizeCandidate(r.parsed,false);assert(r.normalized);r.codeMetrics=codeMetrics(r.normalized);}
  else{r.sourceAuditProblems=validateV3(r.parsed,candidate,f.reference);if(r.sourceAuditProblems.length)throw Error("judge_contract_rejected");}
  r.status="complete";r.qualityStatus="usable_ai_estimate";
 }catch(e:any){r.status="failed";r.error={code:e.code??e.message??"unknown"};
  if(["insufficient_quota","credit_balance_exhausted","invalid_api_key"].includes(e.code))stop=e.code;}
 finally{
  r.durationMs=performance.now()-start;reserved-=bound;
  r.accountedUSD=r.usage?(r.usage.prompt_tokens*rate[0]+r.usage.completion_tokens*rate[1])/1e6:bound;
  used+=r.accountedUSD;
  await writeFile(path,JSON.stringify(r,null,2));
  await appendFile(`${dir}/ledger.jsonl`,JSON.stringify({id:r.id,requestNumber:r.requestNumber,status:r.status,accountedUSD:r.accountedUSD})+"\n");
 }
 return r;
}
const jobs=common.flatMap((f:any)=>["gpt-4.1-mini","gpt-5.6-terra"].map(model=>({f,model})));
let index=0;
await Promise.all(Array.from({length:4},async()=>{while(index<jobs.length){
 const {f,model}=jobs[index++];const messages=structuredClone(f.messages);
 messages[0].content+=rule;
 const g=await request(model,messages,250,"generation",f);
 if(g.qualityStatus==="usable_ai_estimate"){
  const judge=await request("gpt-5.4-2026-03-05",[{role:"system",content:judgeSystem},{role:"user",
   content:JSON.stringify({reference:f.reference,conversationBefore:f.history,currentGuest:f.guest,
    candidate:{type:g.normalized.type,cards:g.normalized.cards,guestTranslation:g.normalized.guestTranslation??""}})}],
   1500,"judge",f,g.normalized,model);
  judge.candidateModel=model;
 }
 await writeFile(`${dir}/progress.json`,JSON.stringify({attempted,accountedUSD:used,inflightReservedUSD:reserved,stop,finishedJobs:index}));
}}));
assert(used<=5+1e-8);
await writeFile(`${dir}/RESULT.json`,JSON.stringify({at:new Date().toISOString(),attempted,
 accountedUSD:used,stop,rows,rule,commonFixtureIds:common.map((f:any)=>f.id),productChanged:false},null,2));
console.log(JSON.stringify({attempted,accountedUSD:used,stop,complete:rows.filter(r=>r.status==="complete").length}));
