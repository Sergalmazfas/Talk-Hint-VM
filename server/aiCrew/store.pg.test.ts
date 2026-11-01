import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { CrewStore } from "./store";
import { initialState } from "./domain";
import { applyOwnerCommand } from "./domain";
import { projectHintEvidence, evidenceHash } from "./hintEvidence";
import { HINT_AGENTS } from "./hintPilot";
import { CrewRuntime } from "./runtime";
describe.skipIf(process.env.CREW_RUNTIME_PG_TEST!=="true")("AI Crew actual PostgreSQL transaction",()=>{
 it("claims a prepared pilot after a real jsonb round-trip, without mutating the saved excerpt or hash",async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,max:1});
  const c=await pool.connect();
  try{
   const state=initialState(), at="2026-11-01T18:00:00Z";
   const evidence=projectHintEvidence({calls:[{latency:{e2eP95Ms:4063},sla:1000}],reports:[],problems:[]});
   applyOwnerCommand(state,{kind:"hint_pilot_prepare",candidate:"latency",ratesConfirmed:true},"owner",at,HINT_AGENTS.map(a=>a.modelId),evidence);
   applyOwnerCommand(state,{kind:"control",enabled:true,dailyLimitMicroUsd:1000000,staleHours:24},"owner",at);
   applyOwnerCommand(state,{kind:"hint_pilot_start",taskId:state.tasks[0].id,ownerApproved:true},"owner",at);
   // Connection-local TEMP fixture in Dev, never production/persistent rows.
   await c.query("CREATE TEMP TABLE ai_crew_runtime_state(environment text PRIMARY KEY,state jsonb NOT NULL,updated_at timestamptz DEFAULT now())");
   await c.query("INSERT INTO ai_crew_runtime_state(environment,state) VALUES($1,$2::jsonb)",["development",JSON.stringify(state)]);
   const wrapper:any={connect:async()=>({query:(...a:any[])=>c.query(...a as [any]),release:()=>{}}),
    query:(...a:any[])=>c.query(...a as [any])};
   const store=new CrewStore(wrapper,"development");
   let stored=await store.read();
   const originalHash=stored.tasks[0].hintPilot.evidenceHash;
   expect(JSON.stringify(stored.tasks[0].hintPilot.evidence)).not.toBe(JSON.stringify(evidence));
   let paid=0;
   const provider={listModels:async()=>[],message:async(model:string)=>{
    paid++;return {model,text:"Fixture proposal",usage:{input_tokens:10,output_tokens:10}};
   }};
   const runtime=new CrewRuntime(store,provider,"production",()=>new Date(at));
   await runtime.tick();
   stored=await store.read();
   expect(paid).toBe(1);
   expect(stored.journal.some(e=>e.kind==="run_reserved")).toBe(true);
   expect(stored.tasks[0].hintPilot.evidenceHash).toBe(originalHash);
   expect(evidenceHash(stored.tasks[0].hintPilot.evidence)).toBe(originalHash);
   expect(stored.tasks[0].hintPilot?.status).toBe("review");
   await store.change(s=>{s.control.enabled=false});
   await runtime.tick();
   expect(paid).toBe(1);
  }finally{c.release();await pool.end()}
 });
 it("persists, CAS-rejects and rolls back in a connection-local TEMP table",async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,max:1});
  const c=await pool.connect();
  try{
   await c.query("CREATE TEMP TABLE ai_crew_runtime_state(environment text PRIMARY KEY,state jsonb NOT NULL,updated_at timestamptz DEFAULT now())");
   await c.query("INSERT INTO ai_crew_runtime_state(environment,state) VALUES($1,$2)",["development",JSON.stringify(initialState())]);
   const wrapper:any={query:(...a:any[])=>c.query(...a as [any]),connect:async()=>({query:(...a:any[])=>c.query(...a as [any]),release:()=>{}})};
   const store=new CrewStore(wrapper,"development");
   await store.change(s=>{s.control.dailyLimitMicroUsd=123},0);
   expect((await store.read()).control.dailyLimitMicroUsd).toBe(123);
   await expect(store.change(s=>{s.control.enabled=true},0)).rejects.toThrow("STALE_REVISION");
   await expect(store.change(s=>{s.control.enabled=true;throw Error("rollback")},1)).rejects.toThrow("rollback");
   expect((await store.read()).control.enabled).toBe(false);
   expect((await store.read()).revision).toBe(1);
  }finally{c.release();await pool.end()}
 });
});
