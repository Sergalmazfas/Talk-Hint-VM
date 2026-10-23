import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../db",()=>({db:{},dbReady:Promise.resolve(),pool:{query:vi.fn()}}));
vi.mock("../auth",()=>({
  loginUser:vi.fn(async(email:string,password:string)=>{if(password!=="test-password")throw Error();return{id:email==="other@example.test"?"other":"owner",email,language:"en"};}),
  getSessionUserId:vi.fn(async()=>undefined),
  authMiddleware:(_r:any,s:any)=>s.sendStatus(401),
}));
vi.mock("../storage",()=>({storage:{
  getUser:vi.fn(async(id:string)=>({id,email:id+"@example.test",language:"en",plan:null})),
  listKnowledgeCards:vi.fn(async(id:string)=>[
    {id:id+"-card",userId:id,title:"Work",body:"Approved facts",profileScope:"work"},
    {id:id+"-private",userId:id,title:"Private",body:"Private facts",profileScope:"personal"},
  ]),
  updateKnowledgeCardById:vi.fn(async(owner:string,id:string,fields:any)=>id===owner+"-card"?{id,userId:owner,...fields}:undefined),
  getUserPhoneNumbers:vi.fn(async(owner:string)=>[{id:owner+"-number",userId:owner,type:"work",twilioNumber:"+12025550123",name:"Work"}]),
}}));
vi.mock("../secretary/tasks",()=>({
  validateSecretaryInstruction:(v:string)=>v.length>0?v:null,
  validateSecretaryPhoneNumber:(v:string)=>/^\+1[2-9]\d{9}$/.test(v)?v:null,
  getLiveSecretaryTaskByClientRequest:vi.fn(async()=>undefined),
}));
const transport=vi.hoisted(()=>({dial:vi.fn(),sms:vi.fn(),push:vi.fn(),calendarWrite:vi.fn()}));
vi.mock("../chatgpt/secretary",()=>({secretaryBackend:()=>({
  history:async()=>[],tasks:async()=>[],call:async()=>{throw Object.assign(Error("Call not found"),{status:404});},
})}));
vi.mock("../incomingSecretary/runtime",()=>({incomingStore:{
  settings:vi.fn(async(_o:string,id:string)=>({numberId:id,cardIds:[],enabled:false,timeZone:""})),
  saveSettings:vi.fn(async()=>undefined),
}}));
vi.mock("../incomingSecretary/ownerCalendar",()=>({ownerCalendar:{
  status:async()=>({state:"setup_required",bookingEnabled:false,mode:"read_only"}),
}}));
import { registerMobileSecretary } from "./routes";
import { MobileStore, type RecordRow } from "./store";
class MemoryStore extends MobileStore {
  rows=new Map<string,RecordRow>();
  async get(id:string,owner?:string){const r=this.rows.get(id);return r&&r.expires>new Date()&&(!owner||r.owner===owner)?r:undefined;}
  async put(r:RecordRow){if(!this.rows.has(r.id))this.rows.set(r.id,structuredClone(r));return this.rows.get(r.id)!;}
  async remove(id:string,o:string){if((await this.get(id,o)))this.rows.delete(id);}
  async consume(id:string,o:string){if(!await this.get(id,o))return false;this.rows.delete(id);return true;}
  async list(o:string,k:string){return [...this.rows.values()].filter(r=>r.owner===o&&r.kind===k);}
  async transition(id:string,o:string,status:string){const r=await this.get(id,o);if(r?.kind==="task"&&r.payload.status==="prepared"){r.payload={...r.payload,status};return r;}}
  async claimLive(id:string,o:string,status:"starting"|"cancelled"){const r=await this.get(id,o);if(r?.kind==="live-review"&&r.payload.status==="prepared"){r.payload={...r.payload,status};return structuredClone(r);}}
  async linkLive(id:string,o:string,taskId:string){const r=await this.get(id,o);if(r?.kind==="live-review"&&r.payload.status==="starting")r.payload={...r.payload,taskId};}
}
let app:express.Express,store:MemoryStore;
const path="/api/mobile-secretary";
const assignment={clientRequestId:"c5f10f30-7c73-49e3-a9f6-75404c4ef111",recipient:"Demo company",phoneNumber:"+12025550123",instruction:"Ask their opening hours",cardIds:["owner-card"]};
async function login(other=false){const r=await request(app).post(path+"/login").send({email:other?"other@example.test":"owner@example.test",password:"test-password"});expect(r.status).toBe(200);return r.body.token as string;}
beforeEach(()=>{vi.stubEnv("NODE_ENV","development");store=new MemoryStore();app=express();app.use(express.json());registerMobileSecretary(app,store);vi.clearAllMocks();});
describe("isolated mobile Secretary Dev client",()=>{
  it("requires scoped credentials and denies foreign origins",async()=>{
    expect((await request(app).get(path+"/me")).status).toBe(401);
    expect((await request(app).get(path+"/me").set("Authorization","Bearer ordinary-session")).status).toBe(401);
    expect((await request(app).post(path+"/login").set("Origin","https://attacker.test").send({})).status).toBe(403);
  });
  it("logs in, rotates and revokes scoped sessions",async()=>{
    const t=await login();expect(t).toMatch(/^thmobile\./);
    expect((await request(app).get(path+"/me").auth(t,{type:"bearer"})).body.model.model).toBe("gpt-live-1");
    const r=await request(app).post(path+"/refresh").auth(t,{type:"bearer"}).send({});
    expect(r.status).toBe(200);expect(r.body.token).not.toBe(t);
    expect((await request(app).get(path+"/me").auth(t,{type:"bearer"})).status).toBe(401);
    expect((await request(app).post(path+"/logout").auth(r.body.token,{type:"bearer"}).send({})).status).toBe(200);
    expect((await request(app).get(path+"/me").auth(r.body.token,{type:"bearer"})).status).toBe(401);
  });
  it("preserves one TEST on concurrent confirmation, retry and fresh router restart",async()=>{
    const t=await login(),p=await request(app).post(path+"/prepare").auth(t,{type:"bearer"}).send(assignment);
    expect(p.status).toBe(200);expect(p.body.status).toBe("prepared");
    const replies=await Promise.all(Array.from({length:5},()=>request(app).post(path+`/test-tasks/${p.body.id}/confirm`).auth(t,{type:"bearer"}).send({})));
    expect(replies.every(r=>r.status===200&&r.body.task.status==="completed")).toBe(true);
    expect((await store.list("owner","task")).length).toBe(1);
    const next=express();next.use(express.json());registerMobileSecretary(next,store);
    const recovered=await request(next).get(path+`/test-tasks/${p.body.id}`).auth(t,{type:"bearer"});
    expect(recovered.body.task.id).toBe(p.body.id);
    const retry=await request(next).post(path+"/prepare").auth(t,{type:"bearer"}).send(assignment);
    expect(retry.body.id).toBe(p.body.id);expect(retry.body.status).toBe("completed");
    expect(transport.dial).not.toHaveBeenCalled();expect(transport.sms).not.toHaveBeenCalled();expect(transport.push).not.toHaveBeenCalled();expect(transport.calendarWrite).not.toHaveBeenCalled();
  });
  it("forbids foreign cards, edits, profiles, tasks and history",async()=>{
    const a=await login(),b=await login(true);
    expect((await request(app).post(path+"/prepare").auth(b,{type:"bearer"}).send(assignment)).status).toBe(403);
    expect((await request(app).patch(path+"/cards/owner-card").auth(b,{type:"bearer"}).send({title:"bad",body:"bad",profileScope:"work"})).status).toBe(404);
    expect((await request(app).put(path+"/profiles/owner-number/cards").auth(b,{type:"bearer"}).send({cardIds:[]})).status).toBe(404);
    const p=await request(app).post(path+"/prepare").auth(a,{type:"bearer"}).send(assignment);
    expect((await request(app).post(path+`/test-tasks/${p.body.id}/confirm`).auth(b,{type:"bearer"}).send({})).status).toBe(404);
    expect((await request(app).get(path+"/history/foreign").auth(b,{type:"bearer"})).status).toBe(404);
  });
  it("rejects changed assignments and expired reviews; cancelled tasks stay cancelled",async()=>{
    const t=await login(),p=await request(app).post(path+"/prepare").auth(t,{type:"bearer"}).send(assignment);
    expect((await request(app).post(path+"/prepare").auth(t,{type:"bearer"}).send({...assignment,instruction:"Different"})).status).toBe(409);
    const row=await store.get(p.body.id);row!.payload.expiresAt=new Date(0).toISOString();
    expect((await request(app).post(path+`/test-tasks/${p.body.id}/confirm`).auth(t,{type:"bearer"}).send({})).status).toBe(410);
    row!.payload.expiresAt=new Date(Date.now()+50000).toISOString();
    await request(app).post(path+`/test-tasks/${p.body.id}/cancel`).auth(t,{type:"bearer"}).send({});
    expect((await request(app).post(path+`/test-tasks/${p.body.id}/confirm`).auth(t,{type:"bearer"}).send({})).body.task.status).toBe("cancelled");
  });
  it("mounts scoped APIs in production, but keeps guest access closed",async()=>{
    vi.stubEnv("NODE_ENV","production");const prod=express();registerMobileSecretary(prod,store);
    expect((await request(prod).get(path+"/me")).status).toBe(401);
    expect((await request(prod).get("/secretary-preview/")).status).toBe(404);
  });
  it("returns real model and unavailable booking, never fake calendar authorization",async()=>{
    const t=await login();
    const r=await request(app).get(path+"/calendar/owner-number").auth(t,{type:"bearer"});
    expect(r.body).toMatchObject({bookingEnabled:false,mode:"read_only"});
    expect((await request(app).post(path+"/calendar/owner-number/connect").auth(t,{type:"bearer"}).send({})).status).toBe(409);
  });
  it("permits incoming disclosure only for owned Work cards, never shared/private/foreign or activation fields",async()=>{
    const t=await login();
    for(const cardIds of [["owner-private"],["other-card"]])expect(
      (await request(app).put(path+"/profiles/owner-number/cards").auth(t,{type:"bearer"}).send({cardIds})).status
    ).toBe(403);
    expect((await request(app).put(path+"/profiles/owner-number/cards").auth(t,{type:"bearer"}).send({cardIds:["owner-card"],enabled:true})).status).toBe(400);
    const result=await request(app).put(path+"/profiles/owner-number/cards").auth(t,{type:"bearer"}).send({cardIds:["owner-card"]});
    expect(result.status).toBe(200);expect(result.body.activationChanged).toBe(false);expect(result.body.settings.enabled).toBe(false);
  });
  it("fails closed when durable storage rejects preparation",async()=>{
    const t=await login();
    const original=store.put.bind(store);
    vi.spyOn(store,"put").mockImplementation(async r=>{if(r.kind==="task")throw Error("Write failed");return original(r);});
    const result=await request(app).post(path+"/prepare").auth(t,{type:"bearer"}).send(assignment);
    expect(result.status).toBe(503);
    expect((await store.list("owner","task")).length).toBe(0);
  });
});

