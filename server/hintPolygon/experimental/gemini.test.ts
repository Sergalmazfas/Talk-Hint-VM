import{it,expect,vi,afterEach}from"vitest";
import{EventEmitter}from"node:events";
import{mkdtempSync,rmSync}from"node:fs";
import{tmpdir}from"node:os";
import{join}from"node:path";
const wire=vi.hoisted(()=>({messages:[]as string[]}));
vi.mock("ws",()=>({default:class extends EventEmitter{
 static OPEN=1;readyState=1;
 constructor(){super();queueMicrotask(()=>this.emit("open"));}
 send(s:string){wire.messages.push(s);const m=JSON.parse(s);
  if(m.setup)queueMicrotask(()=>this.emit("message",Buffer.from('{"setupComplete":{}}')));
  if(m.realtimeInput?.activityEnd)queueMicrotask(()=>this.emit("message",Buffer.from(
   '{"serverContent":{"outputTranscription":{"text":"Hello."},"turnComplete":true}}')));
 }
 terminate(){}
}}));
import{geminiEngine}from"./gemini";
import{Ledger}from"../ledger";
import{BASELINE}from"../contracts";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();wire.messages.length=0;});
it("does not hang a completed answer on missing usage; charges full reserve, never feeds Guest transcript to Live",async()=>{
 const d=mkdtempSync(join(tmpdir(),"gemini-live-")),l=new Ledger(join(d,"ledger.json"),true);
 vi.stubEnv("GEMINI_API_KAY","test-only-not-real");
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({model:"gpt-5.6-terra",
  choices:[{finish_reason:"stop",message:{content:'{"translation":"гость","native":"Привет."}'}}],
  usage:{prompt_tokens:10,completion_tokens:10,prompt_tokens_details:{cached_tokens:0}}}),{status:200})));
 const f={id:"fixture",goal:"test goal",recordingSid:"none",wavMd5:"none",audioSha256:"a".repeat(64),durationMs:1000,
  roles:["owner","guest"]as("owner"|"guest")[],vad:[],vadHash:"b".repeat(64),goalHash:"c".repeat(64)};
 const e=geminiEngine(f,{...BASELINE,model:"gemini-3.8-live",maxOutputTokens:500},l,"test",3);
 try{
  await e.open();expect(l.snapshot().entries[0].status).toBe("reserved");
  e.owner("OWNER_KNOWN_FACT");e.frame("guest",Buffer.alloc(160,0));
  const h=await e.generate("turn","SECRET_GUEST_TRANSCRIPT",[]);
  expect(h.en).toBe("Hello.");await e.close();
  expect(wire.messages.join("\n")).toContain("OWNER_KNOWN_FACT");
  expect(wire.messages.join("\n")).not.toContain("SECRET_GUEST_TRANSCRIPT");
  const entry=l.snapshot().entries.find(x=>x.kind==="gemini-audio")!;
  expect(entry.status).toBe("unknown");expect(entry.charged).toBe(entry.reserve);
 }finally{await l.close();rmSync(d,{recursive:true,force:true});}
});
