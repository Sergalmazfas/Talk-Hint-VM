import WebSocket from "ws";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import type {Ledger} from "../ledger";
import {sha} from "../contracts";
import {parseHint} from "../provider";

// Official sources, retrieved before implementation:
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/guides/realtime-costs
// Input audio: 1 token / 100ms; reserve at FIVE times that rate.
// This controlled B variant uses Flux only for turn boundaries / judge text.
// Guest transcript text is NEVER supplied to the native model.
export const NATIVE_MODEL="gpt-realtime-2.1";
/** A known Markdown envelope is transport formatting, not prose to guess around. */
export function parseNativeHint(text:string){
 const t=text.trim(),m=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
 const body=m?m[1]:t;
 try{JSON.parse(body);}catch{throw Error("INVALID_HINT_JSON");}
 return parseHint(body);
}
const partialJSON=(text:string)=>text.replace(/^\s*```(?:json)?\s*/i,"");
export const nativeRate={text:4,audio:32,cachedText:.4,cachedAudio:.4,outText:24,outAudio:64};
export function nativeCost(u:any) {
  const d=u?.input_token_details,o=u?.output_token_details;
  const values=[u?.input_tokens,u?.output_tokens,d?.text_tokens,d?.audio_tokens,o?.text_tokens,o?.audio_tokens];
  if(values.some(v=>!Number.isSafeInteger(v)||v<0))throw Error("NATIVE_USAGE_UNKNOWN");
  if(d.text_tokens+d.audio_tokens!==u.input_tokens || o.text_tokens+o.audio_tokens!==u.output_tokens)
    throw Error("NATIVE_USAGE_MODALITY_MISMATCH");
  const c=d.cached_tokens_details;
  if(d.cached_tokens && !c)throw Error("NATIVE_CACHED_USAGE_UNKNOWN");
  const ct=c?.text_tokens??0,ca=c?.audio_tokens??0;
  if(!Number.isSafeInteger(ct)||!Number.isSafeInteger(ca)||ct<0||ca<0||ct>d.text_tokens||ca>d.audio_tokens||
    ct+ca!==(d.cached_tokens??0))throw Error("NATIVE_CACHE_USAGE_INVALID");
  return Math.ceil((d.text_tokens-ct)*nativeRate.text+(d.audio_tokens-ca)*nativeRate.audio+
    ct*nativeRate.cachedText+ca*nativeRate.cachedAudio+
    o.text_tokens*nativeRate.outText+o.audio_tokens*nativeRate.outAudio);
}
// A JSON token or first response byte is NOT a displayable English word.
export function firstEnglishWord(s:string) {
  const match=s.match(/(?<!\\)"suggestion"\s*:\s*\{[^{}]*?(?<!\\)"en"\s*:\s*"([^"\\]*)(["\\]|$)/);
  if(!match)return null;
  const completeWord=match[1].match(/^\s*([A-Za-z]+(?:['’-][A-Za-z]+)*)(?:\s|[.,!?:;])/);
  if(completeWord)return completeWord[1];
  return match[2]==='"'?match[1].match(/^\s*([A-Za-z]+(?:['’-][A-Za-z]+)*)$/)?.[1]??null:null;
}
type ContextItem=Record<string,unknown>;
export type NativeResult={en:string;translation:string;native:string;firstAt:number;fullAt:number;translationAt:number|null;usage:any;model:string};
type ResponseWaiter={resolve:(v:NativeResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;text:string;firstAt:number|null};

export class NativeHints {
  private ws!:WebSocket;
  private audioBytes=0;
  private audioHash=createHash("sha256");
  private context:ContextItem[]=[];
  private ownerBytes=0;
  private ownerHash=createHash("sha256");
  private commits:{resolve:(v:string)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}[]=[];
  private responses=new Map<string,ResponseWaiter>();
  private fatal:Error|null=null;
  private handshakeRequestId:string|null=null;
  readonly auditLog:unknown[]=[];
  constructor(private ledger:Ledger,private prefix:string,private fixtureId:string,private audioSha:string,
    private instructions:string,private maxOutputTokens=250){}
  async open() {
    if(this.ledger.snapshot().entries.some(e=>e.kind==="native-audio"&&e.scope===this.fixtureId&&e.status==="unknown"))
      throw Error("UNKNOWN_NATIVE_FIXTURE_NOT_RETRIED");
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("NATIVE_CONFIG_TIMEOUT")),20_000);
      this.ws=new WebSocket(`wss://api.openai.com/v1/realtime?model=${NATIVE_MODEL}`,{
        headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},handshakeTimeout:15_000});
      this.ws.on("upgrade",res=>{this.handshakeRequestId=String(res.headers["x-request-id"]??"")||null;});
      this.ws.on("error",()=>{const e=Error("NATIVE_SOCKET_ERROR");clearTimeout(timer);reject(e);void this.fail(e);});
      this.ws.on("close",()=>{if(this.responses.size||this.commits.length)void this.fail(Error("NATIVE_SOCKET_CLOSED"));});
      this.ws.on("message",raw=>{
        let m:any;try{m=JSON.parse(raw.toString());}catch{void this.fail(Error("NATIVE_EVENT_JSON_INVALID"));return;}
        if(m.type==="session.created")this.ws.send(JSON.stringify({type:"session.update",session:{
          type:"realtime",output_modalities:["text"],instructions:this.instructions,
          audio:{input:{format:{type:"audio/pcmu"},turn_detection:null}},max_output_tokens:this.maxOutputTokens}}));
        if(m.type==="session.updated"){clearTimeout(timer);
          if(m.session?.model!==NATIVE_MODEL){reject(Error("NATIVE_MODEL_SUBSTITUTION"));return;}resolve();}
        if(m.type==="error"){clearTimeout(timer);const code=String(m.error?.code??"error").replace(/[^a-zA-Z0-9_-]/g,"");
          const e=Error("NATIVE_API_"+code);reject(e);void this.fail(e);}
        if(m.type==="input_audio_buffer.committed"){
          const w=this.commits.shift();if(w){clearTimeout(w.timer);this.context.push({type:"item_reference",id:m.item_id});w.resolve(m.item_id);}}
        const key=m.response?.metadata?.lab_request??m.metadata?.lab_request;
        if(m.type==="response.created" && key)this.responseIds.set(m.response.id,key);
        const id=key??this.responseIds.get(m.response_id??m.response?.id),w=id?this.responses.get(id):undefined;
        if(w && (m.type==="response.output_text.delta"||m.type==="response.text.delta")){
          w.text+=m.delta??"";if(w.firstAt===null&&firstEnglishWord(partialJSON(w.text)))w.firstAt=performance.now();}
        if(w && m.type==="response.done")void this.complete(id,w,m.response);
      });
    });
  }
  private responseIds=new Map<string,string>();
  append(frame:Buffer) {
    if(this.fatal)throw this.fatal;
    this.audioBytes+=frame.length;this.audioHash.update(frame);
    this.ws.send(JSON.stringify({type:"input_audio_buffer.append",audio:frame.toString("base64")}));
  }
  owner(text:string) {
    this.ownerBytes+=Buffer.byteLength(text);this.ownerHash.update(text+"\n");
    this.context.push({type:"message",role:"user",content:[{type:"input_text",text:"Owner: "+text}]});
  }
  async generate(turnId:string,guestTextForDedupOnly:string):Promise<NativeResult> {
    if(this.fatal)throw this.fatal;
    const id=this.prefix+"-"+turnId+"-native";
    const allowedOwners=new Set(this.context.filter(i=>i.type==="message"));
    const ownerHash=this.ownerHash.copy().digest("hex"),ownerBytes=this.ownerBytes,audioSeconds=this.audioBytes/8000;
    // Commit immediately at Flux EOT, before waiting for durable budget I/O.
    const itemId=await new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("NATIVE_COMMIT_TIMEOUT")),10_000);
      this.commits.push({resolve,reject,timer});this.ws.send(JSON.stringify({type:"input_audio_buffer.commit"}));
    });
    // Neither a later Owner final nor later Guest audio may leak into this request.
    const current=this.context.findIndex(i=>i.type==="item_reference"&&i.id===itemId);
    const input=this.context.slice(0,current+1).filter(i=>i.type!=="message"||allowedOwners.has(i));
    const reserve=Math.ceil((Buffer.byteLength(this.instructions)+ownerBytes+4096)*nativeRate.text*1.25+
      (audioSeconds*50+1024)*nativeRate.audio+this.maxOutputTokens*nativeRate.outAudio);
    const identity=sha(JSON.stringify({fixture:this.fixtureId,audioSha:this.audioSha,model:NATIVE_MODEL,
      instructions:sha(this.instructions),owner:ownerHash,guestFinal:sha(guestTextForDedupOnly)}));
    await this.ledger.reserve(id,"native-audio",reserve,identity,this.fixtureId);
    if(this.fatal){await this.ledger.unknown(id);throw this.fatal;}
    return new Promise<NativeResult>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.responses.delete(id);
        void Promise.resolve(this.ledger.unknown(id)).then(()=>reject(Error("NATIVE_RESPONSE_TIMEOUT")),reject);},45_000);
      this.responses.set(id,{resolve,reject,timer,text:"",firstAt:null});
      this.ws.send(JSON.stringify({type:"response.create",response:{conversation:"none",output_modalities:["text"],
        max_output_tokens:this.maxOutputTokens,input,metadata:{lab_request:id}}}));
    });
  }
  private async complete(id:string,w:ResponseWaiter,response:any) {
    clearTimeout(w.timer);this.responses.delete(id);
    try {
      const cost=nativeCost(response.usage),text=w.text||response.output?.flatMap((v:any)=>v.content??[]).map((v:any)=>v.text??"").join("")||"";
      let parsed:ReturnType<typeof parseHint>|undefined,parseError:Error|undefined;
      try{if(response.status!=="completed")throw Error("NATIVE_RESPONSE_UNFINISHED");parsed=parseNativeHint(text);}catch(e){parseError=e as Error;}
      const fullAt=performance.now();
      const safe=(v:unknown)=>String(v??"unspecified").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80);
      const u=response.usage,d=u.input_token_details,o=u.output_token_details,c=d.cached_tokens_details;
      this.auditLog.push({requestId:id,responseId:response.id,status:safe(response.status),
        reason:safe(response.status_details?.reason),costMicro:cost,textChars:text.length,
        markdownEnvelope:text.trim().startsWith("```"),parseError:parseError?.message??null,
        usage:{input:u.input_tokens,output:u.output_tokens,inputText:d.text_tokens,inputAudio:d.audio_tokens,
          cachedText:c?.text_tokens??0,cachedAudio:c?.audio_tokens??0,outputText:o.text_tokens,outputAudio:o.audio_tokens}});
      await this.ledger.finish(id,cost,{httpStatus:101,requestId:this.handshakeRequestId});
      if(parseError)await this.ledger.diagnostic(id,
        `${parseError.message};status=${safe(response.status)};reason=${safe(response.status_details?.reason)};output_tokens=${u.output_tokens};chars=${text.length};fence=${text.trim().startsWith("```")}`,
        "native_response");
      if(parseError)throw parseError;
      if(!parsed)throw Error("NATIVE_EMPTY_HINT");
      const first=firstEnglishWord(partialJSON(text));
      w.resolve({...parsed,firstAt:w.firstAt!==null&&first&&parsed.en.startsWith(first)?w.firstAt:fullAt,
        fullAt,translationAt:parsed.translation?fullAt:null,usage:response.usage,model:NATIVE_MODEL});
    }catch(e){await this.ledger.unknown(id);w.reject(e as Error);}
  }
  private async fail(e:Error) {
    this.fatal??=e;
    for(const w of this.commits){clearTimeout(w.timer);w.reject(e);}this.commits=[];
    for(const[id,w]of Array.from(this.responses.entries())){clearTimeout(w.timer);await this.ledger.unknown(id);w.reject(e);}this.responses.clear();
  }
  async close(){await this.fail(Error("NATIVE_SESSION_ENDED"));this.ws?.terminate();}
}
