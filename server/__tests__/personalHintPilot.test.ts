import {describe,it,expect,vi} from "vitest";
import express from "express";
import request from "supertest";
import {readFileSync} from "node:fs";
import {registerPersonalPipelineRoutes} from "../benchmark/personalPipelineRoutes";
import {candidateBrainModelsForUser,isCandidateBrainModelForUser,isHintMiniPilotOwner} from "../candidatePipeline";
const owner="47704265";
function fixture(){
 const app=express();app.use(express.json());
 const get=vi.fn(async()=>({enabled:false,stt:null,brainModel:null}));
 const set=vi.fn(async(_id,cfg)=>cfg);
 registerPersonalPipelineRoutes(app,"/bench",(req,res,next)=>{
  const id=req.header("x-test-user");
  if(!id)return void res.status(401).end();
  (req as any).user={id};next();
 },{getCandidatePipeline:get,setCandidatePipeline:set});
 return{app,get,set};
}
describe("owner-only Mini pilot (no activation)",()=>{
 it("Mini belongs only to the exact bound account, not every admin",()=>{
  expect(isHintMiniPilotOwner(owner)).toBe(true);
  for(const id of ["other-admin",null,undefined,owner+" "]) {
   expect(isCandidateBrainModelForUser("gpt-4.1-mini",id)).toBe(false);
   expect(candidateBrainModelsForUser(id)).not.toContain("gpt-4.1-mini");
  }
  expect(isCandidateBrainModelForUser("gpt-5.6-terra","other-admin")).toBe(true);
 });
 it("GET is read-only and includes Mini only for owner",async()=>{
  const {app,set}=fixture();
  const a=await request(app).get("/bench/candidate-pipeline").set("x-test-user",owner);
  expect(a.body.allowedBrainModels).toContain("gpt-4.1-mini");expect(a.body.enabled).toBe(false);
  const b=await request(app).get("/bench/candidate-pipeline").set("x-test-user","other-admin");
  expect(b.body.allowedBrainModels).not.toContain("gpt-4.1-mini");expect(set).not.toHaveBeenCalled();
 });
 it("rejects forged target IDs and unauthorized Mini without writes",async()=>{
  const {app,set}=fixture();
  const r=await request(app).put("/bench/candidate-pipeline").set("x-test-user","other-admin")
   .send({userId:owner,enabled:true,stt:null,brainModel:"gpt-4.1-mini"});
  expect(r.status).toBe(400);expect(set).not.toHaveBeenCalled();
 });
 it("writes only the authenticated owner and returns to Terra in one update",async()=>{
  const {app,set}=fixture();
  for(const brainModel of ["gpt-4.1-mini","gpt-5.6-terra"]){
   const r=await request(app).put("/bench/candidate-pipeline").set("x-test-user",owner)
    .send({userId:"victim",enabled:true,stt:null,brainModel});
   expect(r.status).toBe(200);expect(set).toHaveBeenLastCalledWith(owner,{enabled:true,stt:null,brainModel});
  }
 });
 it("keeps existing authentication and validates invalid requests",async()=>{
  const {app,set}=fixture();
  expect((await request(app).put("/bench/candidate-pipeline").send({enabled:true,brainModel:"gpt-4.1-mini"})).status).toBe(401);
  for(const body of [{enabled:true,brainModel:"unknown"},{enabled:true,stt:"invalid"},{enabled:true},{}])
   expect((await request(app).put("/bench/candidate-pipeline").set("x-test-user",owner).send(body)).status).toBe(400);
  expect(set).not.toHaveBeenCalled();
 });
 it("guards persisted overrides at call start and keeps UI return local",()=>{
  const ws=readFileSync("server/websocket.ts","utf8");
  expect(ws).toContain("!isCandidateBrainModelForUser(cfg.brainModel, streamUserId)");
  const routes=readFileSync("server/benchmark/routes.ts","utf8");
  expect(routes).toContain("registerPersonalPipelineRoutes(app, base, requireBenchmarkAdmin, storage)");
  const ui=readFileSync("client/src/pages/admin-diagnostics.tsx","utf8");
  expect(ui).toContain('data-testid="button-pipeline-return-terra"');
  expect(ui).toContain("stt: cfgQ.data?.stt ?? null");
 });
});
