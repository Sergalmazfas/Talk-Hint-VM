import express from "express";
import request from "supertest";
import { beforeEach,afterEach,it,expect,vi } from "vitest";
const f=vi.hoisted(()=>({numbers:vi.fn(),settings:vi.fn()}));
vi.mock("../storage",()=>({storage:{getUserPhoneNumbers:f.numbers}}));
vi.mock("./runtime",()=>({incomingStore:{settings:f.settings}}));
import { registerCalendarDevRoutes } from "./calendarRoutes";
import { CalendarError } from "./workCalendar";
import { defaults } from "./policy";
function setup(){
  const calendar={status:vi.fn(async()=>({connected:true,bookingEnabled:false})),
    availability:vi.fn(async()=>({available:true,bookingConfirmed:false}))};
  const app=express();app.use(express.json());
  const auth:any=(req:any,res:any,next:any)=>{
    if(!req.get("x-owner"))return res.sendStatus(401);
    req.user={id:req.get("x-owner"),email:req.get("x-email")||"owner@example.test"};next();
  };
  registerCalendarDevRoutes(app,auth,calendar as any);return {app,calendar};
}
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("BENCHMARK_ADMIN_EMAILS","owner@example.test,another@example.test");
  f.numbers.mockResolvedValue([{id:"work",userId:"alice",type:"work"},{id:"personal",userId:"alice",type:"personal"}]);
  f.settings.mockResolvedValue({...defaults("work"),timeZone:"America/New_York"});
});
afterEach(()=>vi.unstubAllEnvs());
it("requires app authorization before touching the workspace connector",async()=>{
  const x=setup();expect((await request(x.app).get("/api/incoming-secretary/dev/calendar/work")).status).toBe(401);
  expect(x.calendar.status).not.toHaveBeenCalled();
});
it("requires the trusted admin role",async()=>{
  const x=setup();expect((await request(x.app).get("/api/incoming-secretary/dev/calendar/work").set("x-owner","alice").set("x-email","guest@example.test")).status).toBe(403);
  expect(x.calendar.status).not.toHaveBeenCalled();
});
it.each([["bob","work"],["alice","personal"],["alice","unknown"]])("denies %s / %s before reading Google",async(owner,id)=>{
  const x=setup();expect((await request(x.app).get("/api/incoming-secretary/dev/calendar/"+id).set("x-owner",owner)).status).toBe(404);
  expect(x.calendar.status).not.toHaveBeenCalled();
});
it("is unavailable in production even for the owner",async()=>{
  vi.stubEnv("NODE_ENV","production");const x=setup();
  expect((await request(x.app).get("/api/incoming-secretary/dev/calendar/work").set("x-owner","alice")).status).toBe(404);
  expect(x.calendar.status).not.toHaveBeenCalled();
});
it("retains the Google identity check after app role and number ownership checks",async()=>{
  const x=setup();x.calendar.status.mockRejectedValue(new CalendarError(403,"calendar_owner_required"));
  const r=await request(x.app).get("/api/incoming-secretary/dev/calendar/work").set("x-owner","alice").set("x-email","another@example.test");
  expect(r.status).toBe(403);expect(r.body).toEqual({error:"calendar_owner_required",bookingConfirmed:false});
});
it("checks the owner's actual Work settings and never claims a booking",async()=>{
  const x=setup();const r=await request(x.app).post("/api/incoming-secretary/dev/calendar/work/check").set("x-owner","alice")
    .send({startLocal:"2026-10-23T09:00",durationMinutes:60});
  expect(r.status).toBe(200);expect(r.body.bookingConfirmed).toBe(false);
  expect(f.settings).toHaveBeenCalledWith("alice","work");
  expect(x.calendar.availability).toHaveBeenCalledWith("owner@example.test",true,expect.objectContaining({numberId:"work"}),"2026-10-23T09:00",60);
});
it("rejects injected account/calendar IDs and external origins",async()=>{
  const x=setup();const path="/api/incoming-secretary/dev/calendar/work/check";
  expect((await request(x.app).post(path).set("x-owner","alice").send({startLocal:"2026-10-23T09:00",durationMinutes:60,userId:"bob",calendarId:"primary"})).status).toBe(400);
  expect((await request(x.app).post(path).set("x-owner","alice").set("Origin","https://attacker.test").send({startLocal:"2026-10-23T09:00",durationMinutes:60})).status).toBe(403);
  expect(x.calendar.availability).not.toHaveBeenCalled();
});
