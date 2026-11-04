import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { SecretaryStreamDependencies } from "../secretary/agent";
import { LiveAudio, LIVE_MODEL, LIVE_VOICE } from "../incomingSecretary/liveAudio";
import { compactSpeedPrompt } from "./speedExperiment";
import { SecretaryLab, type LabReport } from "./service";
import { LiveBudget } from "./liveBudget";
import { devReportArchive } from "./devReportArchive";

export const liveBudget = new LiveBudget();
export function requireLiveDev() {
  if(process.env.NODE_ENV!=="development" || process.env.REPLIT_DEPLOYMENT==="1") throw Error("LIVE_DEV_ONLY");
}
/** First-stage comparison: native voice + compact C, explicitly NO tools/backend. */
export function liveBenchConfig(instruction: string) {
  return {
    model:LIVE_MODEL,store:false,
    instructions: compactSpeedPrompt({plan:{instruction},runtimeUtc:new Date().toISOString()}).instructions+
      "\nThis is a private microphone test, not a telephone call. No tools, business actions or backend are connected. "+
      "Never claim to save, call, book, pay or verify anything. Do not delegate. Follow caller RU/EN/ES. "+
      "Yield to corrections; do not repeat obsolete numbers. Use short natural answers, not repeated filler.",
    audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:LIVE_VOICE}},
    delegation:{type:"client"},input:[],
  };
}
export function validateLiveBench(c: any) {
  return c?.model===LIVE_MODEL && c?.audio?.output?.voice===LIVE_VOICE &&
    c?.audio?.format?.type==="audio/pcmu" && c?.audio?.format?.rate===8000 &&
    c?.delegation?.type==="client" && !c?.delegation?.responses;
}
type Usage = {seconds: number|null; connected: boolean; reservation: string;
  timeline: Array<{type:string;atMs:number;startMs?:number;endMs?:number;text?:string}>};
const admissions=new Map<string,Usage>();
const finals=new Map<string,Promise<void>>();
const results=new Map<string,LabReport & {liveBench:object}>();
const owners=new Map<string,string>();

