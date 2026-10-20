/**
 * Isolated visual test host. No native imports, environment credentials,
 * database, OAuth login or telephone provider. Every tool result is a fixture.
 * Run manually with tsx; this is NOT a production endpoint.
 */
import { createServer } from "node:http";
import { callApprovalWidgetHtml } from "../server/chatgpt/callApprovalWidget";

const fixture = {
  structuredContent: {
    call: { recipient: "Тестовая организация · имитация", phoneNumber: "+12025550123",
      instruction: "Уточнить часы работы. Это имитация: реальный номер не набирается.",
      voiceProvider: "elevenlabs", translationLanguage: "ru" },
    expiresAt: "2099-01-01T00:00:00Z",
  },
  _meta: { "talkhint/cardApproval": { confirmation: "mock-not-valid", approvalToken: "mock-not-valid" } },
};
createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/widget") return res.end(callApprovalWidgetHtml());
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
      if(m.method==="tools/call")reply({structuredContent:m.params.name==="get_task"
        ?{id:"mock-task-1",status:"completed",summary:"Тестовый отчёт, без реального звонка"}
        :m.params.arguments.decision==="deny"?{status:"denied"}
        :{task_id:"mock-task-1",task:{status:"starting"},asynchronous:true}});
    });
    </script></html>`);
}).listen(8099, "0.0.0.0", () => console.log("Isolated mock card host listening on 8099; no calls possible"));
