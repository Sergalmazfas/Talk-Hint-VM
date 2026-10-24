import { EventEmitter } from "node:events";
import { beforeEach,afterEach,it,expect,vi } from "vitest";
import WebSocket from "ws";
const mock=vi.hoisted(()=>({events:[] as Array<(e:any)=>void>,sent:[] as object[],audioCount:0,
  number:{id:"work",userId:"owner",type:"work",twilioNumber:"+15550000001"},
}));
vi.mock("../db",()=>({pool:null}));
vi.mock("../secretary/notifications",()=>({notifySecretaryResult:vi.fn()}));
vi.mock("../storage",()=>({storage:{
  getPhoneNumber:vi.fn(async()=>mock.number),getCallByCallSid:vi.fn(async()=>({id:"history"})),createCall:vi.fn(),
  listKnowledgeCards:vi.fn(async()=>[]),
}}));
vi.mock("./audio",()=>({IncomingAudio:class {
  constructor(_i:string,event:(e:any)=>void){mock.events.push(event);mock.audioCount++;}
  connect(){return Promise.resolve();}
  send(e:object){mock.sent.push(e);}
  close(){}
}}));
vi.mock("./liveAudio",()=>({
  LIVE_MODEL:"gpt-live-1",LIVE_VOICE:"marin",LIVE_BACKEND:"gpt-6.1-sol",LIVE_GREETING:"Hello",
  LiveAudio:class{
    constructor(_i:string,event:(e:any)=>void){mock.events.push(event);mock.audioCount++;}
    connect(){return Promise.resolve()}
    send(e:object){mock.sent.push(e)}
    close(){return Promise.resolve(true)}
  },
}));
import { incomingStore,handleIncomingSocket,streamToken,validStreamToken,tryIncomingSecretary,stopIncomingCard } from "./runtime";
import { defaults } from "./policy";
import { MemoryRequests } from "./store";
let memory:MemoryRequests;
class Peer extends EventEmitter {
  readyState:number=WebSocket.OPEN;sent:any[]=[];
  send(s:string){this.sent.push(JSON.parse(s));}
  close(){this.readyState=WebSocket.CLOSED;this.emit("close");}
  message(e:object){this.emit("message",Buffer.from(JSON.stringify(e)));}
}
const start=(p:Peer,callSid="call")=>p.message({event:"start",start:{callSid,streamSid:"stream",customParameters:{numberId:"work",auth:streamToken(callSid,"work")},
  mediaFormat:{encoding:"audio/x-mulaw",sampleRate:8000}}});
