/**
 * Isolated visual test host. No native imports, environment credentials,
 * database, OAuth login or telephone provider. Every tool result is a fixture.
 * Run manually with tsx; this is NOT a production endpoint.
 */
import { createServer } from "node:http";
import { callApprovalWidgetHtml } from "../server/chatgpt/callApprovalWidget";

const fixture = {
  structuredContent: {
    execution: { provider: "openai", model: "gpt-realtime-2.1", voice: "marin", mode: "native_audio" },
    call: { recipient: "Тестовая организация · имитация", phoneNumber: "+12025550123",
      instruction: "Уточнить часы работы. Это имитация: реальный номер не набирается.",
      voiceProvider: "fixture-only", translationLanguage: "ru" },
    expiresAt: "2099-01-01T00:00:00Z",
  },
  _meta: { "talkhint/cardApproval": { confirmation: "mock-not-valid", approvalToken: "mock-not-valid" } },
};
const monitorFixture = {
  task_id: "mock-task-1",
  expiresAt: "2099-01-01T00:00:00Z",
  note: "Изолированная имитация: сеть и аудио провайдеров не используются.",
};
const mockStreamShim = `<script>
  window.fetch=async function(url,options){
    if(url!=="https://monitor.example.test/mock"||options?.method!=="POST")throw new Error("fixture only");
    const encoder=new TextEncoder();
    const events=[
      {type:"snapshot",task:{status:"connected",summary:"Тестовый мониторинг вызова",transcriptTurns:[]}},
      {type:"turn",turnId:"fixture-turn-1",role:"secretary",text:"Тестовая реплика секретаря — реального вызова нет."},
      {type:"subtitle",turnId:"fixture-turn-1",translation:"Тестовый перевод; это не реальный разговор.",language:"ru"},
      {type:"turn",turnId:"fixture-turn-2",role:"guest",text:"Fixture only: we open at nine."},
      {type:"subtitle",turnId:"fixture-turn-2",translation:"Имитация: мы открываемся в девять.",language:"ru"},
      {type:"audio",role:"guest",payload:"/w=="},
      {type:"audio",role:"secretary",payload:"/w=="},
      {type:"status",status:"connected"}
    ];
    const body=new ReadableStream({start(controller){events.forEach(event=>controller.enqueue(encoder.encode("data: "+JSON.stringify(event)+"\\n\\n")));options?.signal?.addEventListener("abort",()=>controller.close(),{once:true})}});
    return {ok:true,body};
  };
  `;
createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.url?.split("?")[0] === "/widget") return res.end(callApprovalWidgetHtml().replace("<script>", mockStreamShim));
  if (req.url === "/live") return res.end(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width">
    <title>TalkHint · fixture-only live monitor</title>
    <style>body{margin:0;background:#e8eee8;font:14px system-ui;color:#29453f}.banner{padding:12px 16px;background:#244a45;color:#fff;font-weight:700}iframe{display:block;border:0;width:100%;height:1500px}</style>
    <div class="banner">ИЗОЛИРОВАННАЯ ИМИТАЦИЯ · вызов, реплики и перевод вымышлены · телефонии и провайдеров нет</div>
    <iframe id="card" src="/widget?fixture=live" title="Тестовая карточка TalkHint"></iframe>
    <script>
    const card=document.getElementById("card");
    const later=fn=>setTimeout(fn,250);
    const clickInCard=id=>{try{card.contentWindow.document.getElementById(id)?.click()}catch(_){}};
    window.addEventListener("message",event=>{
      if(event.source!==card.contentWindow||event.data?.jsonrpc!=="2.0")return;
      const m=event.data;
      const reply=result=>card.contentWindow.postMessage({jsonrpc:"2.0",id:m.id,result},"*");
      if(m.method==="ui/initialize")reply({protocolVersion:"2026-01-26",hostInfo:{name:"isolated-fixture",version:"1"},hostCapabilities:{}});
      if(m.method==="ui/notifications/initialized"){
        card.contentWindow.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:${JSON.stringify(fixture)}},"*");
        later(()=>clickInCard("approve"));
      }
      if(m.method==="ui/message")reply({});
      if(m.method==="tools/call"){
        if(m.params.name==="open_call_monitor")reply({structuredContent:${JSON.stringify(monitorFixture)},_meta:{"talkhint/monitor":{
          url:"https://monitor.example.test/mock",token:"fixture-only-not-a-real-token",
          task_id:"mock-task-1",expiresAt:"2099-01-01T00:00:00Z",
          fallbackUrl:"https://talkhint.example/api/chatgpt/secretary/tasks/mock-task-1"
        }}});
        else if(m.params.name==="get_task")reply({structuredContent:{id:"mock-task-1",status:"completed",summary:"Сохранённый тестовый отчёт; без звонка"}});
        else if(m.params.arguments.decision==="deny")reply({structuredContent:{status:"denied"}});
        else {reply({structuredContent:{task_id:"mock-task-1",task:{status:"starting",summary:"Тестовый вызов — не настоящий."}}});later(()=>clickInCard("listenButton"));}
      }
    });
    </script></html>`);
  if (req.url !== "/") { res.statusCode = 404; return res.end("Not found"); }
  res.end(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width">
    <title>TalkHint · isolated mock host</title>
    <style>body{margin:0;background:#f4f7fc;font:14px system-ui}p{padding:8px 16px;margin:0;color:#394375}iframe{border:0;width:100%;height:1100px}</style>
    <p>Изолированная имитация ChatGPT. Телефония и аккаунты не подключены.</p>
    <iframe id="card" src="/widget" title="Подтверждение тестового вызова"></iframe>
    <script>
    const card=document.getElementById("card");
    window.addEventListener("message",event=>{
      if(event.source!==card.contentWindow||event.data?.jsonrpc!=="2.0")return;
      const m=event.data;
      const reply=result=>card.contentWindow.postMessage({jsonrpc:"2.0",id:m.id,result},"*");
      if(m.method==="ui/initialize")reply({protocolVersion:"2026-01-26",hostInfo:{name:"isolated-fixture",version:"1"},hostCapabilities:{}});
      if(m.method==="ui/notifications/initialized")card.contentWindow.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:${JSON.stringify(fixture)}},"*");
      if(m.method==="ui/message")reply({});
      if(m.method==="tools/call")reply(m.params.name==="open_call_monitor"
        ?{structuredContent:${JSON.stringify(monitorFixture)},_meta:{"talkhint/monitor":{
          url:"https://monitor.example.test/mock",token:"fixture-only-not-a-real-token",
          task_id:"mock-task-1",expiresAt:"2099-01-01T00:00:00Z",
          fallbackUrl:"https://talkhint.example/api/chatgpt/secretary/tasks/mock-task-1"
        }}}
        :{structuredContent:m.params.name==="get_task"
        ?{id:"mock-task-1",status:"completed",summary:"Тестовый отчёт, без реального звонка"}
        :m.params.arguments.decision==="deny"?{status:"denied"}
        :{task_id:"mock-task-1",task:{status:"starting"},asynchronous:true}});
    });
    </script></html>`);
}).listen(8099, "0.0.0.0", () => console.log("Isolated mock card host listening on 8099; no calls possible"));
