export const labControlPage = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light">
<title>Лаборатория Hint · TalkHint</title>
<style>
:root{color-scheme:light;--ink:#183b3b;--muted:#597270;--paper:#f2f5ed;--card:#fffef8;--line:#d6e0d7;--teal:#17645f;--teal-dark:#104b48;--coral:#b54c37;--amber:#8c641c;--shadow:0 14px 40px rgba(24,59,59,.08)}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:radial-gradient(ellipse at 92% 0%,#dfeae0 0,transparent 34rem),var(--paper);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(100% - 32px,760px);margin:0 auto;padding:25px 0 44px}
.topline{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:20px;border-bottom:1px solid var(--line)}
.brand{font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--teal)}
.private{font-size:12px;color:var(--muted);letter-spacing:.03em}
header{padding:27px 0 20px}
.eyebrow{margin:0 0 8px;color:var(--coral);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0;font-size:clamp(30px,8vw,46px);line-height:1.04;letter-spacing:-.045em;font-weight:780}
.intro{max-width:610px;margin:13px 0 0;color:var(--muted);font-size:15px}
.status-card,.section{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}
.status-card{padding:19px;margin:8px 0 16px}
.status-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.status-head h2,.section h2{margin:0;font-size:17px;letter-spacing:-.02em}
.badge{display:inline-flex;align-items:center;gap:7px;border-radius:999px;background:#e9eee8;padding:6px 10px;color:var(--muted);font-size:12px;font-weight:750;white-space:nowrap}
.badge:before{content:"";width:7px;height:7px;border-radius:50%;background:#82938a}
.badge.good{background:#e1f0e8;color:#246044}.badge.good:before{background:#368359}
.badge.bad{background:#f8e8e2;color:#8e3627}.badge.bad:before{background:var(--coral)}
.badge.warn{background:#f4edda;color:#795716}.badge.warn:before{background:#b1842f}
.summary{margin:13px 0 0;font-size:15px;font-weight:650}
.detail{margin:4px 0 0;color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}
.fact{min-height:72px;padding:11px 12px;border:1px solid var(--line);border-radius:12px;background:#fbfcf7}
.fact-label{display:block;color:var(--muted);font-size:11px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
.fact-value{display:block;margin-top:4px;font-size:14px;font-weight:700;overflow-wrap:anywhere}
.section{padding:19px;margin-top:14px}
.section p{margin:8px 0 0;color:var(--muted);font-size:14px}
.actions{display:grid;grid-template-columns:1fr;gap:9px;margin-top:17px}
button{min-height:48px;border:0;border-radius:12px;padding:12px 16px;font:inherit;font-size:14px;font-weight:760;cursor:pointer;transition:transform .16s ease,opacity .16s ease}
button:active{transform:translateY(1px)}
button:disabled{opacity:.48;cursor:not-allowed}
.primary{background:var(--teal);color:#fff}.primary:hover:not(:disabled){background:var(--teal-dark)}
.secondary{background:#e7eee7;color:var(--teal-dark);border:1px solid #ccdad0}
.stop{background:#f5e8e2;color:#8c3929;border:1px solid #ead0c6}
.auth{display:none;margin:13px 0 0;padding:12px;border-radius:11px;background:#f8e8e2;color:#78362a;font-size:14px}
.auth a{color:inherit;font-weight:800}
.footnote{margin:16px 4px 0;color:var(--muted);font-size:12px}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(min-width:600px){main{padding-top:34px}.status-card,.section{padding:23px}.actions{grid-template-columns:1fr 1fr 1fr}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<main>
  <div class="topline"><span class="brand">TalkHint <span aria-hidden="true">/</span> Hint lab</span><span class="private">Закрытая страница владельца</span></div>
  <header>
    <p class="eyebrow">Подготовка без запуска</p>
    <h1>Контроль лаборатории Hint</h1>
    <p class="intro">Сначала проверьте готовность и доставку отчёта. Проверка не включает обработку звонков и не отправляет письма.</p>
  </header>
  <section class="status-card" aria-labelledby="status-title">
    <div class="status-head"><h2 id="status-title">Текущее состояние</h2><span id="overall-badge" class="badge">Загрузка</span></div>
    <p id="summary" class="summary" aria-live="polite">Получаем закрытый статус лаборатории…</p>
    <p id="status-detail" class="detail"></p>
    <div class="facts">
      <div class="fact"><span class="fact-label">Ресурсы</span><span id="resources" class="fact-value">Неизвестно</span></div>
      <div class="fact"><span class="fact-label">Контроль владельца</span><span id="control" class="fact-value">Неизвестно</span></div>
      <div class="fact"><span class="fact-label">Основные флаги</span><span id="flags" class="fact-value">Неизвестно</span></div>
      <div class="fact"><span class="fact-label">Наблюдатель</span><span id="watchdog" class="fact-value">Не проверен</span></div>
    </div>
    <p id="auth-help" class="auth">Доступ не подтверждён. <a href="/admin/login">Войти в TalkHint</a></p>
  </section>
  <section class="section" aria-labelledby="actions-title">
    <h2 id="actions-title">Действия владельца</h2>
    <p>Подготовка только выполняет read-only проверки и создаёт или обновляет остановленную привязку. Включение — отдельное явное действие.</p>
    <div class="actions">
      <button id="readiness" class="secondary" type="button">Проверить готовность</button>
      <button id="enable" class="primary" type="button" disabled>Включить Hint: разбор, дежурный, отчёт 08:00</button>
      <button id="disable" class="stop" type="button" disabled>Остановить контур Hint</button>
    </div>
    <p id="action-message" class="detail" role="status" aria-live="polite"></p>
  </section>
  <p class="footnote">После включения обрабатываются только новые звонки TalkHint Hint владельца. Это не относится к Secretary или Translator; старые звонки не переигрываются. Готовность ресурсов и активное состояние — разные вещи. Успешное включение само по себе не подтверждает, что наблюдатель сейчас свежий.</p>
</main>
<script>
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const els = {
    badge: $("overall-badge"), summary: $("summary"), detail: $("status-detail"),
    resources: $("resources"), control: $("control"), flags: $("flags"), watchdog: $("watchdog"),
    auth: $("auth-help"), readiness: $("readiness"), enable: $("enable"), disable: $("disable"),
    message: $("action-message")
  };
  let current = null;
  let busy = false;
  const put = (el, value) => { el.textContent = value; };
  const humanTime = (value) => {
    if (!value) return "время проверки неизвестно";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "время проверки неизвестно" :
      "проверено " + new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(date);
  };
  const mark = (kind, text) => {
    els.badge.className = "badge" + (kind ? " " + kind : "");
    put(els.badge, text);
  };
  function render(status, errorText) {
    current = status && typeof status === "object" ? status : null;
    els.auth.style.display = errorText === "auth" ? "block" : "none";
    if (!current) {
      mark("bad", "Нет подтверждения");
      put(els.summary, "Статус лаборатории неизвестен.");
      put(els.detail, errorText === "auth" ? "Нужно войти с уже авторизованной учётной записью владельца." :
        (errorText || "Сервер не вернул проверяемый статус."));
      put(els.resources, "Неизвестно");
      put(els.control, "Неизвестно");
      put(els.flags, "Неизвестно");
      put(els.watchdog, "Не проверен");
      updateButtons();
      return;
    }
    const startup = current.startup && typeof current.startup === "object" ? current.startup : null;
    const flags = current.flags && typeof current.flags === "object" ? current.flags : null;
    const control = current.control && typeof current.control === "object" ? current.control : null;
    const resourcesReady = current.configured === true && startup?.status === "ready";
    const active = control?.enabled === true;
    const watchdog = current.watchdog && typeof current.watchdog === "object" ? current.watchdog : null;
    const watchdogFresh = watchdog?.state === "checked" && !!watchdog.checkedAt &&
      Number.isFinite(new Date(watchdog.checkedAt).getTime()) &&
      Date.now() - new Date(watchdog.checkedAt).getTime() < 45000;
    const flagsOk = flags?.enabled === true && flags?.targetMatches === true;
    if (resourcesReady && active && flagsOk && watchdogFresh) {
      mark("good", "Готово к вызову");
      put(els.summary, "Ресурсы готовы, лаборатория включена, наблюдатель свежий.");
    } else if (!resourcesReady || startup?.status === "blocked" || current.configured !== true) {
      mark("bad", "Заблокировано / неизвестно");
      put(els.summary, "Готовность ресурсов не подтверждена — включать нельзя.");
    } else if (active) {
      mark("warn", "Включено, проверка неполная");
      put(els.summary, "Лаборатория включена, но одно или несколько условий не подтверждены.");
    } else {
      mark("warn", "Остановлено");
      put(els.summary, resourcesReady ? "Ресурсы готовы; контроль владельца остаётся выключенным." :
        "Состояние ресурсов пока не подтверждено.");
    }
    const stage = startup?.stage ? " · этап: " + String(startup.stage) : "";
    const code = startup?.code ? " · код: " + String(startup.code) : "";
    const startStatus = startup?.status || "неизвестно";
    const apiError = typeof current.error === "string" ? " · ответ сервера: " + current.error : "";
    put(els.detail, "Окружение: " + (typeof current.environment === "string" ? current.environment : "неизвестно") +
      " · запуск: " + String(startStatus) + stage + code + (startup?.checkedAt ? " · " + humanTime(startup.checkedAt) : "") + apiError);
    put(els.resources, resourcesReady ? "Готовы" :
      current.configured === false ? "Конфигурация недоступна" : "Не подтверждены");
    put(els.control, active ? "Включён" : control?.enabled === false ? "Выключен" : "Не создан / неизвестно");
    put(els.flags, flags ?
      ((flags.enabled === true ? "включён" : flags.enabled === false ? "выключен" : "неизвестно") +
       " · цель " + (flags.targetMatches === true ? "совпадает" : flags.targetMatches === false ? "не совпадает" : "неизвестна") +
       (flags.startsPaused === true ? " · старт остановлен" : flags.startsPaused === false ? " · старт не остановлен" : " · старт неизвестен"))
      : "Неизвестно");
    put(els.watchdog, watchdog ?
      (watchdogFresh ? "Свежий статус · " + humanTime(watchdog.checkedAt) :
        "Не подтверждён: " + (typeof watchdog.state === "string" ? watchdog.state : "нет данных"))
      : "Недоступен — не проверен");
    updateButtons();
  }
  function updateButtons() {
    const flags = current?.flags;
    const control = current?.control;
    const startup = current?.startup;
    const safeToEnable = current?.configured === true && startup?.status === "ready" &&
      flags?.enabled === true && flags?.targetMatches === true && control?.enabled !== true;
    els.readiness.disabled = busy;
    els.enable.disabled = busy || !safeToEnable;
    els.disable.disabled = busy || control?.enabled !== true;
  }
  async function fetchStatus() {
    try {
      const response = await fetch("/api/admin/call-lab/status", {
        method: "GET", credentials: "same-origin", cache: "no-store",
        headers: { "Accept": "application/json" }
      });
      let body = null;
      try { body = await response.json(); } catch {}
      if (response.status === 401 || response.status === 403) {
        render(body, "auth");
        return;
      }
      render(body, response.ok ? (body ? null : "Сервер вернул пустой статус.") :
        (body && typeof body.error === "string" ? body.error : "HTTP " + response.status + " · статус неполный."));
    } catch {
      render(null, "Не удалось получить статус. Повторите проверку вручную.");
    }
  }
  async function post(path, payload, successText) {
    if (busy) return;
    busy = true;
    updateButtons();
    put(els.message, "Выполняется действие…");
    let actionError = "";
    try {
      const response = await fetch(path, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      });
      let body = null;
      try { body = await response.json(); } catch {}
      if (!response.ok) actionError = body && typeof body.error === "string" ?
        body.error : "Действие не подтверждено (HTTP " + response.status + ").";
      else put(els.message, successText);
      if (response.status === 401 || response.status === 403) els.auth.style.display = "block";
    } catch {
      actionError = "Ответ не получен. Результат действия неизвестен; состояние будет перечитано.";
    }
    if (actionError) put(els.message, actionError + " Обновляем статус…");
    await fetchStatus();
    if (actionError) put(els.message, actionError);
    else if (!els.message.textContent) put(els.message, successText);
    busy = false;
    updateButtons();
  }
  els.readiness.addEventListener("click", () => post(
    "/api/admin/call-lab/readiness", {}, "Проверка завершена; состояние перечитано."
  ));
  els.enable.addEventListener("click", () => {
    if (!window.confirm("Подтверждаете включение только для новых Hint-звонков владельца? Это не Secretary/Translator и не запускает исторические звонки.")) return;
    post("/api/admin/call-lab/enable", { confirm: "hint-owner-only" }, "Запрос на включение завершён; состояние перечитано.");
  });
  els.disable.addEventListener("click", () => post(
    "/api/admin/call-lab/disable", {}, "Запрос на остановку завершён; состояние перечитано."
  ));
  fetchStatus();
})();
</script>
</body>
</html>`;
