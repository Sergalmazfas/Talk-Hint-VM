// Translator Realtime Spike — dev-only developer test stand.
//
// Purpose: prove realtime RU↔EN voice translation capability on an isolated
// bench BEFORE any iPhone / TranslatorViewController / telephony integration.
// The stand talks ONLY to the RealtimeTranslationProvider boundary
// (provider.ts) — it has no knowledge of OpenAI specifics.
//
// Security model: the page and the WS channel are hard-disabled in
// production (404 / upgrade rejected). In dev the WS requires a random
// per-boot token that is only embedded in the served page.
//
// NOT part of this spike (by explicit task scope): TranslatorViewController
// integration, tab bar changes, Hint↔Translator switching, Twilio/telephony,
// summary, Call History, memory flow.

import crypto from "crypto";
import type { Express } from "express";
import type WebSocket from "ws";
import { log } from "../index";
import { openaiRealtimeTranslationProvider } from "./openaiRealtimeTranslator";
import type { RealtimeTranslationSession } from "./provider";

const SPIKE_TOKEN = crypto.randomBytes(24).toString("hex");
const SAMPLE_RATE = 24000;

export function isSpikeEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isValidSpikeToken(token: string | null): boolean {
  if (!isSpikeEnabled() || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(SPIKE_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function handleTranslatorSpikeStream(ws: WebSocket) {
  let session: RealtimeTranslationSession | null = null;
  let starting = false;
  let closed = false;

  const send = (obj: object) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.on("message", async (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      session?.sendAudio(data);
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "start") {
      // Guard against concurrent starts AND against the browser socket
      // closing while startSession is in flight — every opened provider
      // session must be cancelled exactly once, never leaked.
      if (session || starting) return;
      starting = true;
      let started: RealtimeTranslationSession;
      try {
        started = await openaiRealtimeTranslationProvider.startSession({
          languages: [msg.langA || "ru", msg.langB || "en"],
          sourceLangHint: "auto",
          voice: msg.voice || undefined,
          inputFormat: { encoding: "pcm16", sampleRateHz: SAMPLE_RATE },
          outputFormat: { encoding: "pcm16", sampleRateHz: SAMPLE_RATE },
        });
      } catch (e) {
        starting = false;
        send({ type: "error", message: (e as Error).message, fatal: true });
        return;
      }
      starting = false;
      if (closed || ws.readyState !== ws.OPEN) {
        started.cancel();
        return;
      }
      session = started;
      session.onEvent((ev) => {
        // Provider events map 1:1 onto the stand's wire protocol.
        if (ev.type === "translated_audio") send({ type: "audio", data: ev.base64 });
        else send(ev);
        if (ev.type === "closed" && !closed) {
          // Provider side dropped — tell the page honestly.
          send({ type: "error", message: "provider session closed", fatal: true });
        }
      });
    } else if (msg.type === "stop") {
      await session?.stop();
      session = null;
    }
  });

  ws.on("close", () => {
    closed = true;
    session?.cancel();
    session = null;
    log("[TranslatorSpike] stand disconnected", "translator");
  });
}

export function registerTranslatorSpike(app: Express) {
  app.get("/translator-spike", (_req, res) => {
    if (!isSpikeEnabled()) return res.status(404).send("Not found");
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(buildSpikePageHtml());
  });
}

function buildSpikePageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Translator Realtime Spike (dev)</title>
<style>
  :root { --bg:#f6f6f8; --card:#fff; --sub:#6b7280; --accent:#6d28d9; --err:#dc2626; }
  body { font-family: -apple-system, system-ui, sans-serif; background:var(--bg); margin:0; padding:16px; color:#111; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:var(--sub); font-size:13px; margin-bottom:12px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  button { padding:10px 18px; border:0; border-radius:10px; font-size:15px; cursor:pointer; }
  #startBtn { background:var(--accent); color:#fff; }
  #stopBtn { background:#e5e7eb; }
  #status { font-size:13px; color:var(--sub); }
  .cols { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
  @media (max-width:800px){ .cols { grid-template-columns:1fr; } }
  .card { background:var(--card); border-radius:14px; padding:12px; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  .card h2 { font-size:14px; margin:0 0 8px; }
  #feed { max-height:340px; overflow-y:auto; font-size:14px; }
  .turn { border-bottom:1px solid #eee; padding:6px 0; }
  .src { color:#111; }
  .dst { color:var(--accent); }
  .err { color:var(--err); font-size:13px; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th,td { border-bottom:1px solid #eee; padding:4px 6px; text-align:right; }
  th:first-child, td:first-child { text-align:left; }
  #summary { font-size:13px; line-height:1.7; }
  .lag-ok { color:#059669; } .lag-warn { color:#d97706; } .lag-bad { color:var(--err); }
  #exportBtn { background:#e5e7eb; font-size:13px; padding:6px 12px; }
</style>
</head>
<body>
<h1>Translator Realtime Spike</h1>
<div class="sub">RU ↔ EN, continuous open-mic, server VAD. Use headphones — the translated voice will otherwise feed back into the mic. Dev-only stand; no telephony, no iOS.</div>
<div class="row">
  <button id="startBtn">Start session</button>
  <button id="stopBtn" disabled>Stop</button>
  <span id="status">idle</span>
</div>
<div class="cols">
  <div class="card"><h2>Transcript</h2><div id="feed"></div></div>
  <div class="card">
    <h2>Per-turn metrics <button id="exportBtn">Export report JSON</button></h2>
    <table id="mtable"><thead><tr>
      <th>#</th><th>latency ms</th><th>in ms</th><th>out ms</th><th>cost $</th>
    </tr></thead><tbody></tbody></table>
    <h2 style="margin-top:10px">Summary</h2>
    <div id="summary">—</div>
  </div>
</div>
<script>
const TOKEN = ${JSON.stringify(SPIKE_TOKEN)};
const RATE = ${SAMPLE_RATE};
let ws=null, ctx=null, workletNode=null, mediaStream=null;
let playhead=0, running=false;
const turns=[]; // metrics
let sessionMeta=null, sessionStartTs=0, errors=[];
const feed=document.getElementById('feed');
const statusEl=document.getElementById('status');
const startBtn=document.getElementById('startBtn');
const stopBtn=document.getElementById('stopBtn');

function setStatus(s){ statusEl.textContent=s; }
function addLine(cls, text){
  const d=document.createElement('div'); d.className='turn '+cls; d.textContent=text;
  feed.appendChild(d); feed.scrollTop=feed.scrollHeight;
  return d;
}

const WORKLET = \`
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(){ super(); this.buf=[]; this.len=0; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0];
    if (ch){
      this.buf.push(new Float32Array(ch)); this.len += ch.length;
      if (this.len >= 960){ // ~40ms @24k
        const all = new Float32Array(this.len); let o=0;
        for (const b of this.buf){ all.set(b,o); o+=b.length; }
        const pcm = new Int16Array(all.length);
        for (let i=0;i<all.length;i++){ const s=Math.max(-1,Math.min(1,all[i])); pcm[i]=s<0?s*0x8000:s*0x7FFF; }
        this.port.postMessage(pcm.buffer,[pcm.buffer]);
        this.buf=[]; this.len=0;
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);\`;

function playChunk(b64){
  const bin=atob(b64); const n=bin.length/2;
  const f=new Float32Array(n);
  for(let i=0;i<n;i++){
    let v=bin.charCodeAt(2*i)|(bin.charCodeAt(2*i+1)<<8);
    if(v>=0x8000)v-=0x10000;
    f[i]=v/0x8000;
  }
  const buf=ctx.createBuffer(1,n,RATE); buf.getChannelData(0).set(f);
  const src=ctx.createBufferSource(); src.buffer=buf; src.connect(ctx.destination);
  const t=Math.max(ctx.currentTime+0.02, playhead);
  src.start(t); playhead=t+buf.duration;
}

let curSrcEl=null, curDstEl=null, dstAccum='';
function onMsg(ev){
  let m; try{ m=JSON.parse(ev.data); }catch{ return; }
  if(m.type==='audio'){ playChunk(m.data); return; }
  if(m.type==='ready'){ sessionMeta=m; setStatus('live — speak ('+m.model+', voice '+(m.voice||'?')+')'); return; }
  if(m.type==='speech_started'){ setStatus('listening…'); curSrcEl=null; curDstEl=null; dstAccum=''; return; }
  if(m.type==='speech_stopped'){ setStatus('translating…'); return; }
  if(m.type==='source_transcript'){ curSrcEl=addLine('src','🎙 '+m.text); return; }
  if(m.type==='translated_transcript_delta'){
    dstAccum+=m.text;
    if(!curDstEl) curDstEl=addLine('dst','→ ');
    curDstEl.textContent='→ '+dstAccum; return;
  }
  if(m.type==='translated_transcript_done'){
    if(!curDstEl) curDstEl=addLine('dst','');
    curDstEl.textContent='→ '+m.text; dstAccum=''; return;
  }
  if(m.type==='turn_completed'){ turns.push(m.metrics); renderMetrics(); setStatus('live — speak'); return; }
  if(m.type==='error'){ errors.push(m.message); addLine('err','⚠ '+m.message); if(m.fatal){ stopAll('provider error'); } return; }
}

function pct(sorted,p){ if(!sorted.length) return null; return sorted[Math.min(sorted.length-1, Math.ceil(p/100*sorted.length)-1)]; }
function renderMetrics(){
  const tb=document.querySelector('#mtable tbody'); tb.innerHTML='';
  for(const t of turns){
    const tr=document.createElement('tr');
    const lag=t.latencyMs;
    const cls=lag==null?'':(lag<=1200?'lag-ok':lag<=2000?'lag-warn':'lag-bad');
    tr.innerHTML='<td>'+t.turnIndex+'</td><td class="'+cls+'">'+(lag??'—')+'</td><td>'+(t.audioInMs??'—')+'</td><td>'+(t.audioOutMs??'—')+'</td><td>'+(t.estimatedCostUsd!=null?t.estimatedCostUsd.toFixed(4):'—')+'</td>';
    tb.appendChild(tr);
  }
  const lat=turns.map(t=>t.latencyMs).filter(v=>v!=null).sort((a,b)=>a-b);
  const cost=turns.reduce((s,t)=>s+(t.estimatedCostUsd||0),0);
  const audioMs=turns.reduce((s,t)=>s+(t.audioInMs||0)+(t.audioOutMs||0),0);
  const wallMin=sessionStartTs?((Date.now()-sessionStartTs)/60000):0;
  document.getElementById('summary').innerHTML=
    'turns: <b>'+turns.length+'</b><br>'+
    'latency (speech end → first translated audio): median <b>'+(pct(lat,50)??'—')+'</b> ms, p95 <b>'+(pct(lat,95)??'—')+'</b> ms<br>'+
    'total est. cost: <b>$'+cost.toFixed(4)+'</b><br>'+
    'cost per active-audio minute: <b>'+(audioMs>0?('$'+(cost/(audioMs/60000)).toFixed(3)):'—')+'</b><br>'+
    'cost per wall-clock minute: <b>'+(wallMin>0.2?('$'+(cost/wallMin).toFixed(3)):'—')+'</b><br>'+
    'errors: '+errors.length;
}

document.getElementById('exportBtn').onclick=()=>{
  const report={ generatedAt:new Date().toISOString(), session:sessionMeta, turns, errors,
    summary:{ turnCount:turns.length,
      latencyMedianMs:pct(turns.map(t=>t.latencyMs).filter(v=>v!=null).sort((a,b)=>a-b),50),
      latencyP95Ms:pct(turns.map(t=>t.latencyMs).filter(v=>v!=null).sort((a,b)=>a-b),95),
      totalEstimatedCostUsd:turns.reduce((s,t)=>s+(t.estimatedCostUsd||0),0) } };
  const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='translator-spike-report.json'; a.click();
};

async function start(){
  startBtn.disabled=true;
  try{
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true}});
    ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:RATE});
    await ctx.resume();
    const blobUrl=URL.createObjectURL(new Blob([WORKLET],{type:'application/javascript'}));
    await ctx.audioWorklet.addModule(blobUrl);
    const srcNode=ctx.createMediaStreamSource(mediaStream);
    workletNode=new AudioWorkletNode(ctx,'capture-processor');
    srcNode.connect(workletNode);
    const proto=location.protocol==='https:'?'wss:':'ws:';
    ws=new WebSocket(proto+'//'+location.host+'/translator-spike-stream?token='+encodeURIComponent(TOKEN));
    ws.binaryType='arraybuffer';
    ws.onopen=()=>{ ws.send(JSON.stringify({type:'start',langA:'ru',langB:'en'})); setStatus('connecting to provider…'); sessionStartTs=Date.now(); };
    ws.onmessage=onMsg;
    ws.onclose=()=>{ if(running) stopAll('connection closed'); };
    ws.onerror=()=>{ addLine('err','⚠ websocket error'); };
    workletNode.port.onmessage=(e)=>{ if(ws&&ws.readyState===1) ws.send(e.data); };
    running=true; stopBtn.disabled=false; playhead=0;
  }catch(e){
    addLine('err','⚠ '+e.message); startBtn.disabled=false;
  }
}

function stopAll(reason){
  running=false;
  try{ ws&&ws.readyState===1&&ws.send(JSON.stringify({type:'stop'})); }catch{}
  try{ ws&&ws.close(); }catch{} ws=null;
  try{ workletNode&&workletNode.disconnect(); }catch{}
  try{ mediaStream&&mediaStream.getTracks().forEach(t=>t.stop()); }catch{}
  try{ ctx&&ctx.close(); }catch{} ctx=null;
  setStatus('stopped'+(reason?' ('+reason+')':''));
  startBtn.disabled=false; stopBtn.disabled=true;
  renderMetrics();
}

startBtn.onclick=start;
stopBtn.onclick=()=>stopAll('');
</script>
</body>
</html>`;
}
