import WebSocket from "ws";
import { performance } from "node:perf_hooks";
import { channels } from "./audio";
import { assertAdapter, money, sha, speechEnd, providerAudioMs, type Recipe, type Segment } from "./contracts";
import { chat, judge, parseHint, promptRequest, type JudgeInput } from "./provider";
import type { Ledger } from "./ledger";
import type { Row, Turn } from "./metrics";
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export type Fixture = {
  id:string;recordingSid:string;wavMd5:string;audioSha256:string;goal:string;
  durationMs:number;roles:("owner"|"guest")[];vad:{role:string;channel:number;segments:Segment[]}[];
  vadHash:string;goalHash:string;
};
export async function replay(f:Fixture,wav:Buffer,r:Recipe,ledger:Ledger,run:string,corpusHash:string,codeCommit:string) {
  assertAdapter(r);
  if(sha(wav)!==f.audioSha256)throw Error("AUDIO_CHANGED");
  const audio=channels(wav),durationMs=audio[0].length/8;
  if(Math.abs(durationMs-f.durationMs)>1)throw Error("VAD_DURATION_MISMATCH");
  if(f.roles.length!==2 || new Set(f.roles).size!==2)throw Error("CHANNEL_ROLES_UNVERIFIED");
  for(let ch=0;ch<2;ch++)if(f.vad[ch]?.role!==f.roles[ch] || f.vad[ch]?.channel!==ch)throw Error("VAD_ROLE_MISMATCH");
  const beforeCost=ledger.held();
  let clock=0,clockMaxDriftMs=0,failure:Error|null=null;
  const turns:Turn[]=[],pending:Promise<void>[]=[],history:string[]=[],items:JudgeInput[]=[],sockets:WebSocket[]=[];
  const sttIds=[0,1].map(ch=>`${run}-${f.id}-stt-${ch}`);
  const sent=[0,0],providerIds:(string|null)[]=[null,null],closed=[false,false],sttHttp=[0,0];
  const finalAudioEnd=[0,0];
  const audioWindows:NonNullable<Row["sttEvidence"]>["windows"]=[];
  const startup=performance.now();
  const setFailure=(e:Error)=>{failure??=e;};
  try {
    // Reserve both paid streams before constructing either socket.
    const sttReserve=Math.ceil((durationMs+12_000)/60_000*money.deepgram.perMinuteMicro);
    if(ledger.held()+2*sttReserve>ledger.snapshot().limit)throw Error("SERIES_BUDGET_EXHAUSTED");
    for(let ch=0;ch<2;ch++) ledger.reserve(sttIds[ch],"stt",sttReserve,sha(JSON.stringify({audioSha256:f.audioSha256,channel:ch,recipe:r})));
    await Promise.all(audio.map((_,ch)=>new Promise<void>((resolve,reject)=>{
      const query=new URLSearchParams({model:r.stt,encoding:"mulaw",sample_rate:"8000",eot_threshold:String(r.eotThreshold),eot_timeout_ms:String(r.eotTimeoutMs)});
      const ws=new WebSocket(`wss://api.deepgram.com/v2/listen?${query}`,{headers:{Authorization:`Token ${process.env.DEEPGRAM_API_KEY}`},handshakeTimeout:20_000});
      sockets[ch]=ws;
      ws.on("upgrade",res=>{providerIds[ch]=String(res.headers["dg-request-id"]??"")||null;sttHttp[ch]=101;});
      ws.once("open",()=>resolve());
      ws.on("unexpected-response",(_req,res)=>{sttHttp[ch]=res.statusCode??0;res.resume();const e=Error(`DEEPGRAM_HTTP_${res.statusCode}`);setFailure(e);reject(e);});
      ws.on("error",()=>{const e=Error("DEEPGRAM_SOCKET_ERROR");setFailure(e);reject(e);});
      ws.on("close",()=>{closed[ch]=true;});
      ws.on("message",data=>{
        try {
          const m=JSON.parse(data.toString());
          if(m.type==="Error")throw Error("DEEPGRAM_PROVIDER_ERROR");
          if(typeof m.request_id==="string")providerIds[ch]=m.request_id;
          if(m.type!=="TurnInfo" || m.event!=="EndOfTurn")return;
          const windowStart=providerAudioMs(m.audio_window_start),windowEnd=providerAudioMs(m.audio_window_end);
          if(windowStart===null || windowEnd===null)throw Error("FLUX_AUDIO_WINDOW_MISSING");
          finalAudioEnd[ch]=Math.max(finalAudioEnd[ch],windowEnd);
          audioWindows.push({role:f.roles[ch],startMs:windowStart,endMs:windowEnd,receivedMs:performance.now()-clock,hasText:!!m.transcript?.trim()});
          if(!m.transcript?.trim() || failure)return;
          const finalMs=performance.now()-clock;
          const text=String(m.transcript).trim(),role=f.roles[ch];
          history.push(`${role==="owner"?"Owner":"Guest"}: ${text}`);
          if(role!=="guest")return;
          const turnId=`${f.id}-${turns.length}`;
          const end=speechEnd(f.vad[ch].segments,windowStart,windowEnd);
          const req=promptRequest(r,text,f.goal,history.join("\n"));
          const turn:Turn={turnId,speechEndMs:end,sttFinalMs:finalMs,firstWordMs:null,fullHintMs:null,translationMs:null,
            valid:false,systemHash:req.systemHash,systemChars:req.systemChars};
          turns.push(turn);
          const past=history.join("\n");
          // Dispatch immediately at EOT. No hidden serialized request queue.
          const job=(async()=>{
            try {
              const result=await chat(ledger,`${run}-${turnId}-brain`,"brain",req.body);
              const hint=parseHint(result.text),delivered=performance.now()-clock;
              turn.translationMs=hint.translation?delivered:null;
              turn.inputTokens=result.usage.prompt_tokens;turn.outputTokens=result.usage.completion_tokens;
              turn.valid=end!==null && finalMs>=end && delivered>=end;
              items.push({turnId,question:text,hint:hint.en,translation:hint.translation,history:past});
              if(!hint.en){turn.reason="NO_HINT_FOR_TURN";return;}
              // Nonstream LIVE: first displayable English word exists only
              // after JSON parse. NOT HTTP first byte/first JSON token.
              turn.firstWordMs=delivered;turn.fullHintMs=delivered;
              if(!turn.valid)turn.reason=end===null?"VAD_ALIGNMENT_UNCERTAIN":"NEGATIVE_AUDIO_CLOCK";
            } catch(e) {turn.reason=(e as Error).message;setFailure(e as Error);}
          })();
          pending.push(job);
        }catch(e){setFailure(e as Error);}
      });
    })));
    clock=performance.now();
    const silence=Buffer.alloc(160,255),total=audio[0].length+8000*8;
    for(let off=0;off<total;off+=160) {
      await sleep(Math.max(0,clock+off/8-performance.now()));
      if(failure)throw failure;
      const drift=performance.now()-clock-off/8; clockMaxDriftMs=Math.max(clockMaxDriftMs,drift);
      if(drift>300)throw Error("REPLAY_CLOCK_DRIFT_OVER_300MS");
      for(let ch=0;ch<2;ch++) {
        if(closed[ch]||sockets[ch].readyState!==WebSocket.OPEN)throw Error("STT_CLOSED_BEFORE_DRAIN");
        const frame=off<audio[ch].length?audio[ch].subarray(off,Math.min(off+160,audio[ch].length)):silence;
        sockets[ch].send(frame);sent[ch]+=frame.length;
      }
    }
    for(let ch=0;ch<2;ch++)sockets[ch].close();
    await Promise.all(pending);
    if(failure)throw failure;
    for(let ch=0;ch<2;ch++) ledger.finish(sttIds[ch],Math.ceil(sent[ch]/8000/60*money.deepgram.perMinuteMicro),{requestId:providerIds[ch],httpStatus:sttHttp[ch]});
    for(let ch=0;ch<2;ch++){
      const lastSpeech=Math.max(0,...f.vad[ch].segments.map(s=>s.endMs));
      if(lastSpeech>finalAudioEnd[ch]+64)throw Error("STT_TAIL_NOT_COVERED");
    }
    if(!turns.length || !items.some(i=>!!i.hint))throw Error("ZERO_HINTS_INVALID");
    // A turn is not matched to a reference by its ordinal. Missing VAD
    // alignment is reported and prevents a flattering aggregate.
    if(turns.some(t=>t.firstWordMs!==null&&!t.valid))throw Error("UNTRUSTWORTHY_TIMING");
    const quality=await judge(ledger,`${run}-${f.id}-judge`,r,f.goal,items);
    return row(true,[],quality);
  } catch(e) {
    setFailure(e as Error);
    for(const ws of sockets)try{ws.terminate();}catch{}
    await Promise.allSettled(pending);
    for(let ch=0;ch<2;ch++)ledger.unknown(sttIds[ch],{requestId:providerIds[ch],httpStatus:sttHttp[ch]});
    return row(false,[(e as Error).message],null);
  } finally {
    for(const ws of sockets)try{ws.terminate();}catch{}
  }
  function row(valid:boolean,reasons:string[],quality:number|null):Row & {startupMs:number;requestHashes:string[]} {
    return {fixtureId:f.id,recipeId:r.id,corpusHash,recipeHash:sha(JSON.stringify(r)),codeCommit,valid,reasons,turns,quality,
      chargedMicro:ledger.held()-beforeCost,costBasis:"provider-usage token estimate; STT sent-duration estimate; unknown holds full reserve; not invoice",
      clockMaxDriftMs,durationMs,contextProvenance:f.goal?"frozen goal; transcript finals reconstructed; cards/strategy unavailable":"goal not saved; transcript finals reconstructed; cards/strategy unavailable",
      judgeModel:r.judgeModel,promptVersion:promptRequest(r,"","","").version,startupMs:clock?clock-startup:performance.now()-startup,
      sttEvidence:{windows:audioWindows,tail:f.roles.map((role,ch)=>({
        role,lastVadEndMs:Math.max(0,...f.vad[ch].segments.map(s=>s.endMs)),lastFinalAudioEndMs:finalAudioEnd[ch],
        covered:Math.max(0,...f.vad[ch].segments.map(s=>s.endMs))<=finalAudioEnd[ch]+64,
      }))},
      requestHashes:ledger.snapshot().entries.filter(e=>e.id.startsWith(run+"-"+f.id)).map(e=>e.payloadHash??sha(e.id))};
  }
}
