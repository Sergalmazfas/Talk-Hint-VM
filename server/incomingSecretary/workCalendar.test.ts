import { describe,it,expect,vi } from "vitest";
import { WorkCalendar,WORK_CALENDAR_ID,WORK_TIMEZONE,localInstant } from "./workCalendar";
import { defaults } from "./policy";
function setup(){
  const state={primary:"owner@example.test",role:"owner",zone:WORK_TIMEZONE,busy:[] as any[],errors:[] as any[],
    extraAcl:[] as any[],http:200,malformed:false,aclMore:false};
  const proxy=vi.fn(async(path:string,options?:any)=>{
    const json=(b:unknown)=>new Response(JSON.stringify(b),{status:state.http});
    if(path.includes("calendarList"))return json({items:[
      {id:state.primary,primary:true,accessRole:"owner"},
      {id:WORK_CALENDAR_ID,summary:"TalkHint — Work",timeZone:state.zone,accessRole:state.role},
    ]});
    if(path.includes("/acl?"))return json({items:[
      {role:"owner",scope:{type:"user",value:state.primary}},
      {role:"owner",scope:{type:"user",value:WORK_CALENDAR_ID}},...state.extraAcl,
    ],...(state.aclMore?{nextPageToken:"more"}:{})});
    expect(path).toBe("/calendar/v3/freeBusy");
    expect(JSON.parse(options.body).items).toEqual([{id:WORK_CALENDAR_ID}]);
    return json(state.malformed?{}:{calendars:{[WORK_CALENDAR_ID]:{busy:state.busy,errors:state.errors}}});
  });
  const calendar=new WorkCalendar(proxy,()=>Date.parse("2026-10-21T12:00Z"));
  // Explicit standalone calendar fixture, NOT a universal Secretary default.
  const settings={...defaults("work"),timeZone:WORK_TIMEZONE,business:{days:[0,2,3,4,5,6],opens:"08:00",closes:"22:00",travelMinutes:30}};
  return {state,proxy,calendar,settings,check:(date="2026-10-23T09:00",duration=60)=>calendar.availability(state.primary,true,settings,date,duration)};
}
describe("Dev Work Calendar — private, owner scoped, occupancy only, no events",()=>{
  it("recognizes the exact private Work resource without exposing account identity",async()=>{
    const x=setup(),status=await x.calendar.status(x.state.primary,true);
    expect(status).toMatchObject({connected:true,bookingEnabled:false,mode:"read_only",timeZone:WORK_TIMEZONE});
    expect(JSON.stringify(status)).not.toContain(x.state.primary);
    expect(x.proxy.mock.calls.every(([p])=>!p.includes("/events"))).toBe(true);
  });
  it("rejects non-admin access before making any Google request",async()=>{
    const x=setup();await expect(x.calendar.status(x.state.primary,false)).rejects.toMatchObject({status:403});
    expect(x.proxy).not.toHaveBeenCalled();
  });
  it("denies a different TalkHint account even if it is an admin",async()=>{
    const x=setup();await expect(x.calendar.status("another@example.test",true)).rejects.toMatchObject({status:403});
    expect(x.proxy.mock.calls.some(([p])=>p==="/calendar/v3/freeBusy")).toBe(false);
  });
  it.each(["reader","writer","freeBusyReader"])("requires ownership rather than %s access",async(role)=>{
    const x=setup();x.state.role=role;await expect(x.check()).rejects.toMatchObject({status:409});
  });
  it("does not silently change timezone",async()=>{
    const x=setup();x.settings.timeZone="America/Indiana/Indianapolis";
    await expect(x.check()).rejects.toMatchObject({code:"business_timezone_must_match_calendar"});
  });
  it.each(["default","domain","group","user"])("fails closed on extra %s access",async(type)=>{
    const x=setup();x.state.extraAcl.push({role:"reader",scope:{type,value:"unrelated@example.test"}});
    await expect(x.check()).rejects.toMatchObject({code:"work_calendar_privacy_review_required"});
  });
  it("does not trust partial ACL data",async()=>{
    const x=setup();x.state.aclMore=true;await expect(x.check()).rejects.toMatchObject({status:409});
  });
  it("checks free time without promising a reservation or reading personal events",async()=>{
    const x=setup();expect(await x.check()).toMatchObject({checked:true,available:true,bookingConfirmed:false});
    const [,opts]=x.proxy.mock.calls.find(([p])=>p==="/calendar/v3/freeBusy")!;
    expect(JSON.parse(opts!.body)).toMatchObject({timeMin:"2026-10-23T12:30:00.000Z",timeMax:"2026-10-23T14:30:00.000Z"});
    expect(x.proxy.mock.calls.some(([p])=>p.includes("/events"))).toBe(false);
  });
  it.each(["2026-10-26T10:00","2026-10-23T07:59","2026-10-23T21:01"])("rejects closed/out-of-hours %s before occupancy queries",async(start)=>{
    const x=setup();expect(await x.check(start)).toMatchObject({checked:false,available:null,reason:"outside_working_hours"});
    expect(x.proxy.mock.calls.some(([p])=>p==="/calendar/v3/freeBusy")).toBe(false);
  });
  it("allows a session ending exactly at 22:00",async()=>{
    expect(await setup().check("2026-10-23T21:00")).toMatchObject({available:true,bookingConfirmed:false});
  });
  it("applies a full thirty-minute travel buffer on either side",async()=>{
    const x=setup();x.state.busy=[{start:"2026-10-23T12:00:00Z",end:"2026-10-23T12:31:00Z"}];
    expect(await x.check()).toMatchObject({available:false,reason:"busy_or_travel_buffer"});
    x.state.busy[0].end="2026-10-23T12:30:00Z";expect(await x.check()).toMatchObject({available:true});
    x.state.busy=[{start:"2026-10-23T14:29:00Z",end:"2026-10-23T15:00:00Z"}];
    expect(await x.check()).toMatchObject({available:false});
  });
  it.each(["2026-03-08T02:30","2026-11-01T01:30","2026-02-30T10:00"])("rejects nonexistent/ambiguous dates %s",value=>{
    expect(()=>localInstant(value)).toThrow();
  });
  it("uses the correct summer and winter offsets",()=>{
    expect(new Date(localInstant("2026-10-23T09:00")).toISOString()).toBe("2026-10-23T13:00:00.000Z");
    expect(new Date(localInstant("2026-12-23T09:00")).toISOString()).toBe("2026-12-23T14:00:00.000Z");
  });
  it("never turns provider/permission/malformed results into free time",async()=>{
    for(const error of ["http","errors","malformed"]){
      const x=setup();if(error==="http")x.state.http=403;if(error==="errors")x.state.errors=[{reason:"notFound"}];if(error==="malformed")x.state.malformed=true;
      await expect(x.check()).rejects.toMatchObject({status:503});
    }
  });
  it("rechecks owner and permissions rather than retaining a stale access grant",async()=>{
    const x=setup();await x.calendar.status(x.state.primary,true);x.state.primary="changed@example.test";
    await expect(x.calendar.availability("owner@example.test",true,x.settings,"2026-10-23T09:00",60)).rejects.toMatchObject({status:403});
  });
});
