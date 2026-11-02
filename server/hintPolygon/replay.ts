import WebSocket from "ws";
import { performance } from "node:perf_hooks";
import { channels } from "./audio";
import { assertAdapter, money, sha, speechEnd, providerAudioMs, type Recipe, type Segment } from "./contracts";
import { chat, judge, parseHint, promptRequest, type JudgeInput } from "./provider";
import type { Ledger } from "./ledger";
import type { Row, Turn } from "./metrics";
import { ownRequestCost } from "./metrics";
import { assessTurns } from "./turnQuality";
import type {HintEngine}from"./experimental/engine";
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export type Fixture = {
  id:string;recordingSid:string;wavMd5:string;audioSha256:string;goal:string;
  durationMs:number;roles:("owner"|"guest")[];vad:{role:string;channel:number;segments:Segment[]}[];
  vadHash:string;goalHash:string;
};
export async function replay(f:Fixture,wav:Buffer,r:Recipe,ledger:Ledger,run:string,corpusHash:string,codeCommit:string,preparedAudio?:Buffer[],engine?:HintEngine) {
  assertAdapter(r);
  if(r.architecture!=="stt-brain"&&!engine)throw Error("EXPERIMENTAL_ENGINE_REQUIRED_NO_FALLBACK");
  if(sha(wav)!==f.audioSha256)throw Error("AUDIO_CHANGED");
  const audio=preparedAudio??channels(wav),durationMs=audio[0].length/8;
  if(audio.length!==2 || audio[0].length!==audio[1].length)throw Error("PREPARED_AUDIO_CHANNEL_MISMATCH");
  if(Math.abs(durationMs-f.durationMs)>1)throw Error("VAD_DURATION_MISMATCH");
  if(f.roles.length!==2 || new Set(f.roles).size!==2)throw Error("CHANNEL_ROLES_UNVERIFIED");
  for(let ch=0;ch<2;ch++)if(f.vad[ch]?.role!==f.roles[ch] || f.vad[ch]?.channel!==ch)throw Error("VAD_ROLE_MISMATCH");
  let clock=0,clockMaxDriftMs=0,failure:Error|null=null;
  const turns:Turn[]=[],pending:Promise<void>[]=[],history:string[]=[],items:JudgeInput[]=[],sockets:WebSocket[]=[];
  const sttIds=[0,1].map(ch=>`${run}-${f.id}-stt-${ch}`);
  const sent=[0,0],providerIds:(string|null)[]=[null,null],closed=[false,false],sttHttp=[0,0];
  const finalAudioEnd=[0,0];
  const audioWindows:NonNullable<Row["sttEvidence"]>["windows"]=[];
  const startup=performance.now();
  const providerFailures:string[]=[];
  const setFailure=(e:Error)=>{failure??=e;};
  try {
    await engine?.open();
    // Reserve both paid streams before constructing either socket.
    const sttReserve=Math.ceil((durationMs+12_000)/60_000*money.deepgram.perMinuteMicro);
    if(ledger.held()+2*sttReserve>ledger.snapshot().limit)throw Error("SERIES_BUDGET_EXHAUSTED");
    for(let ch=0;ch<2;ch++) await ledger.reserve(sttIds[ch],"stt",sttReserve,sha(JSON.stringify({audioSha256:f.audioSha256,channel:ch,recipe:r})));
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
          if(m.type==="TurnInfo"&&m.event==="Update"&&f.roles[ch]==="guest"&&m.transcript?.trim()&&!providerFailures.length)
            engine?.partial?.(String(m.turn_index??"unknown"),String(m.transcript),history.join("\n"));
          if(m.type!=="TurnInfo" || m.event!=="EndOfTurn")return;
          const windowStart=providerAudioMs(m.audio_window_start),windowEnd=providerAudioMs(m.audio_window_end);
          if(windowEnd!==null)finalAudioEnd[ch]=Math.max(finalAudioEnd[ch],windowEnd);
          if(windowStart!==null && windowEnd!==null)
            audioWindows.push({role:f.roles[ch],startMs:windowStart,endMs:windowEnd,receivedMs:performance.now()-clock,hasText:!!m.transcript?.trim()});
          if(!m.transcript?.trim() || failure)return;
          const finalMs=performance.now()-clock;
          const text=String(m.transcript).trim(),role=f.roles[ch];
          history.push(`${role==="owner"?"Owner":"Guest"}: ${text}`);
          if(role!=="guest"){engine?.owner(text);return;}
          const turnId=`${f.id}-${turns.length}`;
          const end=windowStart===null||windowEnd===null?null:speechEnd(f.vad[ch].segments,windowStart,windowEnd);
          const req=promptRequest(r,text,f.goal,history.join("\n"));
          const turn:Turn={turnId,speechEndMs:end,sttFinalMs:finalMs,firstWordMs:null,fullHintMs:null,translationMs:null,
            valid:false,windowEndMs:windowEnd,systemHash:req.systemHash,systemChars:req.systemChars};
          turns.push(turn);
          if(engine){const meta=engine.metadata();turn.systemHash=meta.systemHash;turn.systemChars=meta.systemChars;}
          const past=history.join("\n");
          // Dispatch immediately at EOT. No hidden serialized request queue.
          const job=(async()=>{
            try {
              if(providerFailures.length)throw Error("PROVIDER_DISABLED_AFTER_ERROR");
              const result=engine?null:await chat(ledger,`${run}-${turnId}-brain`,"brain",req.body,f.id,parseHint);
              const h=engine?await engine.generate(turnId,text,past,String(m.turn_index??"unknown")):null;
              if(h?.systemHash)turn.systemHash=h.systemHash;
              if(h?.systemChars!==undefined)turn.systemChars=h.systemChars;
              const hint=h??result!.prepared as ReturnType<typeof parseHint>;
              const first=(h?.firstAt??result!.readyAt)-clock,delivered=(h?.fullAt??result!.readyAt)-clock;
              if(result)turn.reservationWaitMs=result.reservationWaitMs;
              turn.translationMs=h?(h.translationAt===null?null:h.translationAt-clock):hint.translation?delivered:null;
              turn.inputTokens=h?.inputTokens??result!.usage.prompt_tokens;turn.outputTokens=h?.outputTokens??result!.usage.completion_tokens;
              turn.valid=end!==null && finalMs>=end && first>=end && delivered>=first;
              items.push({turnId,question:text,hint:hint.en,translation:hint.translation,history:past});
              if(!hint.en){turn.reason="NO_HINT_FOR_TURN";return;}
              // Nonstream LIVE: first displayable English word exists only
              // after JSON parse. NOT HTTP first byte/first JSON token.
              turn.firstWordMs=first;turn.fullHintMs=delivered;
              if(!turn.valid)turn.reason=end===null?"VAD_ALIGNMENT_UNCERTAIN":"NEGATIVE_AUDIO_CLOCK";
            } catch(e) {
              // An unusable hint rejects this turn, not the rest of the audio.
              // Reservations/unknown outcomes remain charged; never retry it.
              turn.valid=false;turn.reason=(e as Error).message;
              providerFailures.push(turn.reason);
            }
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
        engine?.frame(f.roles[ch],frame);
      }
    }
    for(let ch=0;ch<2;ch++)sockets[ch].close();
    await Promise.all(pending);
    if(failure)throw failure;
    for(let ch=0;ch<2;ch++) await ledger.finish(sttIds[ch],Math.ceil(sent[ch]/8000/60*money.deepgram.perMinuteMicro),{requestId:providerIds[ch],httpStatus:sttHttp[ch]});
    await engine?.settle?.();
    if(providerFailures.length)throw Error("TURN_PROVIDER_FAILURE_"+providerFailures[0]);
    const guestCh=f.roles.indexOf("guest");
    const assessment=assessTurns(turns,f.vad[guestCh].segments,finalAudioEnd[guestCh]);
    if(!assessment.acceptable)throw Error("BAD_TURNS_OVER_30_PERCENT");
    // Abstention is an algorithm result, not corrupt audio. The independent
    // judge must see null hints too, including an entirely abstaining recipe.
    if(!turns.some(t=>t.valid))throw Error("ZERO_ELIGIBLE_TURNS_INVALID");
    // A turn is not matched to a reference by its ordinal. Missing VAD
    // alignment is reported and prevents a flattering aggregate.
    // Keep processing a call despite ambiguous samples. Rejected samples are
    // excluded from both timing and quality, but NEVER from spend.
    const eligible=new Set(turns.filter(t=>t.valid).map(t=>t.turnId));
    try{
      const quality=await judge(ledger,`${run}-${f.id}-judge`,r,f.goal,items.filter(i=>eligible.has(i.turnId)));
      return row(true,[],quality);
    }catch(e){
      // A failed independent judge does not retroactively erase trustworthy
      // physical latency. Quality stays UNKNOWN; no retry or fake score.
      return row(true,["QUALITY_UNAVAILABLE_"+(e as Error).message],null);
    }
  } catch(e) {
    setFailure(e as Error);
    for(const ws of sockets)try{ws.terminate();}catch{}
    await Promise.allSettled(pending);
    for(let ch=0;ch<2;ch++)await ledger.unknown(sttIds[ch],{requestId:providerIds[ch],httpStatus:sttHttp[ch]});
    return row(false,[(e as Error).message],null);
  } finally {
    for(const ws of sockets)try{ws.terminate();}catch{}
    await engine?.close();
  }
  function row(valid:boolean,reasons:string[],quality:number|null):Row & {startupMs:number;requestHashes:string[]} {
    const own=ledger.snapshot().entries.filter(e=>e.id.startsWith(run+"-"+f.id+"-"));
    const guestCh=f.roles.indexOf("guest");
    return {fixtureId:f.id,recipeId:r.id,corpusHash,recipeHash:sha(JSON.stringify(r)),codeCommit,valid,reasons,turns,quality,
      goalGroup:f.goal?"saved-goal":"no-goal",
      turnQuality:assessTurns(turns,f.vad[guestCh].segments,finalAudioEnd[guestCh]),
      chargedMicro:ownRequestCost(own,run+"-"+f.id+"-"),costBasis:"provider-usage token estimate; STT sent-duration estimate; unknown holds full reserve; not invoice",
      clockMaxDriftMs,durationMs,contextProvenance:engine?.metadata().contextProvenance??(f.goal?"frozen goal; transcript finals reconstructed; cards/strategy unavailable":"goal not saved; transcript finals reconstructed; cards/strategy unavailable"),
      judgeModel:r.judgeModel,promptVersion:engine?.metadata().promptVersion??promptRequest(r,"","","").version,startupMs:clock?clock-startup:performance.now()-startup,
      providerAudit:engine?.audit?.(),
      sttEvidence:{windows:audioWindows,tail:f.roles.map((role,ch)=>({
        role,lastVadEndMs:Math.max(0,...f.vad[ch].segments.map(s=>s.endMs)),lastFinalAudioEndMs:finalAudioEnd[ch],
        covered:Math.max(0,...f.vad[ch].segments.map(s=>s.endMs))<=finalAudioEnd[ch]+64,
      }))},
      requestHashes:ledger.snapshot().entries.filter(e=>e.id.startsWith(run+"-"+f.id)).map(e=>e.payloadHash??sha(e.id))};
  }
}
