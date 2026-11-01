import { describe, it, expect, vi } from "vitest";
import { initialState, applyOwnerCommand, staleTasks, type CrewState } from "./domain";
import { CrewRuntime } from "./runtime";
import { AnthropicCrewProvider } from "./anthropic";

class Memory {
  state = initialState();
  private queue = Promise.resolve();
  async read() { return structuredClone(this.state); }
  async change<T>(fn: (s: CrewState) => T, expected?: number): Promise<T> {
    let resolve!: (value: T) => void, reject!: (e: unknown) => void;
    const result = new Promise<T>((a,b)=>{resolve=a;reject=b});
    this.queue = this.queue.then(()=>{
      const copy=structuredClone(this.state);
      try { if(expected!==undefined&&expected!==copy.revision)throw Error("STALE_REVISION");
        const r=fn(copy);copy.revision++;this.state=copy;resolve(r); } catch(e){reject(e)}
    });
    await this.queue;return result;
  }
}
const at="2026-11-01T12:00:00.000Z";
function ready() {
  const m=new Memory(),s=m.state;
  applyOwnerCommand(s,{kind:"task",title:"Task",holder:"lab",problem:"accepted owner task"},"owner",at);
  applyOwnerCommand(s,{kind:"advance",taskId:s.tasks[0].id,holder:"lab",note:"problem recorded"},"owner",at);
  applyOwnerCommand(s,{kind:"agent",agentId:"lab",modelId:"actual-id",inputMicroUsdPerToken:1,outputMicroUsdPerToken:2},"owner",at,["actual-id"]);
  applyOwnerCommand(s,{kind:"control",enabled:true,dailyLimitMicroUsd:100000,staleHours:24},"owner",at);
  applyOwnerCommand(s,{kind:"enqueue",taskId:s.tasks[0].id,agentId:"lab",eventId:crypto.randomUUID()},"owner",at);
  return m;
}
const provider=()=>({listModels:vi.fn(async()=>[{id:"actual-id",display_name:"From API"}]),
 message:vi.fn(async()=>({text:"proposal only",model:"actual-id",usage:{input_tokens:30,output_tokens:20}}))});
