import { it,expect,vi } from "vitest";
vi.mock("../db",()=>({pool:null}));
import { DevConversation } from "./devConversation";
import { MemoryRequests } from "./store";
import { IntakeSession } from "./session";
import { buildInstructions,defaults } from "./policy";

async function fixture() {
  const store=new MemoryRequests(),settings={...defaults("work"),timeZone:"America/New_York"};
  const intake=new IntakeSession("owner","dev-session",settings,store);await intake.begin();
  const received:any[]=[],sent:any[]=[];
  let event:(e:any)=>void=()=>{};
  const peer={readyState:1,send:(s:string)=>received.push(JSON.parse(s)),close:vi.fn()};
  const ai={connect:vi.fn(async()=>{}),send:(e:any)=>sent.push(e),close:vi.fn()};
  const conversation=new DevConversation(intake,buildInstructions(settings,[]),peer,(_i,e)=>{event=e;return ai as any;});
  await conversation.start();
  const tool=(id:string,fields:object,submit=false)=>event({type:"response.function_call_arguments.done",response_id:"r",
    call_id:id,name:submit?"submit_request":"save_request",arguments:JSON.stringify(fields)});
  const record=()=>store.records.get("dev-session")!;
  return {store,intake,received,sent,event:(e:any)=>event(e),peer,ai,conversation,tool,record};
}
it.each([["en","ru"],["en","es"],["en","ru","es"]])("uses the incoming multilingual intake through actual Dev event handling: %j",async(...langs)=>{
  const f=await fixture();
  const languages=langs.flat() as string[];
  for(let i=0;i<languages.length;i++){
    const language=languages[i],text=language==="ru"?"Здравствуйте, имя Анна":language==="es"?"¡Hola! ¿Puede ayudarme?":"Hello";
    f.event({type:"input_audio_buffer.speech_started"});
    f.event({type:"conversation.item.input_audio_transcription.completed",item_id:String(i),transcript:text});
    f.tool(String(i),{language});
  }
  await vi.waitFor(()=>expect(f.record().turns).toHaveLength(languages.length));
  await f.conversation.stop("completed");
  expect(f.record().fields.language).toBe(languages.at(-1));
  expect(f.record().turns.map(t=>t.text).join(" ")).toContain(languages.includes("ru")?"Анна":"¿");
  expect(f.received.every(e=>e.testOnly===true)).toBe(true);expect(f.store.records.size).toBe(1);
});
it("never echoes microphone audio and clears stale speech on interruption before continuing",async()=>{
  const f=await fixture(),audio=Buffer.alloc(160,255).toString("base64");
  f.conversation.input({type:"audio",audio});
  expect(f.sent).toContainEqual({type:"input_audio_buffer.append",audio});
  expect(f.received.filter(e=>e.type==="audio")).toHaveLength(0);
  f.event({type:"response.created",response:{id:"r1"}});
  f.event({type:"response.output_audio.delta",response_id:"r1",item_id:"i",delta:audio});
  await vi.waitFor(()=>expect(f.received.some(e=>e.type==="audio")).toBe(true));
  f.conversation.input({type:"playback",responseId:"r1",playedMs:10000});
  f.event({type:"input_audio_buffer.speech_started"});
  f.event({type:"response.output_audio.delta",response_id:"r1",item_id:"i",delta:audio});
  f.event({type:"response.created",response:{id:"r2"}});
  f.event({type:"response.output_audio.delta",response_id:"r2",item_id:"i2",delta:audio});
  await vi.waitFor(()=>expect(f.received.filter(e=>e.type==="audio")).toHaveLength(2));
  expect(f.received.filter(e=>e.type==="audio").map(e=>e.responseId)).toEqual(["r1","r2"]);
  expect(f.sent).toContainEqual(expect.objectContaining({type:"conversation.item.truncate",audio_end_ms:20}));
  await f.conversation.stop("completed");
});
it("updates corrected details, requires phone reconfirmation, and deduplicates repeated tool delivery",async()=>{
  const f=await fixture();
  f.tool("first",{name:"Ana",phone:"+15550000111",callbackConfirmed:true,address:"Test A",localDate:"2026-11-03",localTime:"10:00",durationMinutes:60,language:"es",notes:"Please contact me",reviewed:true},true);
  await vi.waitFor(()=>expect(f.record().status).toBe("pending_owner"));
  f.tool("correct",{name:"Анна",phone:"+15550000222",address:"Test B",localDate:"2026-11-04",localTime:"11:00"});
  f.tool("correct",{name:"WRONG"});
  await vi.waitFor(()=>expect(f.record().fields.name).toBe("Анна"));
  expect(f.record().fields).toMatchObject({address:"Test B",localDate:"2026-11-04",localTime:"11:00",callbackConfirmed:false,reviewed:false});
  expect(f.sent.filter(e=>e.item?.call_id==="correct")).toHaveLength(1);
  f.tool("review",{callbackConfirmed:true,reviewed:true},true);
  await vi.waitFor(()=>expect(f.record().status).toBe("pending_owner"));
  await f.conversation.stop("completed");
  expect(f.store.records.size).toBe(1);
  expect(f.received.filter(e=>e.type==="request").every(e=>!e.request.bookingConfirmed)).toBe(true);
  expect(f.record().closed).toBe(true);expect(f.ai.close).toHaveBeenCalled();
});
it("returns an honest error and closes AI on failed persistence, never successful acceptance",async()=>{
  const f=await fixture();f.tool("partial",{name:"Saved partial"});
  await vi.waitFor(()=>expect(f.record().fields.name).toBe("Saved partial"));
  f.store.failSave=true;f.tool("fail",{name:"Not saved"},true);
  await vi.waitFor(()=>expect(f.peer.close).toHaveBeenCalled());
  expect(f.received.some(e=>e.type==="error")).toBe(true);
  expect(f.received.find(e=>e.type==="ended")?.error).toBeTruthy();
  const result=f.sent.find(e=>e.item?.call_id==="fail");
  expect(JSON.parse(result.item.output)).toMatchObject({saved:false,bookingConfirmed:false});
  expect(f.record().fields.name).toBe("Saved partial");
});
it("keeps a hold phrase and resumes; disconnect persists a partial instead of booking",async()=>{
  const f=await fixture();
  f.event({type:"conversation.item.input_audio_transcription.completed",item_id:"hold",transcript:"Please hold"});
  await vi.waitFor(()=>expect(f.record().turns).toHaveLength(1));
  expect(f.conversation.ready).toBe(true);expect(f.conversation.closed).toBe(false);
  f.tool("resume",{name:"Анна",language:"ru"});
  await vi.waitFor(()=>expect(f.record().fields.name).toBe("Анна"));
  await f.conversation.stop("connection lost");
  expect(f.record().status).toBe("incomplete");expect(f.record().fields.name).toBe("Анна");
});
it("an unavailable required model fails explicitly without constructing a replacement",async()=>{
  const store=new MemoryRequests(),session=new IntakeSession("o","d",defaults("w"),store);await session.begin();
  const events:any[]=[],factory=vi.fn(()=>({connect:async()=>{throw new Error("Unavailable model");},close:vi.fn(),send:vi.fn()}) as any);
  const c=new DevConversation(session,"incoming",{readyState:1,send:s=>events.push(JSON.parse(s)),close:vi.fn()},factory);
  await c.start();expect(c.ready).toBe(false);expect(factory).toHaveBeenCalledTimes(1);
  expect(events.find(e=>e.type==="error").error).toContain("Другой моделью он не заменялся");
  expect(store.records.get("d")?.closed).toBe(true);
});
it("waits for response.done and all tool outputs before requesting exactly one continuation",async()=>{
  const f=await fixture();
  f.event({type:"response.created",response:{id:"r"}});
  f.tool("one",{name:"Ana"});f.tool("two",{address:"Example Street"});
  await vi.waitFor(()=>expect(f.record().fields.address).toBe("Example Street"));
  expect(f.sent.filter(e=>e.type==="response.create")).toHaveLength(1);
  f.event({type:"response.done",response:{id:"r"}});
  expect(f.sent.filter(e=>e.type==="response.create")).toHaveLength(2);
  expect(f.sent.filter(e=>e.item?.type==="function_call_output")).toHaveLength(2);
  f.event({type:"response.done",response:{id:"r"}});
  expect(f.sent.filter(e=>e.type==="response.create")).toHaveLength(2);
  await f.conversation.stop("completed");
});
it("an active-response race and redundant cancellation cannot terminate a healthy conversation",async()=>{
  const f=await fixture();
  for(const code of ["conversation_already_has_active_response","response_cancel_not_active"])
    f.event({type:"error",error:{code,message:"RAW SENSITIVE PROVIDER MESSAGE"}});
  f.conversation.input({type:"audio",audio:Buffer.alloc(160,255).toString("base64")});
  await vi.waitFor(()=>expect((f.record() as any).devDiagnostics).toHaveLength(2));
  expect(f.conversation.closed).toBe(false);expect(f.ai.close).not.toHaveBeenCalled();
  expect(f.received.some(e=>e.type==="error")).toBe(false);
  expect(JSON.stringify(f.received)).not.toContain("SENSITIVE");
  expect(f.sent.some(e=>e.type==="input_audio_buffer.append")).toBe(true);
  await f.conversation.stop("completed");
});
it("interruption clears immediately and never starts a stale tool continuation during caller speech",async()=>{
  const f=await fixture();
  f.event({type:"response.created",response:{id:"r"}});
  f.tool("one",{name:"Ana"});
  f.event({type:"input_audio_buffer.speech_started"});
  expect(f.received.some(e=>e.type==="clear")).toBe(true);
  expect(f.sent.some(e=>e.type==="response.cancel")).toBe(false);
  f.event({type:"response.done",response:{id:"r",status:"cancelled"}});
  await vi.waitFor(()=>expect(f.record().fields.name).toBe("Ana"));
  expect(f.sent.filter(e=>e.type==="response.create")).toHaveLength(1);
  f.event({type:"input_audio_buffer.speech_stopped"});
  await f.conversation.stop("completed");
});
it.each([
  {phone:"555-0100"},{phone:"+155500222"},{localDate:"tomorrow"},{localDate:"2026-02-31"},
  {localTime:"8 pm"},{durationMinutes:"60"},{language:"ru-RU"},
])("invalid or uncertain intake fields ask for correction without ending the conversation: %j",async patch=>{
  const f=await fixture();f.tool("name",{name:"Ana",language:"ru"});
  await vi.waitFor(()=>expect(f.record().fields.name).toBe("Ana"));
  f.tool("bad",patch);
  await vi.waitFor(()=>expect(f.sent.some(e=>e.item?.call_id==="bad")).toBe(true));
  const result=JSON.parse(f.sent.find(e=>e.item?.call_id==="bad").item.output);
  expect(result).toMatchObject({saved:false,bookingConfirmed:false});
  expect(result.issues.length).toBeGreaterThan(0);
  expect(f.record().fields.name).toBe("Ana");
  expect(f.record().fields.phone).toBeUndefined();
  expect(f.conversation.closed).toBe(false);expect(f.peer.close).not.toHaveBeenCalled();
  expect(f.received.some(e=>e.type==="error")).toBe(false);
  f.tool("corrected",{phone:"+15550000222",callbackConfirmed:false,language:"ru"});
  await vi.waitFor(()=>expect(f.record().fields.phone).toBe("+15550000222"));
  expect(f.record().fields.callbackConfirmed).toBe(false);
  await f.conversation.stop("completed");
});
it("invalid JSON is recoverable and never echoes raw arguments or claims they were stored",async()=>{
  const f=await fixture();
  f.event({type:"response.function_call_arguments.done",response_id:"r",call_id:"bad",name:"save_request",
    arguments:'{sensitive-raw-argument'});
  await vi.waitFor(()=>expect(f.sent.some(e=>e.item?.call_id==="bad")).toBe(true));
  expect(JSON.stringify(f.sent)).not.toContain("sensitive-raw-argument");
  expect(f.conversation.closed).toBe(false);
  expect(JSON.parse(f.sent.find(e=>e.item?.call_id==="bad").item.output).saved).toBe(false);
  await f.conversation.stop("completed");
});
it("a failed acknowledgement after a successful write is not misreported as a failed write",async()=>{
  const f=await fixture();
  vi.spyOn(f.ai,"send").mockImplementation(e=>{
    if(e.item?.type==="function_call_output")throw new Error("Transport failed");
    return f.sent.push(e);
  });
  f.tool("save",{name:"Ana"});
  await vi.waitFor(()=>expect(f.record().closed).toBe(true));
  expect(f.record().fields.name).toBe("Ana");
  expect(f.record().endReason).toBe("tool_ack_failed");
  expect(f.received.find(e=>e.type==="error").error).toContain("Сведения сохранены");
});
it("records which transport failed instead of generic connection lost",async()=>{
  const f=await fixture();f.event({type:"transport_closed",closeCode:1006});
  await vi.waitFor(()=>expect(f.record().closed).toBe(true));
  expect(f.record().endReason).toBe("openai_socket_closed:1006");
});
