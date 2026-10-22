import WebSocket from "ws";
import { LiveAudio,liveConfig } from "../incomingSecretary/liveAudio";
import type { SecretaryRealtimeSession,SecretaryRealtimeEvent } from "./agent";

export function outgoingLiveConfig(instructions:string){
  return liveConfig(instructions,{
    instructions:instructions+"\n"+
      "Speak naturally and briefly. Follow the other party's EN/RU/ES. Use the trusted standard secretary introduction, never an invented identity.\n"+
      "Interruption policy: Yield immediately when the other party speaks; understand their corrections. Noise, music and background chatter are not requests.\n"+
      "On hold or transfer: acknowledge once, wait silently, keep listening and resume when the person returns. Do not end a call merely for silence or hold music.\n"+
      "Delegation policy: Backend tools: reason about the owner's authorized assignment and facts already provided; no external tools or calendar are connected.\n"+
      "Generate <|SpawnThinking|> when the assignment requires careful reasoning or checking the supplied facts; do not generate it for simple greetings or brief clarifications. Never invent verified facts, availability or actions.",
    opening:"Begin the authorized telephone conversation now using the trusted secretary introduction and actual task above. Then listen.",
    tools:[],
  });
}
/** Native full-duplex Live; no Realtime cancel/truncate or cloned TTS. */
export class OpenAISecretaryLiveSession implements SecretaryRealtimeSession{
  readonly inputFormat="mulaw8k" as const;
  readonly continuousAudio=true;
  private ai?:LiveAudio;private ready=false;private closed=false;private introduced=false;private stream=0;
  private listeners:Array<(e:SecretaryRealtimeEvent)=>void>=[];
  private transcripts=new Map<string,{text:string;end:number;stream:string;timer?:ReturnType<typeof setTimeout>}>();
  private seen=new Set<string>();
  constructor(private instructions:string,private factory=(url:string)=>new WebSocket(url,{
    headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
  })){}
  onEvent(fn:(e:SecretaryRealtimeEvent)=>void){this.listeners.push(fn)}
  private emit(e:SecretaryRealtimeEvent){for(const fn of this.listeners){try{fn(e)}catch{/* reporting never crashes media */}}}
  async connect(){
    if(this.ai||this.closed)throw new Error("Secretary Live is single-use");
    this.ai=new LiveAudio(this.instructions,e=>this.event(e),
      ()=>this.factory("wss://api.openai.com/v1/live/sessions"),outgoingLiveConfig(this.instructions));
    try{await this.ai.connect();if(this.closed)return;
      this.ready=true;this.emit({type:"ready"});
    }catch{this.close();throw new Error("GPT-Live 1 connection or exact configuration could not be verified");}
  }
  sendAudio(bytes:Buffer){
    if(!this.ready||this.closed)return;
    try{this.ai?.send({type:"session.input_audio.append",audio:bytes.toString("base64")})}
    catch{this.fail("GPT-Live 1 audio transport failed")}
  }
  startIntroduction(){
    if(!this.ready||this.closed||this.introduced)return;this.introduced=true;
    try{this.ai?.send({type:"session.commentary.append",event_id:"introduction",delegation_id:null,
      content:outgoingLiveConfig(this.instructions).input[0].content[0].text})}
    catch{this.fail("GPT-Live 1 introduction could not be sent")}
  }
  cancelResponse(){/* Native Live manages yielding; Twilio clears queued playback separately. */}
  private flush(role:string){
    const part=this.transcripts.get(role);if(!part)return;
    clearTimeout(part.timer);this.transcripts.delete(role);
    if(!part.text.trim())return;
    if(role==="guest")this.emit({type:"guest_transcript",text:part.text.slice(0,1500)});
    else this.emit({type:"assistant_transcript",responseId:part.stream,text:part.text.slice(0,1500)});
  }
  private text(e:any,role:string){
    if(typeof e.delta!=="string"||e.delta.length>64000||!Number.isFinite(e.start_ms)||!Number.isFinite(e.end_ms))return;
    if(typeof e.event_id==="string"){
      if(this.seen.has(e.event_id))return;
      if(this.seen.size>=20000){this.fail("GPT-Live transcript safety limit");return;}
      this.seen.add(e.event_id);
    }
    let part=this.transcripts.get(role);
    if(!part||e.start_ms-part.end>1200||part.text.length>1400){
      this.flush(role);
      if(role==="guest"){this.flush("secretary");this.emit({type:"speech_started"});this.stream++;}
      part={text:"",end:e.end_ms,stream:`live-${this.stream}`};this.transcripts.set(role,part);
    }
    clearTimeout(part.timer);part.text+=e.delta;part.end=e.end_ms;
    part.timer=setTimeout(()=>this.flush(role),700);part.timer.unref?.();
  }
  private event(e:any){
    if(this.closed)return;
    if(e.type==="session.input_transcript.delta")this.text(e,"guest");
    if(e.type==="session.output_transcript.delta")this.text(e,"secretary");
    if(e.type==="session.output_audio.delta"){
      if(typeof e.delta!=="string"||e.delta.length>128000||e.delta.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.delta)){
        this.fail("Invalid GPT-Live telephone audio");return;
      }
      this.emit({type:"audio",responseId:`live-${this.stream}`,itemId:"",mulaw:Buffer.from(e.delta,"base64")});
    }
    if(e.type==="error"){
      const code=/^[a-z0-9_]{1,80}$/i.test(String(e.error?.code))?String(e.error.code):"unknown";
      this.fail(`GPT-Live 1 request failed (${code}); no fallback`);return;
    }
    if(e.type==="response.event"&&["response.failed","response.incomplete"].includes(e.event?.type))
      this.fail("GPT-Live reasoning failed; no fallback");
    if(["transport_error","transport_closed","session.closed"].includes(e.type)){
      this.flush("guest");this.emit({type:"closed"});this.close();
    }
  }
  private fail(message:string){if(!this.closed){this.emit({type:"error",message,fatal:true});this.close();}}
  close(){
    if(this.closed)return;this.flush("guest");this.closed=true;this.ready=false;
    this.transcripts.forEach(part=>clearTimeout(part.timer));
    this.transcripts.clear();void this.ai?.close();
  }
}
