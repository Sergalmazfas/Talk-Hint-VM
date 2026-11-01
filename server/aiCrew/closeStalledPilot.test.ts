import { describe, expect, it, vi } from "vitest";
import { applyOwnerCommand, commandSchema, initialState, type CrewState } from "./domain";
import { HINT_AGENTS, STALLED_PILOT_OUTCOME } from "./hintPilot";
import { projectHintEvidence } from "./hintEvidence";
import { CrewRuntime } from "./runtime";

const at="2026-11-01T20:00:00Z", owner="owner", models=HINT_AGENTS.map(a=>a.modelId);
const evidence=()=>projectHintEvidence({calls:[{latency:{e2eP95Ms:4000},sla:1000}],reports:[],problems:[]});
function stalled(){
  const s=initialState();
  applyOwnerCommand(s,{kind:"hint_pilot_prepare",candidate:"latency",ratesConfirmed:true},owner,at,models,evidence());
  applyOwnerCommand(s,{kind:"control",enabled:true,dailyLimitMicroUsd:1000000,staleHours:24},owner,at);
  applyOwnerCommand(s,{kind:"hint_pilot_start",taskId:s.tasks[0].id,ownerApproved:true},owner,at);
  applyOwnerCommand(s,{kind:"control",enabled:false,dailyLimitMicroUsd:1000000,staleHours:24},owner,at);
  return s;
}
const close=(s:CrewState,actor=owner)=>applyOwnerCommand(s,{
  kind:"hint_pilot_close_stalled",taskId:s.tasks[0].id,ownerApproved:true},actor,at);

describe("owner closes an unexecuted stalled Hint pilot",()=>{
  it("atomically records a failed outcome, discards queued runs at zero cost, preserves history and spending",()=>{
    const s=stalled(), oldTask=structuredClone(s.tasks[0]), oldJournal=structuredClone(s.journal);
    s.budget["2026-10-31"]={spent:12345,reserved:0};
    const budget=structuredClone(s.budget),epoch=s.control.epoch;
    close(s);
    expect(s.tasks).toHaveLength(1);expect(s.runs).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({id:oldTask.id,closed:true,phase:"outcome",hintPilot:{status:"not_completed"}});
    expect(s.tasks[0].steps.slice(0,-1)).toEqual(oldTask.steps);
    expect(s.tasks[0].steps.at(-1)).toMatchObject({actual:STALLED_PILOT_OUTCOME,note:STALLED_PILOT_OUTCOME,
      met:false,holder:owner,actor:owner,updatedAt:at});
    expect(s.runs[0]).toMatchObject({status:"discarded",cost:0,completedAt:at});
    expect(s.budget).toEqual(budget);
    expect(s.journal.slice(0,oldJournal.length)).toEqual(oldJournal);
    expect(s.journal.at(-1)).toMatchObject({kind:"hint_pilot_closed_stalled",actor:owner,
      detail:{costMicroUsd:0,previousLimitMicroUsd:1000000,dailyLimitMicroUsd:0,agentsStarted:false}});
    expect(s.journal.some(e=>e.kind==="run_discarded_without_execution")).toBe(true);
    expect(s.control).toMatchObject({enabled:false,dailyLimitMicroUsd:0,epoch:epoch+1});
  });
  it.each(["on","running","unknown","run_reserve","budget_reserve","old_budget_reserve",
    "paid","usage","done","proposal","review","closed","no_queue","prepared"])("refuses %s before any mutation",kind=>{
    const s=stalled(),run=s.runs[0],p=s.tasks[0].hintPilot!;
    if(kind==="on")s.control.enabled=true;
    if(kind==="running"||kind==="unknown"||kind==="done")run.status=kind;
    if(kind==="run_reserve")run.reserved=1;
    if(kind==="budget_reserve")s.budget["2026-11-01"]={spent:0,reserved:1};
    if(kind==="old_budget_reserve")s.budget["2026-10-31"]={spent:0,reserved:1};
    if(kind==="paid")run.cost=1;
    if(kind==="usage")run.usage={input_tokens:1,output_tokens:0};
    if(kind==="proposal")p.proposalId="already-proposed";
    if(kind==="review")p.status="review";
    if(kind==="closed")s.tasks[0].closed=true;
    if(kind==="no_queue")run.status="discarded";
    if(kind==="prepared")p.status="prepared";
    const before=structuredClone(s);
    expect(()=>close(s)).toThrow();
    expect(s).toEqual(before);
  });
  it("rejects another owner, missing confirmation, repeat close and nonexistent tasks",()=>{
    const s=stalled(),before=structuredClone(s);
    expect(()=>close(s,"other-owner")).toThrow();expect(s).toEqual(before);
    expect(commandSchema.safeParse({kind:"hint_pilot_close_stalled",taskId:s.tasks[0].id}).success).toBe(false);
    expect(commandSchema.safeParse({kind:"hint_pilot_close_stalled",taskId:s.tasks[0].id,ownerApproved:false}).success).toBe(false);
    expect(()=>applyOwnerCommand(s,{kind:"hint_pilot_close_stalled",taskId:crypto.randomUUID(),ownerApproved:true},owner,at)).toThrow("TASK_NOT_FOUND");
    close(s);const closed=structuredClone(s);
    expect(()=>close(s)).toThrow();expect(s).toEqual(closed);
  });
  it("allows a new prepare → enable → start, but never starts anything as an effect of close or preparation",async()=>{
    let state=stalled();const id=state.tasks[0].id;
    const store={read:async()=>structuredClone(state),change:async<T>(fn:(s:CrewState)=>T)=>{
      const next=structuredClone(state),result=fn(next);next.revision++;state=next;return result;
    }};
    const message=vi.fn(async(model:string)=>({model,text:"fixture",usage:{input_tokens:1,output_tokens:1}}));
    const runtime=new CrewRuntime(store,{message,listModels:async()=>[]},"production");
    close(state);await runtime.tick();expect(message).not.toHaveBeenCalled();
    applyOwnerCommand(state,{kind:"hint_pilot_prepare",candidate:"latency",ratesConfirmed:true},owner,at,models,evidence());
    expect(state.tasks).toHaveLength(2);expect(state.tasks[0].id).toBe(id);
    applyOwnerCommand(state,{kind:"control",enabled:true,dailyLimitMicroUsd:1000000,staleHours:24},owner,at);
    await runtime.tick();expect(message).not.toHaveBeenCalled();
    applyOwnerCommand(state,{kind:"hint_pilot_start",taskId:state.tasks[1].id,ownerApproved:true},owner,at);
    await runtime.tick();expect(message).toHaveBeenCalledTimes(1);
    expect(state.runs[0]).toMatchObject({taskId:id,status:"discarded",cost:0});
  });
});
