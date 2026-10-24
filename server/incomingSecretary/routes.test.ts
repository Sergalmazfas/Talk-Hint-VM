import express from "express";
import request from "supertest";
import { beforeEach,afterEach,it,expect,vi } from "vitest";
const fixtures=vi.hoisted(()=>({cards:[
  {id:"work-card",userId:"owner",profileScope:"work",title:"Services",body:"Future business"},
  {id:"shared",userId:"owner",profileScope:"shared",title:"Private",body:"Not authorized"},
  {id:"personal",userId:"owner",profileScope:"personal",title:"Personal",body:"Private"},
  {id:"foreign",userId:"other",profileScope:"work",title:"Other owner",body:"Private"},
]}));
vi.mock("../db",()=>({pool:null}));
vi.mock("../secretary/notifications",()=>({notifySecretaryResult:vi.fn()}));
vi.mock("../benchmark/adminGate",()=>({isBenchmarkAdmin:(email:string)=>email==="admin@example.invalid"}));
vi.mock("../storage",()=>({storage:{
  getUserPhoneNumbers:vi.fn(async(userId:string)=>[{id:userId+"-work",userId,type:"work",name:"Work",twilioNumber:"+15550000001"},
    {id:"personal",userId,type:"personal",name:"Personal",twilioNumber:"+15550000002"}]),
  listKnowledgeCards:vi.fn(async()=>fixtures.cards),
}}));
import { registerIncomingRoutes } from "./routes";
import { incomingStore } from "./runtime";
import { defaults } from "./policy";
const app=express();app.use(express.json());
registerIncomingRoutes(app,(req:any,res,next)=>{
  const owner=req.get("x-test-owner");if(!owner)return res.sendStatus(401);
  req.user={id:owner,email:owner==="owner"?"admin@example.invalid":"other@example.invalid"};next();
});
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","development");
  vi.spyOn(incomingStore,"settings").mockImplementation(async(_u,n)=>defaults(n));
  vi.spyOn(incomingStore,"list").mockImplementation(async(owner)=>[{id:owner+"-request",userId:owner}] as any);
  vi.spyOn(incomingStore,"saveSettings").mockResolvedValue(undefined);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it("requires the existing login and returns only owner Work data",async()=>{
  expect((await request(app).get("/api/incoming-secretary")).status).toBe(401);
  const r=await request(app).get("/api/incoming-secretary").set("x-test-owner","owner");
  expect(r.status).toBe(200);expect(r.body.cards.map((c:any)=>c.id)).toEqual(["work-card"]);
  expect(r.body.numbers.map((n:any)=>n.id)).toEqual(["owner-work"]);
  expect(r.body.requests[0].id).toBe("owner-request");expect(r.body.calendarConnected).toBe(false);
  const other=await request(app).get("/api/incoming-secretary").set("x-test-owner","other");
  expect(other.body.cards.map((c:any)=>c.id)).toEqual(["foreign"]);
  expect(other.body.requests[0].id).toBe("other-request");
});
it.each(["shared","personal","foreign"])("rejects explicitly selecting %s instead of authorized Work cards",async(id)=>{
  const {numberId,...value}=defaults("owner-work");
  const r=await request(app).put("/api/incoming-secretary/settings/owner-work").set("x-test-owner","owner")
    .send({...value,cardIds:[id]});
  expect(r.status).toBe(403);expect(incomingStore.saveSettings).not.toHaveBeenCalled();
});
it("rejects changing another number or a foreign browser origin",async()=>{
  const {numberId,...value}=defaults("owner-work");
  expect((await request(app).put("/api/incoming-secretary/settings/other-work").set("x-test-owner","owner").send(value)).status).toBe(404);
  expect((await request(app).put("/api/incoming-secretary/settings/owner-work").set("x-test-owner","owner")
    .set("Origin","https://evil.example").send(value)).status).toBe(403);
});
it("permits an explicit owner preference without activating the runtime",async()=>{
  const {numberId,...value}=defaults("owner-work");
  const r=await request(app).put("/api/incoming-secretary/settings/owner-work").set("x-test-owner","owner")
    .send({...value,cardIds:["work-card"]});
  expect(r.status).toBe(200);expect(r.body.activated).toBe(false);
  expect(incomingStore.saveSettings).toHaveBeenCalledWith("owner",expect.objectContaining({enabled:false,cardIds:["work-card"]}));
});
it("Dev text preview is isolated, multilingual and absent outside Dev/admin",async()=>{
  const body={numberId:"owner-work",turns:[{role:"caller",text:"¡Hola! ¿Podemos hablar?",language:"es"}],
    fields:{name:"Анна",language:"es"},endReason:"disconnected"};
  const r=await request(app).post("/api/incoming-secretary/preview").set("x-test-owner","owner").send(body);
  expect(r.status).toBe(200);expect(r.body.simulation).toBe(true);
  expect(r.body.request.status).toBe("incomplete");expect(r.body.request.turns[0].text).toContain("¿");
  expect(incomingStore.saveSettings).not.toHaveBeenCalled();
  expect((await request(app).post("/api/incoming-secretary/preview").set("x-test-owner","other").send(body)).status).toBe(404);
  vi.stubEnv("NODE_ENV","production");
  expect((await request(app).post("/api/incoming-secretary/preview").set("x-test-owner","owner").send(body)).status).toBe(404);
});
