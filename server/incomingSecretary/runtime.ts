import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import WebSocket from "ws";
import twilio from "twilio";
import { storage } from "../storage";
import { pool } from "../db";
import { notifySecretaryResult } from "../secretary/notifications";
import { IncomingStore } from "./store";
import { IntakeSession } from "./session";
import { allowedCards, buildInstructions, MODEL, VOICE } from "./policy";
import { IncomingAudio } from "./audio";

export const incomingStore = new IncomingStore();
export const runtimeEnabled = () => process.env.INCOMING_SECRETARY_RUNTIME_ENABLED === "true";
const active = new Map<string, Set<() => void>>();
const activeOwners = new Map<string,string>(), permissions = new Map<string,Set<string>>();
export function stopIncomingNumber(id: string) { active.get(id)?.forEach(stop=>stop()); }
export function stopIncomingCard(owner:string,cardId:string) {
  activeOwners.forEach((userId,numberId)=>{
    if(userId===owner&&permissions.get(numberId)?.has(cardId))stopIncomingNumber(numberId);
  });
}
function signature(callSid: string,numberId:string,expiry:string) {
  if(!process.env.SESSION_SECRET)throw new Error("Incoming signing unavailable");
  return createHmac("sha256",process.env.SESSION_SECRET).update(`incoming-v1:${callSid}:${numberId}:${expiry}`).digest("hex");
}
export function streamToken(callSid:string,numberId:string) {
  const expiry=String(Date.now()+5*60_000);return `${expiry}.${signature(callSid,numberId,expiry)}`;
}
export function validStreamToken(callSid:string,numberId:string,token:unknown) {
  if(typeof token!=="string"||token.length>100)return false;
  const [expiry,mac]=token.split(".");
  if(!/^\d+$/.test(expiry??"")||Number(expiry)<Date.now()||Number(expiry)>Date.now()+6*60_000||!/^[a-f0-9]{64}$/.test(mac??""))return false;
  try{return timingSafeEqual(Buffer.from(mac,"hex"),Buffer.from(signature(callSid,numberId,expiry),"hex"));}catch{return false;}
}
function unavailable(res:Response) {
  const xml=new twilio.twiml.VoiceResponse();
  xml.say({language:"en-US"},"The appointment helper is unavailable. No request or appointment has been confirmed. Please try again later.");
  xml.hangup();res.type("text/xml").send(xml.toString());
}
/** Called ONLY after the existing Twilio signature check and number-owner lookup.
 * Returns before legacy push/SMS/forwarding. Default gate=false means zero change. */
