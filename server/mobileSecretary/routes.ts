import express, { type Express, type Request, type Response } from "express";
import { resolve } from "node:path";
import { z } from "zod";
import { loginUser, getSessionUserId, authMiddleware } from "../auth";
import { storage } from "../storage";
import { MobileStore, digest, secret } from "./store";
import { SECRETARY_AUDIO_MODEL, SECRETARY_AUDIO_VOICE, SECRETARY_REASONING_MODEL } from "../secretary/voice";
import { validateSecretaryInstruction, validateSecretaryPhoneNumber } from "../secretary/tasks";
import { secretaryBackend } from "../chatgpt/secretary";
import { incomingStore } from "../incomingSecretary/runtime";
import { ownerCalendar } from "../incomingSecretary/ownerCalendar";
import { prepareMessage, clearPrepareState, PREPARE_MODEL, PrepareUnavailableError } from "../prepare";

const model={model:SECRETARY_AUDIO_MODEL,voice:SECRETARY_AUDIO_VOICE,reasoningModel:SECRETARY_REASONING_MODEL};
const publicUser=(u:any)=>({id:u.id,email:u.email,language:u.language});
const failure=(status:number,message:string)=>Object.assign(new Error(message),{status});
/** One-time Dev browser return; no access token is put in its URL. */
export function mobileBrowserReturn(req:Request):string|undefined {
  if(process.env.NODE_ENV!=="development")return;
  const session=req.session as any;
  const id=session?.mobileSecretaryReturn;
  if(session)delete session.mobileSecretaryReturn;
  if(typeof id==="string"&&/^[A-Za-z0-9_-]{43}$/.test(id))return "/api/mobile-secretary/browser/approve?id="+id;
}
const input=z.object({clientRequestId:z.string().uuid(),recipient:z.string().trim().min(1).max(160),
  phoneNumber:z.string().refine(v=>!!validateSecretaryPhoneNumber(v),"Use a valid +1 phone number"),
  instruction:z.string().refine(v=>!!validateSecretaryInstruction(v),"Invalid assignment"),
  cardIds:z.array(z.string().min(1).max(100)).max(40)}).strict();

