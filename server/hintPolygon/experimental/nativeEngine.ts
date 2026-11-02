import {NativeHints}from"./realtime";
import type{HintEngine}from"./engine";
import type{Ledger}from"../ledger";
import type{Fixture}from"../replay";
import{promptRequest}from"../provider";
import{sha,type Recipe}from"../contracts";
export function nativeEngine(f:Fixture,r:Recipe,ledger:Ledger,run:string):HintEngine{
 const suffix="\nAudio input is exclusively Guest. Owner statements are explicitly labelled text. "+
  "Suggest what Owner can SAY next, never answer as Guest. Follow the LIVE JSON format above. Output text only.";
 const instructions=promptRequest(r,"",f.goal,"").system+suffix;
 const template=promptRequest(r,"","","").system+suffix;
 const native=new NativeHints(ledger,`${run}-${f.id}`,f.id,f.audioSha256,instructions,r.maxOutputTokens);
 return{
  open:()=>native.open(),
  frame:(role,frame)=>{if(role==="guest")native.append(frame);},
  owner:text=>native.owner(text),
  generate:async(turnId,text)=>{
   const h=await native.generate(turnId,text);
   return{...h,inputTokens:h.usage.input_tokens,outputTokens:h.usage.output_tokens};
  },
  close:()=>native.close(),
  audit:()=>native.auditLog,
  metadata:()=>({systemHash:sha(instructions),systemChars:Array.from(instructions).length,
   promptVersion:"native-guest-live-"+sha(template).slice(0,16),
   contextProvenance:"Guest original audio -> Realtime; Owner Flux text; Flux EOT is controlled gate and judge reference, NOT native autonomous EOT"}),
 };
}
