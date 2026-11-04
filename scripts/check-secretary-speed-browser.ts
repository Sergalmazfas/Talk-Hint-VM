/** Free browser capability/import check. Never creates a provider session. */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
const profile = await mkdtemp(tmpdir() + "/speed-browser-check-");
const child = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"],
{ stdio: ["ignore", "ignore", "pipe"] });
let ws: WebSocket | undefined;
try {
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("CHROME_TIMEOUT")), 15000);
    child.stderr.on("data", raw => { const m = raw.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  ws = new WebSocket(url); await new Promise<void>((r, j) => { ws!.once("open", r); ws!.once("error", j); });
  let seq = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.on("message", raw => { const e = JSON.parse(raw.toString()); pending.get(e.id)?.(e.result); pending.delete(e.id); });
  const call = (method: string, params: any = {}, sessionId?: string): Promise<any> => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve); ws!.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Runtime.enable", {}, sessionId); await call("Page.enable", {}, sessionId);
  await call("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/admin/secretary-lab?stand=retell-engine` }, sessionId);
  await new Promise(r => setTimeout(r, 3000));
  const r = await call("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async()=>{
    const result={origin:location.origin,secure:window.isSecureContext,media:!!navigator.mediaDevices};
    for(const path of ['/node_modules/.vite/deps/retell-client-js-sdk.js','/src/lib/secretary-lab-retell.ts']){
      try{await import(path);result[path]='ok'}catch(e){result[path]=e.name+': '+e.message}}
    try{const a=new AudioContext();await a.resume();result.audio=a.state;await a.close()}catch(e){result.audio=e.name}
    return result})()` }, sessionId);
  const result = r.result?.value ?? { error: r.exceptionDetails?.exception?.description?.split("\n")[0] };
  await writeFile("generated-artifacts/secretary-speed-series/browser-check.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { ws?.close(); child.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }).catch(() => {}); }
