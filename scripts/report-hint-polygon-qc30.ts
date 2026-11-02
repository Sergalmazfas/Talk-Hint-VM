import{readFileSync,readdirSync,existsSync,writeFileSync,mkdirSync}from"node:fs";
import{summarize,type Row}from"../server/hintPolygon/metrics";
import{sha}from"../server/hintPolygon/contracts";
const root="generated-artifacts/hint-polygon",out=`${root}/qc30-report`;
mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(`${root}/private-manifest.json`,"utf8"));
const ledger=JSON.parse(readFileSync(`${root}/series-ledger.json`,"utf8"));
const spent=ledger.entries.filter((e:any)=>e.status==="spent").reduce((s:number,e:any)=>s+e.charged,0);
const unknown=ledger.entries.filter((e:any)=>e.status==="unknown").reduce((s:number,e:any)=>s+e.reserve,0);
const reserved=ledger.entries.filter((e:any)=>e.status==="reserved").reduce((s:number,e:any)=>s+e.reserve,0);
const groups=["saved-goal","no-goal"].map(group=>{
 const trial=group==="saved-goal"?"a-qc30-goal-full":"a-qc30-no-goal-full",dir=`${root}/trials/${trial}`;
 const expected=manifest.fixtures.filter((f:any)=>!!f.goal===(group==="saved-goal"));
 const raw:Row[]=existsSync(`${dir}/rows`)?readdirSync(`${dir}/rows`).filter(f=>f.endsWith(".json")).map(f=>JSON.parse(readFileSync(`${dir}/rows/${f}`,"utf8"))):[];
 // Preserve immutable raw results. API failures are not an "ambiguous utterance"
 // and must never make an otherwise fast call look like a successful recipe.
 const review=raw.map(r=>{
   const failures=r.turns.filter(t=>t.reason&&!["NO_HINT_FOR_TURN","VAD_ALIGNMENT_UNCERTAIN","NEGATIVE_AUDIO_CLOCK"].includes(t.reason));
   const unavailable=r.reasons.some(s=>s.startsWith("QUALITY_UNAVAILABLE_"));
   return {fixtureId:r.fixtureId,rawHash:sha(JSON.stringify(r)),excludedForApiFailure:failures.length>0||unavailable,
    row:failures.length||unavailable?{...r,valid:false,reasons:[...r.reasons,"AUDIT_API_FAILURE_EXCLUDED"]}:r};
 });
 const rows=review.map(r=>r.row),withheld=expected.filter((f:any)=>!raw.some(r=>r.fixtureId===f.id)&&
   ledger.entries.some((e:any)=>e.kind==="stt"&&e.status==="unknown"&&e.id.includes(f.id))).map((f:any)=>({fixtureId:f.id,reason:"old unknown STT; not retried"}));
 const summary=summarize(rows,expected.length);
 return{group,trial,expected:expected.length,completed:rows.length,withheld,complete:rows.length+withheld.length===expected.length,
  ...summary,qualityCoverage:rows.filter(r=>r.valid&&r.quality!==null).length,
  costMicro:rows.reduce((s,r)=>s+r.chargedMicro,0),
  rawResultsUnchanged:true,review:review.map(({row,...e})=>e)};
});
const report={createdAt:new Date().toISOString(),corpusHash:manifest.corpusHash,method:{
 replay:"original dual-channel 8kHz, 1x, four recordings concurrently",
 qc:"only ambiguous turns excluded; call invalid when >30%; API failures excluded separately",
 firstWord:"parsed displayable English, not first byte / JSON token",
 comparison:"server pipeline only; phone/network/UI rendering parity NOT verified",
 groups:"saved goal / no saved goal always separate; no inferred goals",
 cash:"provider token usage + sent-duration estimates, not invoice; every diagnostic and unknown remains charged",
 },spentMicro:spent,unknownMicro:unknown,reservedMicro:reserved,heldMicro:spent+unknown+reserved,capMicro:ledger.limit,groups};
writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
const headers=["group","expected","completed","valid_calls","invalid_calls","withheld","stt_p50_ms","stt_p95_ms","english_p50_ms","english_p95_ms","full_p50_ms","translation_p50_ms","quality","quality_calls","trial_USD","complete"];
const lines=groups.map(g=>[g.group,g.expected,g.completed,g.validCalls,g.invalidCalls,g.withheld.length,
 g.timings.stt.p50Ms,g.timings.stt.p95Ms,g.timings.firstHintWord.p50Ms,g.timings.firstHintWord.p95Ms,
 g.timings.fullHint.p50Ms,g.timings.translation.p50Ms,g.quality,g.qualityCoverage,g.costMicro/1e6,g.complete]);
writeFileSync(`${out}/comparison.csv`,[headers,...lines].map(a=>a.map(v=>v===null||v===undefined?"":typeof v==="number"?String(Math.round(v*1e6)/1e6):String(v)).join(",")).join("\n")+"\n");
console.log(JSON.stringify({report:`${out}/report.json`,csv:`${out}/comparison.csv`,heldUSD:report.heldMicro/1e6,
 groups:groups.map(g=>({group:g.group,complete:g.complete,completed:g.completed,valid:g.validCalls,withheld:g.withheld.length,
  p50:g.timings.firstHintWord.p50Ms,p95:g.timings.firstHintWord.p95Ms,quality:g.quality}))}));
