import { COPILOT_BENCH_CANDIDATES } from "./copilotBench";
import { COPILOT_GUIDED_CASES } from "./copilotGuidedCases";

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
table{border-collapse:collapse;width:100%;min-width:1080px;font-size:13px}
th,td{border-bottom:1px solid #e5e7ef;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.scroll{overflow-x:auto}small{color:#66748b}.bad{color:#bd2540}.ok{color:#247a52}
.stream{max-width:300px;white-space:pre-wrap}a{color:#4741bb}
.guide-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:12px}
.guide-case{border:1px solid #dee2ef;border-radius:12px;padding:14px;background:#fafbff}
.guide-case h3{font-size:15px;margin:0 0 8px}.guide-case .phrase{font-size:17px;font-weight:650;line-height:1.4;min-height:48px}
.guide-case audio{width:100%;height:38px;margin:7px 0}.guide-case input[type=text]{width:100%;box-sizing:border-box;padding:9px;border:1px solid #c9d0e0;border-radius:8px}
.guide-case .result{border-top:1px solid #dde2ed;padding-top:9px;white-space:pre-wrap;overflow-wrap:anywhere}
.guide-case .row{margin:9px 0}.guide-case button{padding:9px 11px}
@media(max-width:550px){body{padding:10px}.card{padding:12px}.guide-case button{flex:1}}
</style></head><body><main>
<a href="/translator-spike">← Стенд Translator</a><h1>Copilot · самостоятельный тест перевода</h1>
<p class="sub">Веб-проверка без телефонного звонка: одна запись проигрывается текущему Copilot или четырём изолированным настройкам. Это проверяет распознавание и перевод модели, но не микрофонный Hold и не отображение на iPhone. Production-модель и маршрутизация не меняются. Каждый запуск использует платный API.</p>
<div class="card"><h2>1. Пройдите 15 фраз</h2>
<p class="sub">Для каждого примера нажмите «Записать», произнесите фразу и нажмите «Стоп». Используйте тихое место, затем повторите несколько примеров в вашем обычном шуме. «Проверить Copilot» делает один запуск текущей модели; «Сравнить 4» отправляет <b>ту же запись</b> всем четырём настройкам. Поле «Фактически сказано» можно поправить, если вы произнесли иначе.</p>
<div class="row"><button id="runGuidedAll" class="secondary">Проверить все записанные фразы · текущий Copilot</button><span id="guidedStatus" role="status" aria-live="polite" class="sub">Запишите первую фразу ниже.</span></div>
<div id="guided" class="guide-grid"></div>
<p class="sub">Нижний блок показывает полный поток, исходную расшифровку, итог, задержку и ошибки. После прогона скачайте JSON вместе с записями — они включены в файл и не сохраняются в базе стенда. Не произносите настоящие номера и личные данные.</p></div>
<div class="card"><h2>2. Добавить свои записи или шум</h2>
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
<div class="card"><h2>3. Результаты и выгрузка</h2>
<div class="row"><label>Повторы для своих записей <select id="repeats"><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option></select></label><button id="run">Сравнить свои записи · 4 настройки</button><button id="download" class="secondary" disabled>Скачать JSON с результатами и аудио</button></div>
<p class="sub">Current Copilot (text, auto) vs fixed source language vs realtime-mini (text) vs the current voice Translator baseline. Purpose-built gpt-realtime-translate is excluded: it has audio output and no custom prompt, so it cannot supply Copilot's required text-only translation. Failed/unsupported models are reported, never silently substituted.</p>
<p id="status" role="status" aria-live="polite" class="sub">Waiting for audio cases.</p>
<div class="scroll"><table><thead><tr><th>Фраза / направление</th><th>Настройка</th><th>Запуск</th><th>Что сказано</th><th>Source transcript</th><th>Streaming translation</th><th>Final translation</th><th>Задержка (мс)</th><th>Ошибки / заметки</th></tr></thead><tbody id="results"></tbody></table></div>
<p class="sub">Speech and first-text timestamps come from the provider session; final-text receipt is measured in the browser and includes downstream WebSocket delivery. Timings exclude file decoding and upload. Language, names, numbers, omissions and hallucinations require reviewing the visible output against the expected source; no automatic quality score is invented.</p>
</div></main><script>
const TOKEN=${JSON.stringify(token)};
const CANDIDATES=${JSON.stringify(COPILOT_BENCH_CANDIDATES)};
const GUIDED=${JSON.stringify(COPILOT_GUIDED_CASES)};
const $=id=>document.getElementById(id);
const cases=[], results=[], resultRows=new Map(), guided=GUIDED.map((p,i)=>({
 scenario:p.id,name:'Фраза '+(i+1),direction:p.direction,expected:p.phrase,prompt:p.phrase,
 blob:null,audioUrl:null,review:'',note:''
}));
let recorder=null, recordButton=null, recordTimer=null, openingMic=false, chunks=[],busy=false,customCounter=0;
function opt(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o}
function updateExpected(c){
 results.filter(r=>r.caseId===(c.id||c.scenario)).forEach(r=>{
  r.expectedSource=c.expected;
  const row=resultRows.get(r);if(row)row.children[3].textContent=c.expected;
 });
}
function clearCaseResults(c){
 for(let i=results.length-1;i>=0;i--){
  if(results[i].caseId!==(c.id||c.scenario))continue;
  resultRows.get(results[i])?.remove();resultRows.delete(results[i]);results.splice(i,1);
 }
 $('download').disabled=!results.length;
}
function addCase(blob,name){
 if(cases.length>=20){$('captureStatus').textContent='Maximum 20 clips per packet';return}
 cases.push({id:'custom-'+(++customCounter),blob,name,scenario:$('scenario').value,direction:$('direction').value,expected:''});renderCases();
}
function renderCases(){
 $('cases').replaceChildren();
 cases.forEach((c,i)=>{
  const tr=document.createElement('tr'), title=document.createElement('td');
  title.textContent=c.scenario+' · '+c.name;tr.append(title);
  const dir=document.createElement('select');dir.append(opt('guest','Guest EN → RU'),opt('private','Owner RU → EN'));dir.value=c.direction;
   dir.onchange=()=>{clearCaseResults(c);c.direction=dir.value};const d=document.createElement('td');d.append(dir);tr.append(d);
   const expected=document.createElement('input');expected.placeholder='What was actually said?';expected.value=c.expected;expected.oninput=()=>{
    c.expected=expected.value;updateExpected(c);
   };
  const e=document.createElement('td');e.append(expected);tr.append(e);
   const b=document.createElement('button');b.className='secondary';b.textContent='Remove';b.onclick=()=>{clearCaseResults(c);cases.splice(i,1);renderCases()};
  const last=document.createElement('td');last.append(b);tr.append(last);$('cases').append(tr);
 });
}
$('files').onchange=e=>{for(const f of e.target.files)addCase(f,f.name);e.target.value=''};
async function recordClip(button,status,save){
 if(recorder){
  if(recordButton!==button){status.textContent='Сначала остановите другую запись.';return}
  recorder.stop();return;
 }
 if(busy){status.textContent='Дождитесь завершения текущего теста.';return}
 if(openingMic){status.textContent='Дождитесь ответа на запрос микрофона.';return}
 openingMic=true;
 let mic;
 try{
  if(!window.MediaRecorder)throw Error('Этот браузер не поддерживает запись аудио');
  mic=await navigator.mediaDevices.getUserMedia({audio:true});
  chunks=[];const r=new MediaRecorder(mic);
  recorder=r;recordButton=button;
  r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  r.onstop=()=>{
   clearTimeout(recordTimer);mic.getTracks().forEach(t=>t.stop());
   recorder=null;recordButton=null;button.textContent=button.id==='record'?'Record speech':'Записать';
   const blob=new Blob(chunks,{type:r.mimeType});
   if(blob.size)save(blob);else status.textContent='Запись пуста — попробуйте снова.';
  };
  r.onerror=()=>{status.textContent='Не удалось записать аудио';if(r.state!=='inactive')r.stop()};
  r.start();button.textContent='Стоп';status.textContent='Идёт запись…';
  recordTimer=setTimeout(()=>{if(recorder===r&&r.state==='recording')r.stop()},17000);
 }catch(e){
  mic?.getTracks().forEach(t=>t.stop());
  recorder=null;recordButton=null;
  status.textContent='Микрофон недоступен: '+e.message;
 }finally{openingMic=false}
}
$('record').onclick=()=>recordClip($('record'),$('captureStatus'),blob=>{
 addCase(blob,'recording-'+(cases.length+1));$('captureStatus').textContent='Запись добавлена';
});
function setBusy(value){
 busy=value;
 $('run').disabled=value;$('runGuidedAll').disabled=value;
 $('download').disabled=value||!results.length;
 for(const c of guided)if(c.ui){
  c.ui.run.disabled=value||!c.blob;c.ui.compare.disabled=value||!c.blob;
  c.ui.record.disabled=value;c.ui.upload.disabled=value;
 }
}
function guideLine(parent,label,value){
 const p=document.createElement('p'),strong=document.createElement('strong');
 strong.textContent=label+' ';p.append(strong,document.createTextNode(value||'—'));parent.append(p);
}
function renderGuideResult(target,entry){
 target.replaceChildren();
 guideLine(target,'Распознано:',entry.source);
 guideLine(target,'Потоковый перевод:',entry.streaming);
 guideLine(target,'Итог:',entry.final);
 guideLine(target,'Задержки:',entry.turns.map(t=>
  'от конца речи до первого текста '+(t.textLatencyMs??'нет данных')+' мс').join('; '));
 guideLine(target,'Порядок:',entry.translationBeforeSource?'Перевод пришёл раньше source transcript':'Source transcript был доступен до перевода');
 if(entry.errors.length)guideLine(target,'Ошибки:',entry.errors.join(' | '));
 target.className='result '+(entry.errors.length?'bad':'');
}
function renderGuided(){
 $('guided').replaceChildren();
 guided.forEach((c,i)=>{
  const card=document.createElement('article');card.className='guide-case';
  const heading=document.createElement('h3');heading.textContent=(i+1)+'/15 · '+(c.direction==='private'?'Вы говорите по-русски → английский':'Собеседник говорит по-английски → русский');
  const phrase=document.createElement('p');phrase.className='phrase';phrase.textContent=c.prompt;
  const actual=document.createElement('input');actual.type='text';actual.value=c.expected;
  actual.setAttribute('aria-label','Фактически сказано в фразе '+(i+1));
  actual.oninput=()=>{c.expected=actual.value;updateExpected(c)};
  const actualLabel=document.createElement('label');actualLabel.textContent='Фактически сказано:';actualLabel.style.display='block';actualLabel.append(actual);
  const controls=document.createElement('div');controls.className='row';
  const record=document.createElement('button');record.className='secondary';record.textContent='Записать';
  const upload=document.createElement('input');upload.type='file';upload.accept='audio/*,.wav,.mp3,.m4a,.ogg';
  upload.setAttribute('aria-label','Загрузить запись фразы '+(i+1));
  const fileLabel=document.createElement('label');fileLabel.textContent='или файл ';fileLabel.append(upload);
  controls.append(record,fileLabel);
  const audio=document.createElement('audio');audio.controls=true;audio.hidden=true;
  const status=document.createElement('small');status.textContent='Записи пока нет';status.setAttribute('role','status');
  const actions=document.createElement('div');actions.className='row';
  const run=document.createElement('button');run.textContent='Проверить Copilot';run.disabled=true;
  const compare=document.createElement('button');compare.className='secondary';compare.textContent='Сравнить 4';compare.disabled=true;
  actions.append(run,compare);
  const review=document.createElement('select');
  review.append(opt('','Оценка: пока нет'),opt('correct','Перевод верен'),opt('wrong-stt','Ошибка распознавания'),opt('wrong-translation','Ошибка перевода'),opt('wrong-screen','Не то на экране'));
  review.onchange=()=>{c.review=review.value};
  const note=document.createElement('input');note.type='text';note.placeholder='Комментарий к ошибке (необязательно)';
  note.setAttribute('aria-label','Комментарий к фразе '+(i+1));
  note.oninput=()=>{c.note=note.value};
  const result=document.createElement('div');result.className='result';result.textContent='Результат появится здесь после проверки.';
  card.append(heading,phrase,actualLabel,controls,audio,status,actions,review,note,result);
  $('guided').append(card);c.ui={record,upload,run,compare,audio,status,result};
  function save(blob,name){
   clearCaseResults(c);
   if(c.audioUrl)URL.revokeObjectURL(c.audioUrl);
   c.blob=blob;c.name=name;c.audioUrl=URL.createObjectURL(blob);
   audio.src=c.audioUrl;audio.hidden=false;status.textContent='Записано: '+name;
   result.textContent='Новая запись готова к проверке.';result.className='result';
   run.disabled=false;compare.disabled=false;
  }
  record.onclick=()=>recordClip(record,status,blob=>save(blob,'Фраза '+(i+1)+' · микрофон'));
  upload.onchange=e=>{const file=e.target.files[0];if(file)save(file,file.name);upload.value=''};
  run.onclick=()=>runGuided(c,[CANDIDATES[0]]);
  compare.onclick=()=>runGuided(c,CANDIDATES);
 });
}
renderGuided();
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
 cell(tr,candidate.label);cell(tr,String(repeat));cell(tr,c.expected);
 const src=cell(tr,'…'),stream=cell(tr,'…','stream'),final=cell(tr,'…'),timing=cell(tr,'…'),notes=cell(tr,'…');
 const entry={caseId:c.id||c.scenario,runStartedAt:new Date().toISOString(),case:c.scenario,file:c.name,direction:c.direction,expectedSource:c.expected,candidate:candidate.id,repeat,
  inputMs:Math.round(pcm.length/24),source:'',streaming:'',final:'',turns:[],events:[],
  translationBeforeSource:false,firstTextAt:null,finalAt:null,errors:[]};
 const proto=location.protocol==='https:'?'wss:':'ws:';
 const ws=new WebSocket(proto+'//'+location.host+'/copilot-bench-stream?token='+encodeURIComponent(TOKEN));
 ws.binaryType='arraybuffer';
 let ready,fail,speechDetected=false,committed=0,lastActivity=Date.now(),fatalError=null;
 const sources=new Map(),finalTimes=new Map(),responseItems=new Map(),eventStart=Date.now();
 const readyP=new Promise((resolve,reject)=>{ready=resolve;fail=reject});
 ws.onopen=()=>ws.send(JSON.stringify({type:'start',candidate:candidate.id,direction:c.direction}));
 ws.onerror=()=>fail(Error('WebSocket connection failed'));
 ws.onclose=()=>fail(Error('Provider connection closed before ready'));
 ws.onmessage=e=>{
  let m;try{m=JSON.parse(e.data)}catch{return}
  if(m.type==='response_created'&&m.responseId)responseItems.set(m.responseId,m.sourceItemId);
  if(['input_committed','response_created','source_transcript','translated_transcript_delta',
      'translated_transcript_done','turn_completed','response_cancelled','error','invariant_violation'].includes(m.type)){
   entry.events.push({atMs:Date.now()-eventStart,type:m.type,itemId:m.itemId||m.sourceItemId||responseItems.get(m.responseId),
    responseId:m.responseId,text:m.text||undefined,code:m.code||undefined});
  }
  if(m.type!=='ready')lastActivity=Date.now();
  if(m.type==='ready')ready();
  if(m.type==='speech_started'||m.type==='input_committed')speechDetected=true;
  if(m.type==='input_committed')committed++;
  if(m.type==='source_transcript'){
   sources.set(m.itemId||'unknown-'+sources.size,m.text);
   entry.source=[...sources.values()].join('\\n');src.textContent=entry.source||'—';
  }
   if(m.type==='translated_transcript_delta'){
    const item=responseItems.get(m.responseId);
    if(!item||!sources.has(item))entry.translationBeforeSource=true;
    entry.firstTextAt??=Date.now();entry.streaming+=m.text;stream.textContent=entry.streaming;
   }
  if(m.type==='translated_transcript_done'){
    const item=responseItems.get(m.responseId);
    if(!item||!sources.has(item))entry.translationBeforeSource=true;
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
  finally{ws.close();results.push(entry);resultRows.set(entry,tr)}
  return entry;
}
async function runGuided(c,candidates){
 if(busy)return;
 if(recorder){c.ui.status.textContent='Сначала остановите запись.';return}
 if(!c.blob){c.ui.status.textContent='Сначала запишите фразу или загрузите файл.';return}
 setBusy(true);c.ui.status.textContent='Проверяем запись…';
 try{
  const pcm=await pcm24(c.blob);
  for(const candidate of candidates){
   $('status').textContent='Фраза '+c.scenario+' · '+candidate.label;
   const entry=await trial(c,candidate,1,pcm);
   if(candidate.id==='copilot-current')renderGuideResult(c.ui.result,entry);
  }
  c.ui.status.textContent='Готово. Остальные настройки показаны в таблице ниже.';
 }catch(e){c.ui.status.textContent='Ошибка записи: '+e.message}
 finally{setBusy(false)}
}
$('runGuidedAll').onclick=async()=>{
 if(busy)return;
 if(recorder){$('guidedStatus').textContent='Сначала остановите запись.';return}
 const ready=guided.filter(c=>c.blob);
 if(!ready.length){$('guidedStatus').textContent='Сначала запишите хотя бы одну фразу.';return}
 setBusy(true);
 try{
  for(let i=0;i<ready.length;i++){
   const c=ready[i];$('guidedStatus').textContent='Фраза '+(i+1)+' из '+ready.length;
   try{
    const pcm=await pcm24(c.blob),entry=await trial(c,CANDIDATES[0],1,pcm);
    renderGuideResult(c.ui.result,entry);c.ui.status.textContent='Проверено';
   }catch(e){c.ui.status.textContent='Ошибка записи: '+e.message}
  }
  $('guidedStatus').textContent='Готово: '+ready.length+' фраз. Скачайте JSON и прикрепите его в чат.';
 }finally{setBusy(false)}
};
$('run').onclick=async()=>{
 if(recorder){$('status').textContent='Сначала остановите запись.';return}
 if(busy||!cases.length){$('status').textContent='Add at least one recorded or uploaded clip first.';return}
 setBusy(true);
 try{
  for(const c of cases){
   let pcm;try{pcm=await pcm24(c.blob)}catch(e){$('status').textContent=c.name+': '+e.message;continue}
   for(const candidate of CANDIDATES)for(let repeat=1;repeat<=Number($('repeats').value);repeat++){
    $('status').textContent='Running '+c.name+' · '+candidate.label+' · '+repeat+'/'+$('repeats').value;
    await trial(c,candidate,repeat,pcm);
   }
  }
  $('status').textContent='Done: '+results.length+' trials. Review source, digits, language, meaning and stability across repeats.';
 }finally{setBusy(false)}
};
$('download').onclick=async()=>{
 if(busy||!results.length)return;
 setBusy(true);$('status').textContent='Готовим JSON с аудиозаписями…';
 try{
  const recordings=[];
  for(const c of [...guided,...cases]){
   if(!c.blob)continue;
   const audioDataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(Error('Cannot read recording'));reader.readAsDataURL(c.blob);
   });
   recordings.push({caseId:c.id||c.scenario,name:c.name,scenario:c.scenario,direction:c.direction,
    prompt:c.prompt||null,actualSpeech:c.expected,review:c.review||'',note:c.note||'',audioDataUrl});
  }
  const body=JSON.stringify({schemaVersion:2,createdAt:new Date().toISOString(),
   note:'Contains voice recordings. Share only with people you trust. No phone call or iOS Hold is simulated.',
   guidedProtocol:GUIDED,recordings,runs:results},null,2);
  const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='copilot-guided-test.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  $('status').textContent='JSON скачан. Прикрепите его сюда, и мы сравним результат.';
 }catch(e){$('status').textContent='Не удалось скачать результаты: '+e.message}
 finally{setBusy(false)}
};
</script></body></html>`;
}