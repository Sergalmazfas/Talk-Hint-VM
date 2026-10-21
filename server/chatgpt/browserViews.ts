import { renderSecretaryContent, type SecretaryHistoryPage } from "./secretaryHistoryViews";

export type BrowserPage =
  | (SecretaryHistoryPage & { csrf: string; flow: string })
  | { kind: "login"; csrf: string; flow: string; message?: string }
  | { kind: "consent"; csrf: string; flow: string; account: string; scopes: string[] }
  | {
      kind: "approval";
      csrf: string;
      flow: string;
      account: string;
      phoneNumber: string;
      instruction: string;
      expiresAt: string;
      approved: boolean;
    }
  | {
      kind: "connections";
      csrf: string;
      flow: string;
      account: string;
      connections: Array<{ id: string; scopes: string[]; expiresAt: string }>;
    }
  | { kind: "status"; title: string; message: string };

const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });

const shell = (title: string, nonce: string, content: string, script = ""): string => {
  const safeNonce = escapeHtml(nonce);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} · TalkHint</title>
  <style nonce="${safeNonce}">
    :root{color-scheme:light;--ink:#17274b;--muted:#586985;--blue:#315fca;--blue-dark:#234aa8;--violet:#6856c8;--line:#d7e0f0;--paper:#f4f7fc;--surface:#fff;--soft:#edf2fb;--danger:#a33749;--focus:#8b79ef}
    *{box-sizing:border-box}
    html{min-height:100%;background:var(--paper)}
    body{margin:0;min-height:100dvh;color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.55;background:radial-gradient(ellipse at 85% 0%,#e8eafe 0,transparent 38%),var(--paper)}
    .page{min-height:100dvh;display:flex;flex-direction:column;padding:clamp(18px,5vw,52px) 18px 24px}
    .top{width:100%;max-width:760px;margin:0 auto 28px;display:flex;align-items:center;justify-content:space-between;gap:14px}
    .brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink);font-weight:760;letter-spacing:-.035em;text-decoration:none;font-size:19px}
    .mark{width:32px;height:32px;border-radius:11px;background:linear-gradient(145deg,var(--blue),var(--violet));position:relative;box-shadow:0 5px 12px #485fc333}
    .mark:before,.mark:after{content:"";position:absolute;background:#fff;border-radius:3px;transform:rotate(-35deg)}
    .mark:before{width:4px;height:17px;left:10px;top:8px}.mark:after{width:4px;height:12px;left:18px;top:10px}
    .top-note{color:var(--muted);font-size:13px;text-align:right}
    main{width:100%;max-width:620px;margin:0 auto;flex:1}
    .card{background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:clamp(22px,5vw,40px);box-shadow:0 16px 42px #243f7010}
    .eyebrow{margin:0 0 12px;color:var(--blue);font-weight:750;font-size:12px;letter-spacing:.105em;text-transform:uppercase}
    h1{margin:0;color:var(--ink);font-size:clamp(25px,6vw,34px);line-height:1.16;letter-spacing:-.045em}
    .lede{margin:14px 0 0;color:var(--muted);max-width:54ch}
    .readonly{display:inline-flex;align-items:center;gap:9px;margin-top:20px;padding:9px 12px;border-radius:10px;background:#eff2ff;border:1px solid #dce1ff;color:#3d448f;font-size:14px;font-weight:720}
    .readonly-mark{width:8px;height:8px;border-radius:50%;background:var(--violet)}
    .section{margin-top:27px}
    label{display:block;margin:0 0 7px;color:#273a5d;font-size:14px;font-weight:700}
    input[type=email],input[type=password]{width:100%;min-height:50px;padding:12px 14px;border:1px solid #bfcce1;border-radius:11px;background:#fff;color:var(--ink);font:inherit}
    input:focus-visible{outline:3px solid #8b79ef66;outline-offset:2px;border-color:var(--focus)}
    .field+.field{margin-top:17px}
    .button{display:inline-flex;justify-content:center;align-items:center;min-height:48px;width:100%;padding:12px 18px;border:1px solid transparent;border-radius:11px;background:var(--blue);color:#fff;font:inherit;font-weight:720;text-align:center;text-decoration:none;cursor:pointer;transition:background-color .16s ease,transform .16s ease}
    .button:hover{background:var(--blue-dark)}
    .button:active{transform:translateY(1px)}
    .button.secondary{background:#fff;border-color:#bdcae0;color:#2b426c}
    .button.secondary:hover{background:#f2f5fc}
    .button.deny{background:#fff;border-color:#cbd4e3;color:#465873}
    .button.deny:hover{background:#f5f7fb}
    .button:focus-visible,.link:focus-visible,.brand:focus-visible{outline:3px solid #8b79ef;outline-offset:3px}
    .stack{display:grid;gap:11px}
    .divider{display:flex;align-items:center;gap:12px;margin:21px 0;color:#75839a;font-size:13px}
    .divider:before,.divider:after{content:"";height:1px;flex:1;background:var(--line)}
    .form-grid{display:grid;gap:12px;margin-top:24px}
    .notice{margin-top:18px;padding:12px 14px;border-left:3px solid var(--violet);border-radius:0 9px 9px 0;background:#f2f1ff;color:#394375;font-size:14px}
    .error{margin:17px 0 0;padding:11px 13px;border-radius:10px;background:#fff0f1;color:var(--danger);font-size:14px}
    .list{display:grid;gap:13px;margin:24px 0 0;padding:0;list-style:none}
    .row{padding:17px;border:1px solid var(--line);border-radius:14px;background:#fbfcff}
    .row-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
    .row-title{font-weight:740;overflow-wrap:anywhere}
    .detail-label{display:block;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}
    .detail-value{margin-top:4px;overflow-wrap:anywhere;white-space:pre-wrap}
    .scope-list{margin:0;padding-left:21px}
    .scope-list li+li{margin-top:6px}
    .actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:24px}
    .expiry{margin:11px 0 0;color:var(--muted);font-size:13px}
    .manage{display:inline-flex;margin-top:23px;color:var(--blue-dark);font-weight:700;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
    .footer{width:100%;max-width:760px;margin:24px auto 0;color:#77849a;font-size:12px;text-align:center}
    [role=status]{min-height:1.5em;margin:13px 0 0;color:#4c5e7d;font-size:14px}
    @media(max-width:520px){.page{padding:17px 14px 20px}.top{margin-bottom:18px}.card{border-radius:18px}.top-note{max-width:145px;font-size:12px}.actions{grid-template-columns:1fr}.row-head{display:block}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <div class="page">
    <header class="top">
      <a class="brand" href="/"><span class="mark" aria-hidden="true"></span><span>TalkHint</span></a>
      <span class="top-note">Подключение ChatGPT<br>к вашему аккаунту</span>
    </header>
    <main>${content}</main>
    <footer class="footer">ChatGPT на iPhone не заявляется как совместимый способ подключения.</footer>
  </div>${script ? `\n  <script nonce="${safeNonce}">${script}</script>` : ""}
</body>
</html>`;
};

const hidden = (csrf: string, flow: string): string =>
  `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="flow" value="${escapeHtml(flow)}">`;

const logoutAndManage = (csrf: string, flow: string, api: string): string =>
  `<section class="section"><form method="post" action="${api}/browser/logout">${hidden(csrf, flow)}<button class="button secondary" type="submit">Завершить web-сеанс</button></form><a class="manage" href="${api}/secretary">Secretary — история и отчёты</a><br><a class="manage" href="${api}/connections/manage">Управление подключениями</a></section>`;

export function renderBrowserPage(page: BrowserPage, nonce: string, api: "/api/chatgpt" | "/api/chatgpt-actions" = "/api/chatgpt"): string {
  switch (page.kind) {
    case "secretary-history":
    case "secretary-detail":
      return shell("Secretary", nonce, renderSecretaryContent(page, api) + logoutAndManage(page.csrf, page.flow, api));
    case "login": {
      const notice = page.message ? `<p class="error" role="status">${escapeHtml(page.message)}</p>` : "";
      const content = `<article class="card">
        <p class="eyebrow">Безопасное подключение</p>
        <h1>Войдите в TalkHint</h1>
        <p class="lede">Используйте существующий аккаунт TalkHint, чтобы продолжить настройку доступа для ChatGPT.</p>
        <div class="readonly"><span class="readonly-mark" aria-hidden="true"></span>Защищённое подтверждение владельца</div>
        ${notice}
        <form class="form-grid" method="post" action="${api}/browser/login">
          ${hidden(page.csrf, page.flow)}
          <div class="field"><label for="email">Электронная почта</label><input id="email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
          <button class="button" type="submit">Продолжить</button>
        </form>
        <div class="divider">или</div>
        <div class="stack">
          <a class="button secondary" href="/" target="_blank" rel="noopener noreferrer">Войти через существующий TalkHint</a>
          <button class="button secondary" id="bridge-login" type="button">Я уже вошёл в TalkHint</button>
        </div>
        <p id="bridge-status" role="status" aria-live="polite"></p>
        <p class="notice">Разрешения будут показаны отдельно после входа. Сама авторизация не разрешает звонки.</p>
      </article>`;
      const script = `const bridgeButton=document.getElementById("bridge-login");const status=document.getElementById("bridge-status");bridgeButton.addEventListener("click",async()=>{status.textContent="";let token;try{token=localStorage.getItem("token")}catch{status.textContent="Не удалось получить активный сеанс. Войдите в TalkHint ещё раз.";return}if(!token){status.textContent="Активный сеанс TalkHint не найден. Войдите в TalkHint и повторите попытку.";return}bridgeButton.disabled=true;bridgeButton.setAttribute("aria-busy","true");try{const form=document.querySelector('form[action="${api}/browser/login"]');const body={csrf:form.elements.csrf.value,flow:form.elements.flow.value};const response=await fetch("${api}/browser/session",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"});if(!response.ok)throw new Error("session");const result=await response.json();if(typeof result.next!=="string"||!result.next.startsWith("${api}/browser/review?flow="))throw new Error("next");window.location.assign(result.next)}catch{status.textContent="Не удалось подтвердить сеанс. Проверьте вход в TalkHint и попробуйте ещё раз.";bridgeButton.disabled=false;bridgeButton.removeAttribute("aria-busy")}});`;
      return shell("Вход", nonce, content, script);
    }
    case "consent": {
      const scopeLabels: Record<string, string> = {
        "calls:read": "Список, статусы и результаты собственных звонков",
        "secretary:start": "Подготовка исходящих; каждый звонок подтверждается отдельно",
        "calls:transcript": "Чтение текста разговора и доступных переводов",
        "calls:listen": "Прослушивание обеих сторон собственных звонков вживую",
        "offline_access": "Сохранять подключение без повторного входа при каждом звонке",
      };
      const scopeRows = page.scopes.map((scope) => `<li>${escapeHtml(scope)} — ${escapeHtml(scopeLabels[scope] ?? scope)}</li>`).join("");
      const content = `<article class="card">
        <p class="eyebrow">Запрос доступа</p>
        <h1>Разрешить подключение?</h1>
        <p class="lede">Проверьте аккаунт и точный перечень разрешений. Ничего не будет включено без вашего выбора.</p>
        <div class="section row"><span class="detail-label">Аккаунт TalkHint</span><div class="detail-value">${escapeHtml(page.account)}</div></div>
        <div class="section"><span class="detail-label">Запрошенные разрешения</span><ul class="scope-list">${scopeRows}</ul></div>
        <p class="notice"><strong>${page.scopes.includes("secretary:start") ? "Запрошена возможность подготовить исходящий вызов." : "Данные доступны только для чтения."}</strong> Для каждого вызова всё равно требуется отдельное подтверждение владельца с номером и заданием. Не передавайте пароли и коды из транскрипций. Совместимость с ChatGPT на iPhone ещё не проверена.</p>
        <form method="post" action="${api}/browser/consent">
          ${hidden(page.csrf, page.flow)}
          <div class="actions"><button class="button" type="submit" name="decision" value="allow">Разрешить</button><button class="button deny" type="submit" name="decision" value="deny">Отказать</button></div>
        </form>
        ${logoutAndManage(page.csrf, page.flow, api)}
      </article>`;
      return shell("Проверка доступа", nonce, content);
    }
    case "approval": {
      const decision = page.approved
        ? `<p class="notice" role="status"><strong>Уже одобрено.</strong> Повторное подтверждение не требуется. Разрешение позволит ChatGPT только начать один указанный вызов позже; эта страница не выполняет звонок.</p>`
        : `<p class="notice"><strong>Одно точное действие.</strong> Подтверждение разрешает последующий запрос ChatGPT начать только этот вызов. На этой странице звонок не выполняется и номер не набирается.</p>
          <form method="post" action="${api}/browser/approve">
            ${hidden(page.csrf, page.flow)}
            <div class="actions"><button class="button" type="submit" name="decision" value="approve">Одобрить этот вызов</button><button class="button deny" type="submit" name="decision" value="deny">Отказать</button></div>
          </form>`;
      const content = `<article class="card">
        <p class="eyebrow">Проверка владельцем аккаунта</p>
        <h1>${page.approved ? "Подтверждение уже получено" : "Подтвердите один вызов"}</h1>
        <p class="lede">Сверьте все детали. Одобрение относится только к указанному действию.</p>
        <div class="list">
          <div class="row"><span class="detail-label">Аккаунт TalkHint</span><div class="detail-value">${escapeHtml(page.account)}</div></div>
          <div class="row"><span class="detail-label">Точный номер телефона</span><div class="detail-value">${escapeHtml(page.phoneNumber)}</div></div>
          <div class="row"><span class="detail-label">Инструкция</span><div class="detail-value">${escapeHtml(page.instruction)}</div></div>
        </div>
        <p class="expiry">Срок действия запроса: ${escapeHtml(page.expiresAt)}</p>
        ${decision}
        ${logoutAndManage(page.csrf, page.flow, api)}
      </article>`;
      return shell("Подтверждение вызова", nonce, content);
    }
    case "connections": {
      const rows = page.connections.map((connection) => `<li class="row">
        <div class="row-head"><div><span class="detail-label">Аккаунт TalkHint</span><div class="row-title">${escapeHtml(page.account)}</div></div></div>
        <p class="expiry">Разрешения: ${escapeHtml(connection.scopes.join(", "))}</p>
        <p class="expiry">Истекает: ${escapeHtml(connection.expiresAt)}</p>
        <form class="section" method="post" action="${api}/browser/revoke">
          ${hidden(page.csrf, page.flow)}<input type="hidden" name="id" value="${escapeHtml(connection.id)}">
          <button class="button deny" type="submit">Отозвать подключение</button>
        </form>
      </li>`).join("");
      const content = `<article class="card">
        <p class="eyebrow">Ваши подключения</p>
        <h1>Доступ ChatGPT</h1>
        <p class="lede">Показаны только активные подключения, предоставленные TalkHint. Вы можете отозвать любое из них.</p>
        <div class="readonly"><span class="readonly-mark" aria-hidden="true"></span>Отзыв не удаляет историю и не завершает звонок</div>
        ${rows ? `<ul class="list">${rows}</ul>` : `<p class="notice">Активных подключений нет.</p>`}
        ${logoutAndManage(page.csrf, page.flow, api)}
      </article>`;
      return shell("Подключения", nonce, content);
    }
    case "status": {
      const content = `<article class="card">
        <p class="eyebrow">TalkHint · ChatGPT</p>
        <h1>${escapeHtml(page.title)}</h1>
        <p class="lede">${escapeHtml(page.message)}</p>
        <a class="manage" href="${api}/connections/manage">Управление подключениями</a>
      </article>`;
      return shell(page.title, nonce, content);
    }
  }
}
