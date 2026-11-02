import {expect,it}from"vitest";
import {assessTurns}from"./turnQuality";
import {runQueue,selectBatch}from"./scheduler";
it("keeps short smoke tests but starts the longest full-corpus recordings first",()=>{
 const fixtures=[1,2,3,10].map(durationMs=>({durationMs}));
 expect(selectBatch(fixtures,3).map(f=>f.durationMs)).toEqual([1,2,3]);
 expect(selectBatch(fixtures,36).map(f=>f.durationMs)).toEqual([10,3,2,1]);
 expect(fixtures.map(f=>f.durationMs)).toEqual([1,2,3,10]);
});
import type{Turn}from"./metrics";
import{ownRequestCost}from"./metrics";
import{Ledger}from"./ledger";
import{mkdtempSync,rmSync,readFileSync}from"node:fs";
import{tmpdir}from"node:os";
import{join}from"node:path";
const turn=(valid:boolean,windowEndMs=100):Turn=>({turnId:"x",speechEndMs:valid?100:null,sttFinalMs:120,
 firstWordMs:150,fullHintMs:150,translationMs:150,valid,windowEndMs,systemHash:"x",systemChars:0});
it("30% rejected is allowed, more than 30% is rejected",()=>{
 expect(assessTurns([...Array(7).fill(turn(true)),...Array(3).fill(turn(false))],[],100)).toMatchObject({bad:3,total:10,acceptable:true});
 expect(assessTurns([...Array(6).fill(turn(true)),...Array(4).fill(turn(false))],[],100).acceptable).toBe(false);
});
it("missing Guest tail is explicit; an already rejected crossing turn is not counted twice",()=>{
 expect(assessTurns([turn(false)],[{startMs:50,endMs:200}],100)).toMatchObject({bad:1,total:1,missingTail:0});
 expect(assessTurns([turn(true)],[{startMs:150,endMs:200}],100)).toMatchObject({bad:1,total:2,missingTail:1});
 expect(assessTurns([],[],0).acceptable).toBe(false);
});
it("runs four independent tasks concurrently, never above four, and never repeats an item",async()=>{
 let active=0,max=0;const visited:number[]=[];
 await runQueue(Array.from({length:11},(_,i)=>i),4,async i=>{
   active++;max=Math.max(max,active);visited.push(i);await new Promise(r=>setTimeout(r,1));active--;
 });
 expect(max).toBe(4);expect(visited).toEqual(Array.from({length:11},(_,i)=>i));
});
it("stops queued work while waiting for already-started calls to finish",async()=>{
 let stop=false;const visited:number[]=[];
 await runQueue([1,2,3,4,5],2,async i=>{visited.push(i);stop=true;await Promise.resolve();},()=>stop);
 expect(visited).toEqual([1]);
});
it("never charges another concurrent recording's spend to this call",()=>{
 const entries=[{id:"run-A-brain",status:"spent",charged:10,reserve:50},
 {id:"run-B-brain",status:"spent",charged:20,reserve:50},
 {id:"run-A-stt",status:"unknown",charged:30,reserve:30}];
 expect(ownRequestCost(entries,"run-A-")).toBe(40);
 expect(ownRequestCost(entries,"run-B-")).toBe(20);
 expect(ownRequestCost(entries,"run-A-")+ownRequestCost(entries,"run-B-")).toBe(60);
});
it("independent recordings may have identical text, but an unknown call is never retried",()=>{
 const dir=mkdtempSync(join(tmpdir(),"polygon-scopes-")),l=new Ledger(join(dir,"ledger.json")),hash="a".repeat(64);
 try{
  l.reserve("a-first","brain",100,hash,"fixture-a");l.unknown("a-first");
  expect(()=>l.reserve("a-retry","brain",100,hash,"fixture-a")).toThrow("UNKNOWN_PAYLOAD");
  l.reserve("b-first","brain",100,hash,"fixture-b");
  expect(l.held()).toBe(200);
 }finally{l.close();rmSync(dir,{recursive:true,force:true});}
});
it("async accounting durably serializes six callers without resetting the shared budget",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"polygon-async-")),path=join(dir,"ledger.json"),l=new Ledger(path,true);
 try{
  await Promise.all(Array.from({length:6},async(_,i)=>{
    await l.reserve("r"+i,"brain",100);
    // The caller's reservation is ON DISK before it may send a request.
    expect(JSON.parse(readFileSync(path,"utf8")).entries.some((e:any)=>e.id==="r"+i)).toBe(true);
    await l.finish("r"+i,10);
  }));
  expect(l.held()).toBe(60);
  await l.close();
  const reopened=new Ledger(path);
  expect(reopened.held()).toBe(60);expect(reopened.snapshot().entries).toHaveLength(6);reopened.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
