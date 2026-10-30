/** Isolated real-component browser test. No app auth bypass, DB, providers or real writes. */
import { build } from "esbuild";
import { readFile, readdir, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import WebSocket from "ws";
const out = "generated-artifacts/team-partners-button";
await mkdir(out, { recursive: true });
const view = JSON.parse(await readFile("generated-artifacts/team-owner-review/TEAM_VIEW_FIXTURE.json", "utf8"));
const source = await readFile("server/team/partnersApproval.ts", "utf8");
const documentHash = source.match(/PARTNERS_DOCUMENT_HASH = "([a-f0-9]+)"/)[1];
const nextRoot = source.match(/PARTNERS_NEXT_ROOT = "([a-f0-9]+)"/)[1];
view.source.environment = "ISOLATED FIXTURE — NOT PRODUCTION";
view.source.workspace = "company-import-7cf8767b-fbeb-4e97-939f-cc2c3767cf3a";
view.members = []; view.feed = [];
view.apply.available = false; view.apply.pin = null; view.apply.csrfToken = "a".repeat(64);
view.partners = { available: true, completed: false, reason: null, documentHash,
  pin: { workspace: view.source.workspace, revision: 918, rootHash: view.source.rootHash, documentHash } };
const entry = `
import React from "react"; import {createRoot} from "react-dom/client";
import TeamPage from "./client/src/pages/team";
const initial=${JSON.stringify(view)}; let current=structuredClone(initial);
const mode=new URLSearchParams(location.search).get("mode"); window.FETCH_TRACE=[];
window.fetch=async(url,options={})=>{
 const body=options.body?JSON.parse(options.body):null;
 window.FETCH_TRACE.push({url,method:options.method||"GET",body,csrf:options.headers?.["x-team-csrf"]});
 const reply=(value,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}}));
 if(url==="/api/admin/team")return reply(current);
 if(options.headers?.["x-team-csrf"]!==initial.apply.csrfToken||JSON.stringify(body.expected)!==JSON.stringify(initial.partners.pin))
   return reply({error:"Fixture assertion: bad pin/CSRF"},403);
 if(url.endsWith("/grant"))return reply({grant:"b".repeat(64)});
 if(url.endsWith("/apply")){
   if(body.grant!=="b".repeat(64))return reply({error:"bad grant"},403);
   current.source.revision=919;current.source.rootHash=${JSON.stringify(nextRoot)};
   current.partners={...current.partners,available:false,completed:true,pin:null};
   if(mode==="ambiguous")return reply({error:"Simulated response lost after commit"},503);
   return reply(current);
 }
 return reply({error:"Unexpected fixture request"},404);
};
createRoot(document.getElementById("root")).render(<TeamPage/>);
if(location.pathname==="/confirmation"){
 const timer=setInterval(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Применить Клавдия"));
 if(b){b.click();clearInterval(timer)}},30);
}`;
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, outfile: `${out}/browser-fixture.js`, logLevel: "silent" });
const assets = "generated-artifacts/talkhint-release-candidate/dist/public/assets";
const cssName = (await readdir(assets)).find(name => /^index-.*\.css$/.test(name));
const css = await readFile(`${assets}/${cssName}`, "utf8");
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style><body><aside style="background:#fff3cd;padding:12px">ИЗОЛИРОВАННЫЙ СТЕНД · API имитирован · production не подключён</aside><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(await readFile(`${out}/browser-fixture.js`)); }
  else if (req.url === "/favicon.ico") { res.statusCode = 204; res.end(); }
  else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); }
});
await new Promise(resolve => server.listen(8099, "127.0.0.1", resolve));
if (process.argv.includes("--serve")) console.log("Isolated browser fixture ready on 8099");
else {
  const temp = await mkdtemp(join(tmpdir(), "partners-chrome-"));
  const chrome = spawn("/repl/tools/bin/chromium", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${temp}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let socket;
  try {
    const browserURL = await new Promise((resolve, reject) => {
      let log = ""; chrome.stderr.on("data", b => { log += b; const m = log.match(/DevTools listening on (\S+)/); if (m) resolve(m[1]); });
      chrome.once("error", reject);
    });
    const targets = await (await fetch(`http://${new URL(browserURL).host}/json/list`)).json();
    socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => socket.once("open", resolve));
    const pending = new Map(); let serial = 0;
    socket.on("message", bytes => { const r = JSON.parse(bytes); if (r.id && pending.has(r.id)) {
      const p = pending.get(r.id); pending.delete(r.id); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result); } });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const r = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
    };
    const until = async expression => {
      for (let n = 0; n < 100; n++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error(`UI condition timed out: ${expression}`);
    };
    const click = expression => evaluate(`(${expression}).click()`);
    const partnerButton = `[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Применить Клавдия"))`;
    const confirmButton = `document.querySelector('[role="dialog"] .team-modal-actions button:last-child')`;
    const results = [];
    await command("Page.enable");
    for (const mode of ["success", "ambiguous"]) {
      await command("Page.navigate", { url: `http://127.0.0.1:8099/?mode=${mode}` });
      await until(`Boolean(${partnerButton})`);
      assert.equal(await evaluate("window.FETCH_TRACE.filter(r=>r.method==='POST').length"), 0);
      await click(partnerButton); await until(`Boolean(${confirmButton})`); await click(confirmButton);
      await until("window.FETCH_TRACE.filter(r=>r.method==='POST').length===2");
      await until("!document.body.innerText.includes('Документ применяется')");
      if (mode === "success") {
        await until("document.body.innerText.includes('r919')");
        assert.equal(await evaluate(`(${partnerButton})?.disabled ?? true`), true);
      } else {
        await until("document.body.innerText.includes('Результат может быть неоднозначным') || document.body.innerText.includes('результат может быть неоднозначным')");
        assert.equal(await evaluate(`(${partnerButton}).disabled`), true);
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(await evaluate("window.FETCH_TRACE.filter(r=>r.method==='POST').length"), 2);
        await click(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Обновить данные"))`);
        await until("document.body.innerText.includes('Применение завершено')");
        assert.equal(await evaluate("window.FETCH_TRACE.filter(r=>r.method==='POST').length"), 2);
      }
      results.push({ mode, trace: await evaluate("window.FETCH_TRACE"), passed: true });
    }
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await command("Page.navigate", { url: "http://127.0.0.1:8099/confirmation" });
    await until(`Boolean(${confirmButton})`);
    const geometry = await evaluate(`(()=>{
      const modal=document.querySelector('[role="dialog"]'),actions=modal.querySelector('.team-modal-actions');
      return {viewport:innerHeight,modal:modal.getBoundingClientRect().toJSON(),actions:actions.getBoundingClientRect().toJSON(),
        width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}
    })()`);
    assert(geometry.modal.top >= 0 && geometry.actions.bottom <= geometry.viewport);
    assert(geometry.width <= geometry.client + 1);
    await writeFile(`${out}/BROWSER_CHECKS.json`, JSON.stringify({ isolated: true, noRealRequestsOrWrites: true, results, geometry }, null, 2));
    console.log("Browser checks passed: one grant + one apply; uncertain committed response -> GET only; mobile actions visible.");
  } finally {
    socket?.close(); chrome.kill("SIGTERM"); server.close();
    await new Promise(resolve => setTimeout(resolve, 200)); await rm(temp, { recursive: true, force: true });
  }
}
