/**
 * Read-only browser check of the actual CompanyBrowser component against a
 * current Dev snapshot. Localhost-only fixture, never an auth bypass in the app.
 * Run: NODE_ENV=development npx tsx scripts/check-company-preview.ts
 */
import { Pool } from "pg";
import { build } from "esbuild";
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis } from "../server/projectModel/hypotheses";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function main() {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== "development" || !url || !/^(helium|lithium)$/.test(new URL(url).hostname))
    throw Error("Explicit Dev only");
  const pool = new Pool({ connectionString: url });
  const rows = (await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`)).rows;
  assert.equal(rows.length, 1, "one canonical workspace");
  const root = await unpackModel(pool, rows[0].owner_key, rows[0].state);
  const selected = readHypothesis(root, "new-country");
  await pool.end();
  const latest = selected.operatingModel!.revisions.at(-1)!;
  // Presentation fixture only: history still lives in canonical storage.
  const fixture = { ...selected, alternatives: undefined, operatingModel: { revisions: [latest] } };
  const nodes = latest.data.nodes;
  const department = nodes.find(n => n.kind === "department" && n.code === "T01")!;
  const analyst = nodes.find(n => n.kind === "role" && n.code === "P-BENCH")!;
  const duties = nodes.filter(n => n.kind === "action" && n.roleId === analyst.id);
  assert.ok(department && analyst && duties.length, "real department, role and actions");
  const modelJson = JSON.stringify(fixture);
  const output = await build({
    stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client";
      import CompanyBrowser from "./client/src/components/company-preview/CompanyBrowser";
      fetch("/fixture.json").then(r=>r.json()).then(model=>createRoot(document.getElementById("root")).render(<CompanyBrowser model={model}/>));`,
    loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, outdir: "/tmp/company-browser-bundle", jsx: "automatic",
    alias: { "@": resolve("client/src"), "@shared": resolve("shared") },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = output.outputFiles.find(f => f.path.endsWith(".js"))!.text;
  const css = output.outputFiles.find(f => f.path.endsWith(".css"))!.text;
  let writes = 0;
  const fixtureServer = createServer((req, res) => {
    if (req.method !== "GET") { writes++; res.writeHead(405).end(); return; }
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); }
    else if (req.url === "/bundle.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
    else if (req.url === "/fixture.json") { res.setHeader("Content-Type", "application/json"); res.end(modelJson); }
    else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>body{margin:0}</style><div id="root"></div><script src="/bundle.js"></script></html>'); }
  });
  await new Promise<void>(r => fixtureServer.listen(0, "127.0.0.1", r));
  const port = (fixtureServer.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/company-preview`;
  const chrome = spawn("/repl/tools/bin/chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
    "--disable-background-networking", "--remote-debugging-port=0", "--user-data-dir=/tmp/company-browser-chromium-" + process.pid, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let socket: WebSocket | undefined;
  try {
    const debugUrl = await new Promise<string>((done, reject) => {
      const timeout = setTimeout(() => reject(Error("Chromium did not start")), 20000);
      let logs = "";
      chrome.stderr!.on("data", b => {
        logs += String(b); const match = logs.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timeout); done(match[1]); }
      });
      chrome.on("error", reject);
    });
    const target = await (await fetch(`http://127.0.0.1:${new URL(debugUrl).port}/json/new?about:blank`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string };
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((r, reject) => { socket!.once("open", r); socket!.once("error", reject); });
    let sequence = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const exceptions: string[] = [];
    socket.on("message", message => {
      const payload = JSON.parse(String(message));
      if (payload.method === "Runtime.exceptionThrown") exceptions.push(payload.params.exceptionDetails.text);
      const request = pending.get(payload.id);
      if (request) { pending.delete(payload.id); payload.error ? request.reject(Error(payload.error.message)) : request.resolve(payload.result); }
    });
    const cdp = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression: string) => {
      const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression: string) => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(50); }
      throw Error("Timed out waiting for component: " + expression);
    };
    const open = async (query = "") => {
      await cdp("Page.navigate", { url: base + query });
      await waitFor("!!document.querySelector('.company-browser')");
    };
    const metrics = async (width: number) => {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    };
    const checkWidth = async () => assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "no horizontal overflow");
    const click = (selector: string, text: string) => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)}) || e.getAttribute('aria-label')===${JSON.stringify(text)}).click()`);
    const checkCount = async (selector: string, expected: number) => assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`), expected);
    const screenshots = resolve("generated-artifacts/company-preview");
    await mkdir(screenshots, { recursive: true });
    const capture = async (name: string) => {
      const image = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(resolve(screenshots, name + ".png"), Buffer.from(image.data, "base64"));
    };
    await cdp("Runtime.enable");
    await cdp("Page.enable");
    await metrics(390);
    await open();
    const departmentCount = nodes.filter(n => n.kind === "department" && n.level === "direction").length;
    await checkCount(".cb-department-card", departmentCount);
    assert.equal(departmentCount, 10, "only departments, not tactical action nodes");
    await checkWidth();
    await capture("01-company-390");
    await click(".cb-department-card", department.name);
    await waitFor("!!document.querySelector('.cb-role-list')");
    await checkWidth();
    await capture("02-department-390");
    await click(".cb-role-card", analyst.name);
    await waitFor("!!document.querySelector('.cb-action-list')");
    await checkCount(".cb-action-list > button", duties.length);
    await checkWidth();
    await capture("03-role-390");
    await click(".cb-action-list > button", duties[0].name);
    await waitFor("!!document.querySelector('.cb-action-head')");
    assert.ok((await evaluate("document.body.textContent")).includes("Входы и свежесть"));
    assert.ok((await evaluate("document.body.textContent")).includes("Отчётность и хранение"));
    await checkWidth();
    await capture("04-procedure-390");
    const actionUrl = await evaluate("location.href");
    await cdp("Page.reload");
    await waitFor("!!document.querySelector('.cb-action-head')");
    assert.equal(await evaluate("location.href"), actionUrl, "deep link survives reload");
    await click(".cb-breadcrumb button", analyst.name);
    await waitFor("!!document.querySelector('.cb-action-list')");
    await evaluate("history.back()");
    await waitFor("!!document.querySelector('.cb-action-head')");
    for (const width of [360, 430, 1280]) {
      await metrics(width);
      await open(`?department=${encodeURIComponent(department.id)}&role=${encodeURIComponent(analyst.id)}`);
      await checkWidth();
      await checkCount(".cb-action-list > button", duties.length);
    }
    await metrics(390);
    await open(`?department=missing&role=${encodeURIComponent(analyst.id)}`);
    await waitFor("!!document.querySelector('.cb-not-found')");
    await click(".cb-primary-button", "К отделам");
    await waitFor("!!document.querySelector('.cb-department-list')");
    await checkCount(".cb-department-card", 10);
    await open(`?department=${encodeURIComponent(department.id)}&role=${encodeURIComponent(analyst.id)}`);
    await evaluate("Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('Регламент')).click()");
    assert.ok(await evaluate("Array.from(document.querySelectorAll('details')).some(d=>d.open)"), "regulations disclosure opens");
    await checkWidth();
    assert.equal(writes, 0, "read-only UI never issues writes");
    assert.deepEqual(exceptions, [], "no browser runtime exceptions");
    assert.equal(JSON.stringify(fixture), modelJson, "component leaves snapshot unchanged");
    console.log(JSON.stringify({
      result: "passed", fixture: "actual current Dev snapshot, not a signed-in app session",
      revision: root.revision, operatingVersion: latest.version, departments: departmentCount,
      role: analyst.code, actions: duties.length, widths: [360, 390, 430, 1280],
      checks: ["department-role-procedure clicks", "reporting", "deep-link reload", "browser back", "invalid-link recovery",
        "regulation disclosure", "no horizontal overflow", "no runtime exceptions", "no writes", "snapshot unchanged"],
      departmentPath: `/admin/company-preview?department=${department.id}`,
      rolePath: `/admin/company-preview?department=${department.id}&role=${analyst.id}`,
      screenshots: "generated-artifacts/company-preview",
    }, null, 2));
  } finally {
    socket?.close();
    chrome.kill("SIGTERM");
    await new Promise<void>(r => fixtureServer.close(() => r()));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
