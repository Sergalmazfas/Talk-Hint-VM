import WebSocket from"ws";
import{performance}from"node:perf_hooks";
import type{Ledger}from"../ledger";
import type{Fixture}from"../replay";
import{sha,type Recipe}from"../contracts";
import{chat}from"../provider";
import{buildOpenAIChatBody}from"../../hintProvider";
import type{HintEngine}from"./engine";
import{geminiCost,geminiPriceSource}from"./geminiCost";
/** Real Live audio output + output transcription, NOT a text-only API substitute. */
export function geminiEngine(f:Fixture,r:Recipe,ledger:Ledger,run:string,maxTurns:number):HintEngine{
 const instructions="You are a private prompter. Listen ONLY to Guest audio. Owner text is labelled separately. "+
  "For each Guest turn, speak ONLY one concise English sentence that Owner can SAY next, not advice or narration. "+
  "No JSON or Markdown. Do not answer as Guest. Use only known facts; never invent names, dates, prices or commitments. "+
  "Acknowledge waiting briefly; answer direct questions first. No tools or external actions. Saved goal:\n"+f.goal;
 const id=`${run}-${f.id}-gemini-session`;
 let ws:WebSocket|undefined,fatal:Error|undefined,activity=false,billingUnknown=false,usedTurns=0,cost=0,httpStatus:number|undefined,requestId:string|null=null;
 let active:{resolve:(h:any)=>void;reject:(e:Error)=>void;text:string;firstAt:number|null;fullAt:number|null;usage:any;
  timer:ReturnType<typeof setTimeout>}|undefined;
 const receipts:unknown[]=[],owners:string[]=[];
 const send=(value:any)=>{if(fatal)throw fatal;if(ws?.readyState!==WebSocket.OPEN)throw Error("GEMINI_NOT_OPEN");ws.send(JSON.stringify(value));};
 const fail=(e:Error)=>{fatal??=e;if(active){
  receipts.push({stage:"failed-turn",error:e.message,textChars:active.text.length,hasTurnComplete:active.fullAt!==null,hasUsage:!!active.usage});
  clearTimeout(active.timer);active.reject(e);active=undefined;
 }};
 const flushOwners=()=>{if(!active&&owners.length)send({clientContent:{turns:owners.splice(0).map(text=>({role:"user",parts:[{text:"Owner already said: "+text}]})),turnComplete:false}});};
 const finish=()=>{
  const a=active;if(!a||a.fullAt===null)return;
  try{
   const c=a.usage?geminiCost(a.usage):null;if(c!==null)cost+=c;else billingUnknown=true;
   if(!a.text.trim()||!/[.!?]\s*$/.test(a.text.trim()))throw Error("GEMINI_INCOMPLETE_SENTENCE");
   receipts.push({stage:"native-audio-transcription",usage:a.usage,estimatedUpperCostMicro:c,
    accounting:c===null?"missing usage: full session reserve remains charged":"conservative usage estimate"});
   clearTimeout(a.timer);active=undefined;
   a.resolve({en:a.text.trim(),firstAt:a.firstAt??a.fullAt,fullAt:a.fullAt});flushOwners();
  }catch(e){fail(e as Error);}
 };
 return{
  async open(){
   if(!Number.isSafeInteger(maxTurns)||maxTurns<1||maxTurns>64)throw Error("GEMINI_INVALID_TURN_BOUND");
   if(ledger.snapshot().entries.some(e=>e.kind==="gemini-audio"&&e.scope===f.id&&e.status==="unknown"))
    throw Error("GEMINI_UNKNOWN_FIXTURE_NOT_RETRIED");
   const reserve=Math.ceil(((Buffer.byteLength(instructions)+8192+f.durationMs/1000*64)*3+
    f.durationMs/1000*100*3+r.maxOutputTokens*12)*(maxTurns+1)*1.5);
   await ledger.reserve(id,"gemini-audio",reserve,sha(JSON.stringify({audio:f.audioSha256,instructions,model:r.model,maxTurns,output:r.maxOutputTokens})),f.id);
   await new Promise<void>((resolve,reject)=>{
    const t=setTimeout(()=>reject(Error("GEMINI_SETUP_TIMEOUT")),15000);
    ws=new WebSocket("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
     {headers:{"x-goog-api-key":process.env.GEMINI_API_KAY!},handshakeTimeout:12000});
    ws.on("upgrade",res=>{httpStatus=res.statusCode;requestId=String(res.headers["x-request-id"]??"")||null;});
    ws.on("open",()=>send({setup:{model:"models/gemini-3.8-live",
     generationConfig:{responseModalities:["AUDIO"],maxOutputTokens:r.maxOutputTokens},
     realtimeInputConfig:{automaticActivityDetection:{disabled:true}},outputAudioTranscription:{},
     systemInstruction:{parts:[{text:instructions}]}}}));
    ws.on("error",()=>{clearTimeout(t);const e=Error("GEMINI_SOCKET_ERROR");reject(e);fail(e);});
    ws.on("close",code=>{clearTimeout(t);if(code!==1000){const e=Error("GEMINI_CLOSED_"+code);reject(e);fail(e);}});
    ws.on("message",raw=>{
     try{
      const m=JSON.parse(raw.toString());
      if(m.error)throw Error("GEMINI_ERROR_"+String(m.error.code??"unknown").replace(/[^a-z0-9_-]/gi,""));
      if(m.setupComplete){clearTimeout(t);resolve();}
      const s=m.serverContent;
      if(s?.interrupted)throw Error("GEMINI_INTERRUPTED");
      if(s?.outputTranscription?.text){
       if(!active)throw Error("GEMINI_UNSOLICITED_OUTPUT");
       active.text+=s.outputTranscription.text;
       if(active.firstAt===null&&/^\s*\S+(?:\s|[.!?]$)/.test(active.text))active.firstAt=performance.now();
      }
      if(m.usageMetadata&&active){active.usage=m.usageMetadata;if(active.fullAt!==null)finish();}
      if(s?.turnComplete&&active){active.fullAt=performance.now();setTimeout(finish,250);}
     }catch(e){clearTimeout(t);reject(e);fail(e as Error);}
    });
   });
  },
  frame(role,frame){
   if(role!=="guest")return;if(fatal)throw fatal;
   const pcm=Buffer.alloc(frame.length*4);let sum=0;
   for(let i=0;i<frame.length;i++){
    const u=(~frame[i])&255,m=(((u&15)<<3)+132)<<((u&112)>>4),v=(u&128)?132-m:m-132;
    pcm.writeInt16LE(v,i*4);pcm.writeInt16LE(v,i*4+2);sum+=v*v;
   }
   if(!activity&&Math.sqrt(sum/frame.length)>100){flushOwners();send({realtimeInput:{activityStart:{}}});activity=true;}
   if(activity)send({realtimeInput:{audio:{data:pcm.toString("base64"),mimeType:"audio/pcm;rate=16000"}}});
  },
  owner(text){owners.push(text);flushOwners();},
  async generate(turnId,text){
   if(fatal)throw fatal;if(active)throw Error("GEMINI_OVERLAPPING_TURNS");
   if(!activity)throw Error("GEMINI_NO_AUDIO_ACTIVITY");
   if(++usedTurns>maxTurns)throw Error("GEMINI_TURN_BOUND_EXCEEDED");
   const h=await new Promise<any>((resolve,reject)=>{
    active={resolve,reject,text:"",firstAt:null,fullAt:null,usage:null,
     timer:setTimeout(()=>fail(Error("GEMINI_TURN_TIMEOUT_NO_RETRY")),45000)};
    send({realtimeInput:{activityEnd:{}}});activity=false;
   });
   const body=buildOpenAIChatBody("gpt-5.6-terra",
    "Translate only supplied text into Russian. Return JSON {translation:Russian guest utterance,native:Russian English-reply translation}. No additional commentary.",
    JSON.stringify({guest:text,english:h.en}),250);
   const v=await chat(ledger,`${run}-${turnId}-russian`,"brain",body,f.id,t=>{
    let x:any;try{x=JSON.parse(t);}catch{throw Error("INVALID_TRANSLATION_JSON");}
    if(typeof x.native!=="string"||typeof x.translation!=="string")throw Error("INVALID_TRANSLATION_SCHEMA");return x;
   }),translated=v.prepared as any;
   return{...h,native:translated.native,translation:translated.translation,translationAt:v.readyAt,inputTokens:v.usage.prompt_tokens,outputTokens:v.usage.completion_tokens};
  },
  async close(){
   if(active)fail(Error("GEMINI_SESSION_ENDED_WITH_ACTIVE_RESPONSE"));
   ws?.removeAllListeners("close");ws?.terminate();
   if(fatal||billingUnknown||usedTurns!==receipts.length)await ledger.unknown(id,{httpStatus,requestId});
   else await ledger.finish(id,cost,{httpStatus,requestId});
  },
  audit:()=>[{stage:"Gemini Live audio -> output transcription; not text-native",priceSource:geminiPriceSource,
   maxTurns,usedTurns,pricing:"usage-based conservative upper estimate, not invoice",modelEcho:"not provided",receipts}],
  metadata:()=>({systemHash:sha(instructions),systemChars:Array.from(instructions).length,
   promptVersion:"gemini-native-compact-"+sha(instructions.replace(f.goal,"")).slice(0,16),
   contextProvenance:"original Guest audio: G711 8k -> PCM 16k sample repetition; online energy start, Flux EOT end; Owner finals as labelled text; audio-output transcript, separate Terra Russian"}),
 };
}
