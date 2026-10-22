import type { Express,RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { isBenchmarkAdmin } from "../benchmark/adminGate";
import { incomingStore } from "./runtime";
import { CalendarError,workCalendar,type WorkCalendar } from "./workCalendar";

/** Project-level connector: Dev-only, exact Google owner AND existing app admin.
 * It is NOT a per-user OAuth/calendar connection for all TalkHint accounts. */
export function registerCalendarDevRoutes(app:Express,auth:RequestHandler,calendar:WorkCalendar=workCalendar){
  const scope:RequestHandler=async(req,res,next)=>{
    if(process.env.NODE_ENV!=="development")return res.sendStatus(404);
    if(!isBenchmarkAdmin(req.user?.email))return res.sendStatus(403);
    try{
      const n=(await storage.getUserPhoneNumbers(req.user!.id))
        .find(n=>n.id===req.params.numberId&&n.userId===req.user!.id&&n.type==="work");
      if(!n)return res.sendStatus(404);
      next();
    }catch{res.status(503).json({error:"Work profile unavailable"});}
  };
  const error=(res:any,e:unknown)=>res.status(e instanceof CalendarError?e.status:e instanceof z.ZodError?400:503)
    .json({error:e instanceof CalendarError?e.code:e instanceof z.ZodError?"invalid_calendar_check":"calendar_unavailable",bookingConfirmed:false});
  app.get("/api/incoming-secretary/dev/calendar/:numberId",auth,scope,async(req,res)=>{
    try{res.json(await calendar.status(req.user!.email??"",true));}catch(e){error(res,e);}
  });
  app.post("/api/incoming-secretary/dev/calendar/:numberId/check",auth,scope,async(req,res)=>{
    if(!req.is("application/json"))return res.sendStatus(415);
    if(req.get("origin")){try{
      if(new URL(req.get("origin")!).host!==req.get("host"))return res.sendStatus(403);
    }catch{return res.sendStatus(403);}}
    try{
      const input=z.object({startLocal:z.string().max(16),durationMinutes:z.number().int().min(1).max(480)}).strict().parse(req.body);
      const settings=await incomingStore.settings(req.user!.id,req.params.numberId);
      res.json(await calendar.availability(req.user!.email??"",true,settings,input.startLocal,input.durationMinutes));
    }catch(e){error(res,e);}
  });
}
