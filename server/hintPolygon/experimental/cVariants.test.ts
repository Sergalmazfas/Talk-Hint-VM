import {describe,it,expect,vi,beforeEach}from"vitest";
import {BASELINE,assertAdapter,assertPaidRecipeOpen,assertOneFactor,type Recipe}from"../contracts";
import {promptRequest,recentTurns}from"../provider";
import {addonCard,textEngine}from"./textEngine";
import {chat}from"../provider";
import {streamHint}from"./stream";
import type{Fixture}from"../replay";
import type{Ledger}from"../ledger";

vi.mock("../provider",async original=>({...await original<typeof import("../provider")>(),chat:vi.fn()}));
vi.mock("./stream",()=>({streamHint:vi.fn()}));
const c:Recipe={...BASELINE,id:"c",architecture:"hint-first",stream:true,translation:"separate"};
const cards=[{id:"parking",triggers:["truck","parking"],en:"Is truck parking available?",native:"Есть парковка?"}];
beforeEach(()=>{vi.clearAllMocks();});
describe("English-first one-factor follow-ups",()=>{
 it("closes standalone D/E/speculation and defers native without removing historical adapters",()=>{
  for(const architecture of ["speculative","classifier-card","precomputed","audio-direct"]as const)
   expect(()=>assertPaidRecipeOpen({...c,architecture})).toThrow(/OWNER_NO_PAID_REQUEST/);
  expect(()=>assertPaidRecipeOpen({...c,architecture:"hint-first-cards"})).not.toThrow();
 });
 it("allows exactly one of short prompt, Flux threshold, cards; refuses combinations",()=>{
  for(const r of [{...c,prompt:"reduced"as const},{...c,eotThreshold:.6},{...c,eotThreshold:.5},{...c,architecture:"hint-first-cards"as const}]){
   expect(()=>assertAdapter(r)).not.toThrow();expect(()=>assertOneFactor(c,r)).not.toThrow();
  }
  expect(()=>assertAdapter({...c,prompt:"reduced",eotThreshold:.6})).toThrow();
  expect(()=>assertAdapter({...c,architecture:"hint-first-cards",eotThreshold:.5})).toThrow();
  expect(()=>assertAdapter({...c,eotTimeoutMs:2000,eotThreshold:.6})).toThrow();
 });
 it("uses saved goal and only last three complete turns, preserving wrapped text",()=>{
  const history="Owner: OLD_SECRET\nGuest: Old question\nOwner: Monday\nwrapped owner text\nGuest: Is parking available?";
  expect(recentTurns(history)).toBe("Guest: Old question\nOwner: Monday\nwrapped owner text\nGuest: Is parking available?");
  const r=promptRequest({...c,prompt:"reduced"},"Is parking available?","Ask about parking",history);
  expect(r.system).toContain("Ask about parking");expect(r.system).not.toContain("OLD_SECRET");
  expect(r.system).toContain("Never invent");expect(r.version).toMatch(/^lab-short-three-/);
  expect(r.systemChars).toBeLessThan(promptRequest(c,"question","goal",history).systemChars);
  expect(()=>promptRequest({...BASELINE,prompt:"reduced"},"","","")).toThrow();
 });
 it("does not match generic words, one-keyword overlap or a negative sentence",()=>{
  expect(addonCard("Can you help please?",cards)).toBeNull();
  expect(addonCard("Is parking available?",cards)).toBeNull();
  expect(addonCard("No truck parking is available",cards)).toBeNull();
  expect(addonCard("What about truck parking?",cards)?.id).toBe("parking");
 });
 for(const hit of [true,false])it(`card ${hit?"hit":"miss"} retains Guest translation and ${hit?"avoids":"uses"} SSE`,async()=>{
  vi.mocked(chat).mockResolvedValueOnce({prepared:cards,usage:{prompt_tokens:10,completion_tokens:10}}as any)
   .mockResolvedValueOnce({prepared:{translation:"Перевод гостя",native:"Перевод ответа"},readyAt:123,usage:{prompt_tokens:5,completion_tokens:5}}as any);
  vi.mocked(streamHint).mockResolvedValue({en:"Could you clarify?",firstAt:100,fullAt:110,usage:{prompt_tokens:5,completion_tokens:5}}as any);
  const e=textEngine({id:"fixture",goal:"Ask about parking"}as Fixture,{...c,architecture:"hint-first-cards"},{}as Ledger,"test");
  await e.open();const h=await e.generate("t",hit?"What about truck parking?":"What is the price?","Guest: question","key");
  expect(h.translation).toBe("Перевод гостя");
  expect(streamHint).toHaveBeenCalledTimes(hit?0:1);
  expect(chat).toHaveBeenCalledTimes(2);expect(e.audit!()).toContainEqual(expect.objectContaining({stage:"card-decision",hit}));
 });
});
