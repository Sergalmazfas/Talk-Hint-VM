// Translator Realtime Spike — dev-only developer test stand.
//
// Purpose: prove realtime voice translation capability on an isolated bench
// BEFORE any iPhone / TranslatorViewController / telephony integration.
// The stand talks ONLY to the RealtimeTranslationProvider boundary
// (provider.ts) — it has no knowledge of OpenAI specifics.
//
// Hardening + Run #2 (spec: attached_assets Translator Spike v2):
// - experimental language controls (Input Auto/RU/EN/ES → Output EN/RU/ES);
// - voice selector (female "marin" / male "cedar", same provider);
// - per-turn evidence: source → translation chain, cancellation forensics
//   (VALID_BARGE_IN / FALSE_PREMATURE_CANCEL / PLAYBACK_FEEDBACK / UNKNOWN)
//   with client playback state captured at the moment of cancellation;
// - lost-translation tracking (completed source utterances w/o translation);
// - semantic review (FAITHFUL / ADDED_CONTENT / UNSOLICITED_RESPONSE /
//   UNCERTAIN) via a server-side judge endpoint;
// - Export report JSON includes the full scorecard.
//
// Security model: the page and the WS channel are hard-disabled in
// production (404 / upgrade rejected). In dev the WS and the review endpoint
// require a random per-boot token that is only embedded in the served page.
//
// NOT part of this spike (by explicit task scope): TranslatorViewController
// integration, tab bar changes, Hint↔Translator switching, Twilio/telephony.

import crypto from "crypto";
import type { Express } from "express";
import type WebSocket from "ws";
import { tlog as log } from "./logger";
import { openaiRealtimeTranslationProvider } from "./openaiRealtimeTranslator";
import { runSemanticReview } from "./reviewJudge";
import type { RealtimeTranslationSession } from "./provider";

const SPIKE_TOKEN = crypto.randomBytes(24).toString("hex");
const SAMPLE_RATE = 24000;

// Experimental controls allowlists (spec Section 8/10). Voices are from the
// SAME realtime provider — marin (female, Run #1 baseline) and cedar (male).
const INPUT_LANGS = ["auto", "ru", "en", "es"] as const;
const OUTPUT_LANGS = ["en", "ru", "es"] as const;
const VOICES: Record<string, { name: string; gender: string }> = {
  marin: { name: "Marin", gender: "female" },
  cedar: { name: "Cedar", gender: "male" },
};

