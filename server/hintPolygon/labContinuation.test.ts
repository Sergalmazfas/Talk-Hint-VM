import{expect,it}from"vitest";
import{verifyLabContinuation}from"./labContinuation";
import{BASELINE,sha,assertAdapter}from"./contracts";
function evidence(){
 const corpusHash="a".repeat(64),recipeHash=sha(JSON.stringify(BASELINE));
 const rows=Array.from({length:14},(_,i)=>({fixtureId:"fixture-"+i,corpusHash,recipeHash,valid:i>0,quality:i?4:null}))as any;
 const proof={corpusHash,capMicro:15_000_000,groups:[{group:"saved-goal",complete:true,expected:15,completed:14,
  withheld:[{fixtureId:"unknown-old"}],validCalls:13,qualityCoverage:13,timings:{firstHintWord:{p50Ms:2000}},
  review:rows.map((r:any)=>({fixtureId:r.fixtureId,rawHash:sha(JSON.stringify(r))}))}]};
 return{rows,proof,corpusHash};
}
it("records owner-authorized lab continuation, never self-acceptance or LIVE parity",()=>{
 const{rows,proof,corpusHash}=evidence(),r=verifyLabContinuation(proof,corpusHash,rows);
 expect(r.liveParityVerified).toBe(false);expect(r.productAcceptance).toBe(false);
 expect(r.limitMicro).toBe(15_000_000);
});
it("rejects a changed row, wrong corpus, incomplete judge coverage or unbounded budget",()=>{
 const{rows,proof,corpusHash}=evidence();
 expect(()=>verifyLabContinuation(proof,"wrong",rows)).toThrow();
 expect(()=>verifyLabContinuation({...proof,capMicro:16_000_000},corpusHash,rows)).toThrow();
 proof.groups[0].qualityCoverage=12;expect(()=>verifyLabContinuation(proof,corpusHash,rows)).toThrow();
 proof.groups[0].qualityCoverage=13;rows[0].quality=5;
 expect(()=>verifyLabContinuation(proof,corpusHash,rows)).toThrow("ROW_OR_RECIPE_CHANGED");
});
it("allows only the explicit controlled native recipe, never a silent provider substitute",()=>{
 const r={...BASELINE,id:"b0-controlled",architecture:"audio-direct"as const,model:"gpt-realtime-2.1",stream:true};
 expect(()=>assertAdapter(r)).not.toThrow();
 expect(()=>assertAdapter({...r,model:"gpt-realtime-mini"})).toThrow("NO_SUBSTITUTION");
 expect(()=>assertAdapter({...r,stt:"native-vad"})).toThrow("NO_SUBSTITUTION");
});
