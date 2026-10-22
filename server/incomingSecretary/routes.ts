import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storage } from "../storage";
import { isBenchmarkAdmin } from "../benchmark/adminGate";
import { incomingStore, runtimeEnabled, stopIncomingNumber, startIncomingNotifications } from "./runtime";
import { TEMPLATE, defaults, settingsSchema, fieldsSchema, allowedCards } from "./policy";
import { LIVE_MODEL as MODEL,LIVE_VOICE as VOICE } from "./liveAudio";
import { IntakeSession } from "./session";
import { MemoryRequests } from "./store";
import { registerIncomingDevRoutes } from "./devMicrophone";
import { registerCalendarDevRoutes } from "./calendarRoutes";
export function registerIncomingRoutes(app:Express,auth:RequestHandler) {
  registerIncomingDevRoutes(app,auth);
  registerCalendarDevRoutes(app,auth);
  const eligible=async(owner:string)=> (await storage.getUserPhoneNumbers(owner)).filter(n=>n.type==="work"&&n.userId===owner);
  const write:RequestHandler=(req,res,next)=>{
    if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
    if(req.get("origin")){try{if(new URL(req.get("origin")!).host!==req.get("host"))return res.status(403).json({error:"Cross-origin request denied"});}catch{return res.sendStatus(403);}}
    next();
  };
  app.get("/api/incoming-secretary",auth,async(req,res)=>{
    try {
      const owner=req.user!.id,numbers=await eligible(owner);
      res.json({numbers:numbers.map(n=>({id:n.id,phoneNumber:n.twilioNumber,name:n.name})),
        settings:await Promise.all(numbers.map(n=>incomingStore.settings(owner,n.id))),
        cards:allowedCards(await storage.listKnowledgeCards(owner),owner,(await storage.listKnowledgeCards(owner)).map(c=>c.id)),
        requests:await incomingStore.list(owner),runtimeEnabled:runtimeEnabled(),calendarConnected:false,templateText:TEMPLATE,
        model:MODEL,voice:VOICE,previewAvailable:process.env.NODE_ENV==="development"&&isBenchmarkAdmin(req.user?.email)});
    }catch{res.status(503).json({error:"Incoming Secretary storage unavailable; no settings activated."});}
  });
  app.put("/api/incoming-secretary/settings/:numberId",auth,write,async(req,res)=>{
    try {
      const owner=req.user!.id,number=(await eligible(owner)).find(n=>n.id===req.params.numberId);
      if(!number)return res.status(404).json({error:"Work number not found"});
      const parsed=settingsSchema.parse(req.body);
      const allowed=allowedCards(await storage.listKnowledgeCards(owner),owner,parsed.cardIds);
      if(allowed.length!==parsed.cardIds.length)return res.status(403).json({error:"Only explicitly selected own Work cards may be used; Shared is not permission."});
      const settings={...parsed,numberId:number.id};
      await incomingStore.saveSettings(owner,settings);stopIncomingNumber(number.id);
      res.json({settings,runtimeEnabled:runtimeEnabled(),activated:runtimeEnabled()&&settings.enabled,calendarConnected:false});
    }catch(e){res.status(e instanceof z.ZodError?400:503).json({error:e instanceof z.ZodError?e.issues[0]?.message:"Could not save incoming settings"});}
  });
  app.post("/api/incoming-secretary/preview",auth,write,async(req,res)=>{
    if(process.env.NODE_ENV!=="development"||!isBenchmarkAdmin(req.user?.email))return res.sendStatus(404);
    try {
      const input=z.object({numberId:z.string(),turns:z.array(z.object({role:z.enum(["caller","secretary"]),text:z.string().max(4000),
        language:z.enum(["en","ru","es"]).optional()})).max(100),fields:fieldsSchema,
        endReason:z.enum(["completed","disconnected"]),failSave:z.boolean().optional()}).strict().parse(req.body);
      if(!(await eligible(req.user!.id)).some(n=>n.id===input.numberId))return res.sendStatus(404);
      const store=new MemoryRequests(),settings=await incomingStore.settings(req.user!.id,input.numberId);
      const session=new IntakeSession(req.user!.id,`preview-${randomUUID()}`,settings,store);
      await session.begin();
      for(let i=0;i<input.turns.length;i++)await session.turn({...input.turns[i],id:String(i)});
      store.failSave=input.failSave??false;
      try{await session.save(input.fields,input.endReason==="completed");await session.end(input.endReason);}
      catch{return res.json({simulation:true,request:Array.from(store.records.values())[0],notice:"Simulated save failed. No successful acceptance or booking may be announced."});}
      res.json({simulation:true,request:Array.from(store.records.values())[0],notice:"Text simulation only: no AI, microphone, real request, notification or telephone call."});
    }catch(e){res.status(e instanceof z.ZodError?400:503).json({error:"Preview unavailable or invalid fields"});}
  });
  startIncomingNotifications();
}
