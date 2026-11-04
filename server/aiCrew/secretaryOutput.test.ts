import { describe, it, expect, vi } from "vitest";
import { initialState } from "./domain";
import { CrewRuntime } from "./runtime";
import { AnthropicCrewProvider, CrewProviderError } from "./anthropic";
import { configureSecretary, queueSecretaryReview, secretaryEvidence, secretaryHash, SECRETARY_AGENTS, finishSecretaryRun } from "./secretaryReview";
import { compareExpectations, type ExpectationSnapshot } from "./expectations";
import { mannerKinds, secretaryOutputSchema, validSecretaryOutput } from "./secretaryOutput";
import { renderProcessLetter } from "../callLab/processReport";

const at="2026-11-04T10:00:00Z";
const manners=mannerKinds.map(kind=>({kind,value:0,quote:"",turn:-1,reason:"No occurrence in excerpt"}));
const author={points:[{index:0,kind:"ask",status:"выполнено",quote:"$150",turn:0,reason:"Quoted price"}],
  openingLanguage:"en",recognitionIssues:[],unverified:[],manners, proposals:[],expectationChecks:[],
  dialogue:{checklist:[{index:0,kind:"ask",answer:"$150",closed:true,quote:"$150",turn:0}],katyaTurns:0,excessTurns:0,
    hypothetical:true,ideal:[{speaker:"guest",text:"$150",sourceTurns:[0]}]}};
function harness() {
  let s=initialState();
  configureSecretary(s,true,20e6,"owner",at,SECRETARY_AGENTS.map(a=>a.modelId),1e6);
  queueSecretaryReview(s,"owner","fixture",secretaryEvidence("Confirm price",[{role:"guest",text:"$150"}],"fixture"),
    Object.fromEntries(SECRETARY_AGENTS.map(a=>[a.agentId,{traits:["a","b","c"],motto:"test"}])),at);
  const store:any={read:async()=>structuredClone(s),change:async(fn:any)=>{
    const next=structuredClone(s),v=await fn(next);next.revision++;s=next;return v;
  }};
  return {store,state:()=>s};
}
const response=(text:string,stopReason="end_turn")=>({text,model:SECRETARY_AGENTS[0].modelId,
  stopReason,usage:{input_tokens:2,output_tokens:3},http:{httpStatus:200,requestId:"fixture"}});
