export const CALL_APPROVAL_RESOURCE = "ui://talkhint/call-approval/v1.html";

export function callApprovalWidgetHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>Подтверждение вызова · TalkHint</title>
  <style>
    :root{color-scheme:light;--ink:#17274b;--muted:#586985;--blue:#315fca;--blue-dark:#234aa8;--violet:#6856c8;--line:#d7e0f0;--paper:#f4f7fc;--surface:#fff;--soft:#edf2fb;--danger:#a33749;--focus:#8b79ef}
    *{box-sizing:border-box}
    html{min-height:100%;background:var(--paper)}
    body{margin:0;min-height:100dvh;color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.55;background:radial-gradient(ellipse at 85% 0%,#e8eafe 0,transparent 38%),var(--paper)}
    .page{min-height:100dvh;display:flex;flex-direction:column;padding:clamp(16px,4vw,34px) 14px 20px}
    .top,main,.footer{width:100%;max-width:620px;margin-left:auto;margin-right:auto}
    .top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}
    .brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink);font-weight:760;letter-spacing:-.035em;font-size:19px}
    .mark{width:32px;height:32px;border-radius:11px;background:linear-gradient(145deg,var(--blue),var(--violet));position:relative;box-shadow:0 5px 12px #485fc333;flex:none}
    .mark:before,.mark:after{content:"";position:absolute;background:#fff;border-radius:3px;transform:rotate(-35deg)}
    .mark:before{width:4px;height:17px;left:10px;top:8px}.mark:after{width:4px;height:12px;left:18px;top:10px}
    .top-note{color:var(--muted);font-size:13px;text-align:right}
    main{flex:1}
    .card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:clamp(20px,5vw,32px);box-shadow:0 16px 42px #243f7010}
    .eyebrow{margin:0 0 10px;color:var(--blue);font-weight:750;font-size:12px;letter-spacing:.105em;text-transform:uppercase}
    h1{margin:0;color:var(--ink);font-size:clamp(25px,6vw,32px);line-height:1.16;letter-spacing:-.045em}
    .lede{margin:12px 0 0;color:var(--muted);max-width:55ch}
    .one-call{display:flex;align-items:flex-start;gap:10px;margin:18px 0 0;padding:12px 14px;border:1px solid #dce1ff;border-radius:12px;background:#eff2ff;color:#394375;font-size:14px}
    .one-call strong{display:block;margin-bottom:2px;color:#303b79}
    .shield{display:grid;place-items:center;width:23px;height:23px;flex:none;border-radius:8px;background:#dfdefd;color:#5149ad;font-size:13px;font-weight:800}
    .details{display:grid;gap:10px;margin:22px 0 0}
    .detail{padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:#fbfcff;min-width:0}
    .detail-label{display:block;color:var(--muted);font-size:11px;font-weight:750;letter-spacing:.07em;text-transform:uppercase}
    .detail-value{display:block;margin-top:4px;color:var(--ink);font-weight:620;overflow-wrap:anywhere;white-space:pre-wrap}
    .detail-value.empty{color:#79869d;font-weight:450}
    .expiry{margin:12px 0 0;color:var(--muted);font-size:13px}
    .actions{display:grid;gap:10px;margin-top:22px}
    .button{display:inline-flex;justify-content:center;align-items:center;min-height:49px;width:100%;padding:12px 16px;border:1px solid transparent;border-radius:11px;background:var(--blue);color:#fff;font:inherit;font-weight:730;text-align:center;cursor:pointer;transition:background-color .16s ease,transform .16s ease}
    .button:hover:not(:disabled){background:var(--blue-dark)}
    .button:active:not(:disabled){transform:translateY(1px)}
    .button.deny{background:#fff;border-color:#bdcae0;color:#2b426c}
    .button.deny:hover:not(:disabled){background:#f2f5fc}
    .button:disabled{cursor:not-allowed;opacity:.62}
    .button:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
    .status{min-height:1.5em;margin:15px 0 0;color:#4c5e7d;font-size:14px}
    .status.error{padding:11px 13px;border-radius:10px;background:#fff0f1;color:var(--danger)}
    .status.success{padding:11px 13px;border-radius:10px;background:#edf7f1;color:#23583c}
    .status[hidden],.result[hidden],.compat[hidden]{display:none}
    .result{margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#f8faff}
    .result-title{margin:0;color:var(--ink);font-size:14px;font-weight:750}
    .result-copy{margin:5px 0 0;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
    .check{margin-top:12px;min-height:42px;font-size:14px}
    .compat{margin-top:14px;padding:12px 14px;border-radius:10px;background:#f2f1ff;color:#394375;font-size:14px}
    .footer{margin-top:18px;color:#77849a;font-size:12px;text-align:center}
    @media(min-width:560px){.actions{grid-template-columns:1fr 1fr}.actions .button:first-child{grid-column:1/-1}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <div class="page">
    <header class="top"><span class="brand"><span class="mark" aria-hidden="true"></span><span>TalkHint</span></span><span class="top-note">Ваш телефонный<br>помощник</span></header>
    <main>
      <article class="card" aria-labelledby="title">
        <p class="eyebrow">Подтверждение владельца</p>
        <h1 id="title">Проверьте детали вызова</h1>
        <p class="lede">Вызов начнётся только после вашего выбора. Подтверждение разрешает один этот вызов — ничего не набирается автоматически.</p>
        <div class="one-call"><span class="shield" aria-hidden="true">1</span><span><strong>Один вызов по указанным данным</strong>Номер, задача и настройки ниже заданы сервером и не редактируются здесь.</span></div>
        <section class="details" aria-label="Детали вызова">
          <div class="detail"><span class="detail-label">Получатель</span><span class="detail-value" id="recipient"></span></div>
          <div class="detail"><span class="detail-label">Номер телефона</span><span class="detail-value" id="phoneNumber"></span></div>
          <div class="detail"><span class="detail-label">Что нужно сделать</span><span class="detail-value" id="instruction"></span></div>
          <div class="detail"><span class="detail-label">Голосовой провайдер</span><span class="detail-value" id="voiceProvider"></span></div>
          <div class="detail"><span class="detail-label">Язык перевода</span><span class="detail-value" id="translationLanguage"></span></div>
        </section>
        <p class="expiry" id="expiry" hidden></p>
        <div class="actions">
          <button class="button" id="approve" type="button" disabled aria-describedby="status">Подтвердить и позвонить один раз</button>
          <button class="button deny" id="deny" type="button" disabled aria-describedby="status">Отказать</button>
        </div>
        <p class="status" id="status" role="status" aria-live="polite">Ожидаем защищённое подтверждение от TalkHint…</p>
        <section class="result" id="taskResult" hidden aria-live="polite">
          <p class="result-title" id="resultTitle"></p>
          <p class="result-copy" id="resultCopy"></p>
          <button class="button deny check" id="checkStatus" type="button" hidden>Проверить статус задачи</button>
        </section>
        <p class="compat" id="compat" hidden></p>
      </article>
    </main>
    <footer class="footer">Подтверждение относится только к этому запросу TalkHint.</footer>
  </div>
  <script>
  (() => {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const approveButton = $("approve");
    const denyButton = $("deny");
    const statusNode = $("status");
    const compatNode = $("compat");
    const resultNode = $("taskResult");
    let sequence = 0;
    let initialized = false;
    let standardAvailable = false;
    let fallbackAvailable = false;
    let requestCounter = 0;
    let pending = new Map();
    let current = null;
    let decisionLocked = false;
    let taskId = null;
    let checking = false;

    function setStatus(message, kind) {
      statusNode.textContent = message;
      statusNode.className = "status" + (kind ? " " + kind : "");
      statusNode.hidden = !message;
    }
    function valueText(value) {
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return "";
    }
    function putValue(id, value, fallback) {
      const node = $(id);
      const text = valueText(value) || fallback;
      node.textContent = text;
      node.classList.toggle("empty", text === fallback);
    }
    function plainRecord(value) {
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    }
    function readCard(structured, metadata) {
      const data = plainRecord(structured);
      const meta = plainRecord(metadata);
      const approval = plainRecord(meta && meta["talkhint/cardApproval"]);
      const call = plainRecord(approval && approval.call) || plainRecord(data && data.call);
      const confirmation = valueText(approval && approval.confirmation);
      const approvalToken = typeof (approval && approval.approvalToken) === "string" ? approval.approvalToken : "";
      if (!call) return null;
      return { call, confirmation, approvalToken, expiresAt: data.expiresAt };
    }
    function revealCard(card) {
      // Host replay / rehydration must never unlock a submitted card.
      if (current && current.confirmation === card.confirmation && decisionLocked) return;
      sequence += 1;
      current = card;
      decisionLocked = false;
      taskId = null;
      checking = false;
      approveButton.disabled = true;
      denyButton.disabled = true;
      resultNode.hidden = true;
      $("checkStatus").hidden = true;
      compatNode.hidden = true;
      putValue("recipient", card.call.recipient, "Получатель по номеру");
      putValue("phoneNumber", card.call.phoneNumber, "Не указан");
      putValue("instruction", card.call.instruction || card.call.goal, "Не указана");
      putValue("voiceProvider", card.call.voiceProvider, "Не указан");
      putValue("translationLanguage", card.call.translationLanguage, "Не указан");
      const expiry = valueText(card.expiresAt);
      $("expiry").textContent = expiry ? "Запрос действует до: " + expiry : "";
      $("expiry").hidden = !expiry;
      if (!card.confirmation || !card.approvalToken) {
        setStatus("Не удалось получить защищённые данные подтверждения. Не подтверждайте этот вызов.", "error");
        compatNode.textContent = "Откройте запрос из TalkHint ещё раз. Вводить или пересылать токены вручную не нужно.";
        compatNode.hidden = false;
        return;
      }
      if (standardAvailable || fallbackAvailable) {
        approveButton.disabled = false;
        denyButton.disabled = false;
        setStatus("Проверьте все детали, затем выберите действие.");
      } else {
        setStatus("Подтверждение недоступно в этом окне.", "error");
        compatNode.textContent = "Откройте этот запрос в поддерживаемом окне ChatGPT с подключённым TalkHint. Внешняя страница для подтверждения не используется.";
        compatNode.hidden = false;
      }
    }
    function sendNotification(method, params) {
      if (!standardAvailable) return false;
      try {
        window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
        return true;
      } catch (_) { return false; }
    }
    function standardRequest(method, params) {
      return new Promise((resolve, reject) => {
        if (!standardAvailable) { reject(new Error("bridge unavailable")); return; }
        const id = "talkhint-" + (++requestCounter);
        const timer = window.setTimeout(() => {
          pending.delete(id);
          reject(new Error("bridge timeout"));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        try {
          window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
        } catch (error) {
          window.clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    }
    function responseResult(response) {
      if (response && response.isError) throw new Error("tool error");
      if (response && response.error) throw new Error("rpc error");
      return response && response.structuredContent ? response.structuredContent : {};
    }
    async function callTool(name, args) {
      if (standardAvailable) {
        return responseResult(await standardRequest("tools/call", { name, arguments: args }));
      }
      const openai = window.openai;
      if (!fallbackAvailable || !openai || typeof openai.callTool !== "function") throw new Error("bridge unavailable");
      const response = await openai.callTool(name, args);
      if (response && response.isError) throw new Error("tool error");
      const output = response && (response.structuredContent || response.toolOutput || response);
      return plainRecord(output) || {};
    }
    function sendAssistantMessage(id) {
      const text = "Получите результат задачи TalkHint вызовом get_task только для task_id " + id + ". Не создавайте и не запускайте новый вызов.";
      if (standardAvailable) {
        standardRequest("ui/message", { content: [{ type: "text", text }] }).catch(() => {});
        return;
      }
      const openai = window.openai;
      if (!standardAvailable && fallbackAvailable && openai && typeof openai.sendFollowUpMessage === "function") {
        try { openai.sendFollowUpMessage({ prompt: text }); } catch (_) {}
      }
    }
    function validTaskId(value) {
      return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
    }
    function summaryText(task) {
      const value = task && (task.summary || task.next_step || task.nextStep);
      return valueText(value).slice(0, 500);
    }
    function showStarted(result, cardSequence) {
      if (sequence !== cardSequence) return;
      const data = plainRecord(result);
      const task = plainRecord(data && data.task);
      const id = data && data.task_id;
      if (!validTaskId(id)) {
        decisionLocked = true;
        approveButton.disabled = true;
        denyButton.disabled = true;
        setStatus("Не удалось однозначно подтвердить запуск. Не нажимайте кнопку повторно: проверьте задачи TalkHint.", "error");
        return;
      }
      taskId = id;
      decisionLocked = true;
      approveButton.disabled = true;
      denyButton.disabled = true;
      resultNode.hidden = false;
      $("resultTitle").textContent = "Запрос принят · задача " + id;
      const status = valueText(task && task.status) || valueText(data.status) || "Статус пока не предоставлен";
      const summary = summaryText(task);
      $("resultCopy").textContent = "Текущий статус: " + status + (summary ? " · " + summary : "") + ". Это не означает, что задача завершена.";
      $("checkStatus").hidden = false;
      setStatus("TalkHint вернул задачу. Для актуального результата можно отдельно проверить её статус.", "success");
      sendAssistantMessage(id);
    }
    function showDenied(cardSequence) {
      if (sequence !== cardSequence) return;
      decisionLocked = true;
      approveButton.disabled = true;
      denyButton.disabled = true;
      resultNode.hidden = false;
      $("resultTitle").textContent = "Вызов не подтверждён";
      $("resultCopy").textContent = "Звонок не будет начат по этому запросу.";
      setStatus("Вы отказали в этом вызове.", "success");
    }
    async function decide(decision) {
      const card = current;
      if (!card || decisionLocked || approveButton.disabled || denyButton.disabled) return;
      decisionLocked = true;
      const cardSequence = sequence;
      approveButton.disabled = true;
      denyButton.disabled = true;
      approveButton.setAttribute("aria-busy", "true");
      denyButton.setAttribute("aria-busy", "true");
      setStatus(decision === "approve" ? "Передаём подтверждение в TalkHint…" : "Передаём отказ в TalkHint…");
      try {
        const result = await callTool("confirm_call_from_card", {
          confirmation: card.confirmation,
          approvalToken: card.approvalToken,
          decision
        });
        if (sequence !== cardSequence) return;
        if (decision === "deny" || result.status === "denied") {
          showDenied(cardSequence);
        } else {
          showStarted(result, cardSequence);
        }
      } catch (_) {
        if (sequence !== cardSequence) return;
        setStatus("Не удалось достоверно получить результат. Не нажимайте подтверждение повторно и не набирайте номер: проверьте статус в задачах TalkHint.", "error");
        compatNode.textContent = "Запрос мог быть принят, даже если ответ не дошёл. Повторный запуск не выполняется.";
        compatNode.hidden = false;
      } finally {
        if (sequence === cardSequence) {
          approveButton.removeAttribute("aria-busy");
          denyButton.removeAttribute("aria-busy");
        }
      }
    }
    async function checkTaskStatus() {
      const id = taskId;
      const cardSequence = sequence;
      if (!id || checking) return;
      checking = true;
      $("checkStatus").disabled = true;
      $("checkStatus").setAttribute("aria-busy", "true");
      setStatus("Запрашиваем сохранённый статус задачи…");
      try {
        const result = await callTool("get_task", { id });
        if (sequence !== cardSequence || taskId !== id) return;
        const task = plainRecord(result && result.task) || result;
        const status = valueText(task.status) || valueText(result.status) || "Статус не предоставлен";
        const summary = summaryText(task);
        $("resultCopy").textContent = "Текущий статус: " + status + (summary ? " · " + summary : "") + ".";
        setStatus("Статус задачи обновлён.", "success");
      } catch (_) {
        if (sequence === cardSequence) setStatus("Не удалось загрузить статус. Вызов повторно не запускается.", "error");
      } finally {
        if (sequence === cardSequence) {
          checking = false;
          $("checkStatus").disabled = false;
          $("checkStatus").removeAttribute("aria-busy");
        }
      }
    }
    function initialOpenAiPayload() {
      const openai = window.openai;
      if (!openai) return;
      const output = plainRecord(openai.toolOutput);
      const responseMeta = plainRecord(openai.toolResponseMetadata);
      const full = plainRecord(responseMeta && (responseMeta.mcp_tool_result || responseMeta.call_tool_result));
      const metadata = plainRecord(full && full._meta) || plainRecord(responseMeta && responseMeta._meta) ||
        responseMeta || plainRecord(output && output._meta);
      const structured = plainRecord(output && output.structuredContent) || output;
      if (structured && metadata) {
        const card = readCard(structured, metadata);
        if (card) revealCard(card);
      }
    }
    function onMessage(event) {
      if (event.source !== window.parent || !event.data || event.data.jsonrpc !== "2.0") return;
      const message = event.data;
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        window.clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error("rpc error"));
        else entry.resolve(message.result || {});
        return;
      }
      if (message.id === "talkhint-initialize") {
        if (!message.error && message.result) {
          standardAvailable = true;
          initialized = true;
          sendNotification("ui/notifications/initialized", {});
          if (current) revealCard(current);
          else setStatus("Ожидаем запрос подтверждения TalkHint…");
        }
        return;
      }
      if (!message.method) return;
      if (message.method === "ui/notifications/tool-result") {
        const params = plainRecord(message.params);
        if (!params) return;
        const card = readCard(params.structuredContent, params._meta);
        if (card) revealCard(card);
      }
    }
    approveButton.addEventListener("click", () => decide("approve"));
    denyButton.addEventListener("click", () => decide("deny"));
    $("checkStatus").addEventListener("click", checkTaskStatus);
    window.addEventListener("message", onMessage);
    try {
      if (window.parent !== window && typeof window.parent.postMessage === "function") {
        window.parent.postMessage({
          jsonrpc: "2.0",
          id: "talkhint-initialize",
          method: "ui/initialize",
          params: {
            protocolVersion: "2026-01-26",
            appInfo: { name: "talkhint-call-approval", version: "1.0.0" },
            appCapabilities: {}
          }
        }, "*");
      }
    } catch (_) {}
    window.setTimeout(() => {
      if (initialized) return;
      const openai = window.openai;
      fallbackAvailable = !!(openai && typeof openai.callTool === "function");
      if (fallbackAvailable) {
        initialOpenAiPayload();
        if (current && current.confirmation && current.approvalToken) {
          approveButton.disabled = false;
          denyButton.disabled = false;
          setStatus("Проверьте все детали, затем выберите действие.");
        }
      } else if (current) {
        approveButton.disabled = true;
        denyButton.disabled = true;
        setStatus("Подтверждение недоступно в этом окне.", "error");
        compatNode.textContent = "Откройте этот запрос в поддерживаемом окне ChatGPT с подключённым TalkHint. Внешняя страница для подтверждения не используется.";
        compatNode.hidden = false;
      } else {
        setStatus("Не удалось установить защищённое соединение с TalkHint.", "error");
        compatNode.textContent = "Откройте запрос в поддерживаемом окне ChatGPT. Не передавайте токен и не переходите на внешнюю страницу.";
        compatNode.hidden = false;
      }
    }, 900);
  })();
  </script>
</body>
</html>`;
}
