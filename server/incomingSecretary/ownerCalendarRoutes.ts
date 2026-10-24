import type { Express, RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { storage } from "../storage";
import { CalendarError } from "./workCalendar";
import { CALLBACK_PATH, ownerCalendar, type OwnerCalendar } from "./ownerCalendar";

const COOKIE="th_calendar_oauth";
export function registerOwnerCalendarRoutes(app:Express,auth:RequestHandler,calendar:OwnerCalendar=ownerCalendar) {
  const owns=async(owner:string,numberId:string)=>(await storage.getUserPhoneNumbers(owner))
    .some(n=>n.id===numberId&&n.userId===owner&&n.type==="work");
  const scope:RequestHandler=async(req,res,next)=>{
    res.set("Cache-Control","no-store");
    try {if(!await owns(req.user!.id,req.params.numberId))return res.sendStatus(404);next();}
    catch {res.status(503).json({error:"calendar_unavailable"});}
  };
  const write:RequestHandler=(req,res,next)=>{
    if(!req.is("application/json"))return res.sendStatus(415);
    if(req.get("origin"))try {
      if(new URL(req.get("origin")!).origin!==`${req.protocol}://${req.get("host")}`)return res.sendStatus(403);
    } catch {return res.sendStatus(403);}
    next();
  };
  const error=(res:any,e:unknown)=>res.status(e instanceof CalendarError?e.status:e instanceof z.ZodError?400:503)
    .json({error:e instanceof CalendarError?e.code:e instanceof z.ZodError?"invalid_calendar_input":"calendar_unavailable"});
  const base="/api/incoming-secretary/calendar/:numberId";
  app.get(base,auth,scope,async(req,res)=>{
    try {res.json(await calendar.status(req.user!.id,req.params.numberId));}catch(e){error(res,e);}
  });
  app.get(base+"/calendars",auth,scope,async(req,res)=>{
    try {res.json(await calendar.calendars(req.user!.id,req.params.numberId));}catch(e){error(res,e);}
  });
  app.post(base+"/connect",auth,scope,write,async(req,res)=>{
    try {
      z.object({}).strict().parse(req.body);
      const browser=randomBytes(32).toString("base64url");
      const url=await calendar.connect(req.user!.id,req.params.numberId,browser);
      res.cookie(COOKIE,browser,{httpOnly:true,secure:true,sameSite:"lax",path:CALLBACK_PATH,maxAge:600000});
      res.json({url});
    }catch(e){error(res,e);}
  });
  app.put(base+"/selection",auth,scope,write,async(req,res)=>{
    try {
      const {calendarId}=z.object({calendarId:z.string().min(1).max(1024)}).strict().parse(req.body);
      res.json(await calendar.select(req.user!.id,req.params.numberId,calendarId));
    }catch(e){error(res,e);}
  });
  app.post(base+"/disconnect",auth,scope,write,async(req,res)=>{
    try {z.object({}).strict().parse(req.body);res.json(await calendar.disconnect(req.user!.id,req.params.numberId));}catch(e){error(res,e);}
  });
  // A provider redirect cannot carry the app's Bearer token. Single-use state is
  // bound to the initiating authenticated owner AND that browser's HttpOnly cookie.
  app.get(CALLBACK_PATH,async(req,res)=>{
    res.set({"Cache-Control":"no-store","Referrer-Policy":"no-referrer"});
    res.clearCookie(COOKIE,{httpOnly:true,secure:true,sameSite:"lax",path:CALLBACK_PATH});
    try {
      const q=z.object({state:z.string().min(32).max(100),code:z.string().min(1).max(4096).optional(),error:z.string().optional()}).parse(req.query);
      const cookies=(req.headers.cookie??"").split(";").map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+"="));
      if(cookies.length!==1)throw new CalendarError(400,"invalid_calendar_oauth_state");
      const browser=cookies[0].slice(COOKIE.length+1);
      if(!/^[A-Za-z0-9_-]{43}$/.test(browser))throw new CalendarError(400,"invalid_calendar_oauth_state");
      await calendar.callback(q.state,browser,q.error?undefined:q.code,owns);
      res.redirect("/incoming-secretary?calendar=connected");
    }catch {res.redirect("/incoming-secretary?calendar=error");}
  });
}
