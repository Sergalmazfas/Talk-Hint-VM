import WebSocket from "ws";
import { MODEL, VOICE } from "./policy";

export const intakeTools = ["save_request", "submit_request"].map(name => ({
  type: "function", name, description: name === "save_request" ? "Persist collected/corrected request fields before acknowledging them." :
    "Save a reviewed request for owner confirmation, NEVER an appointment booking.",
  parameters: { type: "object", properties: {
    name:{type:["string","null"]}, phone:{type:["string","null"],pattern:"^\\+(?:1\\d{10}|[2-9]\\d{7,14})$",
      description:"E.164 with explicit country code, e.g. +12025550173. Country code +1 requires exactly ten national digits. If country/digits are uncertain, use null and ask; never guess, pad or discard digits."},
    callbackConfirmed:{type:"boolean",description:"True only after caller confirms the exact current callback number; reconfirm any correction."},
    address:{type:["string","null"]},localDate:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$",description:"A real calendar date YYYY-MM-DD in the business timezone; null if uncertain."},
    localTime:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$",description:"24-hour HH:mm in the business timezone; null if uncertain."},
    durationMinutes:{type:["integer","null"],minimum:1,maximum:480},language:{type:["string","null"],enum:["en","ru","es",null]},
    notes:{type:["string","null"]},reviewed:{type:"boolean"},
  },additionalProperties:false },
}));
export function audioConfig(instructions: string) {
  return { type:"realtime",model:MODEL,output_modalities:["audio"],instructions,reasoning:{effort:"high"},
    tools:intakeTools,tool_choice:"auto",
    audio:{ input:{format:{type:"audio/pcmu"},transcription:{model:"gpt-4o-mini-transcribe"},
      turn_detection:{type:"semantic_vad",eagerness:"auto",create_response:true,interrupt_response:true}},
    output:{format:{type:"audio/pcmu"},voice:VOICE} } };
}
export class IncomingAudio {
  private socket?: WebSocket;
  constructor(private instructions: string, private event: (e: any) => void,
    private factory = (url: string) => new WebSocket(url,{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`}})) {}
  async connect() {
    await new Promise<void>((resolve,reject) => {
      const s=this.socket=this.factory(`wss://api.openai.com/v1/realtime?model=${MODEL}`);
      const timer=setTimeout(()=>{this.close();reject(new Error("Incoming AI timeout"));},12000); timer.unref?.();
      let ready=false;
      s.on("open",()=>this.send({type:"session.update",session:audioConfig(this.instructions)}));
      s.on("message",raw=>{
        let e:any;try{e=JSON.parse(raw.toString())}catch{return}
        if(e.type==="session.updated"&&!ready){
          if(e.session?.model!==MODEL||e.session?.audio?.output?.voice!==VOICE ||
            e.session?.audio?.output?.format?.type!=="audio/pcmu" ||
            e.session?.audio?.input?.format?.type!=="audio/pcmu"){
            clearTimeout(timer);this.close();reject(new Error("Incoming AI configuration mismatch"));return;
          }
          ready=true;clearTimeout(timer);resolve();return;
        }
        this.event(e);
      });
      s.on("error",()=>{clearTimeout(timer);reject(new Error("Incoming AI connection failed"));this.event({type:"transport_error"});});
      s.on("close",(closeCode)=>{clearTimeout(timer);if(!ready)reject(new Error("Incoming AI closed"));this.event({type:"transport_closed",closeCode});});
    });
  }
  send(e: object) {
    if(this.socket?.readyState!==WebSocket.OPEN) return;
    if(this.socket.bufferedAmount>512*1024) throw new Error("Incoming audio backpressure");
    this.socket.send(JSON.stringify(e));
  }
  close(){this.socket?.close();}
}
