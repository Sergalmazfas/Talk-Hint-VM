import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../db",()=>({pool:null}));
import { CalendarVault, OwnerCalendar, CALENDAR_SCOPES, calendarConfig, calendarHash } from "./ownerCalendar";
import type { CalendarAttempt, CalendarGrant, OwnerCalendarStore } from "./ownerCalendarStore";

// Deterministic store reproduces single-use/expiry/CAS semantics without Google.
class Memory implements OwnerCalendarStore {
  grants=new Map<string,CalendarGrant>();
  attempts=new Map<string,{hash:string;browser:string;value:CalendarAttempt;expires:number;used:boolean}>();
  private key(owner:string,id:string){return JSON.stringify([owner,id]);}
  async get(o:string,n:string){return this.grants.get(this.key(o,n));}
  async begin(hash:string,browser:string,value:CalendarAttempt) {
    this.attempts.set(this.key(value.owner,value.numberId),{hash,browser,value,expires:Date.now()+600000,used:false});
  }
  async consume(hash:string,browser:string) {
    const a=Array.from(this.attempts.values()).find(x=>x.hash===hash&&x.browser===browser&&!x.used&&x.expires>Date.now());
    if(a){a.used=true;return a.value;}
  }
  async finish(hash:string,g:CalendarGrant) {
    const k=this.key(g.owner,g.numberId),a=this.attempts.get(k);
    if(!a||a.hash!==hash||!a.used||a.expires<=Date.now())return false;
    this.grants.set(k,g);this.attempts.delete(k);return true;
  }
  async select(g:CalendarGrant,id:string) {
    const k=this.key(g.owner,g.numberId),current=this.grants.get(k);
    if(current?.revision!==g.revision)return false;
    this.grants.set(k,{...current,calendarId:id});return true;
  }
  async disconnect(o:string,n:string){this.grants.delete(this.key(o,n));this.attempts.delete(this.key(o,n));}
}
const config={clientId:"test-client",clientSecret:"test-secret",redirectUri:"https://app.example.test/api/incoming-secretary/calendar/oauth/callback",key:"a".repeat(64)};
const owned={id:"work@group.calendar.google.com",summary:"Work",timeZone:"Europe/London",accessRole:"owner"};
const primary={id:"google-owner@example.test",primary:true,accessRole:"owner",timeZone:"Europe/London"};
function setup() {
  const store=new Memory();
  const http=vi.fn(async(url:any,init?:RequestInit)=>{
    if(String(url)==="https://oauth2.googleapis.com/token")return Response.json({access_token:"test-access",refresh_token:"test-refresh",scope:CALENDAR_SCOPES.join(" ")});
    return Response.json({items:[primary,owned,{...owned,id:"shared",accessRole:"writer"}]});
  });
  const service=new OwnerCalendar(store,()=>config,http as typeof fetch);
  const consent=async(owner="alice",number="work",browser="browser")=>{
    const url=new URL(await service.connect(owner,number,browser));
    return {state:url.searchParams.get("state")!,browser,url};
  };
  const authorize=async()=>{
    const a=await consent();await service.callback(a.state,a.browser,"code",async()=>true);return a;
  };
  return {store,http,service,consent,authorize};
}
afterEach(()=>vi.unstubAllEnvs());
describe("owner calendar authorization boundary",()=>{
  it("uses narrow read-only scopes, PKCE and encrypted verifier, never a project connection",async()=>{
    const x=setup(),a=await x.consent();
    expect(a.url.origin).toBe("https://accounts.google.com");
    expect(a.url.searchParams.get("scope")?.split(" ")).toEqual(CALENDAR_SCOPES);
    expect(a.url.searchParams.get("code_challenge_method")).toBe("S256");
    const stored=Array.from(x.store.attempts.values())[0];
    expect(stored.hash).toBe(calendarHash(a.state));expect(stored.browser).toBe(calendarHash("browser"));
    expect(stored.value.secret).not.toContain("verifier");
    expect(x.http).not.toHaveBeenCalled();
  });
  it("rejects foreign browsers, tampered and replayed state before exchanging tokens",async()=>{
    const x=setup(),a=await x.consent();
    await expect(x.service.callback(a.state,"attacker","code",async()=>true)).rejects.toMatchObject({code:"invalid_calendar_oauth_state"});
    await expect(x.service.callback("tampered",a.browser,"code",async()=>true)).rejects.toMatchObject({code:"invalid_calendar_oauth_state"});
    expect(x.http).not.toHaveBeenCalled();
    await x.service.callback(a.state,a.browser,"code",async()=>true);
    x.http.mockClear();
    await expect(x.service.callback(a.state,a.browser,"code",async()=>true)).rejects.toMatchObject({code:"invalid_calendar_oauth_state"});
    expect(x.http).not.toHaveBeenCalled();
  });
  it("expires state and invalidates previous attempts",async()=>{
    const x=setup(),a=await x.consent();await x.consent();
    await expect(x.service.callback(a.state,a.browser,"code",async()=>true)).rejects.toMatchObject({code:"invalid_calendar_oauth_state"});
    const b=await x.consent();Array.from(x.store.attempts.values())[0].expires=Date.now()-1;
    await expect(x.service.callback(b.state,b.browser,"code",async()=>true)).rejects.toMatchObject({code:"invalid_calendar_oauth_state"});
    expect(x.http).not.toHaveBeenCalled();
  });
  it("denied consent consumes state without granting anything",async()=>{
    const x=setup(),a=await x.consent();
    await expect(x.service.callback(a.state,a.browser,undefined,async()=>true)).rejects.toMatchObject({code:"calendar_authorization_denied"});
    expect(x.store.grants.size).toBe(0);expect(x.http).not.toHaveBeenCalled();
    await expect(x.service.callback(a.state,a.browser,"code",async()=>true)).rejects.toMatchObject({code:"invalid_calendar_oauth_state"});
  });
  it("rechecks actual profile ownership before Google and before saving a grant",async()=>{
    const x=setup(),a=await x.consent();
    await expect(x.service.callback(a.state,a.browser,"code",async()=>false)).rejects.toMatchObject({code:"work_profile_not_found"});
    expect(x.http).not.toHaveBeenCalled();
    const b=await x.consent(),owns=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(x.service.callback(b.state,b.browser,"code",owns)).rejects.toMatchObject({code:"calendar_connection_changed"});
    expect(x.store.grants.size).toBe(0);
  });
  it("requires all scopes and a durable refresh token",async()=>{
    const x=setup(),a=await x.consent();
    x.http.mockResolvedValueOnce(Response.json({access_token:"test",scope:CALENDAR_SCOPES.join(" ")}));
    await expect(x.service.callback(a.state,a.browser,"code",async()=>true)).rejects.toMatchObject({code:"calendar_permissions_required"});
    expect(x.store.grants.size).toBe(0);
    const b=await x.consent();x.http.mockResolvedValueOnce(Response.json({access_token:"test",refresh_token:"test",scope:CALENDAR_SCOPES[0]}));
    await expect(x.service.callback(b.state,b.browser,"code",async()=>true)).rejects.toMatchObject({code:"calendar_permissions_required"});
  });
  it("stores an encrypted owner-bound grant and requires an explicit selection",async()=>{
    const x=setup();await x.authorize();
    const g=await x.store.get("alice","work");expect(g?.secret).not.toContain("test-refresh");
    expect(g?.calendarId).toBeNull();
    expect(await x.service.status("alice","work")).toMatchObject({state:"selection_required",bookingEnabled:false,mode:"read_only"});
    expect(await x.service.status("bob","work")).toMatchObject({state:"disconnected"});
    expect(await x.service.status("alice","personal")).toMatchObject({state:"disconnected"});
    expect(await x.service.calendars("alice","work")).toEqual({calendars:[{id:owned.id,summary:"Work",timeZone:"Europe/London"}]});
    await expect(x.service.select("alice","work","primary")).rejects.toMatchObject({code:"owned_work_calendar_required"});
    await expect(x.service.select("alice","work",primary.id)).rejects.toMatchObject({code:"owned_work_calendar_required"});
    await expect(x.service.select("alice","work","shared")).rejects.toMatchObject({code:"owned_work_calendar_required"});
    expect(await x.service.select("alice","work",owned.id)).toMatchObject({state:"connected",calendar:{id:owned.id}});
    for(const [url,init] of x.http.mock.calls) {
      expect(String(url)).not.toContain("/events");
      if(String(url).includes("www.googleapis.com"))expect(init?.method??"GET").toBe("GET");
    }
  });
  it("validates owner identity and current calendar permissions on every status",async()=>{
    const x=setup();await x.authorize();await x.service.select("alice","work",owned.id);
    x.http.mockResolvedValueOnce(Response.json({access_token:"fresh"}))
      .mockResolvedValueOnce(Response.json({items:[primary,{...owned,accessRole:"reader"}]}));
    expect(await x.service.status("alice","work")).toMatchObject({state:"reconnect_required"});
    x.http.mockResolvedValueOnce(Response.json({access_token:"fresh"}))
      .mockResolvedValueOnce(Response.json({items:[{...primary,id:"different@example.test"},owned]}));
    expect(await x.service.status("alice","work")).toMatchObject({state:"reconnect_required"});
    x.http.mockResolvedValueOnce(Response.json({error:"invalid_grant"},{status:400}));
    expect(await x.service.status("alice","work")).toMatchObject({state:"reconnect_required"});
  });
  it("fails explicitly on outages rather than serving cached connected state",async()=>{
    const x=setup();await x.authorize();
    x.http.mockRejectedValueOnce(new Error("network"));
    await expect(x.service.status("alice","work")).rejects.toMatchObject({status:503,code:"calendar_unavailable"});
  });
  it("paginates and rejects incomplete/repeated pagination",async()=>{
    const x=setup();await x.authorize();
    x.http.mockResolvedValueOnce(Response.json({access_token:"fresh"}))
      .mockResolvedValueOnce(Response.json({items:[primary],nextPageToken:"two"}))
      .mockResolvedValueOnce(Response.json({items:[owned]}));
    expect((await x.service.calendars("alice","work")).calendars).toHaveLength(1);
    x.http.mockResolvedValueOnce(Response.json({access_token:"fresh"}))
      .mockResolvedValueOnce(Response.json({items:[primary],nextPageToken:"two"}))
      .mockResolvedValueOnce(Response.json({items:[],nextPageToken:"two"}));
    await expect(x.service.calendars("alice","work")).rejects.toMatchObject({code:"calendar_pagination_failed"});
  });
  it("disconnects locally even during an in-flight token exchange; never revokes another grant",async()=>{
    const x=setup(),a=await x.consent();
    const original=x.http.getMockImplementation()!;
    x.http.mockImplementationOnce(async(url,init)=>{
      await x.service.disconnect("alice","work");
      return original(url,init);
    });
    await expect(x.service.callback(a.state,a.browser,"code",async()=>true)).rejects.toMatchObject({code:"calendar_connection_changed"});
    expect(x.store.grants.size).toBe(0);
    await x.authorize();
    x.http.mockClear();
    await x.service.disconnect("alice","work");
    expect(x.http).not.toHaveBeenCalled();
    expect(await x.service.status("alice","work")).toMatchObject({state:"disconnected"});
  });
  it("disconnecting one owner leaves other owners untouched",async()=>{
    const x=setup();await x.authorize();
    const b=await x.consent("bob","bob-work","bob-browser");
    await x.service.callback(b.state,b.browser,"code",async()=>true);
    await x.service.disconnect("alice","work");
    expect(await x.store.get("bob","bob-work")).toBeDefined();
  });
});
it("encryption rejects tampering, foreign users, profiles and wrong keys",()=>{
  const v=new CalendarVault(config.key),secret=v.seal("alice","work",{refreshToken:"test"});
  expect(v.open("alice","work",secret)).toEqual({refreshToken:"test"});
  for(const [owner,number] of [["bob","work"],["alice","personal"]])
    expect(()=>v.open(owner,number,secret)).toThrow("calendar_reconnect_required");
  expect(()=>v.open("alice","work","corrupt")).toThrow("calendar_reconnect_required");
  expect(()=>new CalendarVault("b".repeat(64)).open("alice","work",secret)).toThrow("calendar_reconnect_required");
});
it("has no fallback when per-owner OAuth is not configured",async()=>{
  const x=setup(),service=new OwnerCalendar(x.store,()=>undefined,x.http as typeof fetch);
  expect(await service.status("alice","work")).toMatchObject({state:"setup_required",bookingEnabled:false});
  await expect(service.connect("alice","work","browser")).rejects.toMatchObject({code:"calendar_setup_required"});
  expect(x.http).not.toHaveBeenCalled();
});
it("accepts only complete secure callback configuration",()=>{
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID",config.clientId);vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET",config.clientSecret);
  vi.stubEnv("GOOGLE_CALENDAR_REDIRECT_URI",config.redirectUri);vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",config.key);
  expect(calendarConfig()).toEqual(config);
  for(const uri of ["http://app.test/api/incoming-secretary/calendar/oauth/callback",config.redirectUri+"?x=1","https://user:pass@app.test/api/incoming-secretary/calendar/oauth/callback","https://app.test/wrong"]) {
    vi.stubEnv("GOOGLE_CALENDAR_REDIRECT_URI",uri);expect(calendarConfig()).toBeUndefined();
  }
});
