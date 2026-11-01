export const crewControlPage = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>AI Crew · управление</title>
<style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#24352f;background:#f1f4ee;font-synthesis:none;text-rendering:optimizeLegibility}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 90% 0%,#dce9d9 0,transparent 34%),#f1f4ee}
main{max-width:1120px;margin:auto;padding:24px 18px 60px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid #cbd5c9;padding:8px 0 20px}
.eyebrow,.label{font:700 11px ui-monospace,SFMono-Regular,monospace;letter-spacing:.1em;text-transform:uppercase;color:#627269}
h1{font-size:clamp(28px,6vw,44px);letter-spacing:-.055em;line-height:1;margin:10px 0 8px;color:#183c32}
.sub{margin:0;color:#586961;font-size:14px;max-width:650px}.badge{display:inline-flex;align-items:center;gap:8px;border:1px solid #b9c8ba;border-radius:999px;padding:8px 12px;font-size:12px;font-weight:700;background:#f8faf6;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:#89978d}.dot.on{background:#bf5a38}.bar{display:flex;flex-wrap:wrap;gap:9px;margin:16px 0}
button{font:650 13px inherit;cursor:pointer;border:1px solid #bcc9be;border-radius:9px;padding:10px 13px;background:#fbfcf8;color:#26443a;transition:transform .15s,background .15s}
button:hover{background:#e7eee4;transform:translateY(-1px)}button:active{transform:translateY(0)}button.primary{background:#244a3d;color:#fff;border-color:#244a3d}button.danger{border-color:#c58f7d;color:#9c3925;background:#fff8f5}button:disabled{opacity:.5;cursor:not-allowed;transform:none}
.message{min-height:22px;margin:2px 0 12px;color:#52645a;font-size:13px}.message.error{color:#a23e2a}.message.good{color:#27644a}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}.panel{background:#fbfcf8;border:1px solid #d4ddd2;border-radius:13px;padding:16px;min-width:0;box-shadow:0 5px 18px rgba(34,63,48,.035)}.span8{grid-column:span 8}.span6{grid-column:span 6}.span4{grid-column:span 4}.span12{grid-column:span 12}
h2{font-size:15px;margin:0 0 12px;letter-spacing:-.02em;color:#23483b}h3{font-size:13px;margin:16px 0 8px;color:#38554a}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metric{padding:10px;background:#f1f5ef;border-radius:8px;min-width:0}.metric strong{display:block;font-size:17px;overflow-wrap:anywhere}.metric small{color:#68776d}
.kv{display:grid;grid-template-columns:140px 1fr;gap:7px 12px;font-size:13px}.kv span:nth-child(odd){color:#6b786f}.kv span:nth-child(even){overflow-wrap:anywhere}
label{display:block;font-size:12px;font-weight:700;color:#52645a;margin:10px 0 5px}input,select,textarea{width:100%;border:1px solid #c6d1c4;border-radius:8px;background:#fff;color:#203b31;padding:10px;font:13px ui-monospace,SFMono-Regular,monospace}input:focus,select:focus,textarea:focus{outline:2px solid #94b49c;outline-offset:1px}textarea{min-height:220px;resize:vertical;line-height:1.5}
.fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.hint{font-size:12px;color:#6c786f;line-height:1.5;margin:7px 0}.warning{border-left:3px solid #bd6847;padding:9px 11px;background:#fbf0e9;color:#71412f;border-radius:0 7px 7px 0;font-size:12px;line-height:1.45}
.list{display:grid;gap:7px}.item{padding:10px;border:1px solid #e0e6dd;border-radius:8px;background:#fff;font-size:12px;overflow-wrap:anywhere}.item strong{color:#27483d}.item .muted{color:#748077}.empty{padding:15px;border:1px dashed #cbd5c9;border-radius:8px;color:#718077;font-size:13px}
.scroll{max-height:360px;overflow:auto}.split{display:flex;justify-content:space-between;align-items:center;gap:10px}.small{font-size:11px;color:#718077}.templates{display:flex;flex-wrap:wrap;gap:6px}.templates button{font-size:11px;padding:7px 9px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:12px/1.5 ui-monospace,SFMono-Regular,monospace;color:#33483d}
@media(max-width:700px){main{padding:17px 12px 40px}.top{display:block}.badge{margin-top:14px}.span8,.span6,.span4{grid-column:span 12}.metrics{grid-template-columns:1fr 1fr}.fields{grid-template-columns:1fr}.kv{grid-template-columns:115px 1fr}.bar button{flex:1 1 auto}}
</style>
</head>
<body><main>
 <header class="top"><div><div class="eyebrow">TalkHint / приватная зона владельца</div><h1>AI Crew</h1><p class="sub">Диагностика состояния и журналируемый workflow. Подготовка, лимит и запуск пилота Hint требуют отдельных решений владельца.</p></div><div class="badge"><i class="dot" id="switchDot"></i><span id="switchText">Загрузка состояния…</span></div></header>
<nav class="bar" aria-label="Основные действия"><button id="refresh">Обновить состояние</button><button class="primary" id="initialize">Инициализировать таблицу</button><button class="danger" id="disable">Аварийно выключить всё</button><button id="loadModels">Загрузить модели Anthropic</button></nav>
<div id="message" class="message" role="status" aria-live="polite">Получаем состояние сервера…</div>
<section class="grid">
<article class="panel span12"><h2>Самостоятельные проверки Replit</h2><p class="hint">Отдельный scope crew-test: только пилоты Hint. Общий бюджет серии $5, срок 7 дней с первого использования ключа. Не сбрасывается новым днём, рестартом или заменой ключа. Отзыв окончательный для этой серии.</p><div id="crewTestStatus" class="hint"></div><button class="danger" id="revokeCrewTest">Отключить доступ Replit crew-test</button><button id="checkCrewStructure">Проверить структуру без моделей</button><pre id="crewStructureResult"></pre></article>
<article class="panel span8"><div class="split"><h2>Состояние системы</h2><span class="small" id="updated"></span></div><div class="metrics" id="metrics"></div><div style="height:14px"></div><div class="kv" id="meta"></div><p class="hint" id="notice"></p></article>
 <article class="panel span4"><h2>Лимиты и контроль</h2><div class="warning">Сохранение всегда отправляет <code>enabled:false</code>. Общая настройка лимита не включает агентов. Для пилота используйте отдельные owner-действия.</div>
<div class="fields"><div><label>Текущий дневной лимит (только чтение)</label><div id="dailyLimit"></div></div><div><label for="staleHours">Срок устаревания, часы</label><input id="staleHours" type="number" min="1" max="8760" step="1" value="24"></div></div><p class="hint">Лимит задаётся в долларах только в блоке пилота выше: 5 означает $5. Здесь лимит не меняется. Сохранение выключает контроль и меняет только срок устаревания.</p><button id="saveControl" class="primary">Сохранить выключенный контроль</button></article>
 <article class="panel span6"><h2>Проверка модели (production only)</h2><p class="hint">Список ниже приходит от Anthropic. Probe — один короткий диагностический запрос, максимум 8 выходных токенов. Не повторяйте после неизвестного результата.</p><label for="modelSelect">Фактический ID модели из ответа</label><select id="modelSelect"><option value="">Сначала загрузите модели</option></select><button id="probe" class="danger" disabled>Выполнить одноразовый probe</button><div id="probeStatus" class="hint"></div></article>
 <article class="panel span12"><h2>Пилот Hint · решение владельца</h2><p class="warning">Каждый шаг требует отдельного подтверждения. Запуск может вызвать платные запросы к двум моделям. Не повторяйте действие при неизвестном результате.</p><div class="bar"><button id="prepareHintPilot">Подготовить пилот: задержки</button><div style="min-width:190px;flex:0 1 210px"><label for="pilotLimitUsd">Дневной лимит, USD</label><input id="pilotLimitUsd" type="text" inputmode="decimal" value="1" aria-label="Дневной лимит пилота в долларах"></div><button id="enableHintPilot">Включить с лимитом</button><button class="primary" id="startHintPilot">Запустить пилот</button><button id="closeStalledHintPilot">Закрыть зависший пилот</button></div><p class="hint">Закрытие возможно только при OFF, без выполненных запусков и резервов. История сохраняется; лимит станет 0 для новой подготовки. Это не запускает новый пилот.</p><div id="pilotResults" class="list"><div class="empty">Пилотных задач пока нет.</div></div></article>
<article class="panel span6"><h2>Устаревшие задачи / держатели</h2><div class="list" id="staleList"><div class="empty">Загрузка…</div></div></article>
<article class="panel span6"><h2>Задачи и текущие держатели</h2><div class="list scroll" id="tasks"></div></article>
<article class="panel span6"><h2>Агенты и расписания</h2><div id="agents"></div><h3>Расписания</h3><div id="schedules"></div></article>
<article class="panel span6"><h2>Очередь запусков и расходы</h2><div id="runs"></div><h3>Расходы по дням (microUSD)</h3><div id="costs"></div></article>
<article class="panel span6"><h2>Предложения и публикации</h2><div id="proposals"></div><h3>Публикации</h3><div id="publications"></div></article>
 <article class="panel span12"><div class="split"><h2>Команда владельца (JSON)</h2><span class="small">API проверит схему и revision</span></div><div class="warning">Команды меняют workflow-данные, но не продуктовые данные. Запись описания агента, enqueue и schedule не активируют агентов. Поле enabled:true запрещено в JSON-редакторе; включение возможно только отдельной подтверждённой кнопкой пилота.</div>
<p class="hint">Выберите пример, заполните реальные идентификаторы и отправьте. Команда control будет принудительно сохранена с enabled:false.</p><div class="templates" id="templates"></div><label for="commandJson">JSON команды</label><textarea id="commandJson" spellcheck="false" aria-label="JSON команды владельца"></textarea><button id="submitCommand" class="primary">Отправить команду</button></article>
<article class="panel span12"><div class="split"><h2>Журнал событий</h2><span class="small" id="journalCount"></span></div><div id="journal" class="list scroll"></div></article>
</section>
</main>
<script>
(function(){
  "use strict";
  var API="/api/admin/ai-crew", csrf="", payload=null, models=[], modelEnvironment="", busy=false, pilotBusy=false, pilotBlocked=false, pilotPoll=null, pilotIntent=0;
  var $=function(id){return document.getElementById(id)};
  function text(value){if(value===null||value===undefined)return "—";if(typeof value==="string")return value;if(typeof value==="number"||typeof value==="boolean")return String(value);try{return JSON.stringify(value)}catch(_){return "[не удалось отобразить]"}}
  function node(tag, className, value){var el=document.createElement(tag);if(className)el.className=className;if(value!==undefined)el.textContent=text(value);return el}
  function setMessage(value,kind){var el=$("message");el.textContent=value;el.className="message"+(kind?" "+kind:"")}
  function when(value){if(!value)return "—";var d=new Date(value);return isNaN(d.getTime())?text(value):d.toLocaleString("ru-RU",{dateStyle:"short",timeStyle:"medium"})}
  function clear(el){while(el.firstChild)el.removeChild(el.firstChild)}
  function item(parent,title,details){var box=node("div","item");var strong=node("strong","",title);box.appendChild(strong);if(details!==undefined){var body=node("div","muted",details);box.appendChild(body)}parent.appendChild(box)}
  function empty(el,msg){clear(el);el.appendChild(node("div","empty",msg))}
  function fmtUsd(n){var value=Number(n);return Number.isFinite(value)?(value/1000000).toLocaleString("ru-RU",{maximumFractionDigits:6})+" USD ("+value.toLocaleString("ru-RU")+" microUSD)":text(n)}
  function render(data){
    payload=data; csrf=typeof data.csrf==="string"?data.csrf:"";
    var state=data.state||{}, control=state.control||{};
    var grant=state.testGrant;
    if(state.structureReports&&state.structureReports.length)$("crewStructureResult").textContent=JSON.stringify(state.structureReports[state.structureReports.length-1],null,2);
    $("crewTestStatus").textContent=grant?("Серия "+grant.id+" · "+(grant.revokedAt?"ОТОЗВАНО":Date.parse(grant.expiresAt)<=Date.now()?"ИСТЁК":"разрешена")+" · до "+when(grant.expiresAt)+" · потрачено/unknown "+fmtUsd(grant.spent)+" · резерв "+fmtUsd(grant.reserved)+" · последнее использование "+when(grant.lastUsedAt)):"Ключ ещё не использован; агенты не запущены.";
    $("switchDot").className="dot"+(control.enabled?" on":"");
    $("switchText").textContent=control.enabled?"ВНИМАНИЕ · сервер сообщил enabled=true":"ВЫКЛЮЧЕНО";
    $("updated").textContent="Обновлено "+new Date().toLocaleTimeString("ru-RU");
    var metrics=$("metrics");clear(metrics);
    [[ "Ревизия",state.revision ],["Задач",(state.tasks||[]).length],["Запусков", (state.runs||[]).length]].forEach(function(x){var m=node("div","metric");m.appendChild(node("small","",x[0]));m.appendChild(node("strong","",x[1]));metrics.appendChild(m)});
    var meta=$("meta");clear(meta);
    [["Инициализировано",data.initialized?"да":"нет"],["Среда",data.environment],["Переключатель",control.enabled?"ВКЛ — аварийное выключение доступно":"выключен"],["Бюджет",fmtUsd(control.dailyLimitMicroUsd)],["Устаревание",text(control.staleHours)+" ч"],["Epoch",control.epoch],["Ключ Anthropic",data.keyConfigured?"настроен":"не подтверждён"],["Версия кода",data.codeVersion]].forEach(function(x){meta.appendChild(node("span","",x[0]));meta.appendChild(node("span","",x[1]))});
    $("notice").textContent=data.notice||"";
    $("dailyLimit").textContent=fmtUsd(control.dailyLimitMicroUsd);
    $("staleHours").value=Number.isInteger(control.staleHours)?control.staleHours:24;
    renderStale(data.stale||[]);renderTasks(state.tasks||[]);renderAgents(state.agents||[],state.schedules||[]);
    renderRuns(state.runs||[],state.budget||{});renderProposals(state.documents||[],state.publications||[]);
    renderJournal(state.journal||[]);
    if(state.probe){$("probeStatus").textContent="Сохранённый probe: "+state.probe.status+" · "+state.probe.modelId+" · "+when(state.probe.at)+(state.probe.usage?" · usage "+text(state.probe.usage):"");}
    else $("probeStatus").textContent=data.environment==="production"?"Одноразовый probe ещё не отмечен.":"Probe разрешён только в production.";
    updateProbe();renderPilotResults(state);updatePilotButtons();
  }
  function findOpenPilot(state){return (state.tasks||[]).find(function(t){return t.hintPilot&&!t.closed})||null}
  function renderPilotResults(state){
    var el=$("pilotResults");clear(el);var tasks=(state.tasks||[]).filter(function(t){return t.hintPilot});
    if(!tasks.length){empty(el,"Пилотных задач пока нет.");return}
    tasks.slice().reverse().forEach(function(task){
      var p=task.hintPilot||{}, box=node("div","item");
      box.appendChild(node("strong","","Пилот Hint · "+(p.status||"—")+(task.closed?" · закрыта":"")));
      box.appendChild(node("div","muted","Задача "+task.id+" · кандидат: "+text(p.candidate)));
      if(p.status==="not_completed")box.appendChild(node("div","muted","не выполнено: зависание диспетчера"));
      if(p.status==="owner"&&state.control&&state.control.enabled===false)box.appendChild(node("div","muted","Пилот завершён · контроль автоматически выключен."));
      var docs=state.documents||[], runs=(state.runs||[]).filter(function(r){return r.taskId===task.id}), agents=state.agents||[];
      var proposal=p.proposalId?docs.find(function(d){return d.id===p.proposalId}):null;
      var review=p.reviewId?docs.find(function(d){return d.id===p.reviewId}):null;
      box.appendChild(node("div","muted","Паша · предложение "+(proposal?"("+p.proposalId+"): "+proposal.text:"ещё не получено")));
      box.appendChild(node("div","muted","Фома · вердикт "+(p.verdict==="confirmed"?"подтверждено":p.verdict==="not_confirmed"?"не подтверждено":"ожидается")+(review?" · документ "+p.reviewId+": "+review.text:"")));
      var known=0, knownCount=0, reserved=0, hasUnknownCost=false, hasUnknownReservation=false;
      runs.forEach(function(r){if(typeof r.cost==="number"&&Number.isFinite(r.cost)){known+=r.cost;knownCount++}else if(r.status==="unknown"||r.status==="running")hasUnknownCost=true;if(r.status==="unknown"||r.status==="running"){if(typeof r.reserved==="number"&&Number.isFinite(r.reserved))reserved+=r.reserved;else hasUnknownReservation=true}});
      box.appendChild(node("div","muted","Фактическая цена по учтённым токенам: "+(hasUnknownCost?"неизвестна целиком; известная часть "+fmtUsd(known):fmtUsd(known))+" · оставшийся резерв: "+(hasUnknownReservation?"неизвестно":fmtUsd(reserved))+(knownCount?" · учтено запусков: "+knownCount:"")));
      ["product-manager-specialist","Hint-lg-qa-role"].forEach(function(id){var agent=agents.find(function(a){return a.agentId===id}), usageRuns=runs.filter(function(r){return r.agentId===id}), usage=usageRuns.reduce(function(sum,r){if(r.usage){sum.input+=Number(r.usage.input_tokens)||0;sum.output+=Number(r.usage.output_tokens)||0;sum.known++}else sum.unknown++;return sum},{input:0,output:0,known:0,unknown:0}), prefix=(id==="product-manager-specialist"?"Паша":"Фома")+" · "+id+" · "+(agent?"ставки "+agent.inputMicroUsdPerToken+"/"+agent.outputMicroUsdPerToken+" microUSD/token":"ставки недоступны");box.appendChild(node("div","muted",prefix+" · input "+(usage.known?usage.input:"неизвестно")+" · output "+(usage.known?usage.output:"неизвестно")+(usage.unknown?" · usage неизвестно для "+usage.unknown+" запуска(ов)":"")))});
      el.appendChild(box)
    });
    schedulePilotPoll(state);
  }
  function schedulePilotPoll(state){
    if(pilotPoll){clearTimeout(pilotPoll);pilotPoll=null}
    var active=(state.tasks||[]).some(function(t){return t.hintPilot&&!t.closed&&(t.hintPilot.status==="author"||t.hintPilot.status==="review")});
    if(active)pilotPoll=setTimeout(function(){request("",{method:"GET"}).then(function(data){render(data)}).catch(function(){if(!pilotBlocked)setMessage("Не удалось обновить состояние пилота. Используйте «Обновить состояние» для проверки.","error")})},5000)
  }
  function renderStale(rows){var el=$("staleList");clear(el);if(!rows.length){empty(el,"Устаревших незакрытых задач нет.");return}rows.forEach(function(t){item(el,(t.phase||"")+" · "+(t.holder||"держатель не указан"),"Задача "+t.taskId+" · последнее обновление "+when(t.lastEntryAt))})}
  function renderTasks(rows){var el=$("tasks");clear(el);if(!rows.length){empty(el,"Задач пока нет.");return}rows.slice().reverse().forEach(function(t){var step=(t.steps||[]).slice(-1)[0]||{};item(el,t.title||t.id,(t.closed?"закрыта":"этап: "+t.phase)+" · держатель: "+(step.holder||"—")+" · обновлено: "+when(step.updatedAt)+" · ID: "+t.id)})}
  function renderAgents(rows,schedules){var el=$("agents");clear(el);if(!rows.length)empty(el,"Описания агентов пока отсутствуют.");else rows.forEach(function(a){item(el,a.agentId,"модель "+a.modelId+" · вход "+a.inputMicroUsdPerToken+" / выход "+a.outputMicroUsdPerToken+" microUSD/token")});
    var sc=$("schedules");clear(sc);if(!schedules.length)empty(sc,"Расписаний нет.");else schedules.forEach(function(s){item(sc,s.agentId+" · каждые "+s.everyMinutes+" мин","задача "+s.taskId+" · следующий запуск "+when(s.nextAt))})}
  function renderRuns(rows,budget){var el=$("runs");clear(el);if(!rows.length)empty(el,"Запусков нет.");else rows.slice().reverse().forEach(function(r){item(el,r.status+" · "+r.agentId,"задача "+r.taskId+" · "+when(r.at)+" · reserved "+text(r.reserved)+" · cost "+text(r.cost)+" microUSD")});
    var c=$("costs");clear(c);var keys=Object.keys(budget||{}).sort().reverse();if(!keys.length)empty(c,"Расходы не зарегистрированы.");else keys.forEach(function(day){item(c,day,"потрачено "+text(budget[day].spent)+" · зарезервировано "+text(budget[day].reserved)+" microUSD")})}
  function renderProposals(docs,pubs){var el=$("proposals");clear(el);if(!docs.length)empty(el,"Предложений нет.");else docs.slice().reverse().forEach(function(d){item(el,d.status+" · "+d.agentId+" · "+when(d.at),d.text+" · task "+d.taskId+" · run "+d.runId)});
    var p=$("publications");clear(p);if(!pubs.length)empty(p,"Публикаций нет.");else pubs.slice().reverse().forEach(function(x){item(p,x.commit+" · "+when(x.at),x.fixes+" · task "+x.taskId+" · "+x.actor)})}
  function renderJournal(rows){var el=$("journal");clear(el);$("journalCount").textContent=rows.length+" событий";if(!rows.length){empty(el,"Журнал пуст.");return}rows.slice().reverse().forEach(function(e){var box=node("div","item");box.appendChild(node("strong","",e.kind+" · "+when(e.at)));box.appendChild(node("div","muted","actor: "+e.actor+" · "+text(e.detail)));el.appendChild(box)})}
  $("revokeCrewTest").addEventListener("click",async function(){
    if(!window.confirm("Вы уверены? Отключить crew-test и остановить его пилоты? Возобновления этой серии не будет."))return;
    var button=$("revokeCrewTest");if(button.disabled)return;button.disabled=true;
    try{var fresh=await request("",{method:"GET"});render(fresh);
      var saved=await request("/crew-test/revoke",{method:"POST",body:JSON.stringify({revision:fresh.state.revision})});
      var after=await request("",{method:"GET"});render(after);
      if(saved.saved!==true||after.state.revision!==fresh.state.revision+1||!after.state.testGrant||!after.state.testGrant.revokedAt)throw Error("Отзыв не подтверждён.");
      setMessage("Доступ crew-test отозван. Автозапуска нет.","good");
    }catch(_){setMessage("СТОП: отзыв не подтверждён. Обновите состояние, не повторяйте запись вслепую.","error")}
  });
  $("checkCrewStructure").addEventListener("click",async function(){var b=$("checkCrewStructure");if(b.disabled)return;b.disabled=true;
    try{$("crewStructureResult").textContent=JSON.stringify(await request("/structure-check",{method:"GET"}),null,2)}
    catch(_){$("crewStructureResult").textContent="Проверка недоступна — это не результат «ок»."}finally{b.disabled=false}});
  async function request(path,options){var opt=options||{};opt.cache="no-store";opt.credentials="same-origin";opt.headers=Object.assign({"Accept":"application/json"},opt.headers||{});if(opt.body)opt.headers["Content-Type"]="application/json";if(opt.method==="POST")opt.headers["x-crew-csrf"]=csrf;
    var response=await fetch(API+path,opt), data;try{data=await response.json()}catch(_){data={error:"Ответ сервера не является JSON"}}
    if(!response.ok)throw Error(data.error||("HTTP "+response.status));return data}
  async function refresh(manual){if(busy)return;busy=true;setMessage("Запрашиваем актуальное состояние…");try{var data=await request("",{method:"GET"});render(data);if(manual===true)pilotBlocked=false;updatePilotButtons();setMessage("Состояние получено от сервера.","good")}catch(e){setMessage("Не удалось получить состояние: "+e.message+". Данные на экране могут быть устаревшими.","error")}finally{busy=false}}
  function updatePilotButtons(){var disabled=pilotBusy||pilotBlocked||!pilotStateValid(payload),state=payload&&payload.state,open=state&&findOpenPilot(state),prepared=open&&open.hintPilot.status==="prepared"&&open.phase==="analysis";
    $("prepareHintPilot").disabled=!!(disabled||open||state.control.enabled||state.control.dailyLimitMicroUsd!==0);
    $("enableHintPilot").disabled=!!(disabled||!prepared||state.control.enabled);
    $("startHintPilot").disabled=!!(disabled||!prepared||!state.control.enabled||state.control.dailyLimitMicroUsd<=0);
    $("closeStalledHintPilot").disabled=!!(disabled||!canCloseStalledPilot(state,open))}
  function canCloseStalledPilot(state,task){
    if(!state||!state.control||state.control.enabled!==false||!task||task.closed||task.phase!=="analysis"||!task.hintPilot||task.hintPilot.status!=="author"||task.hintPilot.proposalId||task.hintPilot.reviewId||!state.budget)return false;
    var runs=(state.runs||[]).filter(function(r){return r.taskId===task.id});
    return runs.some(function(r){return r.status==="queued"})&&runs.every(function(r){return ["queued","discarded"].indexOf(r.status)>=0&&(r.reserved===undefined||r.reserved===0)&&(r.cost===undefined||r.cost===0)&&(!r.usage||(r.usage.input_tokens===0&&r.usage.output_tokens===0))})&&Object.keys(state.budget).every(function(day){return state.budget[day].reserved===0})&&!(state.documents||[]).some(function(d){return d.taskId===task.id})
  }
  function pilotStateValid(data){return !!data&&data.initialized===true&&data.environment==="production"&&data.state&&Number.isSafeInteger(data.state.revision)&&data.state.control}
  async function pilotAction(kind){
    if(pilotBusy||pilotBlocked)return;
    var limitRaw=$("pilotLimitUsd").value;
    var confirmations={prepare:"Вы уверены? Подготовить production-пилот Hint по задержкам? Ставки будут зафиксированы, но агенты не запустятся.",enable:"Вы уверены? Включить AI Crew с дневным лимитом $"+limitRaw+"? Это разрешит расходы пилота.",start:"Вы уверены? Запустить подготовленный пилот Hint? Будут выполнены два анализа с возможными расходами.",close:"Вы уверены? Закрыть зависший пилот как «не выполнено: зависание диспетчера»? Очередь будет отмечена discarded, история сохранится. Контроль останется OFF, лимит станет 0. Нового запуска не будет."};
    if(!window.confirm(confirmations[kind]))return;
    pilotBusy=true;var intent=++pilotIntent;updatePilotButtons();setMessage("Получаем свежие данные и проверяем условия пилота…");
    var writeAttempted=false;
    try{
      var fresh=await request("",{method:"GET"});
      csrf=typeof fresh.csrf==="string"?fresh.csrf:"";
      if(!pilotStateValid(fresh))throw Error("Нужна инициализированная production-среда и свежая revision.");
      render(fresh);
      var state=fresh.state, open=findOpenPilot(state), command;
      if(kind==="prepare"){
        if(state.control.enabled!==false||state.control.dailyLimitMicroUsd!==0||open)throw Error("Подготовка разрешена только при выключенном контроле, лимите 0 и отсутствии открытого пилота.");
        command={kind:"hint_pilot_prepare",candidate:"latency",ratesConfirmed:true};
      }else if(kind==="enable"){
        var raw=limitRaw;
        if(typeof raw!=="string"||raw.length>32||!/^\d+(?:\.\d{1,6})?$/.test(raw))throw Error("Введите положительную сумму без экспоненты, максимум с 6 знаками после точки.");
        var parts=raw.split("."), whole=BigInt(parts[0]), fraction=BigInt(((parts[1]||"")+"000000").slice(0,6)), microsBig=whole*1000000n+fraction;
        if(microsBig<=0n||microsBig>100000000000n)throw Error("Лимит должен быть больше 0 и не превышать 100000 USD.");
        if(!open||!open.hintPilot||open.hintPilot.status!=="prepared"||open.phase!=="analysis"||open.closed||state.control.enabled!==false)throw Error("Включение доступно только для свежего подготовленного открытого анализа при выключенном контроле.");
        if(!Number.isInteger(state.control.staleHours)||state.control.staleHours<1||state.control.staleHours>8760)throw Error("Свежий срок устаревания некорректен.");
        command={kind:"control",enabled:true,dailyLimitMicroUsd:Number(microsBig),staleHours:state.control.staleHours};
      }else if(kind==="close"){
        if(!canCloseStalledPilot(state,open))throw Error("Закрытие запрещено: нужен OFF и зависшая очередь без выполненных запусков и резервов.");
        command={kind:"hint_pilot_close_stalled",taskId:open.id,ownerApproved:true};
      }else{
        if(!open||!open.hintPilot||open.hintPilot.status!=="prepared"||open.phase!=="analysis"||open.closed||state.control.enabled!==true||!Number.isFinite(state.control.dailyLimitMicroUsd)||state.control.dailyLimitMicroUsd<=0)throw Error("Запуск доступен только для свежего подготовленного открытого анализа при включённом положительном лимите.");
        command={kind:"hint_pilot_start",taskId:open.id,ownerApproved:true};
      }
      if(intent!==pilotIntent)throw Error("Действие отменено аварийным выключением.");
      writeAttempted=true;
      var result=await request("/command",{method:"POST",body:JSON.stringify({revision:state.revision,command:command})});
      if(!result||result.saved!==true)throw Error("Нет однозначного подтверждения saved=true.");
      setMessage("Действие пилота принято сервером · "+text(result),"good");
      try{var after=await request("",{method:"GET"});render(after);
        if(!pilotStateValid(after)||after.state.revision<=state.revision)throw Error("Revision не увеличилась после записи.");
        var found=findOpenPilot(after.state);
        if(kind==="prepare"&&(!found||found.hintPilot.candidate!=="latency"||found.hintPilot.status!=="prepared"||after.state.control.enabled||after.state.control.dailyLimitMicroUsd!==0))throw Error("Состояние подготовки не совпало.");
        if(kind==="enable"&&(after.state.control.enabled!==true||after.state.control.dailyLimitMicroUsd!==command.dailyLimitMicroUsd))throw Error("Состояние включения не совпало.");
        if(kind==="start"&&(!found||found.id!==command.taskId||["author","review","owner"].indexOf(found.hintPilot.status)<0))throw Error("Состояние запуска не совпало.");
        if(kind==="close"){
          var closed=(after.state.tasks||[]).find(function(t){return t.id===command.taskId}),previousRuns=(state.runs||[]).filter(function(r){return r.taskId===command.taskId&&r.status==="queued"});
          if(after.state.revision!==state.revision+1||!closed||!closed.closed||closed.phase!=="outcome"||closed.hintPilot.status!=="not_completed"||closed.steps.slice(-1)[0].actual!=="не выполнено: зависание диспетчера"||after.state.control.enabled!==false||after.state.control.dailyLimitMicroUsd!==0||!previousRuns.every(function(r){return (after.state.runs||[]).some(function(x){return x.id===r.id&&x.status==="discarded"&&x.cost===0})})||!(after.state.journal||[]).some(function(e){return e.kind==="hint_pilot_closed_stalled"&&e.detail&&e.detail.taskId===command.taskId}))throw Error("Состояние закрытия не совпало.");
        }
        setMessage("Состояние перечитано и проверено после подтверждённого действия.","good")}
      catch(readError){pilotBlocked=true;setMessage("СТОП. Действие подтверждено, но проверка повторного чтения не прошла: "+readError.message+". Новые действия заблокированы до ручного обновления.","error")}
    }catch(e){
      if(writeAttempted){
        pilotBlocked=true;setMessage("СТОП. Результат записи неоднозначен или отклонён: "+e.message+". Запись не повторялась; перечитываем состояние для диагностики. Новые действия заблокированы до ручного обновления.","error");
        try{var diagnosis=await request("",{method:"GET"});render(diagnosis)}catch(readError){setMessage("Результат записи неизвестен: "+e.message+". Диагностическое чтение также не удалось: "+readError.message+". Запись не повторялась; нажмите «Обновить состояние».","error")}
      }else setMessage("Действие не выполнено: "+e.message,"error");
    }finally{pilotBusy=false;updatePilotButtons()}
  }
async function post(path,body,success){if(busy)return;busy=true;setMessage("Ожидаем подтверждение сервера…");var confirmed=false;try{var result=await request(path,{method:"POST",body:JSON.stringify(body||{})});setMessage(success+" · "+text(result),"good");confirmed=true}catch(e){setMessage("Сервер не подтвердил операцию: "+e.message+". Обновите состояние перед повтором.","error")}finally{busy=false}if(confirmed)await refresh()}
  $("refresh").addEventListener("click",function(){refresh(true)});
  $("prepareHintPilot").addEventListener("click",function(){pilotAction("prepare")});
  $("enableHintPilot").addEventListener("click",function(){pilotAction("enable")});
  $("startHintPilot").addEventListener("click",function(){pilotAction("start")});
  $("closeStalledHintPilot").addEventListener("click",function(){pilotAction("close")});
  $("initialize").addEventListener("click",function(){if(!window.confirm("Инициализировать AI Crew? Будет создана новая таблица с выключенными агентами и бюджетом 0. Продолжить?"))return;post("/initialize",{},"Инициализация подтверждена")});
  $("disable").addEventListener("click",function(){if(!window.confirm("Аварийно выключить AI Crew на сервере? Это изменит переключатель и остановит локальный runtime."))return;pilotIntent++;post("/disable",{},"Запрос аварийного выключения подтверждён")});
  $("saveControl").addEventListener("click",async function(){if(busy||pilotBusy)return;var hours=Number($("staleHours").value);if(!Number.isInteger(hours)||hours<1||hours>8760){setMessage("Срок устаревания должен быть целым числом от 1 до 8760 часов.","error");return}if(!window.confirm("Вы уверены? Выключить контроль и сохранить срок устаревания? Дневной лимит не изменится."))return;busy=true;var fresh;try{fresh=await request("",{method:"GET"});render(fresh);if(!fresh.initialized||!Number.isSafeInteger(fresh.state.revision)||!Number.isSafeInteger(fresh.state.control.dailyLimitMicroUsd))throw Error("Нет свежих настроек");}catch(e){setMessage("Настройки не сохранены: "+e.message,"error");return}finally{busy=false}post("/command",{revision:fresh.state.revision,command:{kind:"control",enabled:false,dailyLimitMicroUsd:fresh.state.control.dailyLimitMicroUsd,staleHours:hours}},"Настройки выключенного контроля сохранены; лимит не изменён")});
  $("loadModels").addEventListener("click",async function(){var button=$("loadModels");button.disabled=true;setMessage("Запрашиваем реальные модели у Anthropic…");try{var result=await request("/models",{method:"GET"});models=Array.isArray(result.models)?result.models.filter(function(m){return m&&typeof m.id==="string"}):[];modelEnvironment=result.environment||"";var select=$("modelSelect");clear(select);if(!models.length){select.appendChild(new Option("Ответ не содержит model ID",""));setMessage("Модели не подтверждены: ответ не содержит ID.","error")}else{select.appendChild(new Option("Выберите модель…",""));models.forEach(function(m){select.appendChild(new Option(m.id,m.id))});setMessage("Получены ID из фактического ответа Anthropic · "+text(result.source),"good")}updateProbe()}catch(e){models=[];clear($("modelSelect"));$("modelSelect").appendChild(new Option("Список недоступен",""));setMessage("Не удалось подтвердить модели: "+e.message,"error");updateProbe()}finally{button.disabled=false}});
  function updateProbe(){var state=payload&&payload.state;var unused=state&&!state.probe;var allowed=payload&&payload.environment==="production"&&modelEnvironment==="production"&&models.length>0&&unused&&!busy;$("probe").disabled=!allowed}
  $("modelSelect").addEventListener("change",updateProbe);
  $("probe").addEventListener("click",function(){var modelId=$("modelSelect").value;if(!modelId||!models.some(function(m){return m.id===modelId})){setMessage("Выберите ID, подтверждённый ответом Anthropic.","error");return}if(!window.confirm("Одноразовый production probe для "+modelId+". Возможен расход API. После timeout повтор запрещён: результат может быть неизвестен. Выполнить?"))return;post("/probe",{modelId:modelId},"Результат probe получен")});
  var examples={
    task:{kind:"task",title:"Краткая цель",holder:"Владелец",problem:"Проблема и ожидаемый результат"},
    advance:{kind:"advance",taskId:"ЗАМЕНИТЬ-UUID-ЗАДАЧИ",holder:"Следующий держатель",note:"Что завершено и передаётся дальше",laboratoryActor:"Инженер лаборатории",reviewerActor:"Независимый проверяющий"},
    publication:{kind:"publication",taskId:"ЗАМЕНИТЬ-UUID-ЗАДАЧИ",commit:"abcdef1",fixes:"Что исправлено в публикации"},
    agent:{kind:"agent",agentId:"reviewer",modelId:"ЗАМЕНИТЬ-ID-ИЗ-ANTHROPIC",inputMicroUsdPerToken:null,outputMicroUsdPerToken:null},
    enqueue:{kind:"enqueue",taskId:"ЗАМЕНИТЬ-UUID-ЗАДАЧИ",agentId:"reviewer",eventId:"ЗАМЕНИТЬ-UUID-СОБЫТИЯ"},
    schedule:{kind:"schedule",taskId:"ЗАМЕНИТЬ-UUID-ЗАДАЧИ",agentId:"reviewer",everyMinutes:60,nextAt:"2026-01-01T12:00:00.000Z"}
  };
  var tmpl=$("templates");Object.keys(examples).forEach(function(kind){var b=node("button","",kind);b.type="button";b.addEventListener("click",function(){$("commandJson").value=JSON.stringify(examples[kind],null,2)});tmpl.appendChild(b)});
  $("submitCommand").addEventListener("click",function(){var command;try{command=JSON.parse($("commandJson").value)}catch(e){setMessage("JSON не разобран: "+e.message,"error");return}if(!command||typeof command!=="object"||Array.isArray(command)){setMessage("Ожидается объект-команда.","error");return}if(command.enabled===true){setMessage("enabled:true запрещён. Активация агентов исключена из этой панели.","error");return}if(command.kind==="control")command.enabled=false;if(!payload||!payload.state||!Number.isSafeInteger(payload.state.revision)){setMessage("Нет актуальной revision. Сначала обновите состояние.","error");return}post("/command",{revision:payload.state.revision,command:command},"Команда подтверждена")});
  refresh();
})();
</script>
</body></html>`;
