import WebSocket from "ws";
import { IncomingAudio } from "./audio";
import { IntakeSession } from "./session";
import { MODEL,VOICE,type RequestRecord } from "./policy";

export type DevPeer={readyState:number;bufferedAmount?:number;send:(text:string)=>void;close:()=>void};
/** Same incoming prompt/tools/audio/intake; only the transport and store are Dev. */
export class DevConversation {
  private ai?:IncomingAudio;
  private tail=Promise.resolve();
  private closing?:Promise<void>;
  private response="";private item="";private sentMs=0;private playedMs=0;
  private blocked=new Set<string>();private tools=new Set<string>();
  private pending=0;ready=false;closed=false;
  constructor(readonly session:IntakeSession,private instructions:string,private peer:DevPeer,
    private factory=(instructions:string,event:(e:any)=>void)=>new IncomingAudio(instructions,event)) {}
  private send(e:object) {
    if(this.peer.readyState!==WebSocket.OPEN)return;
    if((this.peer.bufferedAmount??0)>512000){void this.stop("client audio backpressure");return;}
    this.peer.send(JSON.stringify({...e,testOnly:true}));
  }
  private enqueue(fn:()=>Promise<void>) {
    if(this.closed)return;
    if(this.pending>=500){void this.stop("processing queue limit");return;}
    this.pending++;
    this.tail=this.tail.then(fn).catch(()=>{void this.fail("Не удалось сохранить тестовую заявку. Успешное принятие не подтверждено.");})
      .finally(()=>{this.pending--;});
  }
  async start() {
    this.ai=this.factory(this.instructions,e=>this.event(e));
    try {
      await this.ai.connect();
      if(this.closed){this.ai.close();return;}
      this.ready=true;this.send({type:"ready",model:MODEL,voice:VOICE});
      this.ai.send({type:"response.create"});
    }catch{
      if(this.closed)return;
      await this.fail("Не удалось открыть требуемый OpenAI Realtime-сеанс: модель недоступна, соединение отклонено или конфигурация не подтверждена. Другой моделью он не заменялся.");
    }
  }
  input(e:any) {
    if(this.closed)return;
    if(e.type==="stop"){void this.stop("completed");return;}
    if(e.type==="playback"&&e.responseId===this.response&&Number.isFinite(e.playedMs)){
      this.playedMs=Math.max(this.playedMs,Math.min(this.sentMs,Math.max(0,e.playedMs)));return;
    }
    if(e.type!=="audio"||!this.ready)return;
    if(typeof e.audio!=="string"||e.audio.length>24000||e.audio.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.audio)){
      void this.fail("Недопустимый аудиофрагмент.");return;
    }
    try{this.ai?.send({type:"input_audio_buffer.append",audio:e.audio});}
    catch{void this.fail("Аудиосоединение перегружено; тест остановлен.");}
  }
  private event(e:any) {
    if(this.closed)return;
    if(e.type==="error"){
      // Do not echo provider messages/URLs/request payloads.
      const code=String(e.error?.code??"");
      const message=["model_not_found","model_not_available","unsupported_model"].includes(code)?
        `Модель ${MODEL} недоступна этому аккаунту OpenAI. Другой моделью она не заменялась.`:
        code==="insufficient_quota"?"OpenAI сообщил об исчерпании квоты. Модель не заменялась.":
        "OpenAI отклонил голосовой сеанс или ответ. Требуемая модель не заменялась. Проверьте доступ модели и настройки API.";
      void this.fail(message);return;
    }
    if(["transport_error","transport_closed"].includes(e.type)){
      void this.fail("Голосовое соединение прервано. Сохранённые тестовые сведения остаются в истории.");return;
    }
    if(e.type==="input_audio_buffer.speech_started"){
      this.blocked.add(this.response);
      this.send({type:"clear",responseId:this.response});
      try{if(this.item)this.ai?.send({type:"conversation.item.truncate",item_id:this.item,content_index:0,audio_end_ms:Math.floor(this.playedMs)});}
      catch{void this.fail("Не удалось остановить старый голосовой ответ.");return;}
      this.enqueue(async()=>{await this.session.callerStarted();});
    }
    if(e.type==="response.created"){
      this.response=String(e.response?.id??"");this.item="";this.sentMs=0;this.playedMs=0;
    }
    if(e.type==="response.output_audio.delta"&&!this.blocked.has(String(e.response_id))){
      if(typeof e.delta!=="string"||e.delta.length>128000||e.delta.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.delta)){
        void this.fail("OpenAI вернул некорректный аудиофрагмент.");return;
      }
      this.item=String(e.item_id??this.item);
      this.enqueue(async()=>{
        if(this.closed||this.blocked.has(String(e.response_id)))return;
        this.sentMs+=Buffer.byteLength(e.delta,"base64")/8;
        this.send({type:"audio",responseId:e.response_id,itemId:e.item_id,audio:e.delta});
      });
    }
    const caller=e.type==="conversation.item.input_audio_transcription.completed";
    if(caller||e.type==="response.output_audio_transcript.done"){
      if(typeof e.transcript!=="string"||e.transcript.length>64000){void this.fail("Превышен предел транскрипции.");return;}
      this.enqueue(async()=>{
        const request=await this.session.turn({id:String(e.item_id??e.response_id??crypto.randomUUID()),
          role:caller?"caller":"secretary",text:e.transcript});
        this.send({type:"transcript",request});
      });
    }
    if(e.type==="response.function_call_arguments.done"&&!this.blocked.has(String(e.response_id)))this.enqueue(async()=>{
      if(this.closed||this.tools.has(e.call_id))return;
      this.tools.add(e.call_id);
      if(!["save_request","submit_request"].includes(e.name))throw new Error("Unsupported incoming tool");
      try {
        const result=await this.session.save(JSON.parse(e.arguments),e.name==="submit_request");
        this.send({type:"request",request:result.request});
        this.ai?.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:e.call_id,
          output:JSON.stringify({saved:true,status:result.request.status,fields:result.request.fields,
            missing:result.missing,warnings:result.warnings,bookingConfirmed:false})}});
        this.ai?.send({type:"response.create"});
      }catch{
        try{this.ai?.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:e.call_id,
          output:JSON.stringify({saved:false,bookingConfirmed:false,error:"Storage failed. Do not claim successful acceptance."})}});}catch{}
        void this.fail("Ошибка сохранения. Заявка не подтверждена как успешно принятая; проверьте сохранённую часть в истории.");
      }
    });
  }
  private async fail(message:string) {this.send({type:"error",error:message});await this.stop("connection lost");}
  stop(reason:string):Promise<void> {
    if(this.closing)return this.closing;
    this.closed=true;this.ready=false;this.ai?.close();
    const pendingWrites=this.tail;
    this.closing=(async()=>{
      await pendingWrites;
      let request:RequestRecord|undefined,error:string|undefined;
      try{request=await this.session.end(reason);}
      catch{error="Не удалось завершить сохранение. Успешное принятие заявки не подтверждено; проверьте историю после восстановления базы.";}
      this.send({type:"ended",request,error});this.peer.close();
    })();
    return this.closing;
  }
}