describe("mobile confirmed live calls reuse the existing engine",()=>{
  let deps:any,created:Map<string,any>;
  beforeEach(()=>{
    created=new Map();
    deps={backend:{
      start:vi.fn(async(userId:string,input:any)=>{
        const task={id:"engine-task",userId,status:"starting",...input,summary:null,transcript:""};
        created.set(input.clientRequestId,task);return{task,reused:false};
      }),
      task:vi.fn(async(_owner:string,id:string)=>[...created.values()].find(t=>t.id===id)),
    },lookup:vi.fn(async(_owner:string,id:string)=>created.get(id))};
    app=express();app.use(express.json());registerMobileSecretary(app,store,deps);
  });
  it("requires exact real-call consent and never starts during preparation or GET",async()=>{
    const t=await login(),p=await request(app).post(path+"/live/prepare").auth(t,{type:"bearer"}).send(assignment);
    expect(p.status).toBe(200);expect(p.body.testOnly).toBe(false);
    await request(app).get(path+`/live-reviews/${encodeURIComponent(p.body.id)}`).auth(t,{type:"bearer"});
    expect(deps.backend.start).not.toHaveBeenCalled();
    expect((await request(app).post(path+`/live-reviews/${encodeURIComponent(p.body.id)}/confirm`).auth(t,{type:"bearer"}).send({})).status).toBe(400);
    expect(deps.backend.start).not.toHaveBeenCalled();
  });
  it("starts only once on parallel confirm, retry and restart with exact approved context",async()=>{
    const t=await login(),p=await request(app).post(path+"/live/prepare").auth(t,{type:"bearer"}).send(assignment);
    const confirm=()=>request(app).post(path+`/live-reviews/${encodeURIComponent(p.body.id)}/confirm`).auth(t,{type:"bearer"}).send({confirmRealCall:true});
    const results=await Promise.all(Array.from({length:6},confirm));
    expect(results.every(r=>r.status===200)).toBe(true);expect(deps.backend.start).toHaveBeenCalledTimes(1);
    const sent=deps.backend.start.mock.calls[0][1];
    expect(sent).toMatchObject({voiceProvider:"openai",phoneNumber:assignment.phoneNumber,clientRequestId:assignment.clientRequestId});
    expect(sent.instruction).toContain("Approved facts");expect(sent.instruction).not.toContain("Private facts");
    app=express();app.use(express.json());registerMobileSecretary(app,store,deps);
    expect((await confirm()).body.task.taskId).toBe("engine-task");
    expect(deps.backend.start).toHaveBeenCalledTimes(1);
    expect((await request(app).post(path+"/live/prepare").auth(t,{type:"bearer"}).send({...assignment,phoneNumber:"+12025550124"})).status).toBe(409);
  });
  it("blocks foreign users, foreign cards, expired and cancelled review starts",async()=>{
    const t=await login(),other=await login(true);
    expect((await request(app).post(path+"/live/prepare").auth(other,{type:"bearer"}).send(assignment)).status).toBe(403);
    const p=await request(app).post(path+"/live/prepare").auth(t,{type:"bearer"}).send(assignment);
    const endpoint=path+`/live-reviews/${encodeURIComponent(p.body.id)}`;
    expect((await request(app).post(endpoint+"/confirm").auth(other,{type:"bearer"}).send({confirmRealCall:true})).status).toBe(404);
    (await store.get(p.body.id))!.payload.expiresAt=new Date(0).toISOString();
    expect((await request(app).post(endpoint+"/confirm").auth(t,{type:"bearer"}).send({confirmRealCall:true})).status).toBe(410);
    (await store.get(p.body.id))!.payload.expiresAt=new Date(Date.now()+50000).toISOString();
    await request(app).post(endpoint+"/cancel").auth(t,{type:"bearer"}).send({});
    expect((await request(app).post(endpoint+"/confirm").auth(t,{type:"bearer"}).send({confirmRealCall:true})).body.task.status).toBe("cancelled");
    expect(deps.backend.start).not.toHaveBeenCalled();
  });
  it("recovers a saved engine task after acknowledgement failure without redial",async()=>{
    const t=await login(),p=await request(app).post(path+"/live/prepare").auth(t,{type:"bearer"}).send(assignment);
    const original=store.linkLive.bind(store);
    vi.spyOn(store,"linkLive").mockRejectedValueOnce(Error("Temporary write failure")).mockImplementation(original);
    const endpoint=path+`/live-reviews/${encodeURIComponent(p.body.id)}`;
    await request(app).post(endpoint+"/confirm").auth(t,{type:"bearer"}).send({confirmRealCall:true});
    expect((await request(app).get(endpoint).auth(t,{type:"bearer"})).body.task.taskId).toBe("engine-task");
    await request(app).post(endpoint+"/confirm").auth(t,{type:"bearer"}).send({confirmRealCall:true});
    expect(deps.backend.start).toHaveBeenCalledTimes(1);
  });
  it("does not retry an ambiguous start that never returned a task",async()=>{
    deps.backend.start.mockRejectedValue(Error("Transport timeout"));
    const t=await login(),p=await request(app).post(path+"/live/prepare").auth(t,{type:"bearer"}).send(assignment);
    const endpoint=path+`/live-reviews/${encodeURIComponent(p.body.id)}/confirm`;
    expect((await request(app).post(endpoint).auth(t,{type:"bearer"}).send({confirmRealCall:true})).status).toBe(202);
    await request(app).post(endpoint).auth(t,{type:"bearer"}).send({confirmRealCall:true});
    expect(deps.backend.start).toHaveBeenCalledTimes(1);
  });
});
