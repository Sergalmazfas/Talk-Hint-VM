import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({numbers:vi.fn()}));
vi.mock("../storage",()=>({storage:{getUserPhoneNumbers:f.numbers}}));
vi.mock("../db",()=>({pool:null}));
import { registerOwnerCalendarRoutes } from "./ownerCalendarRoutes";
import { CALLBACK_PATH } from "./ownerCalendar";
import { CalendarError } from "./workCalendar";
function setup() {
  const calendar={
    status:vi.fn(async()=>({state:"disconnected",bookingEnabled:false})),calendars:vi.fn(async()=>({calendars:[]})),
    connect:vi.fn(async()=>"https://accounts.google.com/o/oauth2/v2/auth?state=test"),
    select:vi.fn(async()=>({state:"connected",bookingEnabled:false})),
    disconnect:vi.fn(async()=>({state:"disconnected"})),callback:vi.fn(async()=>{}),
  };
  const app=express();app.use(express.json());
  const auth:any=(req:any,res:any,next:any)=>{
    if(!req.get("x-owner"))return res.sendStatus(401);req.user={id:req.get("x-owner")};next();
  };
  registerOwnerCalendarRoutes(app,auth,calendar as any);return {app,calendar};
}
beforeEach(()=>f.numbers.mockResolvedValue([{id:"work",userId:"alice",type:"work"},{id:"personal",userId:"alice",type:"personal"}]));
it("requires authentication and ownership of current Work number for every operation",async()=>{
  const x=setup();
  for(const [method,suffix] of [["get",""],["get","/calendars"],["post","/connect"],["put","/selection"],["post","/disconnect"]]) {
    for(const [owner,id,status] of [["","work",401],["bob","work",404],["alice","personal",404],["alice","missing",404]]) {
      const r=await (request(x.app) as any)[method]("/api/incoming-secretary/calendar/"+id+suffix)
        .set("x-owner",owner).send(method==="put"?{calendarId:"primary"}:{});
      expect(r.status).toBe(status);
    }
  }
  for(const fn of Object.values(x.calendar))expect(fn).not.toHaveBeenCalled();
});
it("scopes all accesses by authenticated owner and never takes owner/connector IDs from input",async()=>{
  const x=setup(),base="/api/incoming-secretary/calendar/work";
  expect((await request(x.app).get(base).set("x-owner","alice")).headers["cache-control"]).toBe("no-store");
  expect(x.calendar.status).toHaveBeenCalledWith("alice","work");
  expect((await request(x.app).get(base+"/calendars").set("x-owner","alice")).status).toBe(200);
  expect(x.calendar.calendars).toHaveBeenCalledWith("alice","work");
  expect((await request(x.app).put(base+"/selection").set("x-owner","alice").send({calendarId:"work-calendar"})).status).toBe(200);
  expect(x.calendar.select).toHaveBeenCalledWith("alice","work","work-calendar");
  for(const extra of [{userId:"bob"},{connectionId:"project"},{business:{opens:"09:00"}},{enabled:true}]) {
    expect((await request(x.app).post(base+"/connect").set("x-owner","alice").send(extra)).status).toBe(400);
    expect((await request(x.app).put(base+"/selection").set("x-owner","alice").send({calendarId:"work",...extra})).status).toBe(400);
    expect((await request(x.app).post(base+"/disconnect").set("x-owner","alice").send(extra)).status).toBe(400);
  }
});
it("denies non-JSON and cross-origin mutations before OAuth or disconnection",async()=>{
  const x=setup(),base="/api/incoming-secretary/calendar/work";
  for(const action of ["connect","disconnect"]) {
    expect((await request(x.app).post(base+"/"+action).set("x-owner","alice").send("hello")).status).toBe(415);
    expect((await request(x.app).post(base+"/"+action).set("x-owner","alice").set("Origin","https://evil.test").send({})).status).toBe(403);
  }
  expect(x.calendar.connect).not.toHaveBeenCalled();expect(x.calendar.disconnect).not.toHaveBeenCalled();
});
it("sets a Secure HttpOnly callback-only browser cookie on explicit connect",async()=>{
  const x=setup(),r=await request(x.app).post("/api/incoming-secretary/calendar/work/connect").set("x-owner","alice").send({});
  expect(r.status).toBe(200);
  expect(r.headers["set-cookie"][0]).toContain("HttpOnly");
  expect(r.headers["set-cookie"][0]).toContain("Secure");
  expect(r.headers["set-cookie"][0]).toContain("SameSite=Lax");
  expect(r.headers["set-cookie"][0]).toContain("Path="+CALLBACK_PATH);
  expect(x.calendar.connect).toHaveBeenCalledWith("alice","work",expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
});
it("does not trust callback query owner IDs; validates browser state and redirects without credentials",async()=>{
  const x=setup(),state="s".repeat(43),browser="b".repeat(43);
  const r=await request(x.app).get(CALLBACK_PATH).query({state,code:"test-code",owner:"bob"}).set("Cookie","th_calendar_oauth="+browser);
  expect(r.status).toBe(302);expect(r.headers.location).toBe("/incoming-secretary?calendar=connected");
  expect(r.headers["cache-control"]).toBe("no-store");expect(r.headers["referrer-policy"]).toBe("no-referrer");
  expect(x.calendar.callback).toHaveBeenCalledWith(state,browser,"test-code",expect.any(Function));
  const owns=x.calendar.callback.mock.calls[0][3] as any;
  expect(await owns("bob","work")).toBe(false);expect(await owns("alice","personal")).toBe(false);
});
it("rejects missing, ambiguous and malformed browser cookies",async()=>{
  const x=setup();
  for(const cookie of ["","th_calendar_oauth=bad","th_calendar_oauth="+"b".repeat(43)+"; th_calendar_oauth="+"c".repeat(43)]) {
    const r=await request(x.app).get(CALLBACK_PATH).query({state:"s".repeat(43),code:"test"}).set("Cookie",cookie);
    expect(r.headers.location).toBe("/incoming-secretary?calendar=error");
  }
  expect(x.calendar.callback).not.toHaveBeenCalled();
});
it("handles denial and provider errors without reflecting codes or exception details",async()=>{
  const x=setup();
  x.calendar.callback.mockRejectedValue(new Error("private provider details"));
  const r=await request(x.app).get(CALLBACK_PATH).query({state:"s".repeat(43),error:"access_denied"})
    .set("Cookie","th_calendar_oauth="+"b".repeat(43));
  expect(x.calendar.callback).toHaveBeenCalledWith("s".repeat(43),"b".repeat(43),undefined,expect.any(Function));
  expect(r.headers.location).toBe("/incoming-secretary?calendar=error");
  x.calendar.status.mockRejectedValue(new CalendarError(503,"calendar_unavailable"));
  expect((await request(x.app).get("/api/incoming-secretary/calendar/work").set("x-owner","alice")).body).toEqual({error:"calendar_unavailable"});
});
