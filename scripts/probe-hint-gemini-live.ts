/** Single synthetic control; never sends call data; same durable $15 ledger. */
import WebSocket from"ws";
import{openSync,writeFileSync,closeSync}from"node:fs";
import{Ledger}from"../server/hintPolygon/ledger";
import{sha}from"../server/hintPolygon/contracts";
import{geminiCost}from"../server/hintPolygon/experimental/geminiCost";
const root="generated-artifacts/hint-polygon",file=`${root}/gemini-live-control.json`;
const fd=openSync(file,"wx",0o600);writeFileSync(fd,'{"status":"started","noRetry":true}');closeSync(fd);
const ledger=new Ledger(`${root}/series-ledger.json`,true),id="gemini-live-format-control-v1";
const setup={setup:{model:"models/gemini-3.8-live",generationConfig:{responseModalities:["AUDIO"],maxOutputTokens:128},
 outputAudioTranscription:{},systemInstruction:{parts:[{text:"Synthetic API check. Say only Hello. No tools."}]}}};
let ws:WebSocket|undefined,httpStatus:number|undefined,requestId:string|null=null,usage:any,textChars=0,audioBytes=0;
try{
 await ledger.reserve(id,"gemini-probe",100_000,sha(JSON.stringify(setup)),"synthetic-gemini-control");
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("GEMINI_CONTROL_TIMEOUT_NO_RETRY")),25000);
  let complete=false,settle:ReturnType<typeof setTimeout>|undefined;
  const check=()=>{if(complete&&usage&&!settle)settle=setTimeout(()=>{clearTimeout(timer);resolve();},200);};
  ws=new WebSocket("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
   {headers:{"x-goog-api-key":process.env.GEMINI_API_KAY!},handshakeTimeout:12000});
  ws.on("upgrade",r=>{httpStatus=r.statusCode;requestId=String(r.headers["x-request-id"]??"")||null;});
  ws.on("open",()=>ws!.send(JSON.stringify(setup)));
  ws.on("error",()=>{clearTimeout(timer);reject(Error("GEMINI_SOCKET_ERROR"));});
  ws.on("close",code=>{if(!complete){clearTimeout(timer);reject(Error("GEMINI_CLOSED_"+code));}});
  ws.on("message",raw=>{
   let m:any;try{m=JSON.parse(raw.toString());}catch{clearTimeout(timer);reject(Error("GEMINI_INVALID_EVENT"));return;}
   if(m.error){clearTimeout(timer);reject(Error("GEMINI_ERROR_"+String(m.error.code??"unknown").replace(/[^a-z0-9_-]/gi,"")));return;}
   if(m.setupComplete)ws!.send(JSON.stringify({clientContent:{turns:[{role:"user",parts:[{text:"Say Hello."}]}],turnComplete:true}}));
   if(m.usageMetadata)usage=m.usageMetadata;
   textChars+=m.serverContent?.outputTranscription?.text?.length??0;
   for(const p of m.serverContent?.modelTurn?.parts??[])if(p.inlineData?.data)audioBytes+=Buffer.from(p.inlineData.data,"base64").length;
   if(m.serverContent?.turnComplete)complete=true;check();
  });
 });
 const cost=geminiCost(usage);
 if(!textChars||!audioBytes)throw Error("GEMINI_AUDIO_OR_TRANSCRIPT_MISSING");
 await ledger.finish(id,cost,{httpStatus,requestId});
 const result={status:"completed",requestedModel:setup.setup.model,modelEcho:"not provided by Live server",
  textChars,audioBytes,usage,costMicro:cost,priceSource:"https://ai.google.dev/gemini-api/docs/pricing",
  noCallData:true,noRetry:true};
 writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){
 await ledger.unknown(id,{httpStatus,requestId});
 const result={status:"failed",error:(e as Error).message,textChars,audioBytes,usage:usage??null,noRetry:true};
 writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=1;
}finally{ws?.terminate();await ledger.close();}
