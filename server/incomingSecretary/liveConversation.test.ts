import { it,expect,vi } from "vitest";
import { LiveConversation } from "./liveConversation";
import { liveConfig,LiveAudio,LIVE_BACKEND } from "./liveAudio";
import { MemoryRequests } from "./store";
import { IntakeSession } from "./session";
import { defaults } from "./policy";
import { EventEmitter } from "node:events";

async function fixture(){
  const store=new MemoryRequests(),session=new IntakeSession("owner","test-live",defaults("work"),store);await session.begin();
  let event!:(e:any)=>void;const sent:any[]=[],received:any[]=[];
  const ai={connect:vi.fn(async()=>{}),send:vi.fn((e:any)=>{sent.push(e)}),close:vi.fn(async()=>true)};
  const peer={readyState:1,send:(s:string)=>{received.push(JSON.parse(s))},close:vi.fn()};
  const c=new LiveConversation(session,"approved work facts only",peer,(_t,cb)=>{event=cb;return ai});await c.start();
  const native=(e:object)=>event({type:"response.event",event:e});
  return {c,store,session,ai,peer,sent,received,event,native,record:()=>store.records.get("test-live")!};
}
it("uses native Live with explicit voice/backend, recording off and intake-only functions",()=>{
  const config=liveConfig("allowed cards");
  expect(config).toMatchObject({model:"gpt-live-1",store:false,audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}});
  expect(config.delegation.responses.model).toBe(LIVE_BACKEND);
  expect(config.delegation.responses.tools.map(t=>t.name)).toEqual(["save_request","submit_request"]);
  expect(JSON.stringify(config)).not.toMatch(/server_vad|semantic_vad|ElevenLabs|Cartesia|web_search/);
});
it("streams native audio and independent captions without Realtime truncation or cancel",async()=>{
  const f=await fixture();
  f.c.input({type:"audio",audio:Buffer.alloc(160,255).toString("base64")});
  f.event({type:"session.output_audio.delta",delta:Buffer.alloc(160,255).toString("base64")});
  f.event({type:"session.input_transcript.delta",event_id:"i1",start_ms:0,end_ms:100,delta:"Здравствуйте"});
  f.event({type:"session.output_transcript.delta",event_id:"o1",start_ms:20,end_ms:120,delta:"Да"});
  f.event({type:"session.input_transcript.delta",event_id:"i2",start_ms:100,end_ms:200,delta:", ¿hola? ¡Sí!"});
  f.event({type:"session.input_transcript.delta",event_id:"i2",start_ms:100,end_ms:200,delta:"duplicate"});
  await vi.waitFor(()=>expect(f.record().turns[0]?.text).toBe("Здравствуйте, ¿hola? ¡Sí!"));
  expect(f.record().turns[1].text).toBe("Да");
  expect(f.sent.some(e=>e.type==="session.input_audio.append")).toBe(true);
  expect(f.sent.some(e=>/truncate|cancel/.test(e.type))).toBe(false);
  expect(f.received.some(e=>e.type==="clear")).toBe(true);
  expect(f.received.find(e=>e.type==="ready")).toMatchObject({model:"gpt-live-1",backend:LIVE_BACKEND});
  await f.c.stop("completed");expect(f.ai.close).toHaveBeenCalledTimes(1);
});
it("saves one tool call once, waits for its complete item and continues once after all outputs",async()=>{
  const f=await fixture();
  f.native({type:"response.created",response:{id:"r"}});
  f.native({type:"response.function_call_arguments.done",call_id:"c",arguments:'{"name":"Ana"}'});
  expect(f.record().fields.name).toBeUndefined();
  const call={type:"response.output_item.done",item:{type:"function_call",call_id:"c",name:"save_request",arguments:'{"name":"Ana","language":"es"}'}};
  f.native(call);f.native(call);
  await vi.waitFor(()=>expect(f.record().fields.name).toBe("Ana"));
  expect(f.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
  f.native({type:"response.completed",response:{id:"r"}});f.native({type:"response.completed",response:{id:"r"}});
  expect(f.sent.filter(e=>e.type==="response.create")).toHaveLength(1);
  expect(f.sent.filter(e=>e.type==="response.item.create")).toHaveLength(1);
  expect(JSON.parse(f.sent.find(e=>e.type==="response.item.create").item.output).bookingConfirmed).toBe(false);
  await f.c.stop("completed");
});
it("bad phone input is recoverable; later correction remains one request",async()=>{
  const f=await fixture();
  for(const [id,args] of [["bad",'{"phone":"5550100"}'],["good",'{"phone":"+12025550173","callbackConfirmed":false}']]){
    f.native({type:"response.created",response:{id}});
    f.native({type:"response.output_item.done",item:{type:"function_call",call_id:id,name:"save_request",arguments:args}});
    f.native({type:"response.completed",response:{id}});
    await vi.waitFor(()=>expect(f.sent.some(e=>e.item?.call_id===id)).toBe(true));
  }
  expect(f.c.closed).toBe(false);
  expect(f.record().fields).toMatchObject({phone:"+12025550173",callbackConfirmed:false});
  expect(f.store.records.size).toBe(1);
  expect(JSON.parse(f.sent.find(e=>e.item?.call_id==="bad").item.output).saved).toBe(false);
  await f.c.stop("completed");
});
it("rejects unknown function names without executing operations",async()=>{
  const f=await fixture();
  f.native({type:"response.created",response:{id:"r"}});
  f.native({type:"response.output_item.done",item:{type:"function_call",call_id:"x",name:"send_sms",arguments:"{}"}});
  await vi.waitFor(()=>expect(f.sent.some(e=>e.item?.call_id==="x")).toBe(true));
  expect(f.record().fields).toEqual({});
  expect(JSON.parse(f.sent.find(e=>e.item?.call_id==="x").item.output).saved).toBe(false);
  await f.c.stop("completed");
});
it("stops and preserves partial data on backend rejection, without substituting a model",async()=>{
  const f=await fixture();
  f.event({type:"session.input_transcript.delta",event_id:"t",start_ms:0,end_ms:300,delta:"Перезвоните, пожалуйста."});
  f.event({type:"error",error:{code:"responses_validation_failed",message:"DO NOT EXPOSE RAW DETAIL"}});
  await vi.waitFor(()=>expect(f.record().closed).toBe(true));
  expect(f.record().endReason).toBe("live:responses_validation_failed");
  expect(f.record().turns[0].text).toContain("Перезвоните");
  expect(JSON.stringify(f.received)).not.toContain("RAW DETAIL");
  expect(f.ai.connect).toHaveBeenCalledTimes(1);
});
it("does not confirm acceptance when storage fails",async()=>{
  const f=await fixture();f.store.failSave=true;
  f.native({type:"response.created",response:{id:"r"}});
  f.native({type:"response.output_item.done",item:{type:"function_call",call_id:"x",name:"save_request",arguments:'{"name":"Ana"}'}});
  await vi.waitFor(()=>expect(f.peer.close).toHaveBeenCalled());
  expect(f.record().fields).toEqual({});
  expect(JSON.parse(f.sent.find(e=>e.item?.call_id==="x").item.output).saved).toBe(false);
});
it("requires exact Live handshake and closes gracefully with session.closed",async()=>{
  class Socket extends EventEmitter{
    readyState=1;bufferedAmount=0;sent:any[]=[];
    send(s:string){const e=JSON.parse(s);this.sent.push(e);if(e.type==="session.close")queueMicrotask(()=>this.emit("message",Buffer.from('{"type":"session.closed"}')));}
    close(){this.readyState=3;this.emit("close",1000);}
    terminate(){this.close();}
  }
  const socket=new Socket(),events:any[]=[];
  const audio=new LiveAudio("facts",e=>events.push(e),()=>socket as any);
  const connecting=audio.connect();socket.emit("open");
  expect(socket.sent[0].type).toBe("session.start");
  socket.emit("message",Buffer.from(JSON.stringify({type:"session.started",session:liveConfig("facts")})));
  await connecting;expect(await audio.close()).toBe(true);
  expect(socket.sent.filter(e=>e.type==="session.close")).toHaveLength(1);
});
