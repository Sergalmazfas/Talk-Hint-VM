export const CALL_APPROVAL_RESOURCE = "ui://talkhint/call-approval/v4.html";

export function callApprovalWidgetHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>TalkHint · подтверждение вызова</title>
  <style>
    :root{color-scheme:light;--ink:#20334a;--muted:#607286;--accent:#176c68;--accent-deep:#105550;--line:#d5dfda;--paper:#edf2ed;--surface:#fbfcf8;--tint:#e5efea;--gold:#c18b42;--danger:#9e4550;--focus:#bf8d48;--serif:Georgia,"Times New Roman",serif;--sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}html{min-height:100%;background:var(--paper)}body{margin:0;min-height:100dvh;color:var(--ink);font:15px/1.55 var(--sans);background:radial-gradient(ellipse at 90% -8%,#dbe8df 0,transparent 43%),var(--paper)}
    button,a{font:inherit}.page{min-height:100dvh;padding:clamp(18px,4vw,38px) 14px 22px;display:flex;flex-direction:column}.top,main,.footer{width:100%;max-width:660px;margin-inline:auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:19px;gap:14px}.brand{display:flex;align-items:center;gap:11px;font-size:18px;font-weight:760;letter-spacing:-.04em}.mark{width:34px;height:34px;border-radius:12px;background:var(--accent);position:relative;box-shadow:0 5px 13px #174f4430}.mark:before,.mark:after{content:"";position:absolute;width:5px;border-radius:5px;background:#f4ead7;transform:rotate(36deg)}.mark:before{height:17px;left:11px;top:8px}.mark:after{height:11px;left:19px;top:12px}.top-note{text-align:right;font-size:12px;line-height:1.4;color:var(--muted)}
    main{flex:1}.card{overflow:hidden;background:var(--surface);border:1px solid var(--line);border-radius:22px;box-shadow:0 18px 45px #314a3d12}.hero{padding:clamp(22px,5vw,36px);background:linear-gradient(135deg,#f9faf5 0%,#f1f5ef 100%);border-bottom:1px solid var(--line)}.eyebrow{margin:0 0 11px;color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}.eyebrow:before{content:"";display:inline-block;width:17px;height:1px;background:var(--gold);vertical-align:middle;margin:0 8px 3px 0}h1{margin:0;font:500 clamp(29px,7vw,40px)/1.08 var(--serif);letter-spacing:-.035em;color:#203b43}.lede{margin:13px 0 0;max-width:58ch;color:var(--muted)}.single{display:flex;align-items:flex-start;gap:12px;margin-top:19px;padding:13px 15px;border:1px solid #d6e3d9;border-radius:13px;background:#eaf1e9;color:#415f59;font-size:13px}.single strong{display:block;margin-bottom:2px;color:#244a45}.seal{width:23px;height:23px;display:grid;place-items:center;flex:none;border:1px solid #bdd0c3;border-radius:50%;color:var(--accent);font:700 12px var(--sans)}
    .content{padding:clamp(20px,5vw,32px)}.details{display:grid;grid-template-columns:1fr;gap:9px}.detail{min-width:0;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#f8faf6}.detail-label{display:block;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.detail-value{display:block;margin-top:4px;color:var(--ink);font-weight:640;overflow-wrap:anywhere;white-space:pre-wrap}.detail-value.empty{color:#829087;font-weight:450}.expiry{margin:12px 0 0;color:var(--muted);font-size:12px}.actions{display:grid;gap:9px;margin-top:20px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;width:100%;padding:11px 15px;border:1px solid transparent;border-radius:11px;background:var(--accent);color:#fff;font-weight:760;text-align:center;cursor:pointer;transition:transform .16s ease,background-color .16s ease}.button:hover:not(:disabled){background:var(--accent-deep)}.button:active:not(:disabled){transform:translateY(1px)}.button.secondary{background:#f9fbf7;border-color:#bbc9c1;color:#31534d}.button.secondary:hover:not(:disabled){background:#edf3ee}.button.quiet{background:transparent;border-color:transparent;color:var(--accent);text-decoration:underline;text-underline-offset:3px}.button:disabled{cursor:not-allowed;opacity:.58}.button:focus-visible,a:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.status{min-height:1.5em;margin:14px 0 0;color:#53685d;font-size:13px}.status.error{padding:11px 13px;border-radius:10px;background:#f8e9e7;color:var(--danger)}.status.success{padding:11px 13px;border-radius:10px;background:#eaf3ed;color:#285b43}.status[hidden],.result[hidden],.compat[hidden],.monitor[hidden],.fallback[hidden]{display:none}
    .result,.monitor{margin-top:17px;padding:16px;border:1px solid var(--line);border-radius:14px;background:#f7f9f5}.result-title{margin:0;color:var(--ink);font-weight:780}.result-copy{margin:5px 0 0;color:var(--muted);font-size:13px;overflow-wrap:anywhere}.check{margin-top:12px}.monitor{padding:0;overflow:hidden}.monitor-head{padding:16px 17px 13px;border-bottom:1px solid var(--line)}.monitor-title{margin:0;font:500 23px/1.15 var(--serif);color:#203b43}.monitor-copy{margin:7px 0 0;color:var(--muted);font-size:13px}.consent{margin:13px 0 0;padding:12px 13px;border-left:3px solid var(--gold);background:#f4f1e7;color:#5a5548;font-size:12px}.monitor-actions{display:grid;grid-template-columns:1fr;gap:8px;padding:0 17px 15px}.host-state{margin:0 17px 14px;padding:10px 12px;border-radius:10px;background:#eaf0ec;color:#476358;font-size:12px}.host-state.error{background:#f8e9e7;color:var(--danger)}.transcript{display:grid;gap:9px;padding:0 17px 17px}.transcript:empty:after{content:"Реплики появятся только после получения данных TalkHint.";display:block;padding:14px;border:1px dashed #c6d3ca;border-radius:10px;color:#74847a;font-size:13px;text-align:center}.turn{padding:11px 12px;border:1px solid #dce4dd;border-radius:11px;background:#fbfcf8}.turn-meta{display:flex;justify-content:space-between;gap:8px;color:#648077;font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.turn-text{margin:5px 0 0;color:#2e4145;white-space:pre-wrap;overflow-wrap:anywhere}.translation{margin:7px 0 0;padding-top:7px;border-top:1px solid #e0e7e0;color:#68756d;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.compat,.fallback{margin-top:14px;padding:13px 15px;border-radius:11px;background:#edf2ed;color:#4d6358;font-size:13px}.fallback a{display:inline-block;margin-top:7px;color:var(--accent);font-weight:750}.footer{margin-top:18px;color:#7b8980;font-size:11px;text-align:center}
    @media(min-width:560px){.details{grid-template-columns:1fr 1fr}.detail:last-child{grid-column:1/-1}.actions{grid-template-columns:1fr 1fr}.actions .button:first-child{grid-column:1/-1}.monitor-actions{grid-template-columns:1fr 1fr}.monitor-actions .button:first-child{grid-column:1/-1}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
    .transcript{max-height:420px;overflow:auto;overscroll-behavior:contain}.started .hero,.started .details,.started .expiry,.started .actions{display:none}.call-summary{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;color:var(--ink)}
  </style>
</head>
<body>
  <div class="page">
    <header class="top"><span class="brand"><span class="mark" aria-hidden="true"></span><span>TalkHint</span></span><span class="top-note">Личный телефонный<br>секретарь</span></header>
    <main><article class="card" id="cardContainer" aria-labelledby="title">
      <div class="hero"><p class="eyebrow">Точное подтверждение</p><h1 id="title">Проверьте детали вызова</h1>
        <div class="single"><span class="seal" aria-hidden="true">1</span><span><strong>Один вызов</strong>Номер и цель заданы TalkHint.</span></div>
      </div>
      <div class="content">
        <p class="call-summary" id="callSummary" hidden></p>
        <section class="details" aria-label="Детали вызова">
          <div class="detail"><span class="detail-label">Получатель</span><span class="detail-value" id="recipient"></span></div>
          <div class="detail"><span class="detail-label">Модель и голос</span><span class="detail-value" id="execution"></span></div>
          <div class="detail"><span class="detail-label">Номер</span><span class="detail-value" id="phoneNumber"></span></div>
          <div class="detail"><span class="detail-label">Краткая цель</span><span class="detail-value" id="instruction"></span></div>
        </section>
        <p class="expiry" id="expiry" hidden></p>
        <div class="actions"><button class="button" id="approve" type="button" disabled aria-describedby="status">Подтвердить и позвонить</button><button class="button secondary" id="deny" type="button" disabled aria-describedby="status">Отказать</button></div>
        <p class="status" id="status" role="status" aria-live="polite">Ожидаем защищённое подтверждение TalkHint…</p>
        <section class="result" id="taskResult" hidden aria-live="polite"><p class="result-title" id="resultTitle"></p><p class="result-copy" id="resultCopy"></p><button class="button secondary check" id="checkStatus" type="button" hidden>Проверить статус задачи</button></section>
        <section class="monitor" id="monitor" hidden aria-labelledby="monitorTitle">
          <div class="monitor-head"><h2 class="monitor-title" id="monitorTitle">Наблюдение за вызовом</h2><p class="monitor-copy">Плеер слышите вы. ChatGPT получает реплики текстом только по отдельному запросу — не звук плеера.</p>
            <div class="consent">Мониторинг запрашивает доступ к тексту разговора и аудио через подключение TalkHint. ChatGPT может один раз попросить разрешения для областей calls:listen и calls:transcript. Аудио включится только после кнопки «Слушать и показать реплики».</div>
          </div>
          <div class="monitor-actions"><button class="button" id="listenButton" type="button" disabled>Слушать и показать реплики</button><button class="button secondary" id="reconnectButton" type="button" disabled>Переподключить</button></div>
          <p class="host-state" id="monitorState" role="status" aria-live="polite">Мониторинг ещё не запрашивался.</p>
          <div class="transcript" id="transcript" aria-live="polite"></div>
        </section>
        <p class="compat" id="compat" hidden></p>
        <p class="fallback" id="fallback" hidden><span id="fallbackCopy"></span><br><a id="fallbackLink" href="#" target="_blank" rel="noopener noreferrer">Открыть защищённую страницу TalkHint</a></p>
      </div>
    </article></main>
    <footer class="footer">Подтверждение и мониторинг относятся только к этому запросу TalkHint.</footer>
  </div>
  <script>
  (() => {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const approveButton = $("approve"), denyButton = $("deny"), statusNode = $("status"), compatNode = $("compat"), resultNode = $("taskResult");
    let sequence = 0, initialized = false, standardAvailable = false, fallbackAvailable = false, requestCounter = 0;
    const pending = new Map();
    let current = null, decisionLocked = false, taskId = null, taskFallbackUrl = "", checking = false;
    let monitorTicket = null, monitorAbort = null, streamActive = false, streamSequence = 0, listening = false, audioContext = null, terminalTask = false, audioUnavailable = false, audioNeedsGesture = false;
    let monitorRequestSequence = 0, monitorRequestPending = false;
    let taskVerified = false, restoreBootstrapped = false;
    let scheduledSources = [], audioNextAt = { secretary: 0, guest: 0 };
    const turns = new Map();
    function setStatus(message, kind) { statusNode.textContent = message; statusNode.className = "status" + (kind ? " " + kind : ""); statusNode.hidden = !message; }
    function setMonitorState(message, error) { const node = $("monitorState"); node.textContent = message; node.className = "host-state" + (error ? " error" : ""); }
    function valueText(value) { if (typeof value === "string") return value.trim(); if (typeof value === "number" && Number.isFinite(value)) return String(value); return ""; }
    function putValue(id, value, fallback) { const node = $(id), text = valueText(value) || fallback; node.textContent = text; node.classList.toggle("empty", text === fallback); }
    function plainRecord(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
    function readCard(structured, metadata) {
      const data = plainRecord(structured), meta = plainRecord(metadata), approval = plainRecord(meta && meta["talkhint/cardApproval"]);
      const call = plainRecord(approval && approval.call) || plainRecord(data && data.call);
      if (!call) return null;
      return { call, execution: plainRecord(approval && approval.execution) || plainRecord(data.execution),
        confirmation: valueText(approval && approval.confirmation), approvalToken: typeof (approval && approval.approvalToken) === "string" ? approval.approvalToken : "", expiresAt: data.expiresAt };
    }
    function safeHttps(value) { try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch (_) { return ""; } }
    function safeTaskFallback(value, id) {
      const safe = safeHttps(value); if (!safe) return "";
      try {
        const parts = new URL(safe).pathname.split("/").filter(Boolean);
        return parts.length >= 2 && parts[parts.length - 2] === "tasks" && decodeURIComponent(parts[parts.length - 1]) === id ? safe : "";
      } catch (_) { return ""; }
    }
    function showFallback(url, message, label) {
      const safe = safeHttps(url); if (!safe) return;
      $("fallbackLink").href = safe;
      $("fallbackCopy").textContent = message || "Откройте защищённую страницу TalkHint для этого же запроса.";
      $("fallbackLink").textContent = label || "Открыть защищённую страницу TalkHint";
      $("fallback").hidden = false;
    }
    function terminalStatus(value) { return ["completed", "no_answer", "busy", "failed", "unknown", "cancelled"].includes(valueText(value).toLowerCase()); }
    function markTerminal(status) {
      terminalTask = true; monitorTicket = null; streamActive = false; stopAudio();
      if (monitorAbort) { try { monitorAbort.abort(); } catch (_) {} monitorAbort = null; }
      streamSequence++; $("listenButton").disabled = true; $("listenButton").textContent = "Задача завершена";
      $("reconnectButton").disabled = true; $("listenButton").disabled = true; $("checkStatus").disabled = true;
      setMonitorState("Задача завершена (" + valueText(status) + "). Показан сохранённый результат; переподключение больше не требуется.");
    }
    function revealCard(card) {
      if (taskId) return; // A replayed prepare result must never replace a restored task.
      if (current && current.confirmation === card.confirmation && decisionLocked) return;
      sequence++; current = card; decisionLocked = false; taskId = null; taskFallbackUrl = ""; checking = false; monitorTicket = null; terminalTask = false;
      monitorRequestSequence++; monitorRequestPending = false; audioUnavailable = false; audioNeedsGesture = false; stopStream(); clearTranscript();
      $("cardContainer").classList.toggle("started", false); $("callSummary").hidden = true;
      approveButton.disabled = true; denyButton.disabled = true; resultNode.hidden = true; $("checkStatus").hidden = true; $("monitor").hidden = true; $("reconnectButton").disabled = true; $("listenButton").disabled = true; $("fallback").hidden = true; compatNode.hidden = true;
      putValue("recipient", card.call.recipient, "Получатель не указан"); putValue("phoneNumber", card.call.phoneNumber, "Номер не указан"); putValue("instruction", card.call.instruction || card.call.goal, "Цель не указана");
      const expiry = valueText(card.expiresAt); $("expiry").textContent = expiry ? "Запрос действует до: " + expiry : ""; $("expiry").hidden = !expiry;
      const execution = card.execution;
      $("execution").textContent = execution
        ? valueText(execution.model) + " · " + (execution.voice === "owner_clone" ? "Ваш клон голоса" : valueText(execution.voice)) + " · " + valueText(execution.provider)
        : "Модель не передана. Обновите подключение TalkHint в ChatGPT.";
      if (expireCardIfNeeded(card)) return;
      if (expiry) window.setTimeout(() => { if (current === card && !decisionLocked) expireCardIfNeeded(card); },
        Math.max(0, Math.min(2147483647, Date.parse(expiry) - Date.now())));
      if (!card.confirmation || !card.approvalToken) { setStatus("Не удалось получить защищённые данные подтверждения. Не подтверждайте этот вызов.", "error"); compatNode.textContent = "Откройте запрос из TalkHint ещё раз. Токены не нужно вводить или пересылать вручную."; compatNode.hidden = false; return; }
      if (standardAvailable || fallbackAvailable) { approveButton.disabled = false; denyButton.disabled = false; setStatus("Проверьте получателя, номер и цель перед подтверждением."); }
      else { setStatus("Подтверждение недоступно в этом окне.", "error"); compatNode.textContent = "Этот клиент не подтвердил поддержку интерактивной карточки. Обновите подключение и проверьте его в ChatGPT web с поддержкой MCP Apps. Ничего не будет набрано; сайт и текстовое «да» не заменяют кнопку."; compatNode.hidden = false; }
    }
    function expireCardIfNeeded(card) {
      const expires = Date.parse(valueText(card.expiresAt));
      if (!Number.isFinite(expires) || expires > Date.now()) return false;
      decisionLocked = true; approveButton.disabled = true; denyButton.disabled = true;
      setStatus("Подтверждение истекло. Сначала проверьте существующую задачу, затем попросите новую карточку того же поручения с тем же clientRequestId. Эта карточка не запускает новый звонок.", "error");
      return true;
    }
    function sendNotification(method, params) { if (!standardAvailable) return false; try { window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*"); return true; } catch (_) { return false; } }
    let lastReportedHeight = 0;
    function reportSize() {
      const height = Math.min(1600, Math.ceil(document.body && document.body.scrollHeight || 0));
      if (!height || height === lastReportedHeight || !standardAvailable) return;
      lastReportedHeight = height;
      sendNotification("ui/notifications/size-changed", { height });
    }
    if (typeof window.ResizeObserver === "function" && document.body)
      new window.ResizeObserver(reportSize).observe(document.body);
    function standardRequest(method, params) {
      return new Promise((resolve, reject) => {
        if (!standardAvailable) { reject(new Error("bridge unavailable")); return; }
        const id = "talkhint-" + (++requestCounter), timer = window.setTimeout(() => { pending.delete(id); reject(new Error("bridge timeout")); }, 30000);
        pending.set(id, { resolve, reject, timer });
        try { window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*"); }
        catch (error) { window.clearTimeout(timer); pending.delete(id); reject(error); }
      });
    }
    function assertToolSuccess(response) {
      const envelope = plainRecord(response) || {}, metadata = plainRecord(envelope.toolResponseMetadata);
      const candidates = [envelope, plainRecord(envelope.result), plainRecord(metadata && metadata.mcp_tool_result), plainRecord(metadata && metadata.call_tool_result)];
      const failed = candidates.find(candidate => candidate && (candidate.isError || candidate.error));
      if (failed) {
        const error = new Error("tool error");
        error.approvalRejected = !!(failed.structuredContent &&
          failed.structuredContent.code === "CALL_APPROVAL_REJECTED" &&
          failed.structuredContent.requestNotStarted === true);
        throw error;
      }
      return response || {};
    }
    async function callToolEnvelope(name, args) {
      if (standardAvailable) return assertToolSuccess(await standardRequest("tools/call", { name, arguments: args }));
      const openai = window.openai;
      if (!fallbackAvailable || !openai || typeof openai.callTool !== "function") throw new Error("bridge unavailable");
      return assertToolSuccess(await openai.callTool(name, args));
    }
    function responseContent(response) {
      const envelope = plainRecord(response) || {};
      const toolMetadata = plainRecord(envelope.toolResponseMetadata);
      const mcpResult = plainRecord(toolMetadata && toolMetadata.mcp_tool_result);
      const callResult = plainRecord(toolMetadata && toolMetadata.call_tool_result);
      const documented = mcpResult || callResult;
      const nested = plainRecord(envelope.result) || documented || envelope;
      const structured = plainRecord(nested.structuredContent) || plainRecord(nested.toolOutput && nested.toolOutput.structuredContent) ||
        plainRecord(mcpResult && mcpResult.structuredContent) || plainRecord(callResult && callResult.structuredContent) ||
        plainRecord(nested.toolOutput) || plainRecord(envelope.structuredContent) || plainRecord(envelope.toolOutput && envelope.toolOutput.structuredContent) ||
        plainRecord(envelope.toolOutput) || {};
      const meta = plainRecord(nested._meta) || plainRecord(nested.toolResponseMetadata && nested.toolResponseMetadata._meta) ||
        plainRecord(mcpResult && mcpResult._meta) || plainRecord(callResult && callResult._meta) ||
        plainRecord(envelope._meta) ||
        plainRecord(toolMetadata && toolMetadata._meta) || {};
      return { structured, meta };
    }
    async function callTool(name, args) { const result = responseContent(await callToolEnvelope(name, args)); return result.structured; }
    function sendAssistantMessage(id) {
      const text = "Получите результат задачи TalkHint вызовом get_task только для task_id " + id + ". Не создавайте и не запускайте новый вызов.";
      if (standardAvailable) { standardRequest("ui/message", { content: [{ type: "text", text }] }).catch(() => {}); return; }
      const openai = window.openai;
      if (fallbackAvailable && openai && typeof openai.sendFollowUpMessage === "function") { try { openai.sendFollowUpMessage({ prompt: text }); } catch (_) {} }
    }
    function validTaskId(value) { return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value); }
    function summaryText(task) {
      return [...new Set([task && task.summary, task && task.outcome, task && (task.next_step || task.nextStep)]
        .map(valueText).filter(Boolean))].join(" · ").slice(0, 1500);
    }
    function rememberTask(id) {
      // Host state is only an untrusted locator, never an authority or credential store.
      const host = window.openai;
      if (host && typeof host.setWidgetState === "function") {
        try { host.setWidgetState({ version: 1, task_id: id }); return; } catch (_) {}
      }
      compatNode.textContent = "Это окно не сохранило состояние карточки. Чтобы вернуться к задаче, попросите ChatGPT вызвать get_task для task_id " + id + ". Не подготавливайте новый вызов.";
      compatNode.hidden = false;
    }
    function savedTaskId() {
      const state = plainRecord(window.openai && window.openai.widgetState);
      return state && state.version === 1 && validTaskId(state.task_id) ? state.task_id : null;
    }
    function hideTaskData() {
      taskVerified = false; terminalTask = false; monitorTicket = null; taskFallbackUrl = "";
      current = null;
      ["recipient", "phoneNumber", "instruction", "execution"].forEach(id => { $(id).textContent = ""; });
      monitorRequestSequence++; monitorRequestPending = false; stopStream(); clearTranscript();
      $("resultCopy").textContent = ""; $("callSummary").textContent = ""; $("callSummary").hidden = true;
      $("fallback").hidden = true; $("fallbackLink").href = "#"; $("fallbackCopy").textContent = "";
      $("monitor").hidden = true; $("listenButton").disabled = true; $("reconnectButton").disabled = true;
    }
    function restoreTask(id) {
      if (!validTaskId(id) || taskId === id) return;
      sequence++; current = null; taskId = id; decisionLocked = true; terminalTask = false; checking = false;
      approveButton.disabled = true; denyButton.disabled = true; hideTaskData();
      $("cardContainer").classList.toggle("started", true); resultNode.hidden = false;
      $("resultTitle").textContent = "Восстановление задачи";
      $("checkStatus").hidden = false; $("checkStatus").disabled = false;
      checkTaskStatus();
    }
    function bootstrapRestore() {
      if (restoreBootstrapped) return;
      restoreBootstrapped = true;
      const id = savedTaskId(); if (id) restoreTask(id);
    }
    function receiveTaskResult(structured) {
      const data = plainRecord(structured), task = plainRecord(data && data.task);
      const id = data && (data.task_id || data.id || (task && task.id));
      if (!validTaskId(id)) return false;
      // Historical tool output is a locator too: refetch under the CURRENT account.
      restoreTask(id); return true;
    }
    function showStarted(result, cardSequence, restored) {
      if (sequence !== cardSequence) return;
      const data = plainRecord(result), task = plainRecord(data && data.task), id = data && data.task_id;
      if (!validTaskId(id)) { decisionLocked = true; approveButton.disabled = true; denyButton.disabled = true; setStatus("Не удалось однозначно подтвердить запуск. Не нажимайте кнопку повторно: проверьте задачи TalkHint.", "error"); return; }
      taskId = id; taskVerified = true; rememberTask(id); taskFallbackUrl = safeTaskFallback(data.fallbackUrl, id); decisionLocked = true; approveButton.disabled = true; denyButton.disabled = true; resultNode.hidden = false;
      if (current) current = { call: current.call }; // Drop the consumed approval capability.
      $("cardContainer").classList.toggle("started", true);
      $("callSummary").textContent = [current && current.call.recipient, current && current.call.phoneNumber,
        valueText(current && current.call.instruction).slice(0, 180)].filter(Boolean).join(" · ");
      $("callSummary").hidden = !$("callSummary").textContent;
      $("resultTitle").textContent = (restored ? "Восстановлена задача " : "Запрос принят · задача ") + id;
      const status = valueText(task && task.status) || valueText(data.status) || "Статус пока не предоставлен", summary = summaryText(task);
      $("resultCopy").textContent = "Текущий статус: " + status + (summary ? " · " + summary : "") +
        (terminalStatus(status) ? ". Сохранённый результат." : ". Это не означает, что задача завершена.");
      $("checkStatus").hidden = false; $("monitor").hidden = false; $("listenButton").disabled = false; $("listenButton").textContent = "Слушать и показать реплики";
      $("reconnectButton").disabled = false; setMonitorState("Мониторинг ещё не запрашивался. Он относится только к задаче " + id + ".");
      if (taskFallbackUrl) showFallback(taskFallbackUrl, "Отчёт задачи уже сохранён TalkHint. Эта защищённая страница показывает сохранённый отчёт, а не встроенное live audio.", "Открыть сохранённый отчёт TalkHint");
      if (terminalStatus(status)) {
        markTerminal(status);
        setStatus("Задача уже завершена. Сохранённый результат доступен; мониторинг не требуется.", "success");
      } else setStatus("TalkHint вернул задачу. Мониторинг запускается отдельно, только по вашему запросу.", "success");
      if (!restored) sendAssistantMessage(id);
    }
    function showDenied(cardSequence) {
      if (sequence !== cardSequence) return;
      decisionLocked = true; approveButton.disabled = true; denyButton.disabled = true; resultNode.hidden = false;
      $("resultTitle").textContent = "Вызов не подтверждён"; $("resultCopy").textContent = "Звонок не будет начат по этому запросу."; setStatus("Вы отказали в этом вызове.", "success");
    }
    async function decide(decision) {
      const card = current; if (!card || decisionLocked || approveButton.disabled || denyButton.disabled) return;
      if (expireCardIfNeeded(card)) return;
      decisionLocked = true; const cardSequence = sequence; approveButton.disabled = true; denyButton.disabled = true;
      approveButton.setAttribute("aria-busy", "true"); denyButton.setAttribute("aria-busy", "true");
      setStatus(decision === "approve" ? "Передаём подтверждение в TalkHint…" : "Передаём отказ в TalkHint…");
      try {
        const result = await callTool("confirm_call_from_card", { confirmation: card.confirmation, approvalToken: card.approvalToken, decision });
        if (sequence !== cardSequence) return;
        if (decision === "deny" || result.status === "denied") showDenied(cardSequence); else showStarted(result, cardSequence);
      } catch (error) {
        if (sequence !== cardSequence) return;
        if (error && error.approvalRejected) {
          setStatus("Подтверждение отклонено. Этот запрос не запускал звонок. Можно заново подготовить и подтвердить поручение.", "error");
          compatNode.textContent = "Попросите ChatGPT сначала проверить существующую задачу, затем подготовить новую карточку с тем же clientRequestId: " +
            valueText(card.call && card.call.clientRequestId) +
            ". При необходимости обновите подключение. Уже созданную задачу повторно не запускать.";
          compatNode.hidden = false;
          return;
        }
        setStatus("Не удалось достоверно получить результат. Не нажимайте подтверждение повторно и не набирайте номер: проверьте статус в задачах TalkHint.", "error");
        compatNode.textContent = "Запрос мог быть принят, даже если ответ не дошёл. Повторный запуск не выполняется."; compatNode.hidden = false;
      } finally { if (sequence === cardSequence) { approveButton.removeAttribute("aria-busy"); denyButton.removeAttribute("aria-busy"); } }
    }
    async function checkTaskStatus() {
      const id = taskId, cardSequence = sequence; if (!id || checking) return;
      hideTaskData();
      checking = true; $("checkStatus").disabled = true; $("checkStatus").setAttribute("aria-busy", "true"); setStatus("Запрашиваем сохранённый статус задачи…");
      try {
        const response = responseContent(await callToolEnvelope("get_task", { id }));
        if (sequence !== cardSequence || taskId !== id) return;
        const result = response.structured, metadata = plainRecord(response.meta["talkhint/task"]);
        const task = plainRecord(result && result.task) || result;
        if (!task || task.id !== id) throw new Error("task mismatch");
        showStarted({ task_id: id, task, fallbackUrl: metadata && metadata.fallbackUrl }, cardSequence, true);
        setStatus("Статус задачи обновлён.", "success");
      } catch (_) { if (sequence === cardSequence) {
        hideTaskData(); $("resultTitle").textContent = "Задача недоступна";
        setStatus("Не удалось загрузить задачу. Проверьте подключение и аккаунт TalkHint, затем повторите проверку статуса. Вызов повторно не запускается.", "error");
      } }
      finally { if (sequence === cardSequence) { checking = false; $("checkStatus").disabled = terminalTask; $("checkStatus").removeAttribute("aria-busy"); } }
    }
    function clearTranscript() { turns.clear(); $("transcript").replaceChildren(); }
    function ensureTurn(turnId, role) {
      const key = valueText(turnId); if (!key) return null;
      if (turns.has(key)) return turns.get(key);
      const transcript = $("transcript");
      if (turns.size >= 200) {
        const oldestKey = turns.keys().next().value, oldest = turns.get(oldestKey);
        turns.delete(oldestKey);
        if (oldest && oldest.item.parentNode === transcript) transcript.removeChild(oldest.item);
      }
      const item = document.createElement("article"), meta = document.createElement("div"), label = document.createElement("span"), text = document.createElement("p"), translation = document.createElement("p");
      item.className = "turn"; meta.className = "turn-meta"; label.textContent = role === "guest" ? "Собеседник" : role === "secretary" ? "Секретарь" : "Реплика";
      text.className = "turn-text"; translation.className = "translation"; translation.hidden = true; meta.appendChild(label); item.appendChild(meta); item.appendChild(text); item.appendChild(translation);
      transcript.appendChild(item); const entry = { item, text, translation }; turns.set(key, entry); return entry;
    }
    function addTurn(event) { const entry = ensureTurn(event.turnId, event.role); if (!entry || typeof event.text !== "string") return; entry.text.textContent = event.text; }
    function addSubtitle(event) { const entry = ensureTurn(event.turnId, ""); if (!entry || typeof event.translation !== "string") return; const language = event.language === "ru" ? "Перевод · русский: " : event.language === "es" ? "Traducción · español: " : ""; entry.translation.textContent = language + event.translation; entry.translation.hidden = false; }
    function addSnapshot(task) {
      if (!task || typeof task !== "object") return;
      const status = valueText(task.status) || "обновляется";
      const summary = summaryText(task); $("resultCopy").textContent = "Статус: " + status + (summary ? " · " + summary : "") + ".";
      const list = Array.isArray(task.transcriptTurns) ? task.transcriptTurns : [];
      list.forEach(turn => { if (turn && typeof turn === "object") { addTurn({ turnId: turn.turnId || turn.id, role: turn.role, text: turn.text }); if (typeof turn.translation === "string") addSubtitle({ turnId: turn.turnId || turn.id, translation: turn.translation, language: turn.language }); } });
    }
    function clearScheduledAudio() {
      scheduledSources.forEach(source => { try { source.stop(); } catch (_) {} });
      scheduledSources = []; audioNextAt = { secretary: 0, guest: 0 };
    }
    function stopAudio() {
      listening = false; clearScheduledAudio(); $("listenButton").textContent = "Слушать и показать реплики";
    }
    function stopStream(preserveListening) {
      streamSequence++; streamActive = false;
      if (monitorAbort) { try { monitorAbort.abort(); } catch (_) {} monitorAbort = null; }
      if (preserveListening) clearScheduledAudio(); else stopAudio();
    }
    function decodeMulaw(byte) { const value = (~byte) & 255, sign = value & 128, exponent = (value >> 4) & 7, mantissa = value & 15; let sample = ((mantissa << 3) + 0x84) << exponent; sample -= 0x84; return (sign ? -sample : sample) / 32768; }
    function connectedAudioMessage() {
      if (audioUnavailable) return "Текстовый мониторинг подключён; аудио не поддерживается этим окном.";
      if (audioNeedsGesture) return "Текстовый мониторинг подключён. Нажмите «Слушать и показать реплики» ещё раз, чтобы разрешить аудио.";
      if (audioContext && audioContext.state && audioContext.state !== "running") {
        listening = false; audioNeedsGesture = true; clearScheduledAudio();
        $("listenButton").textContent = "Слушать и показать реплики";
        return "Текстовый мониторинг подключён; аудиоконтекст ещё не активен. Нажмите «Слушать и показать реплики» ещё раз; на iOS может потребоваться новый жест.";
      }
      if (listening) return "Подключено к задаче " + taskId + "; аудио включено по вашему запросу.";
      return "Подключено к задаче " + taskId + ". Текст доступен; аудио выключено.";
    }
    function playAudio(payload, role) {
      if (!listening || !audioContext || (role !== "secretary" && role !== "guest") || typeof payload !== "string") return;
      try {
        const binary = atob(payload); if (!binary.length || binary.length > 16000) return;
        const now = audioContext.currentTime, start = Math.max(now + 0.04, audioNextAt[role] || now + 0.04);
        if (start > now + 2.2 || scheduledSources.length >= 12) return;
        const buffer = audioContext.createBuffer(1, binary.length, 8000), channel = buffer.getChannelData(0);
        for (let i = 0; i < binary.length; i++) channel[i] = decodeMulaw(binary.charCodeAt(i));
        const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination); scheduledSources.push(source);
        source.onended = () => { scheduledSources = scheduledSources.filter(item => item !== source); };
        source.start(start); audioNextAt[role] = start + buffer.duration;
      } catch (_) { /* malformed audio is ignored; no data is logged */ }
    }
    function handleEvent(event, id) {
      if (id !== streamSequence || !event || typeof event !== "object") return;
      if (event.type === "snapshot") {
        addSnapshot(event.task);
        if (terminalStatus(event.task && event.task.status)) markTerminal(event.task.status);
        else setMonitorState(connectedAudioMessage());
      }
      else if (event.type === "turn") addTurn(event);
      else if (event.type === "subtitle") addSubtitle(event);
      else if (event.type === "subtitle_unavailable") setMonitorState("Перевод этой реплики недоступен; исходный текст не изменён.");
      else if (event.type === "audio") playAudio(event.payload, event.role);
      else if (event.type === "status") { setMonitorState("Статус TalkHint: " + valueText(event.status)); if (terminalStatus(event.status)) markTerminal(event.status); }
      else if (event.type === "ended") {
        if (valueText(event.reason).toLowerCase() === "completed") { markTerminal(event.reason); return; }
        stopAudio(); monitorTicket = null; streamActive = false; streamSequence++; if (monitorAbort) { try { monitorAbort.abort(); } catch (_) {} monitorAbort = null; }
        const reason = valueText(event.reason).toLowerCase();
        if (reason === "revoked") hideTaskData();
        const message = reason === "expired" ? "Билет мониторинга истёк; задача не завершена. Переподключитесь вручную, чтобы получить новый билет." :
          reason === "revoked" ? "Разрешение на мониторинг отозвано; задача не завершена. Обновите доступ и проверьте статус задачи перед переподключением." :
          "Поток завершён: " + valueText(event.reason) + ". Задача не отмечена как завершённая; переподключение доступно вручную.";
        setMonitorState(message); $("monitor").hidden = false; $("reconnectButton").disabled = !taskVerified;
      }
    }
    async function readSse(response, id) {
      if (!response.ok || !response.body || typeof response.body.getReader !== "function") throw new Error("stream unavailable");
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
      while (id === streamSequence) {
        const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true });
        const blocks = buffer.split(/\\r?\\n\\r?\\n/); buffer = blocks.pop() || "";
        blocks.forEach(block => { const data = block.split(/\\r?\\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\\n"); if (data) { try { handleEvent(JSON.parse(data), id); } catch (_) {} } });
      }
      if (id === streamSequence && streamActive) { streamActive = false; stopAudio(); setMonitorState("Соединение завершилось. Вызов не запускается повторно; переподключитесь вручную.", true); $("reconnectButton").disabled = false; }
    }
    function monitorMetadata(result, id) {
      const parsed = responseContent(result), data = parsed.structured, meta = parsed.meta, ticket = plainRecord(meta["talkhint/monitor"]);
      const task = valueText(ticket && ticket.task_id), endpoint = safeHttps(ticket && ticket.url), token = ticket && typeof ticket.token === "string" ? ticket.token : "";
      if (!ticket || !endpoint || !token || task !== id) throw new Error("monitor ticket unavailable");
      return { url: endpoint, token, task_id: task, expiresAt: valueText(ticket.expiresAt || data.expiresAt), fallbackUrl: safeTaskFallback(ticket.fallbackUrl, id) };
    }
    async function openMonitorStream(id, preserveTranscript) {
      stopStream(true); const streamId = streamSequence; monitorAbort = new AbortController(); streamActive = true;
      $("listenButton").disabled = false; $("reconnectButton").disabled = false;
      if (!preserveTranscript) clearTranscript();
      setMonitorState("Подключаемся к защищённому потоку…");
      try {
        const response = await fetch(monitorTicket.url, { method: "POST", headers: { Authorization: "Bearer " + monitorTicket.token, "Content-Type": "application/json" }, body: "{}", signal: monitorAbort.signal });
        if (streamId !== streamSequence) return;
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          hideTaskData(); $("resultTitle").textContent = "Задача требует проверки доступа";
          setStatus("Доступ к мониторингу недоступен. Проверьте аккаунт и статус задачи.", "error");
          return;
        }
        await readSse(response, streamId);
      } catch (_) {
        if (streamId !== streamSequence) return;
        streamActive = false; stopAudio(); setMonitorState("Поток недоступен из этого окна. Проверьте разрешения или откройте защищённую страницу TalkHint.", true);
        $("reconnectButton").disabled = false;
        if (monitorTicket && monitorTicket.fallbackUrl) showFallback(monitorTicket.fallbackUrl, "Поток недоступен. Откроется защищённый сохранённый отчёт этой же задачи; это не live audio внутри чата.", "Открыть сохранённый отчёт TalkHint");
      }
    }
    async function requestMonitorTicket(id, preserveTranscript) {
      if (!validTaskId(id) || !taskVerified || terminalTask || monitorRequestPending) return;
      monitorRequestPending = true; const requestSequence = ++monitorRequestSequence;
      const reconnect = $("reconnectButton");
      reconnect.disabled = true; setMonitorState("Запрашиваем мониторинг только для задачи " + id + "…");
      try {
        const response = await callToolEnvelope("open_call_monitor", { id });
        if (taskId !== id || requestSequence !== monitorRequestSequence || !taskVerified || terminalTask) return;
        monitorTicket = monitorMetadata(response, id);
        if (monitorTicket.fallbackUrl) showFallback(monitorTicket.fallbackUrl, "Мониторинг доступен отдельно. Ссылка открывает защищённый отчёт именно этой задачи, а не встраивает live audio.", "Открыть сохранённый отчёт TalkHint");
        if (requestSequence === monitorRequestSequence) monitorRequestPending = false;
        await openMonitorStream(id, preserveTranscript);
      } catch (_) {
        if (taskId !== id || requestSequence !== monitorRequestSequence) return;
        if (listening) stopAudio();
        hideTaskData();
        setMonitorState("Не удалось открыть мониторинг. ChatGPT запрашивает calls:listen и calls:transcript вместе; проверьте доступ и повторите только вручную. Никакой новый вызов не запускается.", true);
        $("monitor").hidden = false;
        setStatus("Проверьте подключение и аккаунт, затем нажмите «Проверить статус задачи».", "error");
      } finally {
        if (requestSequence === monitorRequestSequence) monitorRequestPending = false;
      }
    }
    function reconnectMonitor() { if (!taskId || !taskVerified || terminalTask) return; stopStream(true); monitorTicket = null; requestMonitorTicket(taskId, true); }
    function beginAudioFromGesture() {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) {
        audioUnavailable = true; audioNeedsGesture = false; listening = false;
        $("listenButton").textContent = "Аудио недоступно · реплики";
        setMonitorState("Можно смотреть текстовые реплики; это окно не поддерживает воспроизведение аудио.", true);
        return false;
      }
      try {
        if (!audioContext) audioContext = new AudioCtor();
        const resumed = audioContext.resume();
        listening = true; audioUnavailable = false; audioNeedsGesture = false;
        $("listenButton").textContent = "Выключить звук";
        Promise.resolve(resumed).then(() => {
          if (!listening) return;
          if (audioContext && audioContext.state && audioContext.state !== "running") {
            listening = false; audioNeedsGesture = true; clearScheduledAudio(); $("listenButton").textContent = "Слушать и показать реплики";
            setMonitorState("Текст доступен, но аудиоконтекст не запущен. Нажмите «Слушать и показать реплики» ещё раз; на iOS может потребоваться новый жест.", true);
          } else if (streamActive) setMonitorState(connectedAudioMessage());
        }).catch(() => {
          listening = false; audioNeedsGesture = true; clearScheduledAudio(); $("listenButton").textContent = "Слушать и показать реплики";
          setMonitorState("Текст доступен, но браузер не разрешил аудио. Нажмите «Слушать и показать реплики» ещё раз.", true);
        });
        return true;
      } catch (_) {
        listening = false; audioNeedsGesture = true; $("listenButton").textContent = "Слушать и показать реплики";
        setMonitorState("Текстовый мониторинг возможен, но не удалось запустить аудио. Повторите только по нажатию.", true);
        return false;
      }
    }
    function listenClick() {
      if (listening) { stopAudio(); setMonitorState("Звук выключен; текстовый мониторинг продолжается."); return; }
      if (!taskId || !taskVerified || terminalTask) return;
      beginAudioFromGesture();
      if (!monitorTicket || !streamActive) requestMonitorTicket(taskId, true);
    }
    function initialOpenAiPayload() {
      const openai = window.openai; if (!openai) return;
      bootstrapRestore();
      const output = plainRecord(openai.toolOutput), responseMeta = plainRecord(openai.toolResponseMetadata), full = plainRecord(responseMeta && (responseMeta.mcp_tool_result || responseMeta.call_tool_result));
      const metadata = plainRecord(full && full._meta) || plainRecord(responseMeta && responseMeta._meta) || responseMeta || plainRecord(output && output._meta);
      const structured = plainRecord(output && output.structuredContent) || output;
      if (receiveTaskResult(structured)) return;
      if (structured && metadata) { const card = readCard(structured, metadata); if (card) revealCard(card); }
    }
    function onMessage(event) {
      if (event.source !== window.parent || !event.data || event.data.jsonrpc !== "2.0") return;
      const message = event.data;
      if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); window.clearTimeout(entry.timer); if (message.error) entry.reject(new Error("rpc error")); else entry.resolve(message.result || {}); return; }
      if (message.id === "talkhint-initialize") {
        if (!message.error && message.result) { standardAvailable = true; initialized = true; sendNotification("ui/notifications/initialized", {}); bootstrapRestore(); if (!taskId) { if (current) revealCard(current); else setStatus("Подключён ChatGPT MCP bridge; ожидаем запрос TalkHint."); } reportSize(); }
        return;
      }
      if (message.method === "ui/notifications/tool-result") { const params = plainRecord(message.params); if (!params) return; if (receiveTaskResult(params.structuredContent)) return; const card = readCard(params.structuredContent, params._meta); if (card) revealCard(card); }
    }
    approveButton.addEventListener("click", () => decide("approve")); denyButton.addEventListener("click", () => decide("deny"));
    $("checkStatus").addEventListener("click", checkTaskStatus);
    $("reconnectButton").addEventListener("click", reconnectMonitor); $("listenButton").addEventListener("click", listenClick);
    $("fallbackLink").addEventListener("click", event => {
      const url = safeHttps($("fallbackLink").href); if (!url) { event.preventDefault(); return; }
      if (standardAvailable) { event.preventDefault(); standardRequest("ui/open-link", { url }).catch(() => {}); return; }
      const openai = window.openai;
      if (openai && typeof openai.openExternal === "function") {
        event.preventDefault(); try { openai.openExternal({ url }); } catch (_) {}
      }
    });
    function suspendTask() {
      sequence++; checking = false;
      if (taskId) {
        hideTaskData(); $("resultTitle").textContent = "Задача требует проверки доступа";
        $("checkStatus").disabled = false;
      } else stopStream();
      if (audioContext) { try { audioContext.close(); } catch (_) {} audioContext = null; }
    }
    function resumeTask() { if (taskId && !taskVerified && !checking && (standardAvailable || fallbackAvailable)) checkTaskStatus(); }
    window.addEventListener("message", onMessage);
    window.addEventListener("pagehide", suspendTask); window.addEventListener("pageshow", resumeTask);
    if (typeof document.addEventListener === "function") document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") suspendTask(); else resumeTask();
    });
    try { if (window.parent !== window && typeof window.parent.postMessage === "function") window.parent.postMessage({ jsonrpc: "2.0", id: "talkhint-initialize", method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "talkhint-call-approval", version: "1.0.0" }, appCapabilities: {} } }, "*"); } catch (_) {}
    window.setTimeout(() => {
      if (initialized) return;
      const openai = window.openai; fallbackAvailable = !!(openai && typeof openai.callTool === "function");
      if (fallbackAvailable) { initialOpenAiPayload(); if (current && current.confirmation && current.approvalToken && !decisionLocked && !expireCardIfNeeded(current)) { approveButton.disabled = false; denyButton.disabled = false; setStatus("Обнаружен ChatGPT tool bridge. Проверьте получателя, номер и цель."); } }
      else if (current) { approveButton.disabled = true; denyButton.disabled = true; setStatus("Подтверждение недоступно в этом окне.", "error"); compatNode.textContent = "Диагностика: ChatGPT tool bridge не обнаружен. Обновите метаданные подключения и проверьте карточку в ChatGPT web с поддержкой MCP Apps. Поддержка iPhone не подтверждена. Переход на сайт и текстовое «да» не заменяют карточку."; compatNode.hidden = false; }
      else { setStatus("Не удалось установить защищённое соединение с TalkHint.", "error"); compatNode.textContent = "Откройте запрос в поддерживаемом окне ChatGPT. Не передавайте токены."; compatNode.hidden = false; }
    }, 900);
  })();
  </script>
</body>
</html>`;
}