describe("AI Crew launch boundaries",()=>{
 it("starts OFF with zero company budget and 24h stale threshold",()=>{
  const s=initialState();expect(s.control).toMatchObject({enabled:false,dailyLimitMicroUsd:0,staleHours:24});
  expect(s.agents).toEqual([]);expect(s.schedules).toEqual([]);
 });
 it.each(["off","zero","development"])("never calls a model when %s",async mode=>{
  const m=ready(),p=provider();
  if(mode==="off")m.state.control.enabled=false;
  if(mode==="zero")m.state.control.dailyLimitMicroUsd=0;
  await new CrewRuntime(m,p,mode==="development"?"development":"production").tick();
  expect(p.message).not.toHaveBeenCalled();expect(m.state.documents).toEqual([]);
 });
 it("settles actual per-agent usage, saves proposed document only and never advances a task",async()=>{
  const m=ready(),p=provider(),before=structuredClone(m.state.tasks);
  await new CrewRuntime(m,p,"production",()=>new Date(at)).tick();
  expect(m.state.runs[0]).toMatchObject({status:"done",cost:70,modelId:"actual-id"});
  expect(m.state.budget["2026-11-01"]).toEqual({spent:70,reserved:0});
  expect(m.state.documents[0]).toMatchObject({status:"proposed",text:"proposal only"});
  expect(m.state.tasks[0].phase).toBe(before[0].phase);
  expect(m.state.journal.some(e=>e.kind==="run_settled")).toBe(true);
 });
 it("serializes company budget reservations across two runtime instances",async()=>{
  const m=ready(),p=provider();
  m.state.control.dailyLimitMicroUsd=7000;
  m.state.runs.push({...m.state.runs[0],id:crypto.randomUUID(),eventId:crypto.randomUUID()});
  p.message.mockImplementation(async()=>({text:"p",model:"actual-id",usage:{input_tokens:10000,output_tokens:1000}}));
  await Promise.all([new CrewRuntime(m,p,"production",()=>new Date(at)).tick(),new CrewRuntime(m,p,"production",()=>new Date(at)).tick()]);
  expect(p.message.mock.calls.length).toBeLessThanOrEqual(1);
  expect(m.state.control.enabled).toBe(false); // usage exceeded reserve => latch closed
 });
 it("retains full reservation on ambiguous failure, never retries paid request",async()=>{
  const m=ready(),p=provider();p.message.mockRejectedValue(Error("secret should not be logged"));
  const r=new CrewRuntime(m,p,"production",()=>new Date(at));await r.tick();await r.tick();
  expect(p.message).toHaveBeenCalledTimes(1);expect(m.state.runs[0].status).toBe("unknown");
  expect(m.state.budget["2026-11-01"].reserved).toBeGreaterThan(0);
  expect(JSON.stringify(m.state)).not.toContain("secret should not");
 });
 it("global stop discards late output but accounts for delivered usage",async()=>{
  const m=ready(),p=provider();
  p.message.mockImplementation(async()=>{
   await m.change(s=>{s.control.enabled=false;s.control.epoch++});
   return {text:"late",model:"actual-id",usage:{input_tokens:2,output_tokens:3}};
  });
  await new CrewRuntime(m,p,"production",()=>new Date(at)).tick();
  expect(m.state.runs[0]).toMatchObject({status:"discarded",cost:8});
  expect(m.state.documents).toEqual([]);expect(m.state.control.enabled).toBe(false);
 });
 it("local stop aborts the active transport",async()=>{
  const m=ready(),p=provider();let signal:AbortSignal|undefined;
  const runtime=new CrewRuntime(m,p,"production",()=>new Date(at));
  p.message.mockImplementation(async(...args:any[])=>{
   signal=args[3];runtime.stopLocal();expect(signal?.aborted).toBe(true);throw Error("aborted");
  });
  await runtime.tick();expect(signal?.aborted).toBe(true);
  expect(m.state.runs[0].status).toBe("unknown");
 });
 it("uses UTC reservation day through midnight and prevents duplicates",async()=>{
  const m=ready(),p=provider();
  applyOwnerCommand(m.state,{kind:"enqueue",taskId:m.state.tasks[0].id,agentId:"lab",eventId:m.state.runs[0].eventId},"owner",at);
  let n=0;await new CrewRuntime(m,p,"production",()=>new Date(n++===0?"2026-11-01T23:59:59Z":"2026-11-02T00:00:10Z")).tick();
  expect(m.state.runs).toHaveLength(1);expect(m.state.budget["2026-11-01"].spent).toBe(70);
  expect(m.state.budget["2026-11-02"]).toBeUndefined();
 });
 it("dispatches only an explicitly scheduled analysis task",async()=>{
  const m=ready(),p=provider();m.state.runs=[];
  applyOwnerCommand(m.state,{kind:"schedule",taskId:m.state.tasks[0].id,agentId:"lab",everyMinutes:60,nextAt:at},"owner",at);
  const r=new CrewRuntime(m,p,"production",()=>new Date(at));await r.tick();await r.tick();
  expect(p.message).toHaveBeenCalledTimes(1);
 });
 it("never accepts guessed model IDs",()=>{
  const s=initialState();
  expect(()=>applyOwnerCommand(s,{kind:"agent",agentId:"a",modelId:"guessed-5.5",inputMicroUsdPerToken:1,outputMicroUsdPerToken:2},"o",at,[])).toThrow("MODEL_NOT_VERIFIED");
 });
 it("preserves all six workflow phases, independent review, expectation and new-version verification",()=>{
  const m=ready(),s=m.state,t=s.tasks[0],step=(extra:any={})=>applyOwnerCommand(s,{kind:"advance",taskId:t.id,holder:"next",note:"evidence",...extra},"owner",at);
  expect(()=>step()).toThrow("INDEPENDENT_REVIEW");
  expect(()=>step({laboratoryActor:"same",reviewerActor:"same"})).toThrow("INDEPENDENT_REVIEW");
  step({laboratoryActor:"lab",reviewerActor:"qa"});expect(t.phase).toBe("owner_decision");
  expect(()=>step()).toThrow("OWNER_EXPECTATION");
  step({approved:true,expectation:"menu second level works"});
  expect(()=>step()).toThrow("CODE_COMMIT");
  step({commit:"abcdef123"});expect(()=>step({testedCommit:"1234567"})).toThrow("NEW_VERSION");
  step({testedCommit:"abcdef123"});step({actual:"works",met:true});
  expect(t.closed).toBe(true);expect(t.steps.map(x=>x.phase)).toEqual(["problem","analysis","owner_decision","code","verification","outcome"]);
  expect(t.steps.every(x=>!!x.holder&&x.updatedAt===at)).toBe(true);
 });
 it("returns failed expectation to analysis without deleting history; flags stale holder",()=>{
  const m=ready(),s=m.state,t=s.tasks[0];
  t.steps.push({phase:"owner_decision",holder:"owner",updatedAt:at,note:"expectation",actor:"owner",approved:true,expectation:"expected"});
  t.phase="outcome";t.steps.push({phase:"outcome",holder:"owner",updatedAt:at,note:"pending",actor:"owner"});
  applyOwnerCommand(s,{kind:"advance",taskId:t.id,holder:"lab",note:"not met",actual:"still fails",met:false},"owner",at);
  expect(t.closed).toBe(false);expect(t.phase).toBe("analysis");
  expect(staleTasks(s,Date.parse(at)+25*3600000)[0]).toMatchObject({taskId:t.id,holder:"lab",phase:"analysis"});
 });
 it("records publication only against a recorded engineering commit",()=>{
  const m=ready(),t=m.state.tasks[0];
  expect(()=>applyOwnerCommand(m.state,{kind:"publication",taskId:t.id,commit:"abcdef1",fixes:"fix"},"owner",at)).toThrow("PUBLICATION_WITHOUT");
  t.steps.push({phase:"code",holder:"engineer",updatedAt:at,note:"changed",actor:"owner",commit:"abcdef1"});
  applyOwnerCommand(m.state,{kind:"publication",taskId:t.id,commit:"abcdef1",fixes:"fix"},"owner",at);
  expect(m.state.publications[0]).toMatchObject({taskId:t.id,commit:"abcdef1",fixes:"fix"});
 });
 it("models API follows pagination; transport never returns raw errors or secret",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:[{id:"actual-1",display_name:"Haiku"}],has_more:true,last_id:"actual-1"})))
   .mockResolvedValueOnce(new Response(JSON.stringify({data:[{id:"actual-2",display_name:"Sonnet"}],has_more:false})));
  const a=new AnthropicCrewProvider(fetcher as any,()=>"do-not-print-key");
  expect(await a.listModels()).toHaveLength(2);
  expect(fetcher.mock.calls[1][0]).toContain("after_id=actual-1");
  fetcher.mockRejectedValue(Error("do-not-print-key"));
  await expect(a.listModels()).rejects.toThrow("ANTHROPIC_REQUEST_UNCONFIRMED");
 });
});