export async function tryIncomingSecretary(req:Request,res:Response,owner:string,numberId:string|null,numberType:string|null,callSid:string) {
  if(numberType!=="work"||!numberId||!runtimeEnabled())return false;
  try {
    const settings=await incomingStore.settings(owner,numberId);
    if(!settings.enabled)return false;
    if(!settings.timeZone)throw new Error("Business timezone required");
    const request=await incomingStore.begin(owner,numberId,callSid);
    if(request.closed){unavailable(res);return true;}
    // Normal number-level status callback remains unchanged.
    if(!await storage.getCallByCallSid(callSid))await storage.createCall({
      userId:owner,phoneNumberId:numberId,callSid,fromNumber:String(req.body.From??""),
      toNumber:String(req.body.To??""),direction:"incoming",status:"active",
      metadata:{mode:"incoming_secretary",requestId:request.id},
    });
    const xml=new twilio.twiml.VoiceResponse();
    const stream=xml.connect().stream({url:`wss://${req.get("host")}/incoming-secretary-stream`});
    stream.parameter({name:"numberId",value:numberId});
    stream.parameter({name:"auth",value:streamToken(callSid,numberId)});
    // Runs only when the media connection closes; never claims a booking/save.
    xml.say({language:"en-US"},"The connection has ended. No appointment has been confirmed.");
    xml.hangup();res.type("text/xml").send(xml.toString());return true;
  } catch { console.error("[IncomingSecretary] Call setup failed; no acceptance confirmed");unavailable(res);return true; }
}
/** Phone media only. No SMS, outgoing dialer, calendar or automatic transfer imports. */
export function handleIncomingSocket(ws:WebSocket) {
  let session:IntakeSession|undefined, ai:IncomingAudio|undefined, sid="",number="",closed=false,ready=false;
  let queue=Promise.resolve(), response="",item="",playedMs=0;
  let mediaTimestamp=0, responseStartedAt:number|undefined;
  const blocked=new Set<string>(),tools=new Set<string>();
  const timer=setTimeout(()=>end("call time limit"),15*60_000);timer.unref?.();
  const startTimer=setTimeout(()=>end("missing authenticated start"),10_000);startTimer.unref?.();
  const send=(e:object)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(e));};
  let pending=0;
  const enqueue=(fn:()=>Promise<void>)=>{
    if(closed)return;
    if(pending>=500){void end("processing queue safety limit");return;}
    pending++;
    queue=queue.then(fn).catch(()=>end("save or AI failure")).finally(()=>{pending--;});
  };
  async function end(reason:string){
    if(closed)return;closed=true;clearTimeout(timer);clearTimeout(startTimer);ai?.close();
    if(number)active.get(number)?.delete(stop);
    if(number&&!active.get(number)?.size){active.delete(number);activeOwners.delete(number);permissions.delete(number);}
    if(session){try{await session.end(reason)}catch{console.error("[IncomingSecretary] Request finalization failed; persisted partial requires recovery");}}
    if(ws.readyState===WebSocket.OPEN)ws.close();
  }
  const stop=()=>{void end("owner changed or disabled incoming settings");};
  function aiEvent(e:any){
    if(closed)return;
    if(e.type==="input_audio_buffer.speech_started"){
      enqueue(async()=>{await session!.callerStarted();});
      if(response)blocked.add(response);
      send({event:"clear",streamSid:sid});
      if(item)ai?.send({type:"conversation.item.truncate",item_id:item,content_index:0,
        audio_end_ms:Math.floor(Math.min(playedMs,Math.max(0,mediaTimestamp-(responseStartedAt??mediaTimestamp))))});
      response="";item="";playedMs=0;responseStartedAt=undefined;
    }
    if(e.type==="response.created"){response=String(e.response?.id??"");item="";playedMs=0;responseStartedAt=undefined;}
    if(typeof e.transcript==="string"&&e.transcript.length>64000){void end("transcript safety limit");return;}
    if(e.type==="conversation.item.input_audio_transcription.completed" && typeof e.transcript==="string")
      enqueue(async()=>{await session!.turn({id:String(e.item_id??randomUUID()),role:"caller",text:e.transcript});});
    if(e.type==="response.output_audio_transcript.done" && typeof e.transcript==="string")
      enqueue(async()=>{await session!.turn({id:String(e.item_id??e.response_id??randomUUID()),role:"secretary",text:e.transcript});});
    if(e.type==="response.output_audio.delta"&&!blocked.has(String(e.response_id))&&typeof e.delta==="string"){
      if(e.delta.length>128000||e.delta.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.delta)){void end("invalid AI audio");return;}
      item=String(e.item_id??item);
      // queue behind pending persistence: no new speech if a save has failed.
      enqueue(async()=>{if(closed||blocked.has(String(e.response_id)))return;
        responseStartedAt??=mediaTimestamp;
        playedMs+=Buffer.byteLength(e.delta,"base64")/8;
        send({event:"media",streamSid:sid,media:{payload:e.delta}});
      });
    }
    if(e.type==="response.function_call_arguments.done"&&!blocked.has(String(e.response_id)))enqueue(async()=>{
      const id=String(e.call_id??"");if(!id||tools.has(id))return;tools.add(id);
      if(!["save_request","submit_request"].includes(e.name))throw new Error("Unsupported tool");
      let result;
      try {
        const saved=await session!.save(JSON.parse(e.arguments),e.name==="submit_request");
        result={saved:true,status:saved.request.status,fields:saved.request.fields,
          missing:saved.missing,warnings:saved.warnings,bookingConfirmed:false};
      }
      catch { result={saved:false,bookingConfirmed:false,error:"Could not save request. Do not claim acceptance. Ask the caller to try again later."}; }
      ai?.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:id,output:JSON.stringify(result)}});
      ai?.send({type:"response.create"});
    });
    if(e.type==="error"||e.type==="transport_error"||e.type==="transport_closed")void end("AI connection failed");
  }
  ws.on("message",data=>{
    if(closed||data.toString().length>160000)return;
    let e:any;try{e=JSON.parse(data.toString())}catch{return}
    if(e.event==="start")enqueue(async()=>{
      if(session)return;
      if(!runtimeEnabled())throw new Error("Incoming runtime disabled");
      clearTimeout(startTimer);
      number=String(e.start?.customParameters?.numberId??"");
      const call=String(e.start?.callSid??"");
      if(!validStreamToken(call,number,e.start?.customParameters?.auth))throw new Error("Unauthorized stream");
      const numbers=await storage.getPhoneNumber(number);
      if(!numbers||numbers.type!=="work")throw new Error("Not a work line");
      const settings=await incomingStore.settings(numbers.userId,number);
      if(!settings.enabled)throw new Error("Incoming disabled");
      const candidate=new IntakeSession(numbers.userId,call,settings,incomingStore);await candidate.begin();
      await incomingStore.update(numbers.userId,call,r=>{if(r.streamStarted||r.closed)throw new Error("Stream already claimed");return{...r,streamStarted:true};});
      session=candidate;
      sid=String(e.start.streamSid??e.streamSid??"");
      if(e.start?.mediaFormat?.encoding!=="audio/x-mulaw"||e.start?.mediaFormat?.sampleRate!==8000||!sid)throw new Error("Unsupported media");
      const set=active.get(number)??new Set();set.add(stop);active.set(number,set);
      activeOwners.set(number,numbers.userId);permissions.set(number,new Set(settings.cardIds));
      const cards=allowedCards(await storage.listKnowledgeCards(numbers.userId),numbers.userId,settings.cardIds);
      const latest=await incomingStore.settings(numbers.userId,number);
      if(closed)return;
      if(JSON.stringify(latest)!==JSON.stringify(settings))throw new Error("Permissions changed during setup");
      ai=new IncomingAudio(buildInstructions(settings,cards),aiEvent);
      await ai.connect();if(closed){ai.close();return;}ready=true;ai.send({type:"response.create"});
    });
    if(e.event==="media"&&ready&&e.media?.track!=="outbound"){
      mediaTimestamp=Number.isFinite(Number(e.media?.timestamp))?Number(e.media.timestamp):mediaTimestamp;
      const payload=e.media?.payload;
      if(typeof payload!=="string"||payload.length>24000||payload.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload))return;
      try{ai?.send({type:"input_audio_buffer.append",audio:payload});}catch{void end("audio backpressure");}
    }
    if(e.event==="stop")enqueue(async()=>{await end("connection ended");});
  });
  ws.on("close",()=>{enqueue(async()=>{await end("connection lost");});});
  ws.on("error",()=>{void end("media connection error");});
}
let notificationWorker:ReturnType<typeof setInterval>|undefined;
export function startIncomingNotifications(){
  if(notificationWorker||!runtimeEnabled())return;
  const sweep=async()=>{
    if(!pool)return;
    try {
      // Crash recovery: runtime calls are bounded to 15 minutes.
      await pool.query(`UPDATE incoming_secretary_requests SET payload=payload ||
        jsonb_build_object('closed',true,'status','incomplete','endReason','server session lost','outcome',
          CASE payload->'fields'->>'language'
            WHEN 'ru' THEN 'Связь прервана. Неполная заявка сохранена. Запись на сеанс не подтверждена.'
            WHEN 'es' THEN 'Conexión interrumpida. Solicitud parcial guardada. No hay cita confirmada.'
            ELSE 'Connection interrupted; preserved partial request. No appointment booked.' END)
        WHERE payload->>'closed' IS DISTINCT FROM 'true' AND updated_at < now()-interval '20 minutes'`);
      const result=await pool.query(`WITH candidate AS (
        SELECT call_sid FROM incoming_secretary_requests WHERE payload->>'closed'='true'
        AND (notification_status='pending' OR notification_status='failed' AND updated_at<now()-interval '2 minutes'
        OR notification_status='sending' AND updated_at<now()-interval '5 minutes')
        ORDER BY updated_at LIMIT 10 FOR UPDATE SKIP LOCKED)
        UPDATE incoming_secretary_requests r SET notification_status='sending',notification_attempts=notification_attempts+1,updated_at=now()
        FROM candidate c WHERE r.call_sid=c.call_sid RETURNING r.call_sid,r.user_id,r.id`);
      for(const r of result.rows){
        try{await notifySecretaryResult(r.user_id,r.id,true);
          await pool.query("UPDATE incoming_secretary_requests SET notification_status='sent' WHERE call_sid=$1",[r.call_sid]);}
        catch{await pool.query("UPDATE incoming_secretary_requests SET notification_status='failed',updated_at=now() WHERE call_sid=$1",[r.call_sid]);}
      }
    } catch{console.error("[IncomingSecretary] Notification/recovery worker unavailable");}
  };
  notificationWorker=setInterval(()=>void sweep(),30000);notificationWorker.unref?.();
}