export function registerMobileSecretary(app:Express,store=new MobileStore()) {
  // No new endpoints/static preview are mounted in production.
  if(process.env.NODE_ENV!=="development")return;
  const router=express.Router();
  router.use((req,res,next)=>{
    res.set({"Cache-Control":"no-store","Referrer-Policy":"no-referrer"});
    const origin=req.get("origin");
    if(origin) {
      try {
        const u=new URL(origin);
        if(u.host!==req.get("host")&&!["http://localhost:8081","http://localhost:19006"].includes(u.origin))
          return res.status(403).json({error:"Cross-origin request denied"});
        res.set({"Access-Control-Allow-Origin":u.origin,"Vary":"Origin","Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"GET, POST, PATCH, PUT, OPTIONS"});
      }catch{return res.sendStatus(403);}
    }
    if(req.method==="OPTIONS")return res.sendStatus(204);
    if(!["GET","HEAD"].includes(req.method)&&!req.is("application/json"))return res.sendStatus(415);
    next();
  });
  const wrap=(fn:(req:Request,res:Response)=>Promise<any>)=>(req:Request,res:Response)=>{void fn(req,res).catch(e=>{
    res.status(e instanceof z.ZodError?400:e.status??503).json({error:e instanceof z.ZodError?e.issues[0]?.message:e.status?e.message:"Mobile Dev service unavailable"});
  });};
  const mint=async(owner:string)=>{
    const token="thmobile."+secret();
    await store.put({id:digest(token),owner,kind:"session",payload:{},expires:new Date(Date.now()+86400000)});
    return {token,user:publicUser(await storage.getUser(owner))};
  };
  const attempts=new Map<string,{count:number,until:number}>();
  router.post("/login",wrap(async(req,res)=>{
    if(attempts.size>1000)for(const [k,v] of Array.from(attempts))if(v.until<Date.now())attempts.delete(k);
    const key=req.ip??"unknown",a=attempts.get(key);
    if(a&&a.until>Date.now()&&a.count>=10)throw failure(429,"Too many login attempts; try again later");
    attempts.set(key,{count:a&&a.until>Date.now()?a.count+1:1,until:Date.now()+600000});
    const v=z.object({email:z.string().email().max(254),password:z.string().min(1).max(256)}).strict().parse(req.body);
    let user;try{user=await loginUser(v.email,v.password);}catch{throw failure(401,"Sign-in failed. Google-only accounts must use browser authorization.");}
    res.json(await mint(user.id));
  }));
  router.post("/exchange",wrap(async(req,res)=>{
    const {sessionToken}=z.object({sessionToken:z.string().min(32).max(256)}).strict().parse(req.body);
    const owner=await getSessionUserId(sessionToken);if(!owner)throw failure(401,"Invalid session");
    res.json(await mint(owner));
  }));
  // Existing browser login may authorize the new client with a PKCE challenge.
  // No long-lived token in redirect URLs; the client polls with its verifier.
  router.post("/browser/start",wrap(async(req,res)=>{
    const {challenge}=z.object({challenge:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
    const id=secret();
    await store.put({id:"browser:"+id,owner:"pending",kind:"browser",payload:{challenge},expires:new Date(Date.now()+300000)});
    res.json({id,url:`/api/mobile-secretary/browser/approve?id=${id}`});
  }));
  router.get("/browser/login",wrap(async(req,res)=>{
    const id=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.query.id);
    if(!(await store.get("browser:"+id)))throw failure(410,"Authorization expired");
    if(!req.session)throw failure(503,"Browser login session unavailable");
    (req.session as any).mobileSecretaryReturn=id;
    req.session.save(()=>res.redirect("/api/login"));
  }));
  router.get("/browser/approve",(req,res,next)=>{
    if(req.user)return next();
    const id=typeof req.query.id==="string"&&/^[A-Za-z0-9_-]{43}$/.test(req.query.id)?req.query.id:"";
    res.set("Cache-Control","no-store").type("html").send(`<meta name="viewport" content="width=device-width"><h1>TalkHint Secretary Dev</h1><p>Sign in with your existing account to authorize this Dev client.</p><a href="/api/mobile-secretary/browser/login?id=${id}">Continue with Google</a>`);
  },authMiddleware,wrap(async(req,res)=>{
    const id=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.query.id);
    const pending=await store.get("browser:"+id);
    if(!pending||pending.kind!=="browser")throw failure(410,"Authorization expired");
    // GET only shows a form; ownership approval requires explicit POST.
    res.type("html").send(`<meta name="viewport" content="width=device-width"><h1>TalkHint Secretary Dev</h1><p>Authorize this client for TEST and your Dev data only. No calls or number activation.</p><form method="post" action="/api/mobile-secretary/browser/approve-form"><input type="hidden" name="id" value="${id}"><button>Authorize Dev client</button></form>`);
  }));
  // Form is separately mounted below (JSON API otherwise rejects form requests).
  app.post("/api/mobile-secretary/browser/approve-form",express.urlencoded({extended:false}),authMiddleware,wrap(async(req,res)=>{
    if(req.get("origin")!==`${req.protocol}://${req.get("host")}`)throw failure(403,"Cross-origin request denied");
    const id=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.body.id),pending=await store.get("browser:"+id);
    if(!pending||pending.kind!=="browser")throw failure(410,"Authorization expired");
    if(pending.payload.calendarNumberId) {
      if(pending.owner!==req.user!.id)throw failure(403,"Sign in with the same TalkHint account");
      const numberId=pending.payload.calendarNumberId;
      if(!(await storage.getUserPhoneNumbers(req.user!.id)).some(n=>n.id===numberId&&n.type==="work"))throw failure(404,"Work profile not found");
      const browser=secret(),url=await ownerCalendar.connect(req.user!.id,numberId,browser);
      await store.remove(pending.id,pending.owner);
      res.cookie("th_calendar_oauth",browser,{httpOnly:true,secure:true,sameSite:"lax",path:"/api/incoming-secretary/calendar/oauth/callback",maxAge:600000});
      return res.redirect(url);
    }
    await store.put({id:"approved:"+id,owner:req.user!.id,kind:"approved",payload:pending.payload,expires:pending.expires});
    res.set("Cache-Control","no-store").type("html").send("Dev client authorized. Return to the Secretary app.");
  }));
  router.post("/browser/exchange",wrap(async(req,res)=>{
    const {id,verifier}=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{43}$/),verifier:z.string().min(43).max(128)}).strict().parse(req.body);
    const row=await store.get("approved:"+id);
    if(!row)return res.status(202).json({pending:true});
    if(digest(verifier)!==row.payload.challenge)throw failure(403,"Invalid verifier");
    // Atomic consumption avoids replay across workers.
    const {pool}=await import("../db");
    const won=await pool!.query("DELETE FROM mobile_secretary_dev WHERE id=$1 AND owner=$2 RETURNING id",[row.id,row.owner]);
    if(!won.rowCount)throw failure(410,"Authorization already consumed");
    await store.remove("browser:"+id,"pending");
    res.json(await mint(row.owner));
  }));
  router.use((req,res,next)=>{void (async()=>{
    const token=req.get("authorization")?.replace(/^Bearer /,"")??"";
    if(!token.startsWith("thmobile."))throw failure(401,"Mobile client sign-in required");
    const row=await store.get(digest(token));
    if(!row||row.kind!=="session")throw failure(401,"Session expired");
    const user=await storage.getUser(row.owner);if(!user)throw failure(401,"Account unavailable");
    req.user={id:user.id,email:user.email,language:user.language,plan:user.plan};
    (req as any).mobileSession=row;
    next();
  })().catch(e=>res.status(e.status??503).json({error:e.status?e.message:"Mobile Dev authentication unavailable"}));});
  const owner=(r:Request)=>r.user!.id;
  router.get("/me",wrap(async(req,res)=>res.json({user:publicUser(req.user),model,testOnly:true,legal:{approved:false}})));
  router.post("/refresh",wrap(async(req,res)=>{
    const token=await mint(owner(req));await store.remove((req as any).mobileSession.id,owner(req));res.json(token);
  }));
  router.post("/logout",wrap(async(req,res)=>{await store.remove((req as any).mobileSession.id,owner(req));res.json({success:true});}));
  router.get("/cards",wrap(async(req,res)=>res.json({cards:await storage.listKnowledgeCards(owner(req))})));
  router.patch("/cards/:id",wrap(async(req,res)=>{
    const fields=z.object({title:z.string().trim().min(1).max(120),body:z.string().max(12000),profileScope:z.enum(["personal","work"])}).strict().parse(req.body);
    const c=await storage.updateKnowledgeCardById(owner(req),req.params.id,fields);if(!c)throw failure(404,"Card not found");res.json({card:c});
  }));
  router.get("/profiles",wrap(async(req,res)=>{
    const numbers=await storage.getUserPhoneNumbers(owner(req));
    const account=await storage.getUser(owner(req));
    res.json({numbers:numbers.map(({id,twilioNumber,name,type})=>({id,twilioNumber,name,type})),contactPhone:account?.forwardingPhone??null,contactPhoneStatus:"saved_forwarding_contact_not_an_assigned_number",
      incomingSettings:await Promise.all(numbers.filter(n=>n.type==="work").map(n=>incomingStore.settings(owner(req),n.id)))});
  }));
  const work=async(req:Request)=>{
    if(!(await storage.getUserPhoneNumbers(owner(req))).some(n=>n.id===req.params.id&&n.type==="work"))
      throw failure(404,"Work profile not found");
  };
  router.put("/profiles/:id/cards",wrap(async(req,res)=>{
    await work(req);
    const {cardIds}=z.object({cardIds:z.array(z.string()).max(40)}).strict().parse(req.body);
    const cards=await storage.listKnowledgeCards(owner(req));
    if(cardIds.some(id=>!cards.some(c=>c.id===id&&c.profileScope==="work")))throw failure(403,"Only your Work cards may be permitted");
    const settings=await incomingStore.settings(owner(req),req.params.id);
    await incomingStore.saveSettings(owner(req),{...settings,cardIds});
    res.json({settings:{...settings,cardIds},activationChanged:false});
  }));
  const history=secretaryBackend(async()=>{throw new Error("Transport forbidden in mobile Dev");});
  router.get("/history",wrap(async(req,res)=>res.json({
    calls:(await history.history(owner(req))).map(c=>({...c,kind:"call"})),
    tasks:(await history.tasks(owner(req))).map(t=>({...t,kind:"task"})),
  })));
  router.get("/history/:id",wrap(async(req,res)=>res.json({call:await history.call(owner(req),req.params.id,true)})));
  router.get("/tasks/:id",wrap(async(req,res)=>res.json({task:await history.task(owner(req),req.params.id,true)})));
  router.get("/test-tasks",wrap(async(req,res)=>res.json({tasks:(await store.list(owner(req),"task")).map(r=>r.payload)})));
  router.post("/prepare/message",wrap(async(req,res)=>{
    const v=z.object({conversationId:z.string().uuid(),clientMessageId:z.string().uuid(),text:z.string().trim().min(1).max(4000)}).strict().parse(req.body);
    // Separate namespace: cannot clear or change the owner's Swift/lab preparation.
    try {
      const result=await prepareMessage(`mobile:${owner(req)}:${v.conversationId}`,v.text,v.clientMessageId,"secretary");
      res.json({...result,model:PREPARE_MODEL});
    }catch(e){if(e instanceof PrepareUnavailableError)throw failure(503,e.message);throw e;}
  }));
  router.post("/prepare/reset",wrap(async(req,res)=>{
    const v=z.object({conversationId:z.string().uuid()}).strict().parse(req.body);
    clearPrepareState(`mobile:${owner(req)}:${v.conversationId}`);
    res.json({success:true});
  }));
  router.post("/prepare",wrap(async(req,res)=>{
    const v=input.parse(req.body),cards=await storage.listKnowledgeCards(owner(req));
    const selected=v.cardIds.map(id=>cards.find(c=>c.id===id));
    if(selected.some(c=>!c))throw failure(403,"Card not permitted");
    const id=digest(owner(req)+":"+v.clientRequestId),existing=await store.get(id,owner(req));
    const fingerprint=digest(JSON.stringify(v));
    if(existing&&existing.payload.fingerprint!==fingerprint)throw failure(409,"Assignment changed; prepare a new review");
    const createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+600000).toISOString();
    const payload={id,testOnly:true,status:"prepared",fingerprint,createdAt,expiresAt,
      review:{recipient:v.recipient,phoneNumber:v.phoneNumber,instruction:v.instruction,cards:selected,model:model.model,voice:model.voice},
      summary:null,transcript:""};
    const row=await store.put({id,owner:owner(req),kind:"task",payload,expires:new Date(Date.now()+86400000)});
    if(row.payload.fingerprint!==fingerprint)throw failure(409,"Assignment changed; prepare a new review");
    res.json(row.payload);
  }));
  router.get("/test-tasks/:id",wrap(async(req,res)=>{
    const row=await store.get(req.params.id,owner(req));if(row?.kind!=="task")throw failure(404,"TEST task not found");res.json({task:row.payload});
  }));
  for(const [action,status] of [["confirm","completed"],["cancel","cancelled"]])router.post(`/test-tasks/:id/${action}`,wrap(async(req,res)=>{
    z.object({}).strict().parse(req.body);
    const row=await store.get(req.params.id,owner(req));if(row?.kind!=="task")throw failure(404,"TEST task not found");
    if(row.payload.status==="prepared"&&Date.parse(row.payload.expiresAt)<Date.now())throw failure(410,"Review expired; prepare again");
    const next=await store.transition(row.id,owner(req),status);
    res.json({task:next?.payload??(await store.get(row.id,owner(req)))!.payload});
  }));
  for(const action of ["","/calendars","/selection","/disconnect","/connect"]) {
    const path="/calendar/:id"+action,method=action==="/selection"?"put":action==="/disconnect"||action==="/connect"?"post":"get";
    router[method](path,wrap(async(req,res)=>{
      await work(req);const o=owner(req),id=req.params.id;
      if(action==="/connect") {
        const status=await ownerCalendar.status(o,id);
        if(status.state==="setup_required")throw failure(409,"calendar_setup_required: personal Google OAuth is not configured; no calendar connected");
        const browserId=secret();
        await store.put({id:"browser:"+browserId,owner:o,kind:"browser",payload:{calendarNumberId:id},expires:new Date(Date.now()+300000)});
        return res.json({url:"/api/mobile-secretary/browser/approve?id="+browserId,notice:"Use the same TalkHint account in the browser, then return and refresh. Booking remains unavailable."});
      }
      const result=action==="/calendars"?await ownerCalendar.calendars(o,id):
        action==="/selection"?await ownerCalendar.select(o,id,z.object({calendarId:z.string()}).strict().parse(req.body).calendarId):
        action==="/disconnect"?await ownerCalendar.disconnect(o,id):await ownerCalendar.status(o,id);
      res.json(result);
    }));
  }
  router.post("/transcribe",wrap(async(req,res)=>{
    const v=z.object({audio:z.string().max(9500000),mimeType:z.enum(["audio/mp4","audio/m4a","audio/webm","audio/wav"])}).strict().parse(req.body);
    if(!process.env.OPENAI_API_KEY)throw failure(503,"Transcription is not configured");
    const form=new FormData();form.append("model","gpt-4o-transcribe");
    form.append("file",new Blob([Buffer.from(v.audio,"base64")],{type:v.mimeType}),v.mimeType.includes("webm")?"voice.webm":"voice.m4a");
    const r=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw failure(502,"Transcription unavailable; no fallback");
    res.json({text:(await r.json()).text});
  }));
  app.use("/api/mobile-secretary",router);
  app.use("/secretary-preview",express.static(resolve("apps/secretary-mobile/dist"),{index:"index.html"}));
}
