import { COPILOT_BENCH_CANDIDATES } from "./copilotBench";

export function buildCopilotBenchPage(token: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Copilot translation comparison · dev</title>
<style>
body{font:15px system-ui,-apple-system,sans-serif;background:#f5f6fa;color:#18213a;margin:0;padding:16px}
main{max-width:1200px;margin:auto}h1{font-size:23px;margin:12px 0 4px}h2{font-size:17px}
.sub{color:#536178}.card{background:white;border-radius:14px;padding:16px;margin:14px 0;box-shadow:0 1px 5px #d9deea}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
button,select,input{font:inherit}button{border:0;border-radius:9px;padding:10px 14px;background:#4741bb;color:white;cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}.secondary{background:#e8eaf5;color:#263252}
input[type=file]{max-width:100%}label{display:inline-flex;gap:6px;align-items:center}
table{border-collapse:collapse;width:100%;min-width:830px;font-size:13px}
th,td{border-bottom:1px solid #e5e7ef;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.scroll{overflow-x:auto}small{color:#66748b}.bad{color:#bd2540}.ok{color:#247a52}
.stream{max-width:300px;white-space:pre-wrap}a{color:#4741bb}
</style></head><body><main>
<a href="/translator-spike">← Translator stand</a><h1>Copilot translation comparison</h1>
<p class="sub">Development-only. Record or upload the same speech once, then replay identical 24 kHz PCM to isolated provider sessions. No phone call, guest audio, hint pipeline or production configuration is changed. Voice Translator baseline sends no audio to speakers; only its text transcript is displayed. This makes billable API calls.</p>
<div class="card"><h2>1. Build a test packet</h2>
<div class="row"><label>Scenario <select id="scenario">
<option value="question">Simple question</option><option value="digits">Phone number / digits</option>
<option value="date">Date / time</option><option value="address">Address / company name</option>
<option value="short">Short answer (yes / no / mhm / one eight)</option>
<option value="service">Long service / support phrase</option>
<option value="fragment">Interrupted / consecutive segments</option><option value="noise">Noise / silence / wrong-language artifact</option>
<option value="owner">Owner: Нет, я буду через два часа, не раньше</option>
<option value="mint">Owner: Я уже использую Mint Mobile</option>
<option value="repeat">Owner: Повторите, пожалуйста, последний вопрос</option>
</select></label><label>Direction <select id="direction"><option value="guest">Guest EN → RU</option><option value="private">Owner private RU → EN</option></select></label></div>
<div class="row"><input id="files" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg" multiple><button id="record" class="secondary">Record speech</button><span id="captureStatus" class="sub">Choose files or record one clip at a time. Use headphones if needed.</span></div>
<div class="scroll"><table><thead><tr><th>Case / file</th><th>Direction</th><th>Expected source (optional)</th><th>Remove</th></tr></thead><tbody id="cases"></tbody></table></div></div>
<div class="card"><h2>2. Compare identical input</h2>
<div class="row"><label>Repeats <select id="repeats"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></label><button id="run">Run all configurations</button><button id="download" class="secondary" disabled>Download JSON evidence</button></div>
<p class="sub">Current Copilot (text, auto) vs fixed source language vs realtime-mini (text) vs the current voice Translator baseline. Purpose-built gpt-realtime-translate is excluded: it has audio output and no custom prompt, so it cannot supply Copilot's required text-only translation. Failed/unsupported models are reported, never silently substituted.</p>
<p id="status" role="status" aria-live="polite" class="sub">Waiting for audio cases.</p>
<div class="scroll"><table><thead><tr><th>Case / direction</th><th>Model / settings</th><th>Run</th><th>Source transcript</th><th>Streaming output</th><th>Final translation</th><th>Timing (ms)</th><th>Errors / review</th></tr></thead><tbody id="results"></tbody></table></div>
<p class="sub">Speech and first-text timestamps come from the provider session; final-text receipt is measured in the browser and includes downstream WebSocket delivery. Timings exclude file decoding and upload. Language, names, numbers, omissions and hallucinations require reviewing the visible output against the expected source; no automatic quality score is invented.</p>
</div></main><script>
const TOKEN=${JSON.stringify(token)};
const CANDIDATES=${JSON.stringify(COPILOT_BENCH_CANDIDATES)};
const $=id=>document.getElementById(id);
const cases=[], results=[];let recorder=null, chunks=[];
function opt(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o}
function addCase(blob,name){
 if(cases.length>=12){$('captureStatus').textContent='Maximum 12 clips per packet';return}
 cases.push({blob,name,scenario:$('scenario').value,direction:$('direction').value,expected:''});renderCases();
}
function renderCases(){
 $('cases').replaceChildren();
 cases.forEach((c,i)=>{
  const tr=document.createElement('tr'), title=document.createElement('td');
  title.textContent=c.scenario+' · '+c.name;tr.append(title);
  const dir=document.createElement('select');dir.append(opt('guest','Guest EN → RU'),opt('private','Owner RU → EN'));dir.value=c.direction;
  dir.onchange=()=>{c.direction=dir.value};const d=document.createElement('td');d.append(dir);tr.append(d);
  const expected=document.createElement('input');expected.placeholder='What was actually said?';expected.value=c.expected;expected.oninput=()=>{c.expected=expected.value};
  const e=document.createElement('td');e.append(expected);tr.append(e);
  const b=document.createElement('button');b.className='secondary';b.textContent='Remove';b.onclick=()=>{cases.splice(i,1);renderCases()};
  const last=document.createElement('td');last.append(b);tr.append(last);$('cases').append(tr);
 });
}
$('files').onchange=e=>{for(const f of e.target.files)addCase(f,f.name);e.target.value=''};
$('record').onclick=async()=>{
 if(recorder){recorder.stop();recorder=null;$('record').textContent='Record speech';return}
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  chunks=[];const r=new MediaRecorder(stream);recorder=r;
  r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  r.onstop=()=>{stream.getTracks().forEach(t=>t.stop());addCase(new Blob(chunks,{type:r.mimeType}),'recording-'+(cases.length+1));$('captureStatus').textContent='Recording added to packet'};
  r.start();$('record').textContent='Stop recording';$('captureStatus').textContent='Recording…';
 }catch(e){$('captureStatus').textContent='Microphone unavailable: '+e.message}
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function pcm24(blob){
 const ctx=new (window.AudioContext||window.webkitAudioContext)();
 try{
  const decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
  const length=Math.round(decoded.duration*24000);
  if(length<2400||length>24000*18)throw Error('Audio must be 0.1–18 seconds');
  const out=new Int16Array(length), channels=decoded.numberOfChannels;
  for(let i=0;i<length;i++){
   const index=i*decoded.sampleRate/24000, lo=Math.floor(index), hi=Math.min(lo+1,decoded.length-1), fraction=index-lo;
   let sample=0;for(let ch=0;ch<channels;ch++){const a=decoded.getChannelData(ch);sample+=(a[lo]*(1-fraction)+a[hi]*fraction)/channels}
   out[i]=Math.round(Math.max(-1,Math.min(1,sample))*32767);
  }
  return out;
 }finally{await ctx.close()}
}
function cell(tr,text,cls){const td=document.createElement('td');td.textContent=text||'—';if(cls)td.className=cls;tr.append(td);return td}
async function trial(c,candidate,repeat,pcm){
 const tr=document.createElement('tr');$('results').append(tr);
 cell(tr,c.scenario+' · '+(c.direction==='guest'?'EN → RU':'RU → EN'));
 cell(tr,candidate.label);cell(tr,String(repeat));
 const src=cell(tr,'…'),stream=cell(tr,'…','stream'),final=cell(tr,'…'),timing=cell(tr,'…'),notes=cell(tr,'…');
 const entry={case:c.scenario,file:c.name,direction:c.direction,expectedSource:c.expected,candidate:candidate.id,repeat,
  inputMs:Math.round(pcm.length/24),source:'',streaming:'',final:'',turns:[],firstTextAt:null,finalAt:null,errors:[]};
 const proto=location.protocol==='https:'?'wss:':'ws:';
 const ws=new WebSocket(proto+'//'+location.host+'/copilot-bench-stream?token='+encodeURIComponent(TOKEN));
 ws.binaryType='arraybuffer';
 let ready,fail,speechDetected=false,committed=0,lastActivity=Date.now(),fatalError=null;
 const sources=new Map(),finalTimes=new Map();
 const readyP=new Promise((resolve,reject)=>{ready=resolve;fail=reject});
 ws.onopen=()=>ws.send(JSON.stringify({type:'start',candidate:candidate.id,direction:c.direction}));
 ws.onerror=()=>fail(Error('WebSocket connection failed'));
 ws.onclose=()=>fail(Error('Provider connection closed before ready'));
 ws.onmessage=e=>{
  let m;try{m=JSON.parse(e.data)}catch{return}
  if(m.type!=='ready')lastActivity=Date.now();
  if(m.type==='ready')ready();
  if(m.type==='speech_started'||m.type==='input_committed')speechDetected=true;
  if(m.type==='input_committed')committed++;
  if(m.type==='source_transcript'){
   sources.set(m.itemId||'unknown-'+sources.size,m.text);
   entry.source=[...sources.values()].join('\\n');src.textContent=entry.source||'—';
  }
  if(m.type==='translated_transcript_delta'){entry.firstTextAt??=Date.now();entry.streaming+=m.text;stream.textContent=entry.streaming}
  if(m.type==='translated_transcript_done'){
   entry.firstTextAt??=Date.now();entry.finalAt=Date.now();
   if(m.responseId)finalTimes.set(m.responseId,entry.finalAt);
   entry.final+=(entry.final?'\\n':'')+m.text;final.textContent=entry.final||'—';
  }
  if(m.type==='turn_completed'){
   entry.turns.push(m.metrics);
   timing.textContent=entry.turns.map((t,i)=>'#'+(i+1)+' start→first '+
    (t.speechStartTs&&t.firstTranslatedTextTs?t.firstTranslatedTextTs-t.speechStartTs:'n/a')+
    '; end→final '+(t.speechEndTs&&finalTimes.has(t.responseId)?finalTimes.get(t.responseId)-t.speechEndTs:'n/a')).join('\\n');
  }
  if(m.type==='error'||m.type==='suppressed_microturn'||m.type==='response_cancelled'||m.type==='invariant_violation'){
   entry.errors.push(m.message||m.reason||m.code||m.type);notes.textContent=entry.errors.join(' | ');
   if(m.fatal){fatalError=m.message||'Provider failure';fail(Error(fatalError))}
  }
 };
 try{
  await Promise.race([readyP,sleep(12000).then(()=>{throw Error('Provider ready timeout')})]);
  // Timed PCM frames preserve VAD behavior; same decoded samples for every candidate.
  const samples=new Int16Array(4800);
  async function send(buffer){
   for(let i=0;i<buffer.length;i+=samples.length){
    if(ws.readyState!==WebSocket.OPEN)throw Error('Provider disconnected');
    const part=buffer.subarray(i,i+samples.length);
    ws.send(part.buffer.slice(part.byteOffset,part.byteOffset+part.byteLength));await sleep(100);
   }
  }
  await send(new Int16Array(4800));await send(pcm);await send(new Int16Array(24000));
  // Keep collecting ALL committed turns, not just the first response. A clip
  // can contain interrupted or consecutive utterances.
  const sentAt=Date.now(),deadline=sentAt+15000;
  while(Date.now()<deadline){
   if(fatalError)throw Error(fatalError);
   if(!speechDetected&&Date.now()-sentAt>4000)throw Error('No speech detected');
   if(committed>0&&entry.turns.length>=committed&&Date.now()-Math.max(lastActivity,sentAt)>1300)break;
   await sleep(120);
  }
  if(!entry.turns.length||entry.turns.length<committed)throw Error('Translation timeout (incomplete turns)');
  await sleep(300);
  if(!entry.source)await sleep(1200); // asynchronous input transcript can follow response.done.
  if(sources.size<committed)entry.errors.push('Source transcription unavailable for some turns: review recording');
  if(!entry.final){entry.errors.push('No final translation');notes.textContent=entry.errors.join(' | ')}
  if(/[\\u3400-\\u9fff]/u.test(entry.final))entry.errors.push('CJK characters in output');
  if(entry.final && c.direction==='private' && /[\\u0400-\\u04ff]/u.test(entry.final))
   entry.errors.push('Cyrillic in English output');
  if(entry.final && c.direction==='guest' && !/[\\u0400-\\u04ff]/u.test(entry.final))
   entry.errors.push('No Cyrillic in Russian output — review language');
  if(entry.errors.length){notes.textContent=entry.errors.join(' | ');notes.className='bad'}
 }catch(e){
  entry.errors.push(e.message==='No speech detected'&&!speechDetected
   ? 'No speech detected: review clip/noise; no translation expected'
   : e.message);
  notes.textContent=entry.errors.join(' | ');
  notes.className=speechDetected||!entry.errors.at(-1).startsWith('No speech detected')?'bad':'ok';
 }
 finally{ws.close();results.push(entry)}
}
let busy=false;
$('run').onclick=async()=>{
 if(busy||!cases.length){$('status').textContent='Add at least one recorded or uploaded clip first.';return}
 busy=true;$('run').disabled=true;$('download').disabled=true;results.length=0;$('results').replaceChildren();
 try{
  for(const c of cases){
   let pcm;try{pcm=await pcm24(c.blob)}catch(e){$('status').textContent=c.name+': '+e.message;continue}
   for(const candidate of CANDIDATES)for(let repeat=1;repeat<=Number($('repeats').value);repeat++){
    $('status').textContent='Running '+c.name+' · '+candidate.label+' · '+repeat+'/'+$('repeats').value;
    await trial(c,candidate,repeat,pcm);
   }
  }
  $('status').textContent='Done: '+results.length+' trials. Review source, digits, language, meaning and stability across repeats.';
 }finally{busy=false;$('run').disabled=false;$('download').disabled=!results.length}
};
$('download').onclick=()=>{
 const body=JSON.stringify({createdAt:new Date().toISOString(),runs:results},null,2);
 const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='copilot-translation-comparison.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
};
</script></body></html>`;
}