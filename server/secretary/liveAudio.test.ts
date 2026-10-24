import { EventEmitter } from "node:events";
import { it,expect,vi,afterEach } from "vitest";
import { OpenAISecretaryLiveSession,outgoingLiveConfig } from "./liveAudio";
import { SecretaryNativePlayback } from "./nativePlayback";
import type { SecretaryRealtimeEvent } from "./agent";

class Socket extends EventEmitter{
  readyState=1;bufferedAmount=0;sent:any[]=[];
  send(raw:string){const e=JSON.parse(raw);this.sent.push(e);
    if(e.type==="session.start")queueMicrotask(()=>this.message({type:"session.started",session:e.session}));
    if(e.type==="session.close")queueMicrotask(()=>this.message({type:"session.closed"}));
  }
  message(e:object){this.emit("message",Buffer.from(JSON.stringify(e)))}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit("close",1000)}
  terminate(){this.close()}
}
afterEach(()=>vi.useRealTimers());
it("forwards an explicit native Live closing decision and guest activity without dialing", async()=>{
  const socket=new Socket(),events:SecretaryRealtimeEvent[]=[];
  const live=new OpenAISecretaryLiveSession("Authorized task",()=>{
    queueMicrotask(()=>socket.emit("open"));return socket as any;
  });
  live.onEvent(e=>events.push(e));await live.connect();
  const native=(event:object)=>socket.message({type:"response.event",event});
  native({type:"response.created",response:{id:"closing-review"}});
  const request={reason:"follow_up",farewell:"Gracias, adiós."};
  native({type:"response.output_item.done",response_id:"closing-review",item:{
    type:"function_call",call_id:"close-1",name:"prepare_call_end",arguments:JSON.stringify(request),
  }});
  expect(events.filter(e=>e.type==="end_requested")).toEqual([{type:"end_requested",request}]);
  expect(socket.sent.some(e=>e.type==="response.item.create"&&JSON.parse(e.item.output).prepared)).toBe(true);
  native({type:"response.completed",response:{id:"closing-review"}});
  expect(socket.sent.at(-1).type).toBe("response.create");
  socket.message({type:"session.input_transcript.delta",event_id:"guest-continues",start_ms:0,end_ms:100,delta:"Espere"});
  expect(events.some(e=>e.type==="guest_activity")).toBe(true);
  live.close();
});
it("uses native Live, the authorized task and no intake/booking or clone tools",()=>{
  const config=outgoingLiveConfig("Trusted identity: Example Owner's secretary. Ask about repair status.");
  expect(config).toMatchObject({model:"gpt-live-1",store:false,audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}});
  expect(config.delegation.responses.model).toBe("gpt-6.1-sol");
  expect(config.delegation.responses.tools.map(tool => tool.name)).toEqual(["prepare_call_end"]);
  expect(config.instructions).toContain("repair status");
  expect(config.instructions).not.toContain("massage");
  expect(config.delegation.responses.instructions).toContain("Trusted identity");
});
it("streams phone PCMU, yields without unsupported Realtime commands and continues the new stream",async()=>{
  vi.useFakeTimers();
  const socket=new Socket(),events:SecretaryRealtimeEvent[]=[],urls:string[]=[];
  const live=new OpenAISecretaryLiveSession("Authorized task",url=>{urls.push(url);queueMicrotask(()=>socket.emit("open"));return socket as any});
  live.onEvent(e=>events.push(e));await live.connect();live.startIntroduction();live.startIntroduction();
  expect(urls).toEqual(["wss://api.openai.com/v1/live/sessions"]);
  expect(socket.sent.filter(e=>e.type==="session.commentary.append")).toHaveLength(1);
  live.sendAudio(Buffer.alloc(160,255));
  expect(socket.sent.at(-1).type).toBe("session.input_audio.append");
  socket.message({type:"session.output_audio.delta",delta:"////"});
  socket.message({type:"session.input_transcript.delta",event_id:"i",start_ms:0,end_ms:100,delta:"Здравствуйте. ¿Hola?"});
  socket.message({type:"session.output_audio.delta",delta:"////"});
  await vi.advanceTimersByTimeAsync(701);
  expect(events.find(e=>e.type==="guest_transcript")).toMatchObject({text:"Здравствуйте. ¿Hola?"});
  expect(events.filter(e=>e.type==="audio").map((e:any)=>e.responseId)).toEqual(["live-0","live-1"]);
  expect(events.some(e=>e.type==="speech_started")).toBe(true);
  expect(socket.sent.some(e=>/truncate|cancel|session.update|input_audio_buffer/.test(e.type))).toBe(false);
  live.close();await vi.advanceTimersByTimeAsync(1);
  expect(socket.sent.at(-1).type).toBe("session.close");
});
it("records continuous speech only after paced audio and a Twilio playback acknowledgement, without audio_done",async()=>{
  vi.useFakeTimers();const socket=new Socket(),played=vi.fn(),truncate=vi.fn();let ack!:()=>void;
  const player=new SecretaryNativePlayback({ws:socket as any,streamSid:()=>"synthetic",continuous:true,
    waitMark:()=>new Promise<void>(resolve=>{ack=resolve}),truncate,playedText:played,audio:()=>{},fail:vi.fn(),
  });
  player.audio("live","",Buffer.alloc(320,255));player.transcript("live","Only Tuesday.");
  expect(played).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(40);
  expect(socket.sent.some(e=>e.event==="mark")).toBe(true);expect(played).not.toHaveBeenCalled();
  ack();await vi.advanceTimersByTimeAsync(0);expect(played).toHaveBeenCalledExactlyOnceWith("Only Tuesday.");
  player.audio("live","",Buffer.alloc(160,255));await vi.advanceTimersByTimeAsync(20);
  expect(socket.sent.filter(e=>e.event==="media")).toHaveLength(3);
  player.interrupt();expect(socket.sent.at(-1).event).toBe("clear");player.close();
});
it("does not disclose raw backend errors or silently choose another model",async()=>{
  const socket=new Socket(),events:SecretaryRealtimeEvent[]=[];
  const live=new OpenAISecretaryLiveSession("Authorized task",()=>{queueMicrotask(()=>socket.emit("open"));return socket as any});
  live.onEvent(e=>events.push(e));await live.connect();
  socket.message({type:"error",error:{code:"responses_validation_failed",message:"PRIVATE RAW DETAIL"}});
  expect(events.find(e=>e.type==="error")).toMatchObject({fatal:true});
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
  expect(socket.sent.filter(e=>e.type==="session.start")).toHaveLength(1);
});
