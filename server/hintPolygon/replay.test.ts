import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASELINE, sha } from "./contracts";
import { Ledger } from "./ledger";
import { replay, type Fixture } from "./replay";

const control=vi.hoisted(()=>({tail:true,multi:false,instance:0,sends:[] as number[]}));
vi.mock("ws",()=>({default:class FakeSocket extends EventEmitter {
  static OPEN=1;readyState=1;ch=control.instance++;sent=0;
  constructor(){super();queueMicrotask(()=>this.emit("open"));}
  send(frame:Buffer){
    this.sent+=frame.length;control.sends.push(Date.now());
    if(control.multi&&this.ch===1&&this.sent>=960&&this.sent<=1440){
      const index=(this.sent-960)/160;
      this.emit("message",Buffer.from(JSON.stringify({type:"TurnInfo",event:"EndOfTurn",
        audio_window_start:index*.02,audio_window_end:index===1?null:(index+1)*.02,transcript:"Which day?"})));
      return;
    }
    if(this.ch===1&&this.sent===960) this.emit("message",Buffer.from(JSON.stringify({
      type:"TurnInfo",event:"EndOfTurn",audio_window_start:"0.0",
      audio_window_end:control.tail?"0.1":"0.02",transcript:"Which day?",
    })));
  }
  close(){this.readyState=3;this.emit("close");}
  terminate(){this.readyState=3;this.emit("close");}
}}));
const dirs:string[]=[];
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();control.instance=0;control.sends=[];control.tail=true;control.multi=false;for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
function wav(){
  const b=Buffer.alloc(44+800*4);b.write("RIFF");b.writeUInt32LE(b.length-8,4);b.write("WAVE",8);b.write("fmt ",12);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(8000,24);
  b.writeUInt32LE(32000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(3200,40);return b;
}
async function exercise(tail:boolean,abstain=false){
  control.tail=tail;
  vi.useFakeTimers();vi.setSystemTime(1000);vi.spyOn(performance,"now").mockImplementation(()=>Date.now());
  const fetcher=vi.fn(async(_url:string,opts:any)=>{
    const body=JSON.parse(opts.body),isJudge=body.model===BASELINE.judgeModel;
    if(!isJudge)await new Promise(r=>setTimeout(r,50));
    return {ok:true,status:200,headers:new Headers({"x-request-id":"fake"}),
      json:async()=>({model:body.model,usage:{prompt_tokens:10,completion_tokens:20},
        choices:[{finish_reason:"stop",message:{content:isJudge?
          JSON.stringify({items:JSON.parse(body.messages[1].content).items.map((i:any)=>({turnId:i.turnId,grounding:4,relevance:4,speakability:4,translation:4}))}):
          abstain?'{"translation":"Какой день?","suggestion":{"en":"","translation":""}}':
          '{"translation":"Какой день?","suggestion":{"en":"Monday.","translation":"Понедельник."}}'}}]})};
  });
  vi.stubGlobal("fetch",fetcher);
  const dir=mkdtempSync(join(tmpdir(),"polygon-replay-"));dirs.push(dir);
  const l=new Ledger(join(dir,"ledger.json")),b=wav();
  const f:Fixture={id:"fixture",recordingSid:"unused",wavMd5:"unused",audioSha256:sha(b),goal:"Book",durationMs:100,
    roles:["owner","guest"],vad:[{role:"owner",channel:0,segments:[]},{role:"guest",channel:1,segments:control.multi?
      [{startMs:0,endMs:20},{startMs:25,endMs:40},{startMs:45,endMs:60},{startMs:65,endMs:80}]:[{startMs:0,endMs:100}]}],
    vadHash:"vad",goalHash:sha("Book")};
  const p=replay(f,b,BASELINE,l,"unit","corpus","commit");
  await vi.advanceTimersByTimeAsync(10_000);
  const row=await p;l.close();return {row,fetcher};
}
it("replays both channels at 1x; first displayable English is after full parsed response, not early bytes",async()=>{
  const {row,fetcher}=await exercise(true);
  expect(row.valid).toBe(true);expect(row.turns).toHaveLength(1);
  expect(row.turns[0]).toMatchObject({speechEndMs:100,sttFinalMs:100,firstWordMs:150,fullHintMs:150,translationMs:150});
  expect(row.quality).toBe(4);expect(fetcher).toHaveBeenCalledTimes(2);
  expect(control.sends.slice(0,6)).toEqual([1000,1000,1020,1020,1040,1040]);
});
it("never hides truncated STT tail as a valid fast result",async()=>{
  const {row}=await exercise(false);
  expect(row.valid).toBe(false);expect(row.reasons).toContain("BAD_TURNS_OVER_30_PERCENT");expect(row.quality).toBeNull();
});
it("judges complete no-hint turns instead of declaring the recording corrupt",async()=>{
 const{row,fetcher}=await exercise(true,true);
 expect(row.valid).toBe(true);expect(row.turns[0].fullHintMs).toBeNull();
 expect(row.quality).toBe(4);expect(fetcher).toHaveBeenCalledTimes(2);
});
it("rejects just one ambiguous turn, keeps streaming, and judges the other three",async()=>{
 control.multi=true;const{row,fetcher}=await exercise(true);
 expect(row.valid).toBe(true);expect(row.turns).toHaveLength(4);
 expect(row.turnQuality).toMatchObject({bad:1,total:4,fraction:.25,acceptable:true});
 expect(row.turns.filter(t=>t.valid)).toHaveLength(3);
 const body=JSON.parse(fetcher.mock.calls.at(-1)![1].body);
 expect(JSON.parse(body.messages[1].content).items).toHaveLength(3);
 expect(row.quality).toBe(4);
});
