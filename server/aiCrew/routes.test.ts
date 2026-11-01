import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { initialState } from "./domain";
const f=vi.hoisted(()=>({state:null as any, session:{} as any,
  message:vi.fn(),models:vi.fn(),initialized:false,builtAt:"now"}));
vi.mock("../db",()=>({pool:{}}));
vi.mock("../benchmark/adminGate",()=>({requireBenchmarkAdmin:(req:any,res:any,next:any)=>{
 if(req.get("x-owner")!=="yes")return res.sendStatus(403);req.user={id:"owner"};next();
}}));
vi.mock("../adminWeb",()=>({adminActionOrigin:(req:any,res:any,next:any)=>{
 if(req.method==="GET"||req.get("origin")==="https://owner.test"||req.get("authorization"))return next();
 res.sendStatus(403);
}}));
vi.mock("./store",()=>({CrewStore:class{
 async initialize(){f.initialized=true}
 async read(){if(!f.initialized)throw Error("not initialized");return structuredClone(f.state)}
 async change(fn:any,rev?:number){if(!f.initialized)throw Error("not initialized");
  if(rev!==undefined&&rev!==f.state.revision)throw Error("stale");
  const s=structuredClone(f.state),r=fn(s);s.revision++;f.state=s;return r}
}}));
vi.mock("./anthropic",()=>({AnthropicCrewProvider:class{
 listModels(){return f.models()}
 message(...args:any[]){return f.message(...args)}
}}));
vi.mock("../codeVersion",()=>({codeVersion:()=>({commit:"a".repeat(40),sourceHash:"hash",taskRef:"roadmap:test",fixes:"fix",dirty:false,builtAt:f.builtAt})}));
import { registerCrewRoutes } from "./routes";
let server:Server,base:string;
const headers={"x-owner":"yes","Content-Type":"application/json",origin:"https://owner.test"};
beforeEach(async()=>{
 f.state=initialState();f.session={};f.initialized=true;f.builtAt="now";
 f.models.mockReset().mockResolvedValue([{id:"from-api",display_name:"actual model"}]);
 f.message.mockReset().mockResolvedValue({text:"OK",model:"from-api",usage:{input_tokens:1,output_tokens:1}});
 const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.session=f.session;next()});
 registerCrewRoutes(app);server=createServer(app);
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${(server.address()as any).port}`;
});
afterEach(async()=>{vi.unstubAllEnvs();await new Promise<void>(r=>server.close(()=>r()))});
async function csrf(){return (await(await fetch(base+"/api/admin/ai-crew",{headers})).json()).csrf}
const post=(path:string,body:any,token="")=>fetch(base+"/api/admin/ai-crew"+path,{method:"POST",headers:{...headers,"x-crew-csrf":token},body:JSON.stringify(body)});
describe("AI Crew owner boundary",()=>{
 it("denies anonymous requests and cookie writes without CSRF or Origin",async()=>{
  expect((await fetch(base+"/api/admin/ai-crew")).status).toBe(403);
  expect((await post("/disable",{})).status).toBe(403);
  const token=await csrf();
  const bad=await fetch(base+"/api/admin/ai-crew/disable",{method:"POST",headers:{"x-owner":"yes","Content-Type":"application/json","x-crew-csrf":token},body:"{}"});
  expect(bad.status).toBe(403);
 });
 it("emergency owner switch disables all agents regardless of stale UI revision",async()=>{
  f.state.control.enabled=true;const t=await csrf();
  expect((await post("/disable",{revision:-1},t)).status).toBe(200);
  expect(f.state.control.enabled).toBe(false);expect(f.state.control.epoch).toBe(1);
  expect(f.message).not.toHaveBeenCalled();
 });
 it("rejects stale state and undeclared model IDs without mutating runtime",async()=>{
  const t=await csrf();
  const c={kind:"control",enabled:false,dailyLimitMicroUsd:0,staleHours:24};
  expect((await post("/command",{revision:999,command:c},t)).status).toBe(409);
  expect(f.state.revision).toBe(0);
  expect((await post("/command",{revision:0,command:{kind:"agent",agentId:"a",modelId:"guessed",inputMicroUsdPerToken:1,outputMicroUsdPerToken:2}},t)).status).toBe(409);
 });
 it("initialization is explicit, defaults stay OFF/0, publication observation is idempotent",async()=>{
  f.initialized=false;const t=await csrf();
  expect((await post("/initialize",{},t)).status).toBe(200);
  expect((await post("/initialize",{},t)).status).toBe(200);
  expect(f.state.control).toMatchObject({enabled:false,dailyLimitMicroUsd:0});
  expect(f.state.journal.filter((x:any)=>x.kind==="publication_observed")).toHaveLength(1);
  f.builtAt="next-publication-same-code";
  expect((await post("/initialize",{},t)).status).toBe(200);
  expect(f.state.journal.filter((x:any)=>x.kind==="publication_observed")).toHaveLength(2);
 });
 it("production-only one-use probe uses an API-returned ID, not an agent or budget",async()=>{
  const t=await csrf();
  expect((await post("/probe",{modelId:"from-api"},t)).status).toBe(409);
  vi.stubEnv("NODE_ENV","production");
  expect((await post("/probe",{modelId:"imaginary-5.5"},t)).status).toBe(400);
  expect((await post("/probe",{modelId:"from-api"},t)).status).toBe(200);
  expect((await post("/probe",{modelId:"from-api"},t)).status).toBe(409);
  expect(f.message).toHaveBeenCalledTimes(1);expect(f.state.agents).toEqual([]);
  expect(f.state.control.enabled).toBe(false);expect(f.state.probe.status).toBe("done");
 });
 it("unclear probe is latched unknown, sanitized and not repeated",async()=>{
  const t=await csrf();vi.stubEnv("NODE_ENV","production");
  f.message.mockRejectedValue(Error("never expose a key"));
  const response=await post("/probe",{modelId:"from-api"},t);
  expect(response.status).toBe(503);expect(await response.text()).not.toContain("never expose");
  expect(f.state.probe.status).toBe("unknown");
  expect((await post("/probe",{modelId:"from-api"},t)).status).toBe(409);
  expect(f.message).toHaveBeenCalledTimes(1);
 });
});
