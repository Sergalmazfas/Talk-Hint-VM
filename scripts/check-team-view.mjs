/**
 * Isolated Chromium UI check: built assets + read-only saved model.
 * All browser requests are intercepted; no login, writes or external calls.
 * Run after npm run build:prepare. Does not verify a real administrator login.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import assert from "node:assert/strict";
import pg from "pg";
import WebSocket from "ws";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let state;
try {
  await db.query("BEGIN READ ONLY");
  const result = await db.query(`SELECT state FROM talkhint_project_models WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) a
    WHERE a->>'id'='new-country')`);
  assert.equal(result.rows.length, 1, "Expected one existing new-country workspace");
  const envelope = result.rows[0].state;
  state = envelope.alternatives.find(item => item.id === "new-country").model;
  // Only the latest version is needed by this renderer; persisted data is untouched.
  state.operatingModel.revisions = state.operatingModel.revisions.slice(-1);
  state.hypothesisContext = {
    selectedId: "new-country", primaryId: null,
    options: envelope.alternatives.map(({ id, title }) => ({ id, title })),
  };
  await db.query("ROLLBACK");
} finally {
  await db.end();
}
const root = "generated-artifacts/talkhint-release-candidate/dist/public";
const html = await readFile(join(root, "index.html"), "utf8");
const temp = await mkdtemp(join(tmpdir(), "team-ui-"));
const chrome = spawn("/repl/tools/bin/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${temp}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const browserURL = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chromium startup timeout")), 15000);
    chrome.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.once("error", reject);
  });
  const targets = await (await fetch(`http://${new URL(browserURL).host}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => socket.once("open", resolve));
  const pending = new Map(), errors = [], writes = [];
  let serial = 0;
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) {
      const handler = pending.get(event.id);
      if (handler) {
        pending.delete(event.id);
        event.error ? handler.reject(new Error(JSON.stringify(event.error))) : handler.resolve(event.result);
      }
      return;
    }
    if (event.method === "Runtime.exceptionThrown")
      errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;
    let body = Buffer.alloc(0), type = "text/plain", status = 200;
    if (request.method !== "GET") {
      writes.push(`${request.method} ${path}`); status = 405;
    } else if (path.startsWith("/admin/") || path === "/") {
      body = Buffer.from(html); type = "text/html";
    } else if (path.startsWith("/assets/")) {
      try {
        body = await readFile(join(root, "assets", basename(path)));
        type = path.endsWith(".css") ? "text/css" : "text/javascript";
      } catch { status = 404; }
    } else if (path.startsWith("/api/")) {
      type = "application/json";
      const response = path === "/api/auth/me"
        ? { user: { id: "test-only", email: "test@example.invalid", language: "ru", isAdmin: true, plan: null } }
        : path === "/api/admin/project-model" ? state : {};
      body = Buffer.from(JSON.stringify(response));
    } else if (path.endsWith(".css") || request.url.includes("fonts.googleapis.com")) {
      type = "text/css";
    } else status = 404;
    await command("Fetch.fulfillRequest", {
      requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: type }],
      body: body.toString("base64"),
    }).catch(error => errors.push(error.message));
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 450));
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`UI mount timeout: ${await evaluate("document.body.innerText.slice(0,500)")} ${errors.join(";")}`);
  };
  const clickText = async text => {
    assert(await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('.team-view button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});b?.click();return !!b})()`), `Missing control ${text}`);
    await settle();
  };
  const search = async value => {
    await evaluate(`{const e=document.querySelector('input[aria-label="Поиск команды"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await settle();
  };
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: "https://team.test.invalid/admin/project-model?hypothesis=new-country&view=overview&workView=team#operating-model" });
  await waitFor(`!!document.querySelector('input[aria-label="Поиск команды"]')`);
  await settle();
  assert.equal(await evaluate("document.querySelectorAll('.team-direction-card').length"), 10);
  const countRoles = () => evaluate("document.querySelectorAll('.team-role-card').length");
  await clickText("Свернуть группы");
  const collapsed = await countRoles();
  await clickText("Раскрыть группы");
  assert(await countRoles() > collapsed, "Expand must restore roles");
  await search("P-BENCH");
  assert(await evaluate(`(()=>{const r=Array.from(document.querySelectorAll('.team-role-card')).find(n=>n.innerText.includes('P-BENCH'));r?.click();return !!r})()`));
  await settle();
  const passport = await evaluate("document.querySelector('.team-detail').innerText");
  assert(passport.includes("Существующий паспорт аналитика"));
  assert(passport.includes("Менеджер продукта"));
  assert(passport.includes("не свидетельство запуска") || passport.includes("Подтверждённых событий запуска"));
  const work = await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('.team-linked-works button')).find(n=>n.innerText.includes('RM.W.QUO'));b?.click();return !!b})()`);
  assert(work, "Existing Quo work must be linked to the analyst");
  await settle();
  assert((await evaluate("document.querySelector('.team-detail').innerText")).includes("RM.W.QUO"));
  await clickText("Назад к паспорту роли");
  await search("");
  await clickText("Вписать");
  await evaluate("document.querySelector('.team-view').scrollIntoView({block:'start'})");
  await settle();
  const canvas = await evaluate(`(()=>{const r=document.querySelector('.team-canvas').getBoundingClientRect();return {height:r.height,visibleNodes:Array.from(document.querySelectorAll('.react-flow__node')).filter(n=>{const b=n.getBoundingClientRect();return b.bottom>r.top&&b.top<r.bottom&&b.right>r.left&&b.left<r.right}).length}})()`);
  assert(canvas.height >= 350 && canvas.height <= 700, `Diagram needs a bounded viewport: ${JSON.stringify(canvas)}`);
  assert(canvas.visibleNodes > 0, "Diagram nodes must be inside the visible canvas");
  await mkdir("generated-artifacts/team-check", { recursive: true });
  const screenshot = async name => {
    const image = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(`generated-artifacts/team-check/${name}.png`, Buffer.from(image.data, "base64"));
  };
  await screenshot("desktop");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelector('.team-detail').scrollIntoView({block:'start'})");
  await settle();
  const mobile = await evaluate(`({width:screen.width,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,detail:document.querySelector('.team-detail').getBoundingClientRect().toJSON(),overflowRoots:Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().width>390&&e.parentElement.getBoundingClientRect().width<=390).slice(0,8).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width}))})`);
  await screenshot("mobile");
  assert(mobile.scrollWidth <= 391, `Mobile horizontal overflow: ${JSON.stringify(mobile)}`);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await settle();
  assert((await evaluate("document.querySelector('.team-detail').innerText")).includes("Выберите роль"));
  assert.deepEqual(writes, [], "The read-only view must not attempt writes");
  assert.deepEqual(errors, [], "Browser runtime must be clean");
  console.log(JSON.stringify({ passed: true, directions: 10, collapsedRoles: collapsed, canvas, mobile, writes, errors, evidence: "isolated built UI with read-only saved data; not real administrator sign-in" }));
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 300));
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
