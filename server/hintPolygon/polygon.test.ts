import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASELINE, RecipeSchema, assertAdapter, assertIndependent, assertOneFactor, sha, speechEnd, tokenCost, money } from "./contracts";
import { Ledger } from "./ledger";
import { channels, mulaw } from "./audio";
import { summarize, type Row } from "./metrics";
import { chat, judge, parseHint, promptRequest } from "./provider";
import { buildLiveSystemPrompt, buildLiveUserPrompt } from "../../shared/prompts";
import { withActionResults } from "../hintActionResults";
import { buildOpenAIChatBody } from "../hintProvider";

const dirs:string[]=[];
const path=()=>{const d=mkdtempSync(join(tmpdir(),"hint-polygon-"));dirs.push(d);return join(d,"ledger.json");};
it("rejects malformed write metadata before it can make the durable ledger unreadable",()=>{
 const p=path(),l=new Ledger(p);
 expect(()=>l.reserve("x","brain",75,"literal-not-SHA")).toThrow("INVALID_PAYLOAD_HASH");
 expect(()=>l.reserve("","brain",75)).toThrow("INVALID_REQUEST_ID");
 expect(l.snapshot().entries).toHaveLength(0);l.close();
 const reopened=new Ledger(p);expect(reopened.held()).toBe(0);reopened.close();
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
describe("isolated corpus/recipe contract",()=>{
  it("refuses accelerated replay",()=>expect(()=>RecipeSchema.parse({...BASELINE,replayRate:2})).toThrow());
  it("permits precisely one factor, not joint model/prompt changes",()=>{
    expect(assertOneFactor(BASELINE,{...BASELINE,maxOutputTokens:50})).toBe("maxOutputTokens");
    expect(()=>assertOneFactor(BASELINE,{...BASELINE,prompt:"minimal",maxOutputTokens:50})).toThrow();
    expect(()=>assertOneFactor(BASELINE,{...BASELINE})).toThrow();
  });
  it("does not swap judge or label it a one-factor comparison",()=>expect(()=>assertOneFactor(BASELINE,{...BASELINE,judgeModel:"other",stream:true})).toThrow());
  it("recognizes dated model identity",()=>{
    expect(()=>assertIndependent("gpt-5.6-terra","gpt-5.6-terra-2026-08-01")).toThrow();
    expect(()=>assertIndependent("gpt-5.6-terra","gpt-4.1-mini")).not.toThrow();
  });
  it.each([{stream:true},{architecture:"audio-direct"},{cache:"off"},{prompt:"minimal"},{model:"unknown"}])("no fake adapter/substitution %j",override=>{
    expect(()=>assertAdapter({...BASELINE,...override} as any)).toThrow("ADAPTER_NOT_IMPLEMENTED");
  });
  it("uses the actual shared LIVE builder and 250-token wire parameters",()=>{
    const p=promptRequest(BASELINE,"Which day?","Book","Guest: Hi");
    const system=withActionResults(buildLiveSystemPrompt({goal:"Book",language:"ru",conversationContext:"Guest: Hi",contextSections:"",strategyMemory:"",translateEnabled:true}),BASELINE.actionResultsEnabled);
    expect(p.system).toBe(system);
    expect(p.body).toEqual(buildOpenAIChatBody(BASELINE.model,system,buildLiveUserPrompt("Which day?"),250));
    expect(p.body).not.toHaveProperty("stream");
    expect(p.body).not.toHaveProperty("temperature");
    expect(promptRequest(BASELINE,"Other","Other","").version).toBe(p.version);
    expect(promptRequest(BASELINE,"Other","Other","").systemHash).not.toBe(p.systemHash);
  });
  it("uses only LIVE reply schema, not the old benchmark envelope",()=>{
    expect(parseHint('{"translation":"Какой день?","suggestion":{"en":"Monday.","translation":"Понедельник."}}').en).toBe("Monday.");
    expect(()=>parseHint('{"should_suggest":true,"translation":"x","suggested_reply":"x"}')).toThrow("NOT_LIVE_SCHEMA");
    expect(()=>parseHint("broken")).toThrow();
  });
  it("does not turn a live-normalized empty greeting suggestion into a stream failure",()=>{
    expect(parseHint('{"translation":"Привет","suggestion":{"en":"","translation":""}}').en).toBe("");
    expect(parseHint('{"translation":"Привет","suggestion":null}').en).toBe("");
  });
  it("takes the last physical speech end in the provider audio window, never ordinal",()=>{
    const s=[{startMs:100,endMs:250},{startMs:400,endMs:600},{startMs:1400,endMs:1700}];
    expect(speechEnd(s,0,900)).toBe(600);
    expect(speechEnd(s,1200,1800)).toBe(1700);
    expect(speechEnd([{startMs:100,endMs:900}],700,1100)).toBe(900);
    expect(speechEnd(s,0,450)).toBeNull();
    expect(speechEnd(s,900,1100)).toBeNull();
    expect(speechEnd(s,NaN,1100)).toBeNull();
  });
});
describe("series budget, crash and unknown safety",()=>{
  it("reserves before I/O, persists charges and never resets on next day/process",()=>{
    const p=path(),l=new Ledger(p);l.reserve("one","brain",1000);expect(JSON.parse(readFileSync(p,"utf8")).entries[0].status).toBe("reserved");
    l.finish("one",250);l.close();
    const b=new Ledger(p);expect(b.held()).toBe(250);expect(()=>b.reserve("one","brain",100)).toThrow("NO_RETRY");b.close();
  });
  it("holds unknown permanently and forbids its payload even under a new ID",()=>{
    const p=path(),l=new Ledger(p);l.reserve("one","brain",999,sha("payload"));l.unknown("one");expect(l.held()).toBe(999);l.close();
    const b=new Ledger(p);expect(b.held()).toBe(999);
    expect(()=>b.reserve("new-id","brain",999,sha("payload"))).toThrow("UNKNOWN_PAYLOAD_NO_RETRY");
    expect(()=>b.reserve("one","brain",999,sha("different"))).toThrow("REQUEST_ALREADY_STARTED");
    b.reserve("separate-diagnostic","brain",1,sha("minimal separate probe"));b.finish("separate-diagnostic",1);
    expect(b.held()).toBe(1000);b.close();
  });
  it("charges an interrupted reserved request as unknown, not free",()=>{
    const p=path(),l=new Ledger(p);l.reserve("one","brain",55);l.close();
    expect(JSON.parse(readFileSync(p,"utf8")).entries[0]).toMatchObject({status:"unknown",charged:55});
  });
  it("enforces $15 for ALL requests together",()=>{
    const l=new Ledger(path());l.reserve("one","stt",14_999_999);l.finish("one",14_999_999);
    expect(()=>l.reserve("two","brain",2)).toThrow("BUDGET_EXHAUSTED");expect(l.held()).toBe(14_999_999);l.close();
  });
  it("refuses simultaneous operators",()=>{
    const p=path(),l=new Ledger(p);expect(()=>new Ledger(p)).toThrow();l.close();
  });
  it("refuses negative, fractional, over-reservation and duplicate charges",()=>{
    const l=new Ledger(path());expect(()=>l.reserve("x","brain",-1)).toThrow();expect(()=>l.reserve("x","brain",.1)).toThrow();
    l.reserve("x","brain",10);expect(()=>l.finish("x",11)).toThrow();l.finish("x",5);expect(()=>l.finish("x",4)).toThrow();l.close();
  });
  it("refuses a corrupt ledger",()=>{
    const p=path();writeFileSync(p,JSON.stringify({series:"hint-polygon-owner-36-v1",limit:15_000_000,entries:[{id:"a",kind:"x",reserve:1,charged:-500,status:"spent",started:"x"}]}));
    expect(()=>new Ledger(p)).toThrow();
  });
  it("prices cached/uncached tokens and refuses absent usage, not zero dollars",()=>{
    expect(tokenCost({prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:20}},money.brain)).toBe(324);
    expect(tokenCost({prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:20,cache_write_tokens:40}},money.brain)).toBe(304);
    expect(tokenCost({prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:20,cache_write_tokens:0}},money.brain)).toBe(284);
    expect(()=>tokenCost({prompt_tokens:10,completion_tokens:1,prompt_tokens_details:{cached_tokens:5,cache_write_tokens:6}},money.brain)).toThrow("CACHE_WRITE");
    expect(()=>tokenCost(undefined,money.brain)).toThrow();expect(()=>tokenCost({prompt_tokens:10,completion_tokens:1,prompt_tokens_details:{cached_tokens:11}},money.brain)).toThrow();
  });
});
describe("provider failures, blind judge and first-word contract",()=>{
  function reply(model:string,text:string,reason="stop"){
    return {ok:true,status:200,headers:new Headers({"x-request-id":"test-id"}),json:async()=>({model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{finish_reason:reason,message:{content:text}}]})};
  }
  it("sends once; HTTP error is unknown and no retry",async()=>{
    const f=vi.fn(async()=>({ok:false,status:429,headers:new Headers({"x-request-id":"failure"}),json:async()=>({error:{code:"insufficient_quota"}})}));
    vi.stubGlobal("fetch",f);const l=new Ledger(path());
    await expect(chat(l,"x","brain",{model:BASELINE.model,max_completion_tokens:250,messages:[]})).rejects.toThrow("429_insufficient_quota");
    expect(f).toHaveBeenCalledTimes(1);expect(l.snapshot().entries[0]).toMatchObject({status:"unknown",httpStatus:429,requestId:"failure"});l.close();
  });
  it("records sanitized parameter/error text, never the key",async()=>{
    const key="sk-test-NOT_A_REAL_KEY";vi.stubEnv("OPENAI_API_KEY",key);
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:false,status:400,headers:new Headers({"x-request-id":"parameter"}),
      json:async()=>({error:{code:"invalid_request_error",param:"max_tokens",message:`Unsupported parameter; key ${key}`}})})));
    const p=path(),l=new Ledger(p);
    await expect(chat(l,"diag","judge",{model:BASELINE.judgeModel,max_tokens:32,messages:[]})).rejects.toThrow("400");
    expect(readFileSync(p,"utf8")).not.toContain(key);
    expect(l.snapshot().entries[0]).toMatchObject({errorParam:"max_tokens",requestId:"parameter",httpStatus:400});
    l.close();vi.unstubAllEnvs();
  });
  it("rejects JSON mode lacking the JSON instruction BEFORE spending",async()=>{
    const p=path(),l=new Ledger(p),f=vi.fn();vi.stubGlobal("fetch",f);
    await expect(chat(l,"json-missing","judge",{model:BASELINE.judgeModel,max_tokens:32,
      response_format:{type:"json_object"},messages:[{role:"user",content:"Return {}."}]})).rejects.toThrow("JSON_MODE_REQUIRES");
    expect(l.snapshot().entries).toHaveLength(0);expect(f).not.toHaveBeenCalled();l.close();
  });
  it("rejects successful but truncated output and still counts its usage",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>reply(BASELINE.model,"{}", "length")));const l=new Ledger(path());
    await expect(chat(l,"x","brain",{model:BASELINE.model,max_completion_tokens:250,messages:[]})).rejects.toThrow("TRUNCATED");
    expect(l.snapshot().entries[0].status).toBe("spent");expect(l.held()).toBe(265);l.close();
  });
  it("rejects silently substituted model",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>reply("another-model","{}")));const l=new Ledger(path());
    await expect(chat(l,"x","brain",{model:BASELINE.model,max_completion_tokens:250,messages:[]})).rejects.toThrow("SUBSTITUTION");l.close();
  });
  it("validates every judge turn/dimension, no fabricated pass",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>reply(BASELINE.judgeModel,'{"items":[{"turnId":"a","grounding":5,"relevance":4,"speakability":3,"translation":4}]}')));
    const l=new Ledger(path());
    expect(await judge(l,"j",BASELINE,"",[{turnId:"a",question:"q",hint:"h",translation:"t",history:""}])).toBe(4);l.close();
  });
  it("rejects incomplete and duplicate judge output",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>reply(BASELINE.judgeModel,'{"items":[]}')));const l=new Ledger(path());
    await expect(judge(l,"j",BASELINE,"",[{turnId:"a",question:"q",hint:"h",translation:"t",history:""}])).rejects.toThrow("JUDGE_INCOMPLETE");l.close();
  });
});
describe("invalid attempts never improve rank or disappear from cost",()=>{
  const row=(valid:boolean,n:number,quality:number):Row=>({
    fixtureId:"a",recipeId:BASELINE.id,corpusHash:"c",recipeHash:"r",codeCommit:"c",valid,reasons:[],quality,chargedMicro:500,
    clockMaxDriftMs:1,durationMs:1000,contextProvenance:"test",judgeModel:BASELINE.judgeModel,promptVersion:"v",
    turns:[{turnId:"a",speechEndMs:1000,sttFinalMs:1200,firstWordMs:n,fullHintMs:n,translationMs:n,valid:true,systemHash:"h",systemChars:10}],
  });
  it("excludes invalid speed/quality but includes every attempted dollar",()=>{
    const s=summarize([row(true,3500,4),row(false,1001,5)],36);
    expect(s.timings.firstHintWord).toMatchObject({n:1,p50Ms:2500,p95Ms:2500});
    expect(s.quality).toBe(4);expect(s.chargedMicro).toBe(1000);expect(s.invalidCalls).toBe(1);
    expect(s.nextRecipesAllowed).toBe(false);
  });
  it("does not call empty corpus fast or perfect",()=>{
    const s=summarize([],36);expect(s.timings.fullHint.p50Ms).toBeNull();expect(s.quality).toBeNull();
  });
});
describe("audio is not resampled/enhanced or silently remapped",()=>{
  it("G.711 mu-law known vectors",()=>{expect(mulaw(0)).toBe(255);expect(mulaw(32767)).toBe(128);expect(mulaw(-32768)).toBe(0);});
  it("rejects wrong/truncated WAV rather than making a synthetic reference",()=>{
    expect(()=>channels(Buffer.alloc(44))).toThrow("BAD_WAV");
  });
});
