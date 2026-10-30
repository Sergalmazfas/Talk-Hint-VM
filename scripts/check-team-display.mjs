/** Loopback-only UI regression: real React + approved local PNGs, no auth/DB/providers. */
import { build } from "esbuild";
import { readFile, readdir, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import WebSocket from "ws";
const out = "generated-artifacts/team-display-fix";
await mkdir(out, { recursive: true });
const view = JSON.parse(await readFile("generated-artifacts/team-owner-review/TEAM_VIEW_FIXTURE.json", "utf8"));
const partner = JSON.parse(await readFile("server/team/approvedPartnersDocument.json", "utf8"));
const existing = new Set(view.members.map(m => m.id));
view.members.push(...JSON.parse(partner.text).members.filter(m => !existing.has(m.id)));
view.members.push({ ...view.members.find(m => m.id === "planned-secretary"),
  id: "employee-katya", name: "Катя", code: "SECRETARY", title: "Телефонный секретарь",
  kind: "employee", status: "autonomous", statusEvidence: "Синтетический UI пример, не production-факт" });
view.source.environment = "ISOLATED UI FIXTURE — NOT PRODUCTION";
view.apply = { ...view.apply, available: false, pin: null };
view.partners = undefined; view.feed = [];
const assets = {
  maria: "DCA4E415-0DE9-4A1B-9936-787BD9A9E06A_1793320819523.png",
  tikhon: "138C64CD-1919-47B6-9B3F-AA2A9DBF6A51_1793320819523.png",
  zamir: "1481CFC8-2CB0-4FC0-ADF7-2356C45B02FD_1793320819523.png",
  foma: "101C9081-D2C5-4F31-96C6-2687DBB45779_1793320819523.png",
  katya: "9146D4D1-803B-44D7-A521-5802546279CA_1793320819523.png",
  efim: "497258E9-630F-4334-9E3A-44549FA2F044_1793326152428.png",
  klavdiy: "8168E690-E22D-4E02-95E7-70587B5D2800_1793326152428.png",
};
for (const m of view.members) if (m.portrait) m.portrait = `/fixture/portrait/${m.portrait.split("/")[5]}`;
const entry = `
import React,{useState} from "react";import{createRoot}from"react-dom/client";
import{TeamContent}from"./client/src/pages/team";
const original=${JSON.stringify(view)};const mode=new URLSearchParams(location.search).get("mode");
if(mode==="error"||mode==="slow")original.members.find(m=>m.id==="external-efim").portrait="/fixture/portrait/"+mode;
function Demo(){const[v,setV]=useState(original);
 window.changePortrait=src=>setV(x=>({...x,members:x.members.map(m=>m.id==="external-efim"?{...m,portrait:src}:m)}));
 return <TeamContent view={v}/>}
createRoot(document.getElementById("root")).render(<Demo/>);
if(new URLSearchParams(location.search).has("focus"))setTimeout(()=>{
 const h=[...document.querySelectorAll("h2")].find(h=>h.textContent===new URLSearchParams(location.search).get("focus"));
 h?.closest("section")?.scrollIntoView();},500);
`;
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, outfile: `${out}/fixture.js`, logLevel: "silent" });
const cssRoot = "generated-artifacts/talkhint-release-candidate/dist/public/assets";
const css = await readFile(`${cssRoot}/${(await readdir(cssRoot)).find(f => /^index-.*\.css$/.test(f))}`, "utf8");
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style><body><aside style="padding:12px;background:#fff3cd">ИЗОЛИРОВАННЫЙ СТЕНД · не production</aside><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const requests = [];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  if (path === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(await readFile(`${out}/fixture.js`)); return; }
  if (path.startsWith("/fixture/portrait/")) {
    const name = path.split("/").at(-1); requests.push({ path, at: Date.now() });
    res.setHeader("Cache-Control", "no-store");
    if (name === "error") { res.statusCode = 503; res.end("Fixture: unavailable"); return; }
    if (name === "slow") await new Promise(resolve => setTimeout(resolve, 1500));
    if (assets[name === "slow" ? "efim" : name]) {
      res.setHeader("Content-Type", "image/png"); res.end(await readFile(`attached_assets/${assets[name === "slow" ? "efim" : name]}`)); return;
    }
    res.statusCode = 404; res.end(); return;
  }
  res.setHeader("Content-Type", "text/html"); res.end(html);
});
await new Promise(resolve => server.listen(8099, "127.0.0.1", resolve));
console.log("UI fixture ready on 8099; no application authentication or data changed.");
if (process.argv.includes("--check")) {
  const temp = await mkdtemp(join(tmpdir(), "team-display-"));
  const chrome = spawn("/repl/tools/bin/chromium", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${temp}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let socket;
  try {
    const address = await new Promise((resolve, reject) => {
      let log = ""; chrome.stderr.on("data", b => { log += b; const m = log.match(/DevTools listening on (\S+)/); if (m) resolve(m[1]); });
      chrome.once("error", reject);
    });
    const pages = await (await fetch(`http://${new URL(address).host}/json/list`)).json();
    socket = new WebSocket(pages.find(t => t.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => socket.once("open", resolve));
    let serial = 0; const pending = new Map();
    socket.on("message", bytes => { const r = JSON.parse(bytes); if (pending.has(r.id)) {
      const p = pending.get(r.id); pending.delete(r.id); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result); } });
    const cmd = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const r = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
    };
    const until = async expression => {
      for (let n = 0; n < 140; n++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)); }
      throw Error(`Timed out: ${expression}`);
    };
    await cmd("Page.enable");
    await cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const card = name => `[...document.querySelectorAll('button')].find(b=>b.querySelector('h3')?.textContent===${JSON.stringify(name)})`;
    const efim = card("Ефим Реплитов"), klavdiy = card("Клавдий Сверкин");
    const loaded = c => `(()=>{const i=(${c})?.querySelector('img');return i?.naturalWidth>0&&getComputedStyle(i).opacity==='1'})()`;
    const results = [];
    await cmd("Page.navigate", { url: "http://127.0.0.1:8099/" });
    await until(loaded(efim)); await until(loaded(klavdiy));
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`), true);
    assert.equal(await evaluate(`(()=>{
      const p=[...document.querySelectorAll('h2')].find(h=>h.textContent==='Планы')?.closest('section');
      return !!p&&p.querySelectorAll('img,[role="img"]').length===0
        &&p.innerText.includes('Команда секретаря — будущая')
        &&p.innerText.includes('Copilot')&&p.innerText.includes('переводчика');
    })()`), true);
    assert.equal(await evaluate(`[...document.querySelectorAll('button h3')].filter(h=>h.textContent==='Катя').length`), 1);
    await evaluate(`(${card("Команда секретаря — будущая")}).click()`);
    await until(`document.querySelector('[role="dialog"]')?.textContent.includes('Команда секретаря — будущая')`);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]').querySelector('img')===null`), true);
    results.push("mobile: decoded Efim/Klavdiy visible; Plans separate and portrait-free; one living Katya; plan profile cannot show Katya");
    await cmd("Page.navigate", { url: "http://127.0.0.1:8099/?mode=slow" });
    await until(`Boolean(${efim})`);
    assert.equal(await evaluate(`(${efim}).querySelector('[role="img"]').innerText.includes('ЕР')`), true);
    await until(loaded(efim)); results.push("initials visible while delayed PNG loads, then approved image visible");
    const before = requests.filter(r => r.path.endsWith("/error")).length;
    await cmd("Page.navigate", { url: "http://127.0.0.1:8099/?mode=error" });
    await until(`Boolean(${efim})&&(${efim}).querySelector('img')===null`);
    assert.equal(await evaluate(`(${efim}).querySelector('[role="img"]').innerText.includes('ЕР')`), true);
    await until(loaded(klavdiy));
    assert.equal(requests.filter(r => r.path.endsWith("/error")).length - before, 1);
    await evaluate(`window.changePortrait('/fixture/portrait/efim?new-source=1')`);
    await until(loaded(efim)); results.push("failed PNG keeps ЕР; other member unaffected; changed source recovers without automatic retries");
    await evaluate(`document.querySelector('#external-team-heading').closest('section').scrollIntoView()`);
    await writeFile(`${out}/PARTNERS_MOBILE.png`, Buffer.from((await cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await evaluate(`[...document.querySelectorAll('h2')].find(h=>h.textContent==='Планы').closest('section').scrollIntoView()`);
    await writeFile(`${out}/PLANS_MOBILE.png`, Buffer.from((await cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await cmd("Emulation.setDeviceMetricsOverride", { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
    await cmd("Page.navigate", { url: "http://127.0.0.1:8099/" }); await until(loaded(efim));
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`), true);
    results.push("desktop: portraits load; no horizontal overflow");
    await writeFile(`${out}/BROWSER_CHECKS.json`, JSON.stringify({ isolated: true, productionConnectionUsed: false,
      authenticatedProductionUiVerified: false, modelWrites: 0, requests: requests.map(r => r.path), results }, null, 2));
    console.log("BROWSER PASS:", results.join("; "));
  } finally {
    socket?.close(); chrome.kill("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, 100)); await rm(temp, { recursive: true, force: true });
    if (!process.argv.includes("--serve")) server.close();
  }
}
