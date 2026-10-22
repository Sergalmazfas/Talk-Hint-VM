import WebSocket from "ws";
import { intakeTools } from "./audio";

export const LIVE_MODEL="gpt-live-1";
export const LIVE_VOICE="marin";
export const LIVE_BACKEND="gpt-6.1-sol";
export const LIVE_GREETING='Greet the caller now in English: "Hello, I’m a virtual appointment helper. I can take a request for the owner to review. How can I help?" Then pause and listen.';

/** Native Live protocol, NOT an alias for /v1/realtime. Never used by telephony. */
export function liveConfig(backendInstructions:string){
  return {
    model:LIVE_MODEL,store:false,
    instructions:[
      "You are a calm, natural virtual appointment helper for a future mobile massage service. Never invent a business name or say it has launched.",
      "Start in English, then follow the caller's English, Russian or Spanish. Ask one short question at a time.",
      "Backchannel policy: Use light, brief acknowledgments without competing with the caller.",
      "Interruption policy: Yield when the caller interrupts; understand corrections. Keep listening during pauses and hold. Do not treat music, coughs or nearby conversations as requests.",
      "Only collect requests. No calendar is connected. Never promise a booking, availability, price or service area.",
      "Do not ask for medical information. If important digits, names or dates are unclear, ask, do not guess.",
      "Delegation policy:",
      "Backend tools: Check the owner's business facts and schedule rules; save or correct a test intake request; return missing fields and owner-review status.",
      "Generate <|SpawnThinking|> when the caller provides or corrects request details, asks about business facts or working hours, or asks to finish their request.",
      "Do not generate <|SpawnThinking|> for greetings or when a brief clarification is needed before saving.",
      "Generate <|SpawnThinking|> before claiming any details were saved. Wait for the actual backend result.",
      "Resolve a closed-day request before collecting the rest of the contact/address details. A saved request is never an appointment confirmation.",
    ].join("\n"),
    input:[{role:"developer",content:[{type:"input_text",text:LIVE_GREETING}]}],
    audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:LIVE_VOICE}},
    delegation:{type:"responses",responses:{
      model:LIVE_BACKEND,reasoning:{effort:"medium"},max_output_tokens:1600,
      instructions:backendInstructions+"\nYou support a live spoken conversation. Use the latest corrections. Check working days before collecting phone/address. If a day is closed, explain and ask for another day. Never claim a booking. Return concise results in the caller's language. Save known details with tools; do not merely say you saved them.",
      tools:intakeTools.map(t=>({...t,strict:false})),tool_choice:"auto",parallel_tool_calls:false,
    }},
  };
}
export type LiveConnection={connect:()=>Promise<void>;send:(event:object)=>void;close:()=>Promise<boolean>};
export class LiveAudio implements LiveConnection {
  private socket?:WebSocket;
  private finalized=false;
  private closing?:Promise<boolean>;
  private resolveClose?:(ok:boolean)=>void;
  constructor(private instructions:string,private event:(e:any)=>void,
    private factory=()=>new WebSocket("wss://api.openai.com/v1/live/sessions",{
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
    })){}
  async connect(){
    await new Promise<void>((resolve,reject)=>{
      const socket=this.socket=this.factory();let started=false;
      const timer=setTimeout(()=>{socket.terminate();reject(new Error("Live startup timed out"));},15000);timer.unref?.();
      socket.on("open",()=>this.send({type:"session.start",session:liveConfig(this.instructions)}));
      socket.on("message",raw=>{
        let e:any;try{e=JSON.parse(raw.toString())}catch{return}
        if(e.type==="session.started"){
          const c=e.session;
          if(c?.model!==LIVE_MODEL||c?.audio?.output?.voice!==LIVE_VOICE||
            c?.audio?.format?.type!=="audio/pcmu"||c?.audio?.format?.rate!==8000||
            c?.delegation?.responses?.model!==LIVE_BACKEND){
            clearTimeout(timer);socket.terminate();reject(new Error("Live configuration mismatch"));return;
          }
          started=true;clearTimeout(timer);resolve();
        }
        if(e.type==="error"&&!started){clearTimeout(timer);reject(new Error("Live startup rejected"));}
        if(e.type==="session.closed"){this.finalized=true;this.resolveClose?.(true);}
        this.event(e);
      });
      socket.on("unexpected-response",(_req,res)=>{
        clearTimeout(timer);res.resume();socket.terminate();reject(new Error("Live transport rejected"));
      });
      socket.on("error",()=>{clearTimeout(timer);reject(new Error("Live connection failed"));this.event({type:"transport_error"});});
      socket.on("close",closeCode=>{
        clearTimeout(timer);this.resolveClose?.(this.finalized);
        if(!started)reject(new Error("Live closed before startup"));
        this.event({type:"transport_closed",closeCode,finalized:this.finalized});
      });
    });
  }
  send(e:object){
    if(this.socket?.readyState!==WebSocket.OPEN)throw new Error("Live socket is not open");
    if(this.socket.bufferedAmount>512000)throw new Error("Live socket backpressure");
    this.socket.send(JSON.stringify(e));
  }
  close():Promise<boolean>{
    if(this.closing)return this.closing;
    this.closing=new Promise(resolve=>{
      let settled=false;
      const finish=(ok:boolean)=>{if(settled)return;settled=true;this.resolveClose=undefined;
        clearTimeout(timer);this.socket?.close();resolve(ok);};
      const timer=setTimeout(()=>{this.socket?.terminate();resolve(false)},5000);timer.unref?.();
      this.resolveClose=finish;
      if(this.finalized||this.socket?.readyState!==WebSocket.OPEN){finish(this.finalized);return;}
      try{this.send({type:"session.close"});}catch{finish(false);}
    });
    return this.closing;
  }
}
