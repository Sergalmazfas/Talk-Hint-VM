import WebSocket from "ws";
import { ZodError } from "zod";
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
  private responseActive=false;private speaking=false;private continuation=false;private pendingTools=0;
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
    this.tail=this.tail.then(fn).catch(()=>{void this.fail("Не удалось сохранить тестовую заявку. Успешное принятие не подтверждено.","storage_write_failed");})
      .finally(()=>{this.pending--;});
  }
  private flushContinuation(){
    if(this.closed||!this.ready||this.responseActive||this.speaking||this.pendingTools||!this.continuation)return;
    this.continuation=false;this.responseActive=true;
    try{this.ai?.send({type:"response.create"});}
    catch{void this.fail("Не удалось продолжить голосовой ответ.");}
  }
  private diagnostic(code:string,fatal:boolean){
    // Codes only: no provider message, IDs, credentials or conversation text.
    console.warn(`[IncomingDev] OpenAI ${fatal?"fatal":"recoverable"}: ${code}`);
    this.enqueue(async()=>{await this.session.store.update(this.session.owner,this.session.callSid,r=>{
      const previous=(r as RequestRecord&{devDiagnostics?:object[]}).devDiagnostics??[];
      return {...r,devDiagnostics:[...previous.slice(-19),{code,fatal,at:new Date().toISOString()}]};
    });});
  }
  async start() {
    this.ai=this.factory(this.instructions,e=>this.event(e));
    try {
      await this.ai.connect();
      if(this.closed){this.ai.close();return;}
      this.ready=true;this.send({type:"ready",model:MODEL,voice:VOICE});
      this.continuation=true;this.flushContinuation();
    }catch{
      if(this.closed)return;
      await this.fail("Не удалось открыть требуемый OpenAI Realtime-сеанс: модель недоступна, соединение отклонено или конфигурация не подтверждена. Другой моделью он не заменялся.","openai_connect_failed");
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
      const rawCode=String(e.error?.code??"unknown");
      const code=/^[a-z0-9_]{1,80}$/i.test(rawCode)?rawCode:"unknown";
      if(["conversation_already_has_active_response","response_cancel_not_active"].includes(code)){
        this.diagnostic(code,false);
        this.send({type:"notice",code,message:"Синхронизация голосового ответа. Тест продолжается."});
        return;
      }
      this.diagnostic(code,true);
      const message=["model_not_found","model_not_available","unsupported_model"].includes(code)?
        `Модель ${MODEL} недоступна этому аккаунту OpenAI. Другой моделью она не заменялась.`:
        code==="insufficient_quota"?"OpenAI сообщил об исчерпании квоты. Модель не заменялась.":
        "OpenAI отклонил голосовой сеанс или ответ. Требуемая модель не заменялась. Проверьте доступ модели и настройки API.";
      void this.fail(`${message} Код: ${code}.`,`openai:${code}`);return;
    }
    if(["transport_error","transport_closed"].includes(e.type)){
      const code=Number.isInteger(e.closeCode)?String(e.closeCode):"unknown";
      void this.fail("Голосовое соединение прервано. Сохранённые тестовые сведения остаются в истории.",
        e.type==="transport_closed"?`openai_socket_closed:${code}`:"openai_socket_error");return;
    }
    if(e.type==="input_audio_buffer.speech_started"){
      this.speaking=true;this.continuation=false;
      this.blocked.add(this.response);
      this.send({type:"clear",responseId:this.response});
      try{
        // interrupt_response=true already cancels generation at the provider.
        // A second cancel races with its acknowledgement and is unnecessary.
        if(this.item)this.ai?.send({type:"conversation.item.truncate",item_id:this.item,content_index:0,audio_end_ms:Math.floor(this.playedMs)});
      }
      catch{void this.fail("Не удалось остановить старый голосовой ответ.");return;}
      this.enqueue(async()=>{await this.session.callerStarted();});
    }
    if(e.type==="input_audio_buffer.speech_stopped")this.speaking=false;
    if(e.type==="response.created"){
      this.responseActive=true;this.continuation=false;
      this.response=String(e.response?.id??"");this.item="";this.sentMs=0;this.playedMs=0;
    }
    if(e.type==="response.done"&&(!e.response?.id||e.response.id===this.response)){
      this.responseActive=false;this.flushContinuation();
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
    if(e.type==="response.function_call_arguments.done"&&!this.blocked.has(String(e.response_id))){
      if(typeof e.call_id!=="string"||this.tools.has(e.call_id))return;
      this.tools.add(e.call_id);this.pendingTools++;
      this.enqueue(async()=>{
      try {
      if(this.closed)return;
      if(!["save_request","submit_request"].includes(e.name))throw new Error("Unsupported incoming tool");
      let persisted=false;
      try {
        const result=await this.session.save(JSON.parse(e.arguments),e.name==="submit_request");
        persisted=true;
        this.send({type:"request",request:result.request});
        this.ai?.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:e.call_id,
          output:JSON.stringify({saved:true,status:result.request.status,fields:result.request.fields,
            missing:result.missing,warnings:result.warnings,bookingConfirmed:false})}});
        if(!this.blocked.has(String(e.response_id)))this.continuation=true;
      }catch(error){
        if(!persisted&&(error instanceof ZodError||error instanceof SyntaxError)){
          const issues=error instanceof ZodError?error.issues.map(issue=>({
            field:issue.path.filter(p=>typeof p==="string"&&/^[a-zA-Z]+$/.test(p)).join(".")||"$",
            code:issue.code,
          })):[{field:"$",code:"invalid_json"}];
          this.diagnostic("invalid_tool_arguments",false);
          this.send({type:"notice",code:"invalid_tool_arguments",
            message:"Секретарь уточняет формат данных. Разговор продолжается; успешное сохранение этих данных ещё не подтверждено."});
          this.ai?.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:e.call_id,
            output:JSON.stringify({saved:false,bookingConfirmed:false,error:"Invalid field format, not a storage failure.",
              issues,instructions:"Do not claim these fields were saved. Keep earlier valid facts. Clarify uncertain details in the caller's current language. A phone must be an unambiguous E.164 number with explicit country code; never guess digits or country. Dates YYYY-MM-DD, times HH:mm (24h), duration an integer. Use null for unknown fields and ask the caller. Confirm the corrected callback number again."})}});
          if(!this.blocked.has(String(e.response_id)))this.continuation=true;
          return;
        }
        if(persisted){
          void this.fail("Сведения сохранены, но ответ не удалось передать в голосовой сеанс. Проверьте TEST-историю.","tool_ack_failed");
          return;
        }
        try{this.ai?.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:e.call_id,
          output:JSON.stringify({saved:false,bookingConfirmed:false,error:"Storage failed. Do not claim successful acceptance."})}});}catch{}
        void this.fail("Ошибка сохранения. Заявка не подтверждена как успешно принятая; проверьте сохранённую часть в истории.","storage_write_failed");
      }
      }finally{this.pendingTools--;this.flushContinuation();}
    });}
  }
  private async fail(message:string,reason="dev_processing_failed") {
    console.warn(`[IncomingDev] stopping: ${reason}`);
    this.send({type:"error",error:message,code:reason});await this.stop(reason);
  }
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