beforeEach(()=>{
  vi.stubEnv("INCOMING_SECRETARY_RUNTIME_ENABLED","true");vi.stubEnv("SESSION_SECRET","test-only-incoming-key");
  mock.events=[];mock.sent=[];mock.audioCount=0;memory=new MemoryRequests();
  vi.spyOn(incomingStore,"settings").mockResolvedValue({...defaults("work"),enabled:true,timeZone:"America/New_York"});
  vi.spyOn(incomingStore,"begin").mockImplementation((...args)=>memory.begin(...args));
  vi.spyOn(incomingStore,"update").mockImplementation((...args)=>memory.update(...args));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it("binds unforgeable media token to the exact call and work number",()=>{
  const t=streamToken("call","work");
  expect(validStreamToken("call","work",t)).toBe(true);
  expect(validStreamToken("other","work",t)).toBe(false);
  expect(validStreamToken("call","personal",t)).toBe(false);
  expect(validStreamToken("call","work","forged")).toBe(false);
});
it("leaves personal/manual handling alone and gates the new mode off by default",async()=>{
  const req={} as any,res={} as any;
  expect(await tryIncomingSecretary(req,res,"owner","personal","personal","call")).toBe(false);
  vi.stubEnv("INCOMING_SECRETARY_RUNTIME_ENABLED","");
  expect(await tryIncomingSecretary(req,res,"owner","work","work","call")).toBe(false);
});
it("returns AI TwiML before legacy notifications and has no outgoing dial action",async()=>{
  const res={type:vi.fn().mockReturnThis(),send:vi.fn()} as any;
  const req={body:{From:"+15550000444",To:"+15550000001"},get:()=> "example.test"} as any;
  expect(await tryIncomingSecretary(req,res,"owner","work","work","call")).toBe(true);
  const xml=res.send.mock.calls[0][0];
  expect(xml).toContain("incoming-secretary-stream");expect(xml).not.toContain("<Dial");
  expect(xml).not.toContain("sms");expect(memory.records.size).toBe(1);
});
it("rejects forged media before opening AI",async()=>{
  const p=new Peer();handleIncomingSocket(p as any);
  p.message({event:"start",start:{callSid:"x",customParameters:{numberId:"work",auth:"bad"}}});
  await vi.waitFor(()=>expect(p.readyState).toBe(WebSocket.CLOSED));
  expect(mock.audioCount).toBe(0);expect(memory.records.size).toBe(0);
});
it("does not echo inbound audio, clears interrupted audio and ignores stale deltas",async()=>{
  const p=new Peer();handleIncomingSocket(p as any);start(p);
  await vi.waitFor(()=>expect(mock.audioCount).toBe(1));
  await new Promise(r=>setTimeout(r,10));
  const payload=Buffer.alloc(160,255).toString("base64");
  p.message({event:"media",media:{payload,timestamp:"1000",track:"inbound"}});
  expect(mock.sent).toContainEqual({type:"session.input_audio.append",audio:payload});
  expect(p.sent.filter(e=>e.event==="media")).toHaveLength(0);
  const event=mock.events[0];
  event({type:"session.output_audio.delta",delta:payload});
  await vi.waitFor(()=>expect(p.sent.some(e=>e.event==="media")).toBe(true));
  event({type:"session.input_transcript.delta",event_id:"caller",start_ms:0,end_ms:100,delta:"Hello"});
  const count=p.sent.length;
  event({type:"response.output_audio.delta",response_id:"r1",delta:payload});
  await new Promise(r=>setTimeout(r,10));
  expect(p.sent.at(-1).event).toBe("clear");expect(p.sent.length).toBe(count);
  expect(mock.sent.some((e:any)=>e.type==="conversation.item.truncate")).toBe(false);
  p.close();
  await vi.waitFor(()=>expect(memory.records.get("call")?.closed).toBe(true));
});
it("repeated streams do not create requests or close another active session",async()=>{
  const a=new Peer();handleIncomingSocket(a as any);start(a);
  await vi.waitFor(()=>expect(mock.audioCount).toBe(1));
  const b=new Peer();handleIncomingSocket(b as any);start(b);
  await vi.waitFor(()=>expect(b.readyState).toBe(WebSocket.CLOSED));
  expect(mock.audioCount).toBe(1);expect(memory.records.size).toBe(1);
  expect(memory.records.get("call")?.closed).not.toBe(true);
  a.close();
  await vi.waitFor(()=>expect(memory.records.get("call")?.closed).toBe(true));
});
it("saves tool results once and returns saved:false on storage failure",async()=>{
  const p=new Peer();handleIncomingSocket(p as any);start(p);
  await vi.waitFor(()=>expect(mock.audioCount).toBe(1));
  mock.events[0]({type:"response.event",event:{type:"response.created",response:{id:"r"}}});
  const e={type:"response.event",event:{type:"response.output_item.done",
    item:{type:"function_call",call_id:"t1",name:"save_request",arguments:'{\"name\":\"Анна\",\"language\":\"ru\"}'}}};
  mock.events[0](e);mock.events[0](e);
  await vi.waitFor(()=>expect(mock.sent.filter((x:any)=>x.item?.call_id==="t1")).toHaveLength(1));
  memory.failSave=true;
  mock.events[0]({...e,event:{...e.event,item:{...e.event.item,call_id:"t2"}}});
  await vi.waitFor(()=>expect(mock.sent.some((x:any)=>x.item?.call_id==="t2")).toBe(true));
  const result=mock.sent.find((x:any)=>x.item?.call_id==="t2") as any;
  expect(JSON.parse(result.item.output)).toMatchObject({saved:false,bookingConfirmed:false});
  memory.failSave=false;p.close();
  // Finalization failed while storage was unavailable; the recovery worker owns
  // this unclosed partial row. Do not turn that into a false successful save.
  expect(memory.records.get("call")?.fields.name).toBe("Анна");
  expect(memory.records.get("call")?.status).not.toBe("pending_owner");
});
it("revoking an approved card stops its owner's active AI, not another owner's",async()=>{
  vi.mocked(incomingStore.settings).mockResolvedValue({...defaults("work"),enabled:true,timeZone:"America/New_York",cardIds:["card"]});
  const p=new Peer();handleIncomingSocket(p as any);start(p);
  await vi.waitFor(()=>expect(mock.audioCount).toBe(1));
  stopIncomingCard("other","card");expect(p.readyState).toBe(WebSocket.OPEN);
  stopIncomingCard("owner","card");
  await vi.waitFor(()=>expect(p.readyState).toBe(WebSocket.CLOSED));
  expect(memory.records.get("call")?.closed).toBe(true);
});
it("does not end the session for a hold phrase or a minute of silence, and accepts resumed speech",async()=>{
  vi.useFakeTimers();
  try {
    const p=new Peer();handleIncomingSocket(p as any);start(p);
    await vi.waitFor(()=>expect(mock.audioCount).toBe(1));
    mock.events[0]({type:"session.input_transcript.delta",event_id:"hold",start_ms:0,end_ms:100,delta:"Please hold"});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.readyState).toBe(WebSocket.OPEN);
    mock.events[0]({type:"session.input_transcript.delta",event_id:"resumed",start_ms:60000,end_ms:60100,delta:"¡Hola! ¿Podemos continuar?"});
    await vi.advanceTimersByTimeAsync(1);
    expect(memory.records.get("call")?.turns.map(t=>t.text)).toEqual(["Please hold","¡Hola! ¿Podemos continuar?"]);
    p.close();await vi.waitFor(()=>expect(memory.records.get("call")?.closed).toBe(true));
  } finally {vi.useRealTimers();}
});
