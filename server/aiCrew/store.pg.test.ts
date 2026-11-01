import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { CrewStore } from "./store";
import { initialState } from "./domain";
describe.skipIf(process.env.CREW_RUNTIME_PG_TEST!=="true")("AI Crew actual PostgreSQL transaction",()=>{
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