export function isSpikeEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isValidSpikeToken(token: string | null): boolean {
  if (!isSpikeEnabled() || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(SPIKE_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Validate experimental control values from the page (fail-closed to defaults). */
export function sanitizeSpikeControls(msg: any): {
  inputLang: string;
  outputLang: string;
  voice: string;
} {
  const inputLang = INPUT_LANGS.includes(msg?.inputLang) ? msg.inputLang : "auto";
  const outputLang = OUTPUT_LANGS.includes(msg?.outputLang) ? msg.outputLang : "en";
  const voice = Object.prototype.hasOwnProperty.call(VOICES, msg?.voice) ? msg.voice : "marin";
  return { inputLang, outputLang, voice };
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
      const { inputLang, outputLang, voice } = sanitizeSpikeControls(msg);
      // Directed mode: everything → outputLang. The language pair drives
      // auto-detection hints; use the fixed input when given, else the pair
      // most likely to appear (ru/en/es minus the output language).
      const otherLang =
        inputLang !== "auto" ? inputLang : outputLang === "ru" ? "en" : "ru";
      let started: RealtimeTranslationSession;
      try {
        started = await openaiRealtimeTranslationProvider.startSession({
          languages: [otherLang, outputLang],
          sourceLangHint: inputLang,
          outputLanguage: outputLang,
          voice,
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
      send({
        type: "session_config",
        inputLang,
        outputLang,
        voice_id: voice,
        voice_name: VOICES[voice]?.name || voice,
        voice_gender: VOICES[voice]?.gender || "unknown",
        provider: "openai-realtime",
      });
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

  // Semantic review judge (spec Section 2) — dev-only, token-protected.
  app.post("/translator-spike/review", async (req, res) => {
    if (!isSpikeEnabled()) return res.status(404).send("Not found");
    const token = req.headers["x-spike-token"];
    if (!isValidSpikeToken(typeof token === "string" ? token : null)) {
      return res.status(403).json({ error: "invalid token" });
    }
    const turns = Array.isArray(req.body?.turns) ? req.body.turns : [];
    const inputs = turns
      .filter((t: any) => typeof t?.turnIndex === "number")
      .slice(0, 200)
      .map((t: any) => ({
        turnIndex: t.turnIndex,
        // Cap per-field text so a token holder cannot submit unbounded
        // billable judge payloads (real spike utterances are far shorter).
        source: String(t.source || "").slice(0, 2000),
        translation: String(t.translation || "").slice(0, 2000),
      }));
    try {
      const results = await runSemanticReview(inputs);
      res.json({ results });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
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
  :root { --bg:#f6f6f8; --card:#fff; --sub:#6b7280; --accent:#6d28d9; --err:#dc2626; --ok:#059669; }
  body { font-family: -apple-system, system-ui, sans-serif; background:var(--bg); margin:0; padding:16px; color:#111; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:var(--sub); font-size:13px; margin-bottom:12px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  button { padding:10px 18px; border:0; border-radius:10px; font-size:15px; cursor:pointer; }
  select { padding:6px 8px; border-radius:8px; border:1px solid #d1d5db; font-size:14px; }
  label { font-size:13px; color:var(--sub); }
  #startBtn { background:var(--accent); color:#fff; }
  #stopBtn { background:#e5e7eb; }
  #status { font-size:13px; color:var(--sub); }
  .cols { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
  @media (max-width:800px){ .cols { grid-template-columns:1fr; } }
  .card { background:var(--card); border-radius:14px; padding:12px; box-shadow:0 1px 3px rgba(0,0,0,.06); margin-bottom:12px; }
  .card h2 { font-size:14px; margin:0 0 8px; }
  #feed { max-height:340px; overflow-y:auto; font-size:14px; }
  .turn { border-bottom:1px solid #eee; padding:6px 0; }
  .src { color:#111; }
  .dst { color:var(--accent); }
  .err { color:var(--err); font-size:13px; }
  .cx { color:#b45309; font-size:13px; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th,td { border-bottom:1px solid #eee; padding:4px 6px; text-align:right; }
  th:first-child, td:first-child { text-align:left; }
  #summary { font-size:13px; line-height:1.7; }
  .lag-ok { color:var(--ok); } .lag-warn { color:#d97706; } .lag-bad { color:var(--err); }
  .smallbtn { background:#e5e7eb; font-size:13px; padding:6px 12px; }
  .cls-FAITHFUL { color:var(--ok); } .cls-ADDED_CONTENT,.cls-UNSOLICITED_RESPONSE { color:var(--err); font-weight:600; }
  .cls-UNCERTAIN { color:#d97706; }
  .evrow { font-size:12px; border-bottom:1px solid #eee; padding:5px 0; }
  .evrow select { font-size:12px; padding:2px 4px; }
</style>
</head>
<body>
<h1>Translator Realtime Spike — Run #2 stand</h1>
<div class="sub">Continuous open-mic, server VAD. Use headphones — the translated voice will otherwise feed back into the mic. Dev-only stand; no telephony, no iOS. Changing a selector while live cleanly restarts the session.</div>
<div class="row">
  <label>Input <select id="inLang"><option value="auto" selected>Auto</option><option value="ru">Russian</option><option value="en">English</option><option value="es">Spanish</option></select></label>
  <label>Output <select id="outLang"><option value="en" selected>English</option><option value="ru">Russian</option><option value="es">Spanish</option></select></label>
  <label>Voice <select id="voiceSel"><option value="marin" selected>Marin (female)</option><option value="cedar">Cedar (male)</option></select></label>
</div>
<div class="row">
  <button id="startBtn">Start session</button>
  <button id="stopBtn" disabled>Stop</button>
  <span id="status">idle</span>
</div>
<div class="cols">
  <div>
    <div class="card"><h2>Transcript</h2><div id="feed"></div></div>
    <div class="card"><h2>Cancellation forensics <span class="sub" id="cxCount"></span></h2><div id="cxList" class="sub">no cancellations yet</div></div>
  </div>
  <div>
    <div class="card">
      <h2>Per-turn metrics
        <button id="reviewBtn" class="smallbtn">Run semantic review</button>
        <button id="exportBtn" class="smallbtn">Export report JSON</button>
      </h2>
      <table id="mtable"><thead><tr>
        <th>#</th><th>latency ms</th><th>in ms</th><th>out ms</th><th>cost $</th><th>review</th>
      </tr></thead><tbody></tbody></table>
      <h2 style="margin-top:10px">Scorecard</h2>
      <div id="summary">—</div>
    </div>
  </div>
</div>
<script>
const TOKEN = ${JSON.stringify(SPIKE_TOKEN)};
const RATE = ${SAMPLE_RATE};
let ws=null, ctx=null, workletNode=null, mediaStream=null;
let playhead=0, running=false, restarting=false;
const turns=[];              // per-turn metrics from provider (completed + cancelled)
const srcUtterances=[];      // evidence: every recognized source utterance
const cancellations=[];      // forensic records
let review={ results:{}, ranAt:null };  // turnIndex -> {classification, reason}
let sessionMeta=null, sessionConfig=null, sessionStartTs=0, errors=[];
// Finished runs (each with its own immutable config + evidence). A control
// change archives the current run so one scorecard never mixes configs.
const completedRuns=[];
function archiveCurrentRun(reason){
  if(turns.length||srcUtterances.length||cancellations.length){
    completedRuns.push({ reason, archivedAt:new Date().toISOString(),
      session:sessionMeta, sessionConfig, scorecard:computeScorecard(),
      turns:turns.slice(), sourceUtterances:srcUtterances.slice(),
      cancellations:cancellations.slice(), semanticReview:JSON.parse(JSON.stringify(review)), errors:errors.slice() });
  }
  turns.length=0; srcUtterances.length=0; cancellations.length=0;
  review={ results:{}, ranAt:null }; errors=[];
  sessionMeta=null; sessionConfig=null; sessionStartTs=0;
}
let lastSpeechStartTs=0, lastSpeechStopTs=0, lastPlaybackEndTs=0;
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
function playbackActive(){ return !!ctx && playhead > ctx.currentTime + 0.05; }
function isMeaningful(t){ return !!t && t.replace(/[^\\p{L}\\p{N}]/gu,'').length >= 3; }

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
  src.onended=()=>{ if(!playbackActive()) lastPlaybackEndTs=Date.now(); };
}

let curSrcEl=null, curDstEl=null, dstAccum='';
function onMsg(ev){
  let m; try{ m=JSON.parse(ev.data); }catch{ return; }
  if(m.type==='audio'){ playChunk(m.data); return; }
  if(m.type==='session_config'){ sessionConfig=m; return; }
  if(m.type==='ready'){ sessionMeta=m; setStatus('live — speak ('+m.model+', voice '+(m.voice||'?')+')'); return; }
  if(m.type==='speech_started'){
    lastSpeechStartTs=Date.now();
    setStatus('listening…'); curSrcEl=null; curDstEl=null; dstAccum='';
    return;
  }
  if(m.type==='speech_stopped'){ lastSpeechStopTs=Date.now(); setStatus('translating…'); return; }
  if(m.type==='source_transcript'){
    // Keyed by the provider's stable item id — association with translations
    // and cancellations happens at scorecard time via sourceItemId matching,
    // never by event arrival order (transcription events arrive async).
    srcUtterances.push({ index:srcUtterances.length, itemId:m.itemId||null, ts:Date.now(), text:m.text, meaningful:isMeaningful(m.text) });
    curSrcEl=addLine('src','🎙 '+m.text);
    return;
  }
  if(m.type==='translated_transcript_delta'){
    dstAccum+=m.text;
    if(!curDstEl) curDstEl=addLine('dst','→ ');
    curDstEl.textContent='→ '+dstAccum; return;
  }
  if(m.type==='translated_transcript_done'){
    if(!curDstEl) curDstEl=addLine('dst','');
    curDstEl.textContent='→ '+m.text; dstAccum='';
    return;
  }
  if(m.type==='response_cancelled'){
    // Forensic evidence captured at the moment of cancellation. The
    // sourceItemId comes from the provider's FIFO attribution — stable
    // even during barge-in, unlike "newest untranslated" guessing.
    const rec={
      index:cancellations.length, ts:m.ts, reason:m.reason,
      sourceItemId:m.sourceItemId||null,
      playbackActiveAtCancel:playbackActive(),
      msSinceLastPlaybackEnd:lastPlaybackEndTs?Date.now()-lastPlaybackEndTs:null,
      msSinceSpeechStart:lastSpeechStartTs?Date.now()-lastSpeechStartTs:null,
      classification:'UNKNOWN',
      heuristic: playbackActive() ? 'playback was active — check PLAYBACK_FEEDBACK vs intentional barge-in' : 'no playback active — check FALSE_PREMATURE_CANCEL vs new utterance',
    };
    cancellations.push(rec);
    addLine('cx','✂ response cancelled ('+m.reason+') — classify below');
    renderCancellations(); renderMetrics();
    return;
  }
  if(m.type==='turn_completed'){ turns.push(m.metrics); renderMetrics(); setStatus('live — speak'); return; }
  if(m.type==='error'){ errors.push(m.message); addLine('err','⚠ '+m.message); if(m.fatal){ stopAll('provider error'); } return; }
}

const CX_CLASSES=['UNKNOWN','VALID_BARGE_IN','FALSE_PREMATURE_CANCEL','PLAYBACK_FEEDBACK'];
function renderCancellations(){
  document.getElementById('cxCount').textContent='('+cancellations.length+')';
  const box=document.getElementById('cxList');
  if(!cancellations.length){ box.textContent='no cancellations yet'; return; }
  box.innerHTML='';
  for(const c of cancellations){
    const d=document.createElement('div'); d.className='evrow';
    const sel=document.createElement('select');
    for(const cls of CX_CLASSES){ const o=document.createElement('option'); o.value=cls; o.textContent=cls; if(cls===c.classification)o.selected=true; sel.appendChild(o); }
    sel.onchange=()=>{ c.classification=sel.value; renderMetrics(); };
    const srcU=c.sourceItemId?srcUtterances.find(u=>u.itemId===c.sourceItemId):null;
    d.append('#'+c.index+' '+new Date(c.ts).toLocaleTimeString()+' reason='+c.reason+' | playback@cancel='+c.playbackActiveAtCancel+' | src: '+(srcU?('«'+srcU.text.slice(0,60)+'»'):'(transcript pending/unknown)')+' | '+c.heuristic+' ');
    d.appendChild(sel);
    box.appendChild(d);
  }
}

function pct(sorted,p){ if(!sorted.length) return null; return sorted[Math.min(sorted.length-1, Math.ceil(p/100*sorted.length)-1)]; }

function computeScorecard(){
  const completed=turns.filter(t=>!t.cancelled);
  const lat=completed.map(t=>t.latencyMs).filter(v=>v!=null).sort((a,b)=>a-b);
  const cost=turns.reduce((s,t)=>s+(t.estimatedCostUsd||0),0);
  const audioMs=turns.reduce((s,t)=>s+(t.audioInMs||0)+(t.audioOutMs||0),0);
  const wallMin=sessionStartTs?((Date.now()-sessionStartTs)/60000):0;
  const cxBy=cls=>cancellations.filter(c=>c.classification===cls).length;
  const completedSrc=srcUtterances.filter(u=>u.meaningful);
  // Association is computed HERE from stable provider item ids — robust to
  // any event arrival order (async transcription, barge-in reordering).
  const isTranslated=u=>u.itemId!=null && turns.some(t=>t.sourceItemId===u.itemId && !t.cancelled && t.translatedTranscript);
  const cancellationFor=u=>u.itemId!=null ? cancellations.find(c=>c.sourceItemId===u.itemId) : undefined;
  const translatedSrc=completedSrc.filter(isTranslated);
  // LOST_TRANSLATION: meaningful completed source utterance with no delivered
  // translation, unless its cancellation is classified VALID_BARGE_IN.
  const lost=completedSrc.filter(u=>{
    if(isTranslated(u)) return false;
    const cx=cancellationFor(u);
    return !(cx && cx.classification==='VALID_BARGE_IN');
  });
  const rev=Object.values(review.results);
  const cnt=cls=>rev.filter(r=>r.classification===cls).length;
  return {
    total_turns: completed.length,
    latency_median_ms: pct(lat,50), latency_p95_ms: pct(lat,95),
    total_cancellations: cancellations.length,
    valid_barge_ins: cxBy('VALID_BARGE_IN'),
    false_premature_cancellations: cxBy('FALSE_PREMATURE_CANCEL'),
    playback_feedback_cancellations: cxBy('PLAYBACK_FEEDBACK'),
    unknown_cancellations: cxBy('UNKNOWN'),
    completed_source_turns: completedSrc.length,
    successfully_translated_turns: translatedSrc.length,
    lost_completed_translations: lost.length,
    lost_translation_rate: completedSrc.length? +(lost.length/completedSrc.length).toFixed(4):0,
    lost_turns_evidence: lost.map(u=>({index:u.index,itemId:u.itemId,text:u.text,cancellation:cancellationFor(u)?cancellationFor(u).index:null})),
    semantic_review_ran: !!review.ranAt,
    added_content_count: cnt('ADDED_CONTENT'),
    unsolicited_response_count: cnt('UNSOLICITED_RESPONSE'),
    uncertain_translation_count: cnt('UNCERTAIN'),
    faithful_count: cnt('FAITHFUL'),
    total_estimated_cost_usd: +cost.toFixed(4),
    cost_per_active_audio_minute: audioMs>0? +(cost/(audioMs/60000)).toFixed(4):null,
    cost_per_wall_clock_minute: wallMin>0.2? +(cost/wallMin).toFixed(4):null,
    errors: errors.length,
  };
}

function renderMetrics(){
  const tb=document.querySelector('#mtable tbody'); tb.innerHTML='';
  for(const t of turns){
    const tr=document.createElement('tr');
    const lag=t.cancelled?null:t.latencyMs;
    const cls=lag==null?'':(lag<=1200?'lag-ok':lag<=2000?'lag-warn':'lag-bad');
    const r=review.results[t.turnIndex];
    const rlabel=t.cancelled?'✂ cancelled':(r?('<span class="cls-'+r.classification+'" title="'+(r.reason||'')+'">'+r.classification+'</span>'):'—');
    tr.innerHTML='<td>'+t.turnIndex+'</td><td class="'+cls+'">'+(lag??'—')+'</td><td>'+(t.audioInMs??'—')+'</td><td>'+(t.audioOutMs??'—')+'</td><td>'+(t.estimatedCostUsd!=null?t.estimatedCostUsd.toFixed(4):'—')+'</td><td>'+rlabel+'</td>';
    tb.appendChild(tr);
  }
  const sc=computeScorecard();
  document.getElementById('summary').innerHTML=
    'turns: <b>'+sc.total_turns+'</b> (cancelled: '+sc.total_cancellations+')<br>'+
    'latency: median <b>'+(sc.latency_median_ms??'—')+'</b> ms, p95 <b>'+(sc.latency_p95_ms??'—')+'</b> ms<br>'+
    'cancellations — barge-in: '+sc.valid_barge_ins+', false/premature: <b class="'+(sc.false_premature_cancellations?'err':'')+'">'+sc.false_premature_cancellations+'</b>, feedback: <b class="'+(sc.playback_feedback_cancellations?'err':'')+'">'+sc.playback_feedback_cancellations+'</b>, unknown: '+sc.unknown_cancellations+'<br>'+
    'source turns: '+sc.completed_source_turns+', translated: '+sc.successfully_translated_turns+', <b class="'+(sc.lost_completed_translations?'err':'')+'">lost: '+sc.lost_completed_translations+'</b> (rate '+sc.lost_translation_rate+')<br>'+
    'semantic review: '+(sc.semantic_review_ran?('faithful '+sc.faithful_count+', added <b class="'+(sc.added_content_count?'err':'')+'">'+sc.added_content_count+'</b>, unsolicited <b class="'+(sc.unsolicited_response_count?'err':'')+'">'+sc.unsolicited_response_count+'</b>, uncertain '+sc.uncertain_translation_count):'not run')+'<br>'+
    'total est. cost: <b>$'+sc.total_estimated_cost_usd.toFixed(4)+'</b>, per active-audio min: '+(sc.cost_per_active_audio_minute!=null?('$'+sc.cost_per_active_audio_minute):'—')+', per wall-clock min: '+(sc.cost_per_wall_clock_minute!=null?('$'+sc.cost_per_wall_clock_minute):'—')+'<br>'+
    'errors: '+sc.errors;
}

document.getElementById('reviewBtn').onclick=async()=>{
  const btn=document.getElementById('reviewBtn');
  // Source text reconciled by stable item id (handles input transcription
  // arriving after its response); adapter transcript is only a fallback for
  // unattributed turns.
  const srcFor=t=>{ const u=t.sourceItemId?srcUtterances.find(u=>u.itemId===t.sourceItemId):null; return (u&&u.text)||t.sourceTranscript||''; };
  const payload=turns.filter(t=>!t.cancelled&&(srcFor(t)||t.translatedTranscript)).map(t=>({turnIndex:t.turnIndex,source:srcFor(t),translation:t.translatedTranscript||''}));
  if(!payload.length){ alert('no completed turns to review yet'); return; }
  btn.disabled=true; btn.textContent='reviewing…';
  try{
    const r=await fetch('/translator-spike/review',{method:'POST',headers:{'Content-Type':'application/json','x-spike-token':TOKEN},body:JSON.stringify({turns:payload})});
    if(!r.ok){ throw new Error('review failed: '+r.status+' '+await r.text()); }
    const data=await r.json();
    for(const res of data.results){ review.results[res.turnIndex]=res; }
    review.ranAt=new Date().toISOString();
    renderMetrics();
  }catch(e){ alert(e.message); }
  btn.disabled=false; btn.textContent='Run semantic review';
};

document.getElementById('exportBtn').onclick=()=>{
  const report={ generatedAt:new Date().toISOString(),
    currentRun:{ session:sessionMeta, sessionConfig, scorecard:computeScorecard(),
      turns, sourceUtterances:srcUtterances, cancellations,
      semanticReview:review, errors },
    completedRuns };
  const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='translator-spike-run2-report.json'; a.click();
};

function controlsMsg(){
  return { type:'start',
    inputLang:document.getElementById('inLang').value,
    outputLang:document.getElementById('outLang').value,
    voice:document.getElementById('voiceSel').value };
}

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
    ws.onopen=()=>{ ws.send(JSON.stringify(controlsMsg())); setStatus('connecting to provider…'); if(!sessionStartTs) sessionStartTs=Date.now(); };
    ws.onmessage=onMsg;
    ws.onclose=()=>{ if(running&&!restarting) stopAll('connection closed'); };
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

// Changing an experimental control while live = clean restart with the new
// config (spec: switching controls must never break the session).
async function restartWithControls(){
  if(!running) return;
  restarting=true;
  addLine('cx','↻ controls changed — archiving run, restarting session with new config');
  stopAll('controls changed');
  archiveCurrentRun('controls changed');
  renderMetrics(); renderCancellations();
  await new Promise(r=>setTimeout(r,300));
  restarting=false;
  start();
}
document.getElementById('inLang').onchange=restartWithControls;
document.getElementById('outLang').onchange=restartWithControls;
document.getElementById('voiceSel').onchange=restartWithControls;

startBtn.onclick=start;
stopBtn.onclick=()=>stopAll('');
</script>
</body>
</html>`;
}
