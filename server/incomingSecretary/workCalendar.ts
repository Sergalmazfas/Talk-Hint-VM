import { ReplitConnectors } from "@replit/connectors-sdk";
import type { Settings } from "./policy";

// Resource identifiers, not credentials. Never fall back to another connection,
// the primary calendar, a name match or an arbitrary caller-supplied calendar.
export const WORK_CALENDAR_ID="78c17cd00d954de8f0036818000fe5a17ceab6d50f2f01038c52f515f6a3fd75@group.calendar.google.com";
const CONNECTION_ID="conn_google-calendar_01M5GHCTNJ1RDKCQ2527MRXQ0J";
export const WORK_TIMEZONE="America/New_York";
type Proxy=(path:string,options?:{method?:"GET"|"POST";body?:string;headers?:Record<string,string>})=>Promise<Response>;
export class CalendarError extends Error{
  constructor(readonly status:number,readonly code:string){super(code);}
}
const reject=(status:number,code:string):never=>{throw new CalendarError(status,code)};
const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:WORK_TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function local(t:number){
  const p=Object.fromEntries(formatter.formatToParts(new Date(t)).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Reject DST gaps/ambiguities rather than silently shifting the requested time. */
export function localInstant(value:string){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return reject(400,"invalid_local_time");
  const base=Date.parse(value+"Z");if(!Number.isFinite(base))return reject(400,"invalid_local_time");
  const found=new Set<number>();
  for(const day of [-1,0,1]){
    const guess=base+day*86400000,offset=Date.parse(local(guess)+"Z")-guess,candidate=base-offset;
    if(local(candidate)===value)found.add(candidate);
  }
  if(found.size!==1)return reject(400,"nonexistent_or_ambiguous_local_time");
  return Array.from(found)[0];
}
export class WorkCalendar {
  constructor(private proxy:Proxy,private now=Date.now){}
  private async json(path:string,options?:Parameters<Proxy>[1]):Promise<any>{
    let r:Response;
    try{r=await this.proxy(path,options);}catch{return reject(503,"calendar_unavailable");}
    if(!r.ok)return reject(503,"calendar_unavailable");
    try{return await r.json();}catch{return reject(503,"invalid_calendar_response");}
  }
  async status(email:string,admin:boolean){
    if(!admin||!email)return reject(403,"calendar_owner_required");
    let page:string|undefined,primary:string|undefined,work:any;
    const seen=new Set<string>();
    do{
      const q=new URLSearchParams({maxResults:"250",fields:"items(id,primary,accessRole,summary,timeZone),nextPageToken"});
      if(page)q.set("pageToken",page);
      const b=await this.json("/calendar/v3/users/me/calendarList?"+q);
      if(!Array.isArray(b.items))return reject(503,"invalid_calendar_response");
      for(const c of b.items){
        if(c.primary&&c.accessRole==="owner")primary=c.id;
        if(c.id===WORK_CALENDAR_ID)work=c;
      }
      page=b.nextPageToken;
      if(page){if(seen.has(page)||seen.size>=100)return reject(503,"calendar_pagination_failed");seen.add(page);}
    }while(page);
    if(typeof primary!=="string"||primary.trim().toLowerCase()!==email.trim().toLowerCase())
      return reject(403,"calendar_owner_required");
    if(!work||work.accessRole!=="owner"||work.timeZone!==WORK_TIMEZONE)
      return reject(409,"work_calendar_setup_required");
    const acl=await this.json(`/calendar/v3/calendars/${encodeURIComponent(WORK_CALENDAR_ID)}/acl?maxResults=250&fields=items(role,scope(type,value)),nextPageToken`);
    // Fail closed on incomplete ACLs, public/domain/group access or extra people.
    if(acl.nextPageToken||!Array.isArray(acl.items)||!acl.items.some((a:any)=>a.role==="owner"&&a.scope?.value===primary)||
      acl.items.some((a:any)=>a.role!=="none"&&(a.scope?.type!=="user"||![primary,WORK_CALENDAR_ID].includes(a.scope?.value))))
      return reject(409,"work_calendar_privacy_review_required");
    return {connected:true as const,summary:String(work.summary||"TalkHint — Work"),timeZone:WORK_TIMEZONE,
      bookingEnabled:false as const,mode:"read_only" as const,
      url:"https://calendar.google.com/calendar/u/0/r?cid="+encodeURIComponent(Buffer.from(WORK_CALENDAR_ID).toString("base64"))};
  }
  async availability(email:string,admin:boolean,settings:Settings,startLocal:string,durationMinutes:number){
    if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>480)return reject(400,"invalid_duration");
    const status=await this.status(email,admin);
    if(settings.timeZone!==status.timeZone)return reject(409,"business_timezone_must_match_calendar");
    const start=localInstant(startLocal),end=start+durationMinutes*60000,endLocal=local(end);
    if(start<this.now()||start>this.now()+366*86400000)return reject(400,"date_outside_check_window");
    const day=new Date(startLocal.slice(0,10)+"T12:00:00Z").getUTCDay();
    const basis={bookingConfirmed:false as const,checked:false,available:null as boolean|null,timeZone:WORK_TIMEZONE,startLocal,durationMinutes};
    if(!settings.business.days.includes(day)||startLocal.slice(11)<settings.business.opens||
      endLocal.slice(0,10)!==startLocal.slice(0,10)||endLocal.slice(11)>settings.business.closes)
      return {...basis,reason:"outside_working_hours"};
    const buffer=Math.max(30,settings.business.travelMinutes)*60000;
    const b=await this.json("/calendar/v3/freeBusy",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({timeMin:new Date(start-buffer).toISOString(),timeMax:new Date(end+buffer).toISOString(),
        timeZone:WORK_TIMEZONE,items:[{id:WORK_CALENDAR_ID}]})});
    const c=b.calendars?.[WORK_CALENDAR_ID];
    if(!c||c.errors?.length||!Array.isArray(c.busy))return reject(503,"availability_unknown");
    const intervals=c.busy.map((i:any)=>({start:Date.parse(i.start),end:Date.parse(i.end)}));
    if(intervals.some((i:any)=>!Number.isFinite(i.start)||!Number.isFinite(i.end)||i.end<=i.start))
      return reject(503,"availability_unknown");
    const available=!intervals.some((i:any)=>i.start<end+buffer&&i.end>start-buffer);
    return {...basis,checked:true,available,reason:available?"calendar_free_not_a_booking":"busy_or_travel_buffer",
      notice:"Calendar occupancy only. This is not a reservation or evidence that the requested service/duration/address is offered."};
  }
}
let sdk:ReplitConnectors|undefined;
export const workCalendar=new WorkCalendar((path,options)=> {
  sdk??=new ReplitConnectors();
  return sdk.proxy("google-calendar",path,{...options,connectionId:CONNECTION_ID});
});
