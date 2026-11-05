import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import calls from "./opening.real-calls.fixture.json";
import { PhoneOpeningGate } from "./opening";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import { CResponseBuffer } from "../secretaryLab/cResponseBuffer";
import { legacySecretaryPlan, secretaryInstruction } from "../../shared/callPlan";

class Socket extends EventEmitter {
  readyState=1;bufferedAmount=0;sent:any[]=[];
  send(s:string){this.sent.push(JSON.parse(s));}
  close(){this.readyState=3;this.emit("close");}
  frame(frame:object){this.emit("message",Buffer.from(JSON.stringify(frame)),false);}
}
const turn=(content:string)=>[{role:"user" as const,content}];
const introduction="Hello, I am the owner's secretary.";
function setup(profile:"C"|"legacy"="C"){
  const stream=vi.fn(async function*(_request:any){
    await new Promise(resolve=>setTimeout(resolve,100));
    yield {type:"text" as const,text:introduction};
    yield {type:"complete" as const,tools:[],output:[]};
  });
  const end=vi.fn(async()=>{});
  const registry=new RetellEngineRegistry(stream,{phone:true,phoneProfile:()=>profile,onNoHuman:end});
  const entry=registry.reserve("fixture","Ask about repair","task");
  registry.registered("task","call_fixture");
  const ws=new Socket();registry.attach(ws as any,`/retell-phone-engine/${entry.ticket}/call_fixture`);
  ws.frame({interaction_type:"call_details",call:{call_id:"call_fixture",call_type:"phone_call"}});
  return {stream,end,registry,ws};
}
afterEach(()=>vi.useRealTimers());
describe("Read-only real call greeting regressions — no network/models",()=>{
  it("reproduces the old C buffer silence: identical user_turn update pauses the prepared greeting",async()=>{
    vi.useFakeTimers();
    const send=vi.fn();
    const b=new CResponseBuffer({generate:async(_turns,_signal,emit)=>{
      await new Promise(resolve=>setTimeout(resolve,100));emit(introduction);
    },send,record:vi.fn(),error:()=>({message:"error",end:false})});
    b.request(1,turn(calls.anytime[0]));
    b.update(turn(calls.anytime[0]),true);
    await vi.advanceTimersByTimeAsync(100);
    expect(send).not.toHaveBeenCalled();b.close();
  });
  it.each(["C","legacy"] as const)("Anytime: first greeting escapes stale ASR pause (%s)",async profile=>{
    vi.useFakeTimers();const {ws,registry,stream,end}=setup(profile);
    const transcript=turn(calls.anytime[0]);
    ws.frame({interaction_type:"update_only",turntaking:"user_turn",transcript});
    ws.frame({interaction_type:"response_required",response_id:1,transcript});
    await vi.advanceTimersByTimeAsync(0);
    for(let i=0;i<3;i++)ws.frame({interaction_type:"update_only",turntaking:"user_turn",transcript});
    await vi.advanceTimersByTimeAsync(100);
    expect(ws.sent.filter(f=>f.content).map(f=>f.content)).toEqual([introduction]);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0].input.some((t:any)=>t.content?.includes("Give the trusted introduction NOW"))).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);expect(end).not.toHaveBeenCalled();registry.dispose();
  });
  it.each(["C","legacy"] as const)("Pilot 208: late live greeting at 25s, not a premature hangup (%s)",async profile=>{
    vi.useFakeTimers();const {ws,registry,end,stream}=setup(profile);
    await vi.advanceTimersByTimeAsync(25000);expect(end).not.toHaveBeenCalled();
    const transcript=turn(calls.pilot208[0]);
    ws.frame({interaction_type:"response_required",response_id:1,transcript});
    await vi.advanceTimersByTimeAsync(100);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(ws.sent.filter(f=>f.content).map(f=>f.content)).toEqual(["Hi, hello?",introduction]);
    await vi.advanceTimersByTimeAsync(60000);expect(end).not.toHaveBeenCalled();registry.dispose();
  });
  it.each(["C","legacy"] as const)("a real correction still cancels the old greeting (%s)",async profile=>{
    vi.useFakeTimers();const {ws,registry,stream}=setup(profile);
    ws.frame({interaction_type:"response_required",response_id:1,transcript:turn(calls.anytime[0])});
    await vi.advanceTimersByTimeAsync(0);
    const corrected=turn(calls.anytime[0]+" No, the price is 200.");
    ws.frame({interaction_type:"update_only",turntaking:"user_turn",transcript:corrected});
    await vi.advanceTimersByTimeAsync(100);expect(ws.sent.filter(f=>f.content)).toHaveLength(0);
    ws.frame({interaction_type:"response_required",response_id:2,transcript:corrected});
    // C retains its existing 150ms coalescing delay for a genuine correction;
    // the fake stream then takes 100ms. Legacy starts immediately.
    await vi.advanceTimersByTimeAsync(profile==="C"?249:99);
    expect(ws.sent.filter(f=>f.content)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ws.sent.filter(f=>f.content).map(f=>f.content)).toEqual([introduction]);
    expect(stream).toHaveBeenCalledTimes(2);registry.dispose();
  });
  it("Flying J real fragmented recording at 25s stays silent until its own 20s deadline",async()=>{
    vi.useFakeTimers();const {ws,registry,end,stream}=setup();
    await vi.advanceTimersByTimeAsync(25000);expect(end).not.toHaveBeenCalled();
    ws.frame({interaction_type:"update_only",turntaking:"user_turn",transcript:turn(calls.flying706[0])});
    ws.frame({interaction_type:"response_required",response_id:1,transcript:calls.flying706.map(content=>({role:"user",content}))});
    await vi.advanceTimersByTimeAsync(19999);
    expect(stream).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();
    expect(ws.sent.filter(f=>f.content).map(f=>f.content)).toEqual(["Hi, hello?"]);
    await vi.advanceTimersByTimeAsync(1);expect(end).toHaveBeenCalledExactlyOnceWith("task","no_human_20s");registry.dispose();
  });
  it("R&D actual voicemail is recognized and skipped without a model within 1500ms",async()=>{
    vi.useFakeTimers();
    const stream=vi.fn(),end=vi.fn(async()=>{});
    const reg=new RetellEngineRegistry(stream,{phone:true,phoneProfile:()=>"C",onNoHuman:end});
    const entry=reg.reserve("fixture",secretaryInstruction({...legacySecretaryPlan("Ask about repair","+15550000001"),sayAsk:["Skip voicemail."]}),"task");
    reg.registered("task","call_vm");const socket=new Socket();
    reg.attach(socket as any,`/retell-phone-engine/${entry.ticket}/call_vm`);
    socket.frame({interaction_type:"call_details",call:{call_id:"call_vm",call_type:"phone_call"}});
    socket.frame({interaction_type:"update_only",turntaking:"user_turn",transcript:turn(calls.rd[0])});
    await vi.advanceTimersByTimeAsync(1500);
    expect(end).toHaveBeenCalledExactlyOnceWith("task","voicemail_skip");expect(stream).not.toHaveBeenCalled();
    expect(socket.sent.filter(f=>f.content)).toHaveLength(0);reg.dispose();
  });
  it("an old recording cannot trap a company greeting; only explicit markers justify silence",()=>{
    const gate=new PhoneOpeningGate();
    expect(gate.permit(turn("Thank you for calling"))).toBe(false);
    expect(gate.permit(turn(calls.anytime[0]))).toBe(true);
    for(const greeting of ["hello","Anytime Anywhere truck repair.","…send me your struck repair","Thank you"])
      expect(new PhoneOpeningGate().permit(turn(greeting))).toBe(true);
    const partial=new PhoneOpeningGate();
    expect(partial.permit(turn("Hello"),false)).toBe(false);
    expect(partial.permit(turn("Hello, press one for service"))).toBe(false);
  });
});