describe("Secretary structured output and bounded paid completion",()=>{
  it("QA can confirm an honest missed expectation; a failed goal never becomes owner acceptance",async()=>{
    const h=harness(),snapshot:ExpectationSnapshot={documentId:"DOC-TALKHINT-IMPROVEMENT-JOURNAL",documentHash:"a".repeat(64),
      status:"available",targets:[{entryId:"before",recordedAt:"2026-11-04T09:00:00Z",metric:"katya_turns",operator:"lte",value:6,unit:"turns"}]};
    await h.store.change((s:any)=>{const p=s.tasks[0].secretaryReview;
      p.evidence.expectations=snapshot;p.evidence.transcript.push(...Array.from({length:8},(_,i)=>({speaker:"secretary",text:`Question ${i+1}`})));
      p.evidenceHash=secretaryHash(p.evidence);
    });
    const a={...author,dialogue:{...author.dialogue,katyaTurns:8}};
    a.expectationChecks=compareExpectations(snapshot,a,8).map(r=>({...r,reason:"8 реплик вместо не более 6"})) as any;
    const outputs=[a,{verdict:"confirmed",checks:a.points.map(({status,...r})=>r),disagreements:[],unverified:[],manners,
      dialogue:a.dialogue,expectationChecks:a.expectationChecks},
      {outcome:"ожидание не сошлось",agreed:["price"],remaining:[],unverified:[],learned:"8 реплик",wentWrong:"8 > 6",nextAction:"Владельцу",proposals:[]}];
    let i=0;const provider:any={message:async(model:string)=>({...response(JSON.stringify(outputs[i++])),model})};
    const runtime=new CrewRuntime(h.store,provider,"production",()=>new Date(at));
    await runtime.tick();await runtime.tick();await runtime.tick();
    expect(h.state().tasks[0].secretaryReview).toMatchObject({authorValid:true,verdict:"confirmed",status:"reported"});
    expect(JSON.parse(h.state().documents[0].text).expectationChecks[0].status).toBe("не сошлось");
  });
  it("the actual three-stage dispatcher accepts the expanded schema without weakening independent QA",async()=>{
    const h=harness(),outputs=[author,
      {verdict:"confirmed",checks:author.points.map(({status,...row})=>row),disagreements:[],unverified:[],manners,dialogue:author.dialogue,expectationChecks:[]},
      {outcome:"price confirmed",agreed:["$150"],remaining:[],unverified:[],learned:"Price $150",wentWrong:"none",nextAction:"Owner decides",proposals:[]}];
    let i=0;
    const provider:any={message:async(model:string)=>({...response(JSON.stringify(outputs[i++])),model})};
    const runtime=new CrewRuntime(h.store,provider,"production",()=>new Date(at));
    await runtime.tick();await runtime.tick();await runtime.tick();
    expect(i).toBe(3);expect(h.state().tasks[0].secretaryReview).toMatchObject({status:"reported",verdict:"confirmed",authorValid:true});
    expect(h.state().runs.every(r=>r.status==="done")).toBe(true);
  });
  it("sends Anthropic JSON schema alongside model effort, exposes stop_reason",async()=>{
    let body:any;
    const fetcher:any=async(_:unknown,init:any)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({
      model:"claude-sonnet-5-5",content:[{type:"text",text:'{"points":['}],stop_reason:"max_tokens",
      usage:{input_tokens:1,output_tokens:2}}),{status:200});};
    const result=await new AnthropicCrewProvider(fetcher,()=>"fixture").message("claude-sonnet-5-5","evidence",6000,
      new AbortController().signal,{schema:secretaryOutputSchema("author")});
    expect(body.max_tokens).toBe(6000);expect(body.output_config.effort).toBe("high");
    expect(body.output_config.format.type).toBe("json_schema");expect(result.stopReason).toBe("max_tokens");
    expect(body.tools).toBeUndefined();
  });
  it("reserves two calls, completes only a known cutoff once, sums actual usage and never slices the JSON",async()=>{
    const h=harness(),large={...author,recognitionIssues:Array(5).fill("x".repeat(4000))};
    const provider:any={message:vi.fn().mockResolvedValueOnce(response('{"points":[',"max_tokens"))
      .mockResolvedValueOnce(response(JSON.stringify(large)))};
    await new CrewRuntime(h.store,provider,"production",()=>new Date(at)).tick();
    expect(provider.message).toHaveBeenCalledTimes(2);expect(provider.message.mock.calls[0][2]).toBe(6000);
    expect(provider.message.mock.calls[1][2]).toBe(12000);
    expect(provider.message.mock.calls[1][4].partial).toBe('{"points":[');
    const s=h.state();expect(s.documents[0].text.length).toBeGreaterThan(16000);
    expect(JSON.parse(s.documents[0].text)).toEqual(large);
    expect(s.runs[0].usage).toEqual({input_tokens:4,output_tokens:6});
    expect(s.runs[0].cost).toBe(68);expect(s.tasks[0].secretaryReview?.authorValid).toBe(true);
    expect(s.secretaryBudget?.["2026-11"].reserved).toBe(0);
  });
  it("does not retry a second cutoff, does not invent success",async()=>{
    const h=harness(),provider:any={message:vi.fn().mockResolvedValue(response('{"points":[',"max_tokens"))};
    await new CrewRuntime(h.store,provider,"production",()=>new Date(at)).tick();
    expect(provider.message).toHaveBeenCalledTimes(2);
    expect(h.state().tasks[0].secretaryReview).toMatchObject({authorValid:false,error:"OUTPUT_TRUNCATED_UNVERIFIED"});
  });
  it("does not retry unknown transport; reserves are retained",async()=>{
    const h=harness(),provider:any={message:vi.fn().mockRejectedValue(new CrewProviderError("transport_or_parse"))};
    const runtime=new CrewRuntime(h.store,provider,"production",()=>new Date(at));
    await runtime.tick();await runtime.tick();
    expect(provider.message).toHaveBeenCalledTimes(1);expect(h.state().runs[0].status).toBe("unknown");
    expect(h.state().secretaryBudget?.["2026-11"].reserved).toBeGreaterThan(0);
  });
  it("does not refund a paid partial if completion returns 400",async()=>{
    const h=harness(),provider:any={message:vi.fn().mockResolvedValueOnce(response("partial","max_tokens"))
      .mockRejectedValueOnce(new CrewProviderError("http_rejected",{httpStatus:400,requestId:"rejected"}))};
    await new CrewRuntime(h.store,provider,"production",()=>new Date(at)).tick();
    expect(h.state().runs[0].status).toBe("unknown");expect(h.state().secretaryBudget?.["2026-11"].reserved).toBeGreaterThan(0);
  });
  it("blocks before any request if the complete envelope cannot be reserved",async()=>{
    const h=harness();await h.store.change((s:any)=>{s.control.dailyLimitMicroUsd=100;});
    const provider:any={message:vi.fn()};
    await new CrewRuntime(h.store,provider,"production",()=>new Date(at)).tick();
    expect(provider.message).not.toHaveBeenCalled();
  });
  it("validates every manner and rejects fabricated evidence",()=>{
    expect(validSecretaryOutput("author",author)).toBe(true);
    expect(validSecretaryOutput("author",{...author,manners:[]})).toBe(false);
    const h=harness(),s=h.state(),task=s.tasks[0];task.secretaryReview!.outputVersion=2;
    finishSecretaryRun(s,task,"fixture",JSON.stringify({...author,manners:manners.map((m,i)=>i?m:
      {...m,value:1,quote:"invented",turn:0})}),at);
    expect(task.secretaryReview!.authorValid).toBe(false);
  });
  it("keeps public businesses/domains and business addresses, masks private introductions and home addresses",()=>{
    const e=secretaryEvidence("Call Pilot Flying J about Goodyear",[
      {role:"guest",text:"this is Pilot Flying J. Visit https://PilotFlyingJ.com or PilotFlyingJ.com. 123 Travel Road."},
      {role:"guest",text:"my name is Alice. my home address is 42 Private Road. Call +1 555 777 8888."},
    ],"fixture");
    const text=JSON.stringify(e);
    for(const t of ["Pilot Flying J","PilotFlyingJ.com","Goodyear","123 Travel Road"])expect(text).toContain(t);
    for(const t of ["Alice","42 Private","555"])expect(text).not.toContain(t);
  });
  it("starts the actual letter with exactly three summary lines and puts detail below",()=>{
    const report:any={mode:"secretary",secretary_summary:{learned:"Price",wentWrong:"QA returned",nextAction:"Check transcript"},
      action_reports:[{id:"x",role:"SECRETARY",assigned:"goal",succeeded:["detail"],failed:[],needsOwner:[]}]};
    const {body}=renderProcessLetter(report);
    expect(body.split("\n").slice(0,3)).toEqual(["Что узнали: Price","Что пошло не так: QA returned","Что сделать: Check transcript"]);
    expect(body.indexOf("detail")).toBeGreaterThan(body.indexOf("Что сделать"));
    expect(body).not.toContain("AI-оценка качества не выполнялась");
  });
});
