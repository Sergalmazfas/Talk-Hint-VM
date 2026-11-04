import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIVE_RESERVE, LiveBudget } from "./liveBudget";

describe("isolated Live series budget",()=>{
  let dir:string,b:LiveBudget;
  beforeEach(async()=>{vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
    dir=await mkdtemp(join(tmpdir(),"live-budget-"));b=new LiveBudget(join(dir,"state.json"));});
  afterEach(async()=>{vi.unstubAllEnvs();await rm(dir,{recursive:true,force:true});});
  it("reserves before a request; concurrent admissions fail closed",async()=>{
    await b.reserve("a");await expect(b.reserve("b")).rejects.toThrow("LIVE_ACTIVE_OR_UNKNOWN");
    expect((await b.state()).reservedMicroUsd).toBe(LIVE_RESERVE);
    await b.settle("a",60);expect((await b.state()).spentMicroUsd).toBe(50_000);
    await expect(b.reserve("a")).rejects.toThrow("NO_RETRY");
  });
  it("unknowns retain full envelope across restart and cannot be repeated",async()=>{
    await b.reserve("a");await b.settle("a",null);
    const restored=new LiveBudget(join(dir,"state.json"));
    expect((await restored.state()).spentMicroUsd).toBe(LIVE_RESERVE);
    await expect(restored.reserve("b")).rejects.toThrow("UNKNOWN");
    await expect(restored.settle("a",0)).rejects.toThrow("NO_RETRY");
  });
  it("does not reset the total $20 at a new day or process",async()=>{
    for(let i=0;i<40;i++){await b.reserve(String(i));await b.settle(String(i),600);}
    expect((await b.state()).remainingMicroUsd).toBe(0);
    await expect(new LiveBudget(join(dir,"state.json")).reserve("extra")).rejects.toThrow("EXHAUSTED");
  });
  it("charges per second and rejects unbounded usage",async()=>{
    await b.reserve("a");await expect(b.settle("a",-1)).rejects.toThrow("OUT_OF_BOUNDS");
    await b.settle("a",1);expect((await b.state()).spentMicroUsd).toBe(834);
  });
  it("never admits a production or deployed process",async()=>{
    vi.stubEnv("REPLIT_DEPLOYMENT","1");await expect(b.reserve("prod")).rejects.toThrow("DEV_ONLY");
    vi.stubEnv("REPLIT_DEPLOYMENT","");vi.stubEnv("NODE_ENV","production");
    await expect(b.reserve("prod")).rejects.toThrow("DEV_ONLY");
  });
});
