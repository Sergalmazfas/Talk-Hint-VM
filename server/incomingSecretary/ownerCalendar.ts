import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { CalendarError } from "./workCalendar";
import { validTimezone } from "./policy";
import { PgOwnerCalendarStore, type OwnerCalendarStore, type CalendarGrant } from "./ownerCalendarStore";

const SCOPE_LIST="https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const SCOPE_BUSY="https://www.googleapis.com/auth/calendar.events.freebusy";
export const CALENDAR_SCOPES=[SCOPE_LIST,SCOPE_BUSY];
export const CALLBACK_PATH="/api/incoming-secretary/calendar/oauth/callback";
export const calendarHash=(v:string)=>createHash("sha256").update(v).digest("hex");
const fail=(status:number,code:string):never=>{throw new CalendarError(status,code);};
type Config={clientId:string;clientSecret:string;redirectUri:string;key:string};
type Credential={refreshToken:string;account:string};
type Calendar={id:string;summary:string;timeZone:string};
export function calendarConfig():Config|undefined {
  const clientId=process.env.GOOGLE_CALENDAR_CLIENT_ID,clientSecret=process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri=process.env.GOOGLE_CALENDAR_REDIRECT_URI,key=process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if(!clientId||!clientSecret||!redirectUri||!key||!/^[a-fA-F0-9]{64}$/.test(key))return;
  try {
    const u=new URL(redirectUri);
    if(u.protocol!=="https:"||u.pathname!==CALLBACK_PATH||u.search||u.hash||u.username||u.password)return;
    return {clientId,clientSecret,redirectUri,key};
  } catch { return; }
}
/** Purpose + owner + Work profile bound encryption. No project connector fallback. */
export class CalendarVault {
  constructor(private key:string) {}
  seal(owner:string,numberId:string,value:unknown) {
    const iv=randomBytes(12),c=createCipheriv("aes-256-gcm",Buffer.from(this.key,"hex"),iv);
    c.setAAD(Buffer.from(JSON.stringify(["secretary-calendar-v1",owner,numberId])));
    return [iv,Buffer.concat([c.update(JSON.stringify(value),"utf8"),c.final()]),c.getAuthTag()].map(x=>x.toString("base64url")).join(".");
  }
  open<T>(owner:string,numberId:string,value:string):T {
    try {
      const [iv,body,tag,...extra]=value.split(".");if(extra.length)throw new Error();
      const c=createDecipheriv("aes-256-gcm",Buffer.from(this.key,"hex"),Buffer.from(iv,"base64url"));
      c.setAAD(Buffer.from(JSON.stringify(["secretary-calendar-v1",owner,numberId])));
      c.setAuthTag(Buffer.from(tag,"base64url"));
      return JSON.parse(Buffer.concat([c.update(Buffer.from(body,"base64url")),c.final()]).toString());
    } catch { return fail(409,"calendar_reconnect_required"); }
  }
}
export class OwnerCalendar {
  constructor(readonly store:OwnerCalendarStore=new PgOwnerCalendarStore(),
    private config:()=>Config|undefined=calendarConfig,private fetcher:typeof fetch=fetch) {}
  private configured(){return this.config()??fail(503,"calendar_setup_required");}
  private vault(){return new CalendarVault(this.configured().key);}
  private async request(url:string,init?:RequestInit):Promise<any> {
    let r:Response;
    try { r=await this.fetcher(url,{...init,signal:AbortSignal.timeout(10000),redirect:"error"}); }
    catch { return fail(503,"calendar_unavailable"); }
    if(!r.ok) {
      if(r.status===401||r.status===403)return fail(409,"calendar_reconnect_required");
      if(r.status===400&&url==="https://oauth2.googleapis.com/token")return fail(409,"calendar_reconnect_required");
      return fail(503,"calendar_unavailable");
    }
    try {return await r.json();} catch {return fail(503,"invalid_calendar_response");}
  }
  async connect(owner:string,numberId:string,browser:string) {
    const c=this.configured(),state=randomBytes(32).toString("base64url"),verifier=randomBytes(32).toString("base64url");
    await this.store.begin(calendarHash(state),calendarHash(browser),{owner,numberId,secret:this.vault().seal(owner,numberId,{verifier})});
    const q=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:"code",
      scope:CALENDAR_SCOPES.join(" "),state,code_challenge:Buffer.from(calendarHash(verifier),"hex").toString("base64url"),
      code_challenge_method:"S256",access_type:"offline",prompt:"consent select_account"});
    return "https://accounts.google.com/o/oauth2/v2/auth?"+q;
  }
  async callback(state:string,browser:string,code:string|undefined,owns:(owner:string,numberId:string)=>Promise<boolean>) {
    const a=await this.store.consume(calendarHash(state),calendarHash(browser));
    if(!a)return fail(400,"invalid_calendar_oauth_state");
    if(!code)return fail(400,"calendar_authorization_denied");
    if(!await owns(a.owner,a.numberId))return fail(404,"work_profile_not_found");
    const c=this.configured(),v=this.vault(),{verifier}=v.open<{verifier:string}>(a.owner,a.numberId,a.secret);
    const t=await this.request("https://oauth2.googleapis.com/token",{method:"POST",
      body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:c.redirectUri,
        code,code_verifier:verifier,grant_type:"authorization_code"})});
    if(typeof t.refresh_token!=="string"||typeof t.access_token!=="string"||
      !CALENDAR_SCOPES.every(s=>typeof t.scope==="string"&&t.scope.split(" ").includes(s)))return fail(409,"calendar_permissions_required");
    const {account}=await this.list(t.access_token);
    const grant:CalendarGrant={owner:a.owner,numberId:a.numberId,calendarId:null,revision:randomUUID(),
      secret:v.seal(a.owner,a.numberId,{refreshToken:t.refresh_token,account})};
    if(!await owns(a.owner,a.numberId)||!await this.store.finish(calendarHash(state),grant))return fail(409,"calendar_connection_changed");
  }
  private async access(g:CalendarGrant) {
    const c=this.configured(),credential=this.vault().open<Credential>(g.owner,g.numberId,g.secret);
    const t=await this.request("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({
      client_id:c.clientId,client_secret:c.clientSecret,refresh_token:credential.refreshToken,grant_type:"refresh_token"})});
    if(typeof t.access_token!=="string")return fail(409,"calendar_reconnect_required");
    return {token:t.access_token,credential};
  }
  private async list(token:string) {
    const calendars:Calendar[]=[],seen=new Set<string>();let page:string|undefined,account:string|undefined;
    do {
      const q=new URLSearchParams({maxResults:"250",fields:"items(id,primary,accessRole,summary,timeZone,deleted),nextPageToken"});
      if(page)q.set("pageToken",page);
      const b=await this.request("https://www.googleapis.com/calendar/v3/users/me/calendarList?"+q,{headers:{Authorization:`Bearer ${token}`}});
      if(!Array.isArray(b.items))return fail(503,"invalid_calendar_response");
      for(const x of b.items) {
        if(x.primary===true&&x.accessRole==="owner"&&typeof x.id==="string")account=x.id;
        if(!x.deleted&&!x.primary&&x.accessRole==="owner"&&typeof x.id==="string"&&validTimezone(x.timeZone))
          calendars.push({id:x.id,summary:typeof x.summary==="string"?x.summary:"Work",timeZone:x.timeZone});
      }
      page=b.nextPageToken;
      if(page){if(typeof page!=="string"||seen.has(page)||seen.size>=100)return fail(503,"calendar_pagination_failed");seen.add(page);}
    }while(page);
    if(!account)return fail(409,"calendar_owner_required");
    return {account,calendars};
  }
  private async verified(g:CalendarGrant) {
    const {token,credential}=await this.access(g),list=await this.list(token);
    if(list.account!==credential.account)return fail(409,"calendar_reconnect_required");
    return {...list,token};
  }
  private async grant(owner:string,numberId:string) {
    return await this.store.get(owner,numberId)??fail(409,"calendar_not_connected");
  }
  async status(owner:string,numberId:string) {
    const base={mode:"read_only" as const,bookingEnabled:false as const};
    if(!this.config())return {...base,state:"setup_required"};
    const g=await this.store.get(owner,numberId);
    if(!g)return {...base,state:"disconnected"};
    try {
      const {calendars,account}=await this.verified(g);
      if(!g.calendarId)return {...base,state:"selection_required",account};
      const calendar=calendars.find(x=>x.id===g.calendarId);
      if(!calendar)return {...base,state:"reconnect_required"};
      return {...base,state:"connected",account,calendar:{...calendar,
        url:"https://calendar.google.com/calendar/u/0/r?cid="+encodeURIComponent(Buffer.from(calendar.id).toString("base64"))}};
    } catch(e) {
      if(e instanceof CalendarError&&e.status===409)return {...base,state:"reconnect_required"};
      throw e;
    }
  }
  async calendars(owner:string,numberId:string) {
    const {calendars}=await this.verified(await this.grant(owner,numberId));return {calendars};
  }
  async select(owner:string,numberId:string,calendarId:string) {
    const g=await this.grant(owner,numberId),{calendars}=await this.verified(g);
    if(!calendars.some(x=>x.id===calendarId))return fail(403,"owned_work_calendar_required");
    if(!await this.store.select(g,calendarId))return fail(409,"calendar_connection_changed");
    return this.status(owner,numberId);
  }
  async disconnect(owner:string,numberId:string) {
    // Delete locally first. No global Google revocation: it may revoke another Work profile's grant.
    await this.store.disconnect(owner,numberId);
    return {state:"disconnected",mode:"read_only",bookingEnabled:false};
  }
}
export const ownerCalendar=new OwnerCalendar();
