import express from "express";
import request from "supertest";
import {beforeEach,it,expect,vi} from "vitest";
import {registerCallProfileRoutes} from "./routes";
import {NumberSetupError} from "./assign";
const deps={numbers:vi.fn(),pool:vi.fn(),user:vi.fn(),connect:vi.fn()};
let owner:string|undefined;
const app=express();app.use(express.json());
registerCallProfileRoutes(app,(req,res,next)=>{if(!owner)return res.sendStatus(401);req.user={id:owner} as any;next();},deps);
beforeEach(()=>{
  vi.resetAllMocks();owner="ordinary-account";
  deps.numbers.mockResolvedValue([{id:"mine",userId:owner,twilioNumber:"+15550000001",type:"work",name:"Work"},
    {id:"foreign",userId:"foreign",twilioNumber:"+15550000002",type:"work",name:"private"}]);
  deps.pool.mockResolvedValue([{id:"free",twilioNumber:"+15550000003",isAssigned:false}]);
  deps.user.mockResolvedValue({plan:"basic"});
  deps.connect.mockResolvedValue({phoneNumbers:[{id:"mine",type:"work"}],reused:false});
});
it("offers three choices to an ordinary account; excludes foreign numbers and credentials",async()=>{
  const r=await request(app).get("/api/call-profiles");
  expect(r.status).toBe(200);expect(r.body.onboarding).toEqual({choices:["frames","work","both"],subscribed:true,availableCount:1});
  expect(r.body.profiles[0].numbers).toEqual([]);expect(r.body.profiles[1].numbers).toHaveLength(1);
  expect(JSON.stringify(r.body)).not.toMatch(/foreign|subaccount|token/);expect(deps.connect).not.toHaveBeenCalled();
});
it.each(["frames","work","both"])("connects %s using authenticated identity only",async(choice)=>{
  expect((await request(app).post("/api/call-profiles/connect").send({choice})).status).toBe(200);
  expect(deps.connect).toHaveBeenCalledWith("ordinary-account",choice);
});
it("retains compatibility without a creator-specific plan or number",async()=>{
  const r=await request(app).post("/api/call-profiles/work-number").send({numberId:"free"});
  expect(r.status).toBe(200);expect(r.body.phoneNumber.type).toBe("work");
  expect(deps.connect).toHaveBeenCalledWith(owner,"work",{work:"free"});
});
it("denies missing auth, cross-origin writes and injected owner IDs",async()=>{
  owner=undefined;
  expect((await request(app).post("/api/call-profiles/connect").send({choice:"both"})).status).toBe(401);
  owner="ordinary-account";
  expect((await request(app).post("/api/call-profiles/connect").set("Origin","https://attacker.test").send({choice:"both"})).status).toBe(403);
  expect((await request(app).post("/api/call-profiles/connect").send({choice:"both",userId:"foreign"})).status).toBe(400);
  expect(deps.connect).not.toHaveBeenCalled();
});
it("reports empty pool and recovery errors honestly without success",async()=>{
  deps.pool.mockResolvedValue([]);expect((await request(app).get("/api/call-profiles")).body.recommendedWorkNumber).toBe(null);
  deps.connect.mockRejectedValue(new NumberSetupError(409,"pool_unavailable"));
  expect((await request(app).post("/api/call-profiles/connect").send({choice:"both"})).status).toBe(409);
});
