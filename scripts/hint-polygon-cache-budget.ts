/** One accounting reserve, NOT a model request; never rewrites old charges. */
import{existsSync,readFileSync,writeFileSync}from"node:fs";
import{Ledger}from"../server/hintPolygon/ledger";
import{SERIES,sha}from"../server/hintPolygon/contracts";
const root="generated-artifacts/hint-polygon",path=`${root}/series-ledger.json`;
if(existsSync(path+".lock"))throw Error("ACTIVE_REPLAY_DO_NOT_TOUCH_LEDGER");
const raw=readFileSync(path,"utf8"),before=JSON.parse(raw);
if(before.entries.some((e:any)=>e.status==="reserved"))throw Error("ACTIVE_RESERVE_STOP");
const id=SERIES+"-historical-cache-write-contingency";
if(before.entries.some((e:any)=>e.id===id))throw Error("CONTINGENCY_ALREADY_EXISTS_READ_ONLY_REVIEW_NO_REPEAT");
const historical=before.entries.filter((e:any)=>e.kind==="brain"&&e.status==="spent").map((e:any)=>({
 id:e.id,originalChargedMicro:e.charged,maximumMissingWritePremiumMicro:Math.ceil(e.charged*.25),
}));
const amount=historical.reduce((s:number,e:any)=>s+e.maximumMissingWritePremiumMicro,0);
const payloadHash=sha(JSON.stringify(historical));
const plan={id,kind:"accounting-contingency",amountMicro:amount,payloadHash,beforeLedgerHash:sha(raw),
 historical,source:"https://developers.openai.com/api/docs/guides/prompt-caching",
 reason:"Conservative upper bound: at most 25% of each historical known Terra charge covers its unreported 30-minute cache-write premium. Includes output too, therefore overestimates rather than silently undercounts. Not confirmed spend or a provider execution.",
 noProviderRequest:true,noHistoricalChargesChanged:true};
const fdPath=`${root}/historical-cache-write-contingency.json`;
writeFileSync(fdPath,JSON.stringify(plan,null,2),{flag:"wx",mode:0o600});
const ledger=new Ledger(path,true);
try{
 await ledger.reserve(id,"accounting-contingency",amount,payloadHash,"whole-series-pricing-reserve");
 await ledger.unknown(id);
 const after=ledger.snapshot();
 if(JSON.stringify(after.entries.filter(e=>e.id!==id))!==JSON.stringify(before.entries))throw Error("HISTORY_CHANGED_STOP");
 writeFileSync(`${root}/pricing-accounting-hold.json`,JSON.stringify({
  status:"resolved",contingencyId:id,reservedMicro:amount,payloadHash,
  plan:fdPath,reason:"Historical upper-bound hold added; future tokenCost counts cache writes, maximum if usage breakdown missing.",
 },null,2),{mode:0o600});
 console.log(JSON.stringify({status:"historical_upper_bound_reserved",heldMicro:ledger.held(),cacheWriteReserveMicro:amount,limitMicro:15_000_000,noProviderRequest:true}));
}finally{await ledger.close();}
