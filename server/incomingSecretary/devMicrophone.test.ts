import express from "express";
import request from "supertest";
import { EventEmitter } from "node:events";
import { beforeEach,afterEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({voices:0,liveVoices:0,instructions:""}));
vi.mock("../db",()=>({pool:null,db:{}}));
vi.mock("../benchmark/adminGate",()=>({isBenchmarkAdmin:()=>true}));
vi.mock("./devNotifications",()=>({incomingDevNotifications:async()=>({credentialsUsable:false,issues:[],deliveryTested:false})}));
vi.mock("../storage",()=>({storage:{
  getPhoneNumber:async(id:string)=>({id,userId:id==="other-work"?"other":"owner",type:id==="personal"?"personal":"work"}),
  listKnowledgeCards:async()=>[
    {id:"approved",userId:"owner",profileScope:"work",title:"Allowed",body:"Future service"},
    {id:"not-approved",userId:"owner",profileScope:"work",title:"NO",body:"Unapproved secret"},
    {id:"shared",userId:"owner",profileScope:"shared",title:"Shared",body:"Shared secret"},
    {id:"personal",userId:"owner",profileScope:"personal",title:"Personal",body:"Personal secret"},
    {id:"foreign",userId:"other",profileScope:"work",title:"Other",body:"Foreign secret"},
  ],
}}));
vi.mock("./devConversation",()=>({DevConversation:class {
  closed=false;
  constructor(readonly session:any,instructions:string,_p:any){mocks.instructions=instructions;mocks.voices++;}
  async start(){}
  input(){}
  async stop(reason:string){this.closed=true;await this.session.end(reason);}
}}));
vi.mock("./liveConversation",()=>({LiveConversation:class{
  closed=false;
  constructor(readonly session:any,instructions:string,_p:any){mocks.instructions=instructions;mocks.liveVoices++;mocks.voices++;}
  async start(){}
  input(){}
  async stop(reason:string){this.closed=true;await this.session.end(reason);}
}}));
import { registerIncomingDevRoutes,handleIncomingDevSocket,incomingDevStore } from "./devMicrophone";
import { MemoryRequests } from "./store";
import { defaults } from "./policy";
import { incomingRevocations } from "./revocation";
const app=express();app.use(express.json());const ids:string[]=[];
registerIncomingDevRoutes(app,(req:any,res,next)=>{const owner=req.get("x-owner");if(!owner)return res.sendStatus(401);req.user={id:owner,email:"bench@example.invalid"};next();});
class Peer extends EventEmitter{
  readyState=1;bufferedAmount=0;sent:any[]=[];
  send(s:string){this.sent.push(JSON.parse(s));}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit("close");}
  message(e:object){this.emit("message",Buffer.from(JSON.stringify(e)));}
}
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","development");mocks.voices=0;mocks.liveVoices=0;mocks.instructions="";
  const memory=new MemoryRequests();
  vi.spyOn(incomingDevStore,"settings").mockImplementation(async(_owner,id)=>({...defaults(id),cardIds:["approved","shared","foreign","personal"],timeZone:"America/New_York"}));
  vi.spyOn(incomingDevStore,"begin").mockImplementation((...args)=>memory.begin(...args));
  vi.spyOn(incomingDevStore,"update").mockImplementation((...args)=>memory.update(...args));
  vi.spyOn(incomingDevStore,"list").mockImplementation(async(owner)=>Array.from(memory.records.values()).filter(r=>r.userId===owner));
});
afterEach(async()=>{
  for(const id of ids.splice(0))await request(app).post(`/api/incoming-secretary/dev/sessions/${id}/stop`).set("x-owner","owner").send({});
  vi.restoreAllMocks();vi.unstubAllEnvs();
});
async function create(model?:string) {
  const r=await request(app).post("/api/incoming-secretary/dev/sessions").set("x-owner","owner").send({numberId:"work",...(model?{model}:{})});
  if(r.body.sessionId)ids.push(r.body.sessionId);
  return r;
}
it("offers Live only in Dev, freezes the reserved model, scopes its cards and rejects duplicates/foreign stop",async()=>{
  const r=await create("gpt-live-1");expect(r.status).toBe(200);
  expect(r.body).toMatchObject({model:"gpt-live-1",voice:"marin",backend:"gpt-6.1-sol",testOnly:true});
  expect(mocks.liveVoices).toBe(0);
  const peer=new Peer();handleIncomingDevSocket(peer as any,{headers:{origin:"https://dev.test",host:"dev.test"}});
  peer.message({type:"connect",sessionId:r.body.sessionId,capability:r.body.capability,model:"gpt-realtime-2.1"});
  await vi.waitFor(()=>expect(mocks.liveVoices).toBe(1));expect(mocks.voices).toBe(1);
  expect(mocks.instructions).toContain("Future service");
  for(const text of ["Unapproved secret","Shared secret","Personal secret","Foreign secret"])expect(mocks.instructions).not.toContain(text);
  const repeat=new Peer();handleIncomingDevSocket(repeat as any,{headers:{origin:"https://dev.test",host:"dev.test"}});
  repeat.message({type:"connect",sessionId:r.body.sessionId,capability:r.body.capability});
  await vi.waitFor(()=>expect(repeat.readyState).toBe(3));expect(mocks.liveVoices).toBe(1);
  expect((await request(app).post(`/api/incoming-secretary/dev/sessions/${r.body.sessionId}/stop`).set("x-owner","other").send({})).status).toBe(404);
  const history=(await request(app).get("/api/incoming-secretary/dev").set("x-owner","owner")).body;
  expect(history.requests[0].devModel).toBe("gpt-live-1");
  incomingRevocations.emit("card","owner","approved");
  await vi.waitFor(async()=>{
    const result=(await request(app).get("/api/incoming-secretary/dev").set("x-owner","owner")).body;
    expect(result.activeSession).toBeNull();
    expect(result.requests.find((r:any)=>r.id===history.requests[0].id).closed).toBe(true);
  });
});
it("does not silently replace an unsupported requested model",async()=>{
  expect((await create("gpt-4o")).status).toBe(400);
  expect(mocks.voices+mocks.liveVoices).toBe(0);
});
it("is Dev-only and requires authenticated owner/admin",async()=>{
  expect((await request(app).get("/api/incoming-secretary/dev")).status).toBe(401);
  vi.stubEnv("NODE_ENV","production");
  expect((await request(app).get("/api/incoming-secretary/dev").set("x-owner","owner")).status).toBe(404);
  expect((await create()).status).toBe(404);expect(mocks.voices).toBe(0);
});
it("reserves once, excludes unapproved/private cards, persists history separately and never starts AI at reservation",async()=>{
  const first=await create();expect(first.status).toBe(200);
  expect(first.body.cardTitles).toEqual(["Allowed"]);expect(first.body.testOnly).toBe(true);
  expect(mocks.voices).toBe(0);
  expect((await create()).status).toBe(409);
  const other=await request(app).get("/api/incoming-secretary/dev").set("x-owner","other");
  expect(other.body.requests).toEqual([]);
  expect((await request(app).post(`/api/incoming-secretary/dev/sessions/${first.body.sessionId}/stop`).set("x-owner","other").send({})).status).toBe(404);
});
it("rejects personal/foreign numbers and foreign browser origins",async()=>{
  for(const numberId of ["personal","other-work"]){
    const r=await request(app).post("/api/incoming-secretary/dev/sessions").set("x-owner","owner").send({numberId});
    expect(r.status).toBe(503);
  }
  expect((await request(app).post("/api/incoming-secretary/dev/sessions").set("x-owner","owner").set("Origin","https://evil.invalid").send({numberId:"work"})).status).toBe(403);
});
it("requires a same-origin one-use capability; repeats cannot open a second AI",async()=>{
  const r=await create(),headers={headers:{origin:"https://dev.test",host:"dev.test"}};
  const bad=new Peer();handleIncomingDevSocket(bad as any,{headers:{origin:"https://evil.test",host:"dev.test"}});
  expect(bad.readyState).toBe(3);
  const first=new Peer();handleIncomingDevSocket(first as any,headers);
  first.message({type:"connect",sessionId:r.body.sessionId,capability:r.body.capability});
  await vi.waitFor(()=>expect(mocks.voices).toBe(1));
  expect(mocks.instructions).toContain("Future service");
  for(const secret of ["Unapproved secret","Shared secret","Personal secret","Foreign secret"])expect(mocks.instructions).not.toContain(secret);
  const duplicate=new Peer();handleIncomingDevSocket(duplicate as any,headers);
  duplicate.message({type:"connect",sessionId:r.body.sessionId,capability:r.body.capability});
  await vi.waitFor(()=>expect(duplicate.readyState).toBe(3));expect(mocks.voices).toBe(1);
  incomingRevocations.emit("card","other","approved");
  expect((await request(app).get("/api/incoming-secretary/dev").set("x-owner","owner")).body.activeSession).toBeTruthy();
  incomingRevocations.emit("card","owner","approved");
  await vi.waitFor(async()=>expect((await request(app).get("/api/incoming-secretary/dev").set("x-owner","owner")).body.activeSession).toBe(null));
  first.close();
});
