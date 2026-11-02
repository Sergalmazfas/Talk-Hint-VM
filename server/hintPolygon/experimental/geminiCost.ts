/** Frozen paid-tier prices; conservative for unclassified/thinking tokens. */
export const geminiPriceSource="https://ai.google.dev/gemini-api/docs/pricing";
export function geminiCost(u:any){
 const count=(n:any)=>{if(!Number.isSafeInteger(n)||n<0)throw Error("GEMINI_USAGE_UNKNOWN");return n as number;};
 const part=(total:any,details:any,prices:Record<string,number>,ceiling:number)=>{
  const n=count(total);let used=0,cost=0;
  for(const d of details??[]){const k=count(d.tokenCount);used+=k;cost+=k*(prices[d.modality]??ceiling);}
  if(used>n)throw Error("GEMINI_USAGE_INCONSISTENT");
  return cost+(n-used)*ceiling;
 };
 return Math.ceil(part(u?.promptTokenCount,u?.promptTokensDetails,{TEXT:.75,AUDIO:3,IMAGE:1},3)+
  part(u?.responseTokenCount,u?.responseTokensDetails,{TEXT:4.5,AUDIO:12},12)+count(u?.thoughtsTokenCount??0)*12);
}
