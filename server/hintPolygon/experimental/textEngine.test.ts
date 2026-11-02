import{it,expect,vi,afterEach}from"vitest";
import{mkdtempSync,rmSync}from"node:fs";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{parseCards,localCard}from"./textEngine";
import{streamHint}from"./stream";
import{Ledger}from"../ledger";
const dirs:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
it("rejects malformed cards and abstains instead of selecting an unrelated reply",()=>{
 const cards=parseCards(JSON.stringify({cards:[{id:"date",triggers:["arrival","date"],en:"Tuesday, please.",native:"Во вторник."}]}));
 expect(localCard("Which arrival date?",cards)?.id).toBe("date");
 expect(localCard("Let me check.",cards)).toBeNull();
 expect(()=>parseCards('{"cards":[{"id":"x"}]}')).toThrow("INVALID_CARD");
 expect(()=>parseCards('{"cards":[]}')).toThrow("INVALID_CARDS");
});
function setup(done:boolean){
 const dir=mkdtempSync(join(tmpdir(),"hint-sse-"));dirs.push(dir);
 const ledger=new Ledger(join(dir,"ledger.json"),true);
 const events=[
  {model:"gpt-5.6-terra",choices:[{delta:{content:'{"translation":"","suggestion":{"en":"Hello '}}]},
  {model:"gpt-5.6-terra",choices:[{delta:{content:'there.","translation":""}}'},finish_reason:"stop"}]},
  {model:"gpt-5.6-terra",choices:[],usage:{prompt_tokens:200,completion_tokens:20,prompt_tokens_details:{cached_tokens:0}}},
 ].map(x=>"data: "+JSON.stringify(x)+"\n\n").join("")+(done?"data: [DONE]\n\n":"");
 vi.stubGlobal("fetch",async()=>new Response(events,{status:200,headers:{"x-request-id":"synthetic"}}));
 return ledger;
}
const body={model:"gpt-5.6-terra",messages:[{role:"system",content:"Return JSON."}],max_completion_tokens:250,response_format:{type:"json_object"}};
it("streams actual English, requires usage and charges the known result",async()=>{
 const l=setup(true);
 try{
  const h=await streamHint(l,"stream",body,"fixture");
  expect(h.en).toBe("Hello there.");expect(h.firstAt).toBeLessThanOrEqual(h.fullAt);
  expect(l.snapshot().entries[0].status).toBe("spent");
  expect(l.snapshot().entries[0].requestId).toBe("synthetic");
 }finally{await l.close();}
});
it("missing DONE stays charged as unknown and is never retried",async()=>{
 const l=setup(false);
 try{
  await expect(streamHint(l,"stream",body,"fixture")).rejects.toThrow("MISSING_DONE");
  expect(l.snapshot().entries[0].status).toBe("unknown");
  await expect(streamHint(l,"different-id",body,"fixture")).rejects.toThrow("UNKNOWN_PAYLOAD");
 }finally{await l.close();}
});
