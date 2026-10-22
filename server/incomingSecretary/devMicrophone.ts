import type { Express,RequestHandler } from "express";
import { createHash,randomBytes,randomUUID,timingSafeEqual } from "node:crypto";
import WebSocket from "ws";
import { z } from "zod";
import { pool } from "../db";
import { storage } from "../storage";
import { isBenchmarkAdmin } from "../benchmark/adminGate";
import { IncomingStore } from "./store";
import { IntakeSession } from "./session";
import { MODEL,VOICE,allowedCards,buildInstructions,defaults,type Settings } from "./policy";
import { LiveConversation } from "./liveConversation";
import { LIVE_MODEL,LIVE_VOICE,LIVE_BACKEND } from "./liveAudio";
import { incomingDevNotifications } from "./devNotifications";
import { incomingRevocations } from "./revocation";

export const incomingDevStore=new IncomingStore("incoming_secretary_dev_requests");
type Entry={id:string;owner:string;numberId:string;hash:Buffer;expires:number;used:boolean;closed:boolean;
  model:string;session:IntakeSession;settings:Settings;facts:ReturnType<typeof allowedCards>;voice?:LiveConversation;timer?:ReturnType<typeof setTimeout>;
  stopping?:Promise<void>;finalized?:boolean};
const sessions=new Map<string,Entry>();
const digest=(text:string)=>createHash("sha256").update(text).digest();
function stop(e:Entry,reason:string):Promise<void>{
  if(e.stopping)return e.stopping;
  e.closed=true;clearTimeout(e.timer);
  e.stopping=(async()=>{if(e.voice)await e.voice.stop(reason);else if(e.session)await e.session.end(reason);})()
    .finally(()=>{
      e.finalized=true;
      // Only an owner-scoped locator remains, never a resumable capability.
      const timer=setTimeout(()=>sessions.delete(e.id),30*60_000);timer.unref?.();
    });
  return e.stopping;
}
async function snapshot(owner:string,numberId:string){
  if(numberId==="dev-sandbox") {
    if(!pool)throw new Error("Dev storage unavailable");
    const r=await pool.query("SELECT config FROM incoming_secretary_dev_sandbox_settings WHERE user_id=$1",[owner]);
    const ids=z.array(z.string().min(1).max(100)).max(40).parse(r.rows[0]?.config?.cardIds??[]);
    const settings={...defaults("dev-sandbox"),cardIds:ids};
    return {settings,facts:allowedCards(await storage.listKnowledgeCards(owner),owner,ids)};
  }
  const number=await storage.getPhoneNumber(numberId);
  if(!number||number.userId!==owner||number.type!=="work")throw new Error("Work number unavailable");
  const settings=await incomingDevStore.settings(owner,numberId);
  const facts=allowedCards(await storage.listKnowledgeCards(owner),owner,settings.cardIds);
  return {settings,facts};
}
function unchanged(e:Entry,s:Awaited<ReturnType<typeof snapshot>>) {
  return JSON.stringify(e.settings)===JSON.stringify(s.settings)&&JSON.stringify(e.facts)===JSON.stringify(s.facts);
}
incomingRevocations.on("number",(numberId:string)=>{
  sessions.forEach(e=>{if(e.numberId===numberId&&!e.closed)void stop(e,"permissions changed").catch(()=>{});});
});
incomingRevocations.on("card",(owner:string,id:string)=>{
  sessions.forEach(e=>{if(e.owner===owner&&e.settings?.cardIds.includes(id)&&!e.closed)void stop(e,"permissions changed").catch(()=>{});});
});
export function registerIncomingDevRoutes(app:Express,auth:RequestHandler){
  const guard:RequestHandler=(req,res,next)=>{
    res.set("Cache-Control","no-store");
    if(process.env.NODE_ENV!=="development")return res.sendStatus(404);
    next();
  };
  const admin:RequestHandler=(req,res,next)=>{
    if(!isBenchmarkAdmin(req.user?.email))return res.sendStatus(403);
    next();
  };
  const json:RequestHandler=(req,res,next)=>{
    if(!req.is("application/json"))return res.sendStatus(415);
    if(req.get("origin")){
      try{if(new URL(req.get("origin")!).host!==req.get("host"))return res.sendStatus(403);}catch{return res.sendStatus(403);}
    }
    next();
  };
  app.get("/api/incoming-secretary/dev",guard,auth,admin,async(req,res)=>{
    try {
      // Recover ended/restarted Dev sessions after failed persistence; never
      // race writes of a still-live or currently-finalizing local session.
      const live=Array.from(sessions.values()).filter(e=>e.owner===req.user!.id&&e.session&&(!e.closed||!e.finalized))
        .map(e=>e.session.callSid);
      await pool?.query(`UPDATE incoming_secretary_dev_requests SET payload=payload||
        jsonb_build_object('closed',true,'status','incomplete','endReason','Dev session lost','outcome',
          CASE payload->'fields'->>'language'
            WHEN 'ru' THEN 'Тест прерван. Частичная заявка сохранена; бронирования нет.'
            WHEN 'es' THEN 'Prueba interrumpida. Solicitud parcial guardada; no hay reserva.'
            ELSE 'Interrupted Dev test; partial request preserved. No appointment booked.' END)
        WHERE user_id=$1 AND payload->>'closed' IS DISTINCT FROM 'true'
          AND NOT(call_sid=ANY($2::varchar[])) AND updated_at < now()-interval '5 seconds'`,[req.user!.id,live]);
      const requests=await incomingDevStore.list(req.user!.id);
      const active=Array.from(sessions.values()).find(e=>e.owner===req.user!.id&&!e.closed&&!e.voice?.closed);
      const sandbox=await snapshot(req.user!.id,"dev-sandbox");
      res.json({requests,activeSession:active?{sessionId:active.id,requestId:active.session?(await active.session.begin()).id:null}:null,
        sandbox:{numberId:"dev-sandbox",settings:sandbox.settings,cardTitles:sandbox.facts.map(c=>c.title),
          cards:allowedCards(await storage.listKnowledgeCards(req.user!.id),req.user!.id,
            (await storage.listKnowledgeCards(req.user!.id)).map(c=>c.id))},
        notifications:await incomingDevNotifications(req.user!.id),model:LIVE_MODEL,voice:LIVE_VOICE,testOnly:true,
        models:[{id:LIVE_MODEL,voice:LIVE_VOICE,backend:LIVE_BACKEND,label:"GPT‑Live 1 · естественный диалог"}]});
    }catch{res.status(503).json({error:"Dev-хранилище или диагностика недоступны. Тестовые заявки не выдаются за реальные."});}
  });
  app.post("/api/incoming-secretary/dev/settings",guard,auth,admin,json,async(req,res)=>{
    const input=z.object({cardIds:z.array(z.string().min(1).max(100)).max(40)}).strict().safeParse(req.body);
    if(!input.success||new Set(input.data.cardIds).size!==input.data.cardIds.length)return res.sendStatus(400);
    try{
      const owner=req.user!.id,cards=allowedCards(await storage.listKnowledgeCards(owner),owner,input.data.cardIds);
      if(cards.length!==input.data.cardIds.length)return res.status(403).json({error:"Only your explicitly selected Work cards may be used."});
      if(!pool)throw new Error("Dev storage unavailable");
      await pool.query(`INSERT INTO incoming_secretary_dev_sandbox_settings(user_id,config) VALUES($1,$2::jsonb)
        ON CONFLICT(user_id) DO UPDATE SET config=EXCLUDED.config`,[owner,JSON.stringify(input.data)]);
      await Promise.all(Array.from(sessions.values()).filter(e=>e.owner===owner&&e.numberId==="dev-sandbox"&&!e.closed)
        .map(e=>stop(e,"permissions changed")));
      res.json({saved:true,testOnly:true,cardTitles:cards.map(c=>c.title)});
    }catch{res.status(503).json({error:"Dev card permissions could not be saved."});}
  });
  app.post("/api/incoming-secretary/dev/sessions",guard,auth,admin,json,async(req,res)=>{
    const input=z.object({numberId:z.string().min(1).max(100),model:z.literal(LIVE_MODEL).optional()}).strict().safeParse(req.body);
    if(!input.success)return res.status(400).json({error:"Выберите собственный рабочий номер и поддерживаемую Dev-модель."});
    const owner=req.user!.id;
    const existing=Array.from(sessions.values()).find(e=>e.owner===owner&&!e.closed&&!e.voice?.closed);
    if(existing)return res.status(409).json({error:"Уже есть тестовая сессия. Остановите её перед новым тестом.",sessionId:existing.id});
    // Reservation is installed before the first await so concurrent starts cannot win twice.
    const id=randomUUID(),secret=randomBytes(32).toString("base64url");
    const model=input.data.model??LIVE_MODEL;
    const provisional={id,owner,model,numberId:input.data.numberId,hash:digest(secret),expires:Date.now()+120000,used:false,closed:false} as Entry;
    sessions.set(id,provisional);
    try{
      const s=await snapshot(owner,input.data.numberId);
      if(provisional.closed)throw new Error("Session cancelled");
      const session=new IntakeSession(owner,`dev-microphone:${id}`,s.settings,incomingDevStore);
      Object.assign(provisional,s,{session});
      const record=await session.begin();
      await incomingDevStore.update(owner,session.callSid,r=>({...r,devModel:model,devVoice:model===LIVE_MODEL?LIVE_VOICE:VOICE,
        devBackend:model===LIVE_MODEL?LIVE_BACKEND:null}));
      if(provisional.closed){await session.end("cancelled");throw new Error("Session cancelled");}
      if(!unchanged(provisional,await snapshot(owner,input.data.numberId)))throw new Error("Permissions changed");
      provisional.timer=setTimeout(()=>void stop(provisional,"unused session expired").catch(()=>{}),120000);
      provisional.timer.unref?.();
      res.json({sessionId:id,capability:secret,requestId:record.id,model,voice:model===LIVE_MODEL?LIVE_VOICE:VOICE,
        backend:model===LIVE_MODEL?LIVE_BACKEND:null,
        cardTitles:s.facts.map(c=>c.title),testOnly:true});
    }catch{
      if(provisional.session)await stop(provisional,"setup failed").catch(()=>{});
      else sessions.delete(id);
      res.status(503).json({error:"Не удалось подготовить тест: проверьте собственный Work-номер, сохранённые настройки и Dev-хранилище. Голосовой сеанс не запускался."});
    }
  });
  app.post("/api/incoming-secretary/dev/sessions/:id/stop",guard,auth,admin,json,async(req,res)=>{
    const e=sessions.get(String(req.params.id));
    if(!e||e.owner!==req.user!.id)return res.sendStatus(404);
    try{await stop(e,"completed");res.json({stopped:true,testOnly:true});}
    catch{res.status(503).json({error:"Голос остановлен, но завершение сохранения не подтверждено. Проверьте тестовую историю."});}
  });
}
export function handleIncomingDevSocket(ws:WebSocket,request:{headers:Record<string,any>}){
  if(process.env.NODE_ENV!=="development"){ws.close(1008,"Dev only");return;}
  try{
    const origin=new URL(request.headers.origin??"");
    if(!["https:","http:"].includes(origin.protocol)||origin.host!==request.headers.host)throw new Error();
  }catch{ws.close(1008,"Origin denied");return;}
  let entry:Entry|undefined,claiming=false,ended=false;
  const authTimer=setTimeout(()=>ws.close(1008,"Authentication timeout"),10000);authTimer.unref?.();
  const lifetime=setTimeout(()=>{if(entry)void stop(entry,"test time limit").catch(()=>{});ws.close();},15*60_000);lifetime.unref?.();
  const finish=(reason:string)=>{ended=true;clearTimeout(authTimer);clearTimeout(lifetime);if(entry)void stop(entry,reason).catch(()=>{});};
  ws.on("close",(code)=>finish(`browser_socket_closed:${Number.isInteger(code)?code:"unknown"}`));
  ws.on("error",()=>finish("browser_socket_error"));
  ws.on("message",raw=>{
    if(ended)return;
    if(raw.toString().length>40000){ws.close(1009,"Message too large");return;}
    let e:any;try{e=JSON.parse(raw.toString());}catch{ws.close(1008,"Invalid message");return;}
    if(entry){entry.voice?.input(e);return;}
    if(claiming)return;
    claiming=true;
    void(async()=>{
      const candidate=sessions.get(String(e.sessionId??""));
      if(e.type!=="connect"||typeof e.capability!=="string"||e.capability.length>200||!candidate||
        candidate.used||candidate.closed||candidate.expires<Date.now()||
        !timingSafeEqual(digest(e.capability),candidate.hash))throw new Error("Unauthorized session");
      candidate.used=true;entry=candidate;clearTimeout(authTimer);
      if(!unchanged(candidate,await snapshot(candidate.owner,candidate.numberId)))throw new Error("Permissions changed");
      if(ended||candidate.closed)return;
      clearTimeout(candidate.timer);
      candidate.voice=new LiveConversation(candidate.session,buildInstructions(candidate.settings,candidate.facts),ws);
      await candidate.voice.start();
    })().catch(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"error",error:"Dev-сессия недоступна, истекла или разрешения изменились. Начните новый тест вручную."}));ws.close();});
  });
}
