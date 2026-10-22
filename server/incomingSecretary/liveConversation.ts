import { ZodError } from "zod";
import type { DevPeer } from "./devConversation";
import { IntakeSession } from "./session";
import { LIVE_MODEL,LIVE_VOICE,LIVE_BACKEND,LIVE_GREETING,LiveAudio,type LiveConnection } from "./liveAudio";
import type { RequestRecord,Turn } from "./policy";

/** Dev only. Same owner-scoped intake/store/cards; independent native voice transport. */
export class LiveConversation{
  closed=false;ready=false;
  private ai?:LiveConnection;
  private tail=Promise.resolve();
  private closing?:Promise<void>;
  private pending=0;
  private sequence=0;
  private stream=0;
  private transcripts=new Map<string,{id:string;text:string;end:number}>();
  private seen=new Set<string>();
  private toolCalls=new Set<string>();
  private responses=new Map<string,{id:string;done:boolean;calls:number;outputs:number;continued:boolean}>();
  private lastResponse="";
  constructor(readonly session:IntakeSession,private instructions:string,private peer:DevPeer,
    private factory=(text:string,event:(e:any)=>void):LiveConnection=>new LiveAudio(text,event)){}
  private send(e:object){
    if(this.peer.readyState!==1)return;
    if((this.peer.bufferedAmount??0)>512000){void this.stop("client_audio_backpressure");return;}
    this.peer.send(JSON.stringify({...e,testOnly:true}));
  }
  private enqueue(fn:()=>Promise<void>){
    if(this.closed)return;
    if(this.pending>=500){void this.fail("processing_queue_limit");return;}
    this.pending++;
    this.tail=this.tail.then(fn).catch(()=>{void this.fail("live_processing_failed");}).finally(()=>{this.pending--;});
  }
  async start(){
    this.ai=this.factory(this.instructions,e=>this.event(e));
    try{
      await this.ai.connect();
      if(this.closed){await this.ai.close();return;}
      this.ready=true;
      this.send({type:"ready",model:LIVE_MODEL,voice:LIVE_VOICE,backend:LIVE_BACKEND,audioMode:"live"});
      this.ai.send({type:"session.commentary.append",event_id:"greeting",delegation_id:null,content:LIVE_GREETING});
    }catch{if(!this.closed)await this.fail("live_connect_failed");}
  }
  input(e:any){
    if(this.closed)return;
    if(e.type==="stop"){void this.stop("completed");return;}
    // Native Live owns full-duplex timing; never send Realtime truncate/cancel commands.
    if(e.type!=="audio"||!this.ready)return;
    if(typeof e.audio!=="string"||e.audio.length>24000||e.audio.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.audio)){
      void this.fail("invalid_audio_frame");return;
    }
    try{this.ai?.send({type:"session.input_audio.append",audio:e.audio});}
    catch{void this.fail("live_audio_backpressure");}
  }
  private transcript(e:any,role:Turn["role"]){
    if(typeof e.delta!=="string"||e.delta.length>64000||!Number.isFinite(e.start_ms)||!Number.isFinite(e.end_ms))return;
    if(typeof e.event_id==="string"){
      if(this.seen.has(e.event_id))return;
      if(this.seen.size>=20000){void this.fail("transcript_limit");return;}
      this.seen.add(e.event_id);
    }
    let part=this.transcripts.get(role);
    const fresh=!part||e.start_ms-part.end>1200||part.text.length>8000;
    if(fresh){
      part={id:`live-${role}-${++this.sequence}`,text:"",end:e.end_ms};
      this.transcripts.set(role,part);
      if(role==="caller"){
        // Discard local pre-interruption backlog, not the backend work.
        this.send({type:"clear",responseId:`live-audio-${this.stream}`});this.stream++;
        this.enqueue(async()=>{await this.session.callerStarted();});
      }
    }
    part!.text+=e.delta;part!.end=e.end_ms;
    const fragment={id:part!.id,role,text:part!.text};
    this.enqueue(async()=>{
      const request=await this.session.store.update(this.session.owner,this.session.callSid,r=>{
        if(r.closed)return r;
        const turns=[...r.turns],index=turns.findIndex(t=>t.id===fragment.id);
        if(index<0){if(turns.length>=1000)throw new Error("Transcript limit");turns.push(fragment);}
        else turns[index]=fragment;
        return {...r,turns};
      });
      this.send({type:"transcript",request});
    });
  }
  private continueBackend(state:{id:string;done:boolean;calls:number;outputs:number;continued:boolean}){
    if(this.closed||!state.done||!state.calls||state.outputs!==state.calls||state.continued)return;
    state.continued=true;this.ai?.send({type:"response.create"});
    this.responses.delete(state.id);
  }
  private tool(item:any,state:{id:string;done:boolean;calls:number;outputs:number;continued:boolean}){
    if(typeof item.call_id!=="string"||this.toolCalls.has(item.call_id))return;
    this.toolCalls.add(item.call_id);state.calls++;
    this.enqueue(async()=>{
      let result:object;
      if(!["save_request","submit_request"].includes(item.name)){
        result={saved:false,error:"Unsupported tool. Only intake requests are supported.",bookingConfirmed:false};
      }else{
        try{
          const saved=await this.session.save(JSON.parse(item.arguments),item.name==="submit_request");
          this.send({type:"request",request:saved.request});
          result={saved:true,fields:saved.request.fields,status:saved.request.status,missing:saved.missing,
            warnings:saved.warnings,bookingConfirmed:false};
        }catch(error){
          if(error instanceof SyntaxError||error instanceof ZodError){
            result={saved:false,bookingConfirmed:false,error:"Invalid field format. Clarify before retrying; never guess phone digits/country. Use E.164 (+1 needs ten national digits), date YYYY-MM-DD, time HH:mm, integer duration and language en/ru/es.",
              fields:error instanceof ZodError?error.issues.map(i=>i.path.join(".")):["$"]};
            this.send({type:"notice",code:"invalid_tool_arguments",message:"Секретарь уточняет данные. Тест продолжается."});
          }else{
            try{this.ai?.send({type:"response.item.create",item:{type:"function_call_output",call_id:item.call_id,
              output:JSON.stringify({saved:false,error:"Storage failed. Do not claim successful acceptance.",bookingConfirmed:false})}});}catch{}
            void this.fail("storage_write_failed");return;
          }
        }
      }
      this.ai?.send({type:"response.item.create",item:{type:"function_call_output",call_id:item.call_id,output:JSON.stringify(result)}});
      state.outputs++;this.continueBackend(state);
    });
  }
  private event(e:any){
    if(this.closed)return;
    if(e.type==="session.input_transcript.delta")this.transcript(e,"caller");
    if(e.type==="session.output_transcript.delta")this.transcript(e,"secretary");
    if(e.type==="session.output_audio.delta"){
      if(typeof e.delta!=="string"||e.delta.length>128000||e.delta.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.delta)){
        void this.fail("invalid_provider_audio");return;
      }
      this.send({type:"audio",responseId:`live-audio-${this.stream}`,audio:e.delta});
    }
    if(e.type==="response.event"){
      const n=e.event;
      if(n?.type==="response.created"&&typeof n.response?.id==="string"){
        this.lastResponse=n.response.id;
        this.responses.set(n.response.id,{id:n.response.id,done:false,calls:0,outputs:0,continued:false});
      }
      const state=this.responses.get(n?.response_id??n?.response?.id??this.lastResponse);
      if(n?.type==="response.output_item.done"&&n.item?.type==="function_call"&&state)this.tool(n.item,state);
      if(n?.type==="response.completed"&&state){
        state.done=true;this.continueBackend(state);
        if(!state.calls)this.responses.delete(state.id);
      }
      if(["response.failed","response.incomplete"].includes(n?.type))void this.fail("live_backend_failed");
    }
    if(e.type==="error"){
      const code=/^[a-z0-9_]{1,80}$/i.test(String(e.error?.code))?String(e.error.code):"unknown";
      void this.fail(`live:${code}`);
    }
    if(e.type==="transport_error")void this.fail("live_socket_error");
    if(e.type==="transport_closed")void this.fail(`live_socket_closed:${Number.isInteger(e.closeCode)?e.closeCode:"unknown"}`);
    if(e.type==="session.closed")void this.stop("live_session_ended");
  }
  private async fail(code:string){
    if(this.closed)return;
    console.warn(`[IncomingDev Live] ${code}`);
    this.send({type:"error",code,error:`GPT‑Live 1: ${code}. Другая модель не подставлялась. Сохранённые сведения остаются в TEST-истории.`});
    await this.stop(code);
  }
  stop(reason:string):Promise<void>{
    if(this.closing)return this.closing;
    this.closed=true;this.ready=false;
    const pending=this.tail;
    this.closing=(async()=>{
      const finalized=await this.ai?.close().catch(()=>false)??false;
      await pending;
      let request:RequestRecord|undefined,error:string|undefined;
      try{request=await this.session.end(reason);}
      catch{error="Не удалось подтвердить сохранение TEST-заявки. Проверьте историю.";}
      this.send({type:"ended",request,error,providerFinalized:finalized});this.peer.close();
    })();
    return this.closing;
  }
}
