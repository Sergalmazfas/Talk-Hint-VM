import{performance}from"node:perf_hooks";
import type{Ledger}from"../ledger";
import{canonicalModel,money,sha,tokenCost}from"../contracts";
import{parseHint}from"../provider";
import{firstEnglishWord}from"./realtime";
/** JSON-mode SSE, real English milestone; usage required, no retries/fallback. */
export async function streamHint(ledger:Ledger,id:string,body:any,scope:string){
 if(canonicalModel(body.model)!==canonicalModel("gpt-5.6-terra"))throw Error("UNPRICED_STREAM_MODEL");
 const rate=money.brain;
 const request={...body,stream:true,stream_options:{include_usage:true}};
 const reserve=Math.ceil((Buffer.byteLength(JSON.stringify(request),"utf8")+2048)*rate.input*1.25+
  (body.max_completion_tokens??body.max_tokens)*rate.output);
 await ledger.reserve(id,"brain",reserve,sha(JSON.stringify(request)),scope);
 let httpStatus:number|undefined,requestId:string|null=null;
 try{
  const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",
   headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
   body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});
  httpStatus=response.status;requestId=response.headers.get("x-request-id");
  if(!response.ok||!response.body)throw Error(`STREAM_HTTP_${response.status}`);
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer="",text="",firstAt:number|null=null,usage:any,finish:string|undefined,done=false,actualModel="";
  for(;;){
   const part=await reader.read();buffer+=decoder.decode(part.value,{stream:!part.done});
   let idx:number;
   while((idx=buffer.indexOf("\n"))!==-1){
    const line=buffer.slice(0,idx).trim();buffer=buffer.slice(idx+1);
    if(!line.startsWith("data:"))continue;
    const payload=line.slice(5).trim();
    if(payload==="[DONE]"){done=true;continue;}
    let event:any;try{event=JSON.parse(payload);}catch{throw Error("INVALID_STREAM_EVENT");}
    if(event.error)throw Error("STREAM_PROVIDER_ERROR");
    actualModel=event.model??actualModel;usage=event.usage??usage;
    const choice=event.choices?.[0];
    if(choice?.finish_reason)finish=choice.finish_reason;
    if(typeof choice?.delta?.content==="string"){
     text+=choice.delta.content;if(firstAt===null&&firstEnglishWord(text))firstAt=performance.now();
    }
   }
   if(part.done)break;
  }
  if(!done)throw Error("STREAM_MISSING_DONE_NO_RETRY");
  if(canonicalModel(actualModel)!==canonicalModel(body.model))throw Error("MODEL_SUBSTITUTION");
  const cost=tokenCost(usage,rate);
  let hint:ReturnType<typeof parseHint>|undefined,error:Error|undefined;
  try{if(finish!=="stop")throw Error("STREAM_OUTPUT_UNFINISHED");hint=parseHint(text);}catch(e){error=e as Error;}
  const fullAt=performance.now();
  await ledger.finish(id,cost,{httpStatus,requestId});
  if(error)throw error;if(!hint)throw Error("EMPTY_STREAM");
  const word=firstEnglishWord(text);
  return{...hint,firstAt:firstAt!==null&&word&&hint.en.startsWith(word)?firstAt:fullAt,fullAt,usage};
 }catch(e){
  await ledger.unknown(id,{httpStatus,requestId});throw e;
 }
}
