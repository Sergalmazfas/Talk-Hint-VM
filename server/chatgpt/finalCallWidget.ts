/** One owner decision, then one read-only final-result action. No live
 * transport, audio, automatic polling, URL fallback or provider calls. */
export function finalCallWidgetHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TalkHint — поручение и итог</title><style>
*{box-sizing:border-box}body{margin:0;padding:18px;background:#f5f7f2;color:#203b43;font:15px/1.5 system-ui,sans-serif}
main{max-width:660px;margin:auto;background:white;border:1px solid #dce5dc;border-radius:20px;padding:24px}
h1{font-size:25px;margin:0 0 18px}h2{font-size:18px;margin:22px 0 8px}dt{font-size:12px;color:#657b72;margin-top:12px}
dd{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}button{border:0;border-radius:12px;padding:14px 18px;margin:12px 6px 0 0;font:600 15px system-ui;background:#176858;color:white;cursor:pointer}
button:disabled{opacity:.5;cursor:default}.secondary{background:#e9eee8;color:#37554c}
#status{color:#657b72}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
[hidden]{display:none!important}</style></head><body><main>
<h1>Поручение Secretary</h1>
<section id="preview"><dl><dt>Адресат</dt><dd id="recipient"></dd><dt>Номер собеседника</dt><dd id="phoneNumber"></dd>
<dt>Задание</dt><dd id="instruction"></dd><dt>Секретарь, голос и исходящая линия</dt><dd id="execution"></dd></dl>
<button id="approve" disabled>Подтвердить и позвонить</button><button id="deny" class="secondary" disabled>Отменить</button></section>
<p id="status" role="status">Ожидаем защищённую карточку TalkHint.</p>
<button id="getResult" hidden>Получить итог звонка</button>
<section id="report" hidden><h2>Краткое резюме</h2><pre id="summary"></pre><p id="outcome"></p>
<h2>Полная транскрипция</h2><pre id="transcript"></pre></section>
</main><script>(() => {
"use strict";
const $ = id => document.getElementById(id);
const record = v => v && typeof v === "object" && !Array.isArray(v) ? v : null;
const text = v => typeof v === "string" || typeof v === "number" ? String(v) : "";
const locator = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(v) ? v : null;
let card = null, taskId = null, requestId = null, locked = false, busy = false, bridge = false, sequence = 0;
const pending = new Map();
function status(s) { $("status").textContent = s; }
function persist() {
  if (window.openai && typeof window.openai.setWidgetState === "function")
    window.openai.setWidgetState({taskId, clientRequestId: requestId});
}
function showResultAction() {
  $("preview").hidden = true; $("getResult").hidden = !taskId && !requestId;
}
function renderReport(result) {
  const id = locator(result.task_id || result.id);
  if (id && taskId && id !== taskId) throw new Error("Получен результат другого поручения");
  if (id) taskId = id;
  persist(); showResultAction();
  if (!result.ready) { $("report").hidden = true; status(result.note || "Звонок ещё не завершён. Получите итог позже."); return; }
  $("report").hidden = false;
  $("summary").textContent = result.summary ? (typeof result.summary === "string" ? result.summary : JSON.stringify(result.summary, null, 2))
    : "Сохранённое резюме отсутствует. Данные не придуманы.";
  $("outcome").textContent = (result.phoneNumber ? "Собеседник: " + text(result.phoneNumber) + " · " : "") +
    "Фактический статус: " + text(result.status) + (result.outcome ? " · " + text(result.outcome) : "");
  $("transcript").textContent = text(result.transcript) || "Сохранённая транскрипция отсутствует.";
  status("Итог уже созданного звонка. Повторный звонок не запускался.");
}
function receive(output, meta) {
  const value = record(output); if (!value) return;
  if (Object.prototype.hasOwnProperty.call(value, "ready") && value.task_id) {
    const id = locator(value.task_id);
    if (!id || taskId && id !== taskId) return;
    taskId = id; locked = true; persist(); showResultAction();
    if ($("report").hidden) status("Нажмите «Получить итог звонка»: результат повторно проверяется под текущим подключением.");
    return;
  }
  const task = record(value.task);
  if (value.task_id || task) {
    const incomingId = locator(value.task_id || task && task.id);
    if (!incomingId || taskId && incomingId !== taskId) return;
    if (requestId && task && task.clientRequestId && requestId !== task.clientRequestId) return;
    taskId = incomingId;
    if (task && locator(task.clientRequestId)) requestId = task.clientRequestId;
    if (taskId) { locked = true; persist(); showResultAction(); status("Поручение принято. После завершения нажмите «Получить итог звонка»."); }
    return;
  }
  const wrapped = record(meta && (meta.mcp_tool_result || meta.call_tool_result));
  const metadata = record(wrapped && wrapped._meta) || record(meta && meta._meta) || meta;
  const approval = record(metadata && metadata["talkhint/cardApproval"]);
  if (!approval || !record(value.call) || locked) return;
  card = {confirmation: approval.confirmation, approvalToken: approval.approvalToken,
    expiresAt: value.expiresAt, call: value.call};
  requestId = locator(value.call.clientRequestId);
  $("recipient").textContent = text(value.call.recipient) || "Не указан";
  $("phoneNumber").textContent = text(value.call.phoneNumber);
  $("instruction").textContent = text(value.call.instruction);
  const e = record(value.execution) || {};
  const outgoing = record(e.outgoing) || {}, personality = record(outgoing.personality);
  $("execution").textContent = [e.provider, e.model, e.reasoning, e.voice, outgoing.fromNumber,
    personality && text(personality.name) + " v" + text(personality.version)].filter(Boolean).join(" · ");
  const expired = !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now();
  $("approve").disabled = $("deny").disabled = expired || !card.confirmation || !card.approvalToken || !hasBridge();
  status(expired ? "Срок подтверждения истёк. Звонок не начат." : "Проверьте адресата, номер и задание. Звонок ещё не начат.");
}
function hasBridge() { return bridge || !!(window.openai && typeof window.openai.callTool === "function"); }
async function callTool(name, args) {
  let result;
  if (bridge) result = await new Promise((resolve, reject) => {
    const id = "talkhint-" + (++sequence);
    const timer = window.setTimeout(() => {pending.delete(id); reject(new Error("Ответ не получен. Не создавайте повторный звонок."));}, 20000);
    pending.set(id, {resolve, reject, timer});
    window.parent.postMessage({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args}}, "*");
  });
  else if (window.openai && typeof window.openai.callTool === "function") result = await window.openai.callTool(name, args);
  else throw new Error("Этот клиент не предоставил защищённый интерфейс TalkHint.");
  const value = record(result && result.result) || record(result) || {};
  if (value.isError) throw new Error((value.content || []).map(v => text(v.text)).join(" ") || "Не удалось прочитать результат. Проверьте подключение и разрешения.");
  return record(value.structuredContent) || value;
}
async function decide(decision) {
  if (locked || busy || !card || !hasBridge()) return;
  if (!Number.isFinite(Date.parse(card.expiresAt)) || Date.parse(card.expiresAt) <= Date.now()) {status("Срок подтверждения истёк. Звонок не начат."); return;}
  locked = true; busy = true; $("approve").disabled = $("deny").disabled = true;
  status(decision === "approve" ? "Отправляем одно подтверждение…" : "Отменяем поручение…");
  try {
    const value = await callTool("confirm_call_from_card", {confirmation:card.confirmation,approvalToken:card.approvalToken,decision});
    if (decision === "deny") { $("preview").hidden = true; status("Поручение отменено. Звонок не начат."); return; }
    receive(value);
  } catch (error) {
    if (decision === "approve") {persist(); showResultAction();}
    status(error.message + " Не нажимайте повторный набор; кнопка итога только читает уже созданное поручение.");
  } finally { busy = false; }
}
async function getResult() {
  if (busy || (!taskId && !requestId)) return;
  busy = true; $("getResult").disabled = true;
  try {
    renderReport(await callTool("get_call_result", taskId ? {id:taskId} : {clientRequestId:requestId}));
  } catch (error) {status(error.message);}
  finally {busy = false; $("getResult").disabled = false;}
}
window.addEventListener("message", event => {
  if (event.source !== window.parent || !record(event.data) || event.data.jsonrpc !== "2.0") return;
  const m = event.data, entry = pending.get(m.id);
  if (entry) {pending.delete(m.id); window.clearTimeout(entry.timer); m.error ? entry.reject(new Error("Ошибка интерфейса ChatGPT")) : entry.resolve(m.result); return;}
  if (m.id === "talkhint-initialize" && !m.error) {
    bridge = true;
    window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}}, "*");
    if (card && !locked && Number.isFinite(Date.parse(card.expiresAt)) && Date.parse(card.expiresAt) > Date.now())
      $("approve").disabled = $("deny").disabled = false;
  }
  if (m.method === "ui/notifications/tool-result" && record(m.params)) receive(m.params.structuredContent, m.params._meta);
});
$("approve").addEventListener("click", () => decide("approve"));
$("deny").addEventListener("click", () => decide("deny"));
$("getResult").addEventListener("click", getResult);
const host = window.openai;
if (host) {
  const state = record(host.widgetState);
  if (state) { taskId = locator(state.taskId); requestId = locator(state.clientRequestId); }
  if (taskId || requestId) {locked = true; showResultAction(); status("Откройте сохранённый итог этого поручения. Новый звонок не запускается.");}
  else receive(host.toolOutput && (host.toolOutput.structuredContent || host.toolOutput), host.toolResponseMetadata);
}
window.addEventListener("openai:set_globals", event => {
  const globals = event.detail && event.detail.globals;
  if (globals) receive(globals.toolOutput && (globals.toolOutput.structuredContent || globals.toolOutput), globals.toolResponseMetadata);
});
try {
  if (window.parent !== window) window.parent.postMessage({jsonrpc:"2.0",id:"talkhint-initialize",method:"ui/initialize",
    params:{protocolVersion:"2026-01-26",appInfo:{name:"talkhint-call-result",version:"1.0.0"},appCapabilities:{}}}, "*");
} catch (_) {status("Подключение ChatGPT недоступно. Звонок не начат.");}
})();</script></body></html>`;
}