/** Reuses the same simulated Twilio media peer and native Live transport; no dialer. */
export function startLiveBench(socket: WebSocket, deps: SecretaryStreamDependencies) {
  requireLiveDev();
  let ai: LiveAudio|undefined, id="", sid="", closing=false, started=false;
  let fragments={guest:"",secretary:""};
  const transcriptTimers: Partial<Record<"guest"|"secretary",ReturnType<typeof setTimeout>>>={};
  const transcriptEnds={guest:0,secretary:0};
  const flush=(role:"guest"|"secretary")=>{
    clearTimeout(transcriptTimers[role]);
    const text=fragments[role];fragments[role]="";
    if(text.trim())void deps.onTurn(id,role,text,"lab-"+id);
  };
  const finish=async(reason:string)=>{
    if(closing)return;closing=true;
    const ok=ai?await ai.close():!started;
    const u=admissions.get(id);if(u && !ok)u.seconds=null;
    flush("guest");flush("secretary");
    await deps.onStreamEnd(id,reason,"lab-"+id);
  };
  socket.on("close",()=>void finish("browser_disconnected"));
  socket.on("message",async raw=>{
    let e:any;try{e=JSON.parse(raw.toString());}catch{return;}
    if(e.event==="stop"){void finish("user_stop");return;}
    if(e.event==="media" && ai && started && !closing) {
      try{ai.send({type:"session.input_audio.append",audio:e.media.payload});}catch{void finish("live_input_failed");}
      return;
    }
    if(e.event!=="start"||ai||closing)return;
    id=e.start.customParameters.taskId;sid=e.start.streamSid;
    const context=await deps.lookup(e.start.callSid,id,e.start.customParameters.streamAuth);
    if(!context){await finish("live_context_denied");return;}
    const config=liveBenchConfig(context.instruction);
    ai=new LiveAudio(context.instruction,event=>{
      const u=admissions.get(id);
      if(event.type==="session.started" && u){u.connected=true;u.seconds=null;}
      if(event.type==="session.closed" && u){
        const seconds=event.usage?.seconds;
        u.seconds=typeof seconds==="number"&&Number.isFinite(seconds)&&seconds>=0?seconds:null;
      }
      if(event.type==="session.input_transcript.delta" || event.type==="session.output_transcript.delta"){
        const role=event.type==="session.input_transcript.delta"?"guest":"secretary";
        if(typeof event.delta==="string"){
          if(u && u.timeline.length<3000)u.timeline.push({type:role,atMs:Date.now(),
            startMs:event.start_ms,endMs:event.end_ms,text:event.delta.slice(0,1500)});
          // Speakers overlap: keep independent caption streams instead of
          // splitting the assistant's word every time a caller delta arrives.
          if(Number.isFinite(event.start_ms) && event.start_ms-transcriptEnds[role]>1200)flush(role);
          fragments[role]=(fragments[role]+event.delta).slice(0,6000);
          transcriptEnds[role]=event.end_ms??transcriptEnds[role];
          clearTimeout(transcriptTimers[role]);
          transcriptTimers[role]=setTimeout(()=>flush(role),700);
          transcriptTimers[role]!.unref?.();
        }
      }
      if(event.type==="session.output_audio.delta" && typeof event.delta==="string" && !closing){
        deps.onDiagnostic?.("tts_received");
        socket.send(JSON.stringify({event:"media",streamSid:sid,media:{payload:event.delta}}));
      }
      if(event.type==="delegation.requested"||event.type==="session.delegation.requested")
        void finish("live_backend_not_connected");
      if(event.type==="error"||event.type==="transport_error")void finish("live_provider_error");
      if(event.type==="transport_closed"&&!closing)void finish("live_transport_closed");
    },()=>new WebSocket("wss://api.openai.com/v1/live/sessions",{
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
    }),config as any,validateLiveBench);
    // A request with an uncertain handshake is not zero spend.
    const usage=admissions.get(id);if(usage)usage.seconds=null;
    try{await ai.connect();if(closing)return;started=true;deps.onDiagnostic?.("realtime_ready");}
    catch{await finish("live_setup_unconfirmed");}
  });
}
class LiveEngineLab extends SecretaryLab {
  async create(owner:string,input:any) {
    requireLiveDev();
    if(input?.voiceProvider!=="openai")throw Object.assign(Error("LIVE_BUILTIN_VOICE_ONLY"),{status:400});
    if(typeof input?.instruction!=="string")throw Object.assign(Error("LIVE_INSTRUCTION_REQUIRED"),{status:400});
    liveBenchConfig(input.instruction);
    const reservation=randomUUID();await liveBudget.reserve(reservation);
    try{
      const r=await super.create(owner,input);
      owners.set(r.id,owner);admissions.set(r.id,{reservation,seconds:0,connected:false,timeline:[]});
      return r;
    }catch(e){await liveBudget.settle(reservation,0);throw e;}
  }
  async stop(owner:string,id:string,reason="user_stop"){
    const r=await super.stop(owner,id,reason);
    await finals.get(id);
    return results.get(id)??r;
  }
}
export const liveEngineLab=new LiveEngineLab({
  socketPath:"/secretary-live-lab-stream",
  stopTimeoutMs:7000,
  startEngine:startLiveBench,
  context:async(ownerId)=>({ownerId,voiceProvider:"openai",cloneVoiceId:""}),
  translate:async()=>({}), // No extra display-model charges in this isolated trial.
  openAI:{isAvailable:async()=>{requireLiveDev();return !!process.env.OPENAI_API_KEY;},create:()=>{throw Error("LIVE_NO_REALTIME_FALLBACK");}},
  onEnd:report=>{
    const u=admissions.get(report.id), owner=owners.get(report.id);
    if(!u||!owner)return;
    const final={...report,liveBench:{stage:"compact-C-no-tools",backendConnected:false,usageSeconds:u.seconds,
      rateUsdPerMinute:.05,voiceUsd:u.seconds===null?null:u.seconds*.05/60,engineUsd:0,
      requestMode:"native-full-duplex",timeline:u.timeline,
      audioTiming:"browser playback acknowledgment required; transcript is not VAD"}};
    if(final.cost){
      const amount=u.seconds===null?null:u.seconds*.05/60;
      final.cost={...final.cost,complete:amount!==null,estimatedTotalUsd:amount,knownSubtotalUsd:amount??0,
        durationSeconds:u.seconds,durationBasis:"OpenAI session.closed usage.seconds, not local wall clock",
        lines:[{label:"GPT-Live-1 voice",status:amount===null?"unknown":"estimated",quantity:u.seconds===null?null:u.seconds/60,
          unit:"minute",rateUsd:.05,amountUsd:amount,note:"Provider duration; public tariff; not an invoice"},
        {label:"Backend / tools",status:"not_applicable",quantity:null,unit:"item",rateUsd:null,amountUsd:null,
          note:"First-stage compact C: no backend or tools configured"}],
        notes:["No independent TTS, Retell, display STT or subtitle-model request in this branch.",
          "Cost calculated from provider usage; not a confirmed charge."]};
    }
    results.set(report.id,final);
    finals.set(report.id,(async()=>{
      await liveBudget.settle(u.reservation,u.seconds);
      await (await devReportArchive()).save(owner,final);
    })().catch(()=>{throw Error("LIVE_FINALIZATION_UNCONFIRMED_NO_RETRY");}));
    // No unhandled rejection; stop/readiness still surface failed finalization.
    void finals.get(report.id)!.catch(()=>{});
  },
});
export async function liveEngineReadiness(owner:string){
  requireLiveDev();
  await Promise.all(finals.values());
  const archived=(await (await devReportArchive()).list(owner)).filter((r:any)=>r.liveBench);
  return {
    providers:{openai:{ready:!!process.env.OPENAI_API_KEY,source:"builtin",model:LIVE_MODEL,voice:LIVE_VOICE}},
    models:{realtime:LIVE_MODEL,stt:"GPT-Live native RU/EN/ES"},
    limits:{durationSeconds:300,historyMinutes:0},
    note:"Dev only · GPT-Live + compact C · no tools/backend · $0.05/min · separate $20 series",
    liveBudget:await liveBudget.state(),
    sessions:Array.from(new Map([...archived,...liveEngineLab.reports(owner).map(r=>results.get(r.id)??r)].map(r=>[r.id,r])).values()).reverse(),
  };
}
setInterval(()=>liveEngineLab.sweep(),30_000).unref();
