import WebSocket from "ws";
import { intakeTools } from "./audio";

export const LIVE_MODEL="gpt-live-1";
export const LIVE_VOICE="marin";
export const LIVE_BACKEND="gpt-6.1-sol";
export const LIVE_GREETING='Greet the caller now in English: "Hello, I’m a virtual secretary. How can I help?" Then pause and listen.';

/** Native Live protocol, NOT an alias for /v1/realtime. Never used by telephony. */
export function liveConfig(backendInstructions:string,custom?:{instructions:string;opening:string;tools:typeof intakeTools}){
  return {
    model:LIVE_MODEL,store:false,
    instructions:custom?.instructions??[
      "You are a calm, natural virtual secretary. The approved owner cards available to the backend are your ONLY source of who you represent, their activity, services, prices, hours, timezone, location, contacts and business instructions. Never assume an industry or invent absent facts; ask the backend, clarify, or offer to pass the question to the owner.",
      "Start in English, then follow the caller's English, Russian or Spanish. Ask one short question at a time.",
      "Backchannel policy: Use light, brief acknowledgments without competing with the caller.",
      "Interruption policy: Yield when the caller interrupts; understand corrections. Keep listening during pauses and hold. Do not treat music, coughs or nearby conversations as requests.",
      "Answer factual questions from approved cards through the backend. Collect follow-up requests only when relevant. No booking tool is connected; never promise a booking or checked availability. Quote a price or condition only when the approved card actually states it.",
      "Do not ask for medical information. If important digits, names or dates are unclear, ask, do not guess.",
      "Delegation policy:",
      "Backend tools: Consult approved cards; save or correct the current request; return missing fields and owner-review status. There is no second business questionnaire or profile supplying additional facts.",
      "Generate <|SpawnThinking|> when the caller provides or corrects request details, asks about business facts or working hours, or asks to finish their request.",
      "Do not generate <|SpawnThinking|> for greetings or when a brief clarification is needed before saving.",
      "Generate <|SpawnThinking|> before claiming any details were saved. Wait for the actual backend result.",
      "For an appointment request, check hours only from the card; if absent clarify, never invent a schedule. Ask for address or duration only when relevant to this particular request and card. A saved request is never an appointment confirmation.",
    ].join("\n"),
    input:[{role:"developer",content:[{type:"input_text",text:custom?.opening??LIVE_GREETING}]}],
    audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:LIVE_VOICE}},
    delegation:{type:"responses",responses:{
      model:LIVE_BACKEND,reasoning:{effort:"medium"},max_output_tokens:1600,
      instructions:custom?backendInstructions:backendInstructions+"\nYou support a live spoken conversation. Use the latest corrections and approved cards only. For an appointment request consult working days if stated in the card, otherwise clarify; do not assume every caller needs an appointment, travel address or duration. Store the request purpose in notes. Never claim a booking. Return concise results in the caller's language. Save known details with tools; do not merely say you saved them.",
      tools:(custom?.tools??intakeTools).map(t=>({...t,strict:false})),tool_choice:"auto",parallel_tool_calls:false,
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
    }),private configuration?:ReturnType<typeof liveConfig>){}
  async connect(){
    await new Promise<void>((resolve,reject)=>{
      const socket=this.socket=this.factory();let started=false;
      const timer=setTimeout(()=>{socket.terminate();reject(new Error("Live startup timed out"));},15000);timer.unref?.();
      socket.on("open",()=>this.send({type:"session.start",session:this.configuration??liveConfig(this.instructions)}));
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
