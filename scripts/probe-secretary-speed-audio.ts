/** Paid, explicitly authorized $5 Dev series. No telephone or production API.
 * Uses an ephemeral real Dev login session (revoked in finally), existing
 * protected routes, SDK gateway, reused synthetic PCM fixtures and Chromium.
 * Measured audio is decoded in the browser, NOT physical speaker audibility. */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { SpeedBudget } from "../server/secretaryLab/speedBudget";
import { WebSocket } from "ws";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1" || !process.argv.includes("--run"))
  throw Error("Explicit --run in Dev required");
const database = await import("../server/db");
const { storage } = await import("../server/storage");
await database.dbReady;
const pool = database.pool;
if (!pool || !database.isDevDatabase) throw Error("Dev DB required");
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const api = "/api/admin/secretary-lab/retell-engine";
const cCompare = process.argv.includes("--c-buffer-compare");
const out = cCompare ? "generated-artifacts/katya-c-buffer/audio" : "generated-artifacts/secretary-speed-series";
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex");
let loginCreated = false, chrome: ReturnType<typeof spawn> | undefined, cdp: WebSocket | undefined, active = "", stopAttempted = false;
let browserServer: Server | undefined;
const profile = await mkdtemp(tmpdir() + "/secretary-speed-chrome-");
const attempts: any[] = [];
if (cCompare) {
  try {
    const prior = JSON.parse(await readFile(out + "/audio-series-isolated.json", "utf8"));
    if (!process.argv.includes("--continue-c-confirmed")) throw Error("C_COMPARISON_ALREADY_ATTEMPTED_NO_RETRY");
    const readback = JSON.parse(await readFile("generated-artifacts/katya-c-buffer/baseline-readback.json", "utf8")).report;
    const budget = await new SpeedBudget().state();
    if (budget.reservedMicroUsd !== 0) throw Error("UNCONFIRMED_ADMISSION_NO_CONTINUATION");
    for (const a of prior.attempts) {
      const report = a.report ?? (readback.id === a.id ? readback : undefined);
      if (report?.status !== "ended" || !report.engine?.speed?.requestBudget?.verifiable)
        throw Error("UNCONFIRMED_CALL_NO_CONTINUATION");
      attempts.push({ ...a, report, originalStatus: a.status, status: a.status === "stopped" ? "failed_known" : a.status });
    }
  }
  catch (e: any) { if (e.code !== "ENOENT") throw e; }
}
if (process.argv.includes("--resume-known-completed")) {
  if (cCompare) throw Error("C_COMPARISON_NO_RESUME");
  const previous = JSON.parse(await readFile(out + "/audio-series-isolated.json", "utf8"));
  for (const a of previous.attempts ?? []) {
    const usage = a.report?.engine?.usage;
    if (a.report?.status !== "ended" || usage?.requests !== usage?.measuredRequests ||
      !a.report?.engine?.speed?.requestLog?.every((r: any) => r.complete) ||
      (a.status !== "completed" && a.status !== "failed_known" &&
        !String(a.error).includes("window.__speedSession?.close is not a function") &&
        !(a.error === "GATEWAY_ENDED_EARLY" && a.readOnlyAfterStop?.providerStatus === "ended")))
      throw Error("RESUME_REQUIRES_CONFIRMED_END_AND_MEASURED_USAGE");
    attempts.push({ ...a, originalStatus: a.originalStatus ?? a.status, cleanupError: a.cleanupError ?? a.error,
      status: Number.isFinite(a.audio?.speechEndToDecodedAudioMs) ? "completed" : "failed_known" });
  }
}
const save = () => writeFile(out + "/audio-series-isolated.json", JSON.stringify({
  at: new Date().toISOString(), browserDecodedAudio: true, physicalAudibilityTested: false,
  fixtureSampleRate: 16000, noPaidFixtureGeneration: true, attempts,
}, null, 2));
const http = async (path: string, method = "GET", body?: unknown) => {
  const r = await fetch(base + api + path, { method, headers: { Authorization: `Bearer ${token}`,
    "Content-Type": "application/json", Origin: base }, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000) });
  const data = await r.json();
  if (!r.ok) throw Error(`LAB_HTTP_${r.status}:${String(data.error).slice(0, 160)}`);
  return data;
};
try {
  const p = await pool.query(`SELECT p.id,p.current_version,v.content FROM secretary_personalities p
    JOIN secretary_personality_versions v ON v.personality_id=p.id AND v.version=p.current_version WHERE p.slug=$1`, ["katya"]);
  const user = await pool.query("SELECT id FROM users WHERE id=$1", ["47704265"]);
  if (!p.rows[0] || !user.rows[0]) throw Error("Existing confirmed Dev owner/Katya required");
  const { speedEngine } = await import("../server/secretaryLab/speedRuntime");
  const row = p.rows[0];
  for (const variant of ["A", "B", "C"] as const) {
    const engine = speedEngine(user.rows[0].id, "Fictional test: briefly explain how you can help; never invent prices or actions.",
      variant, { personalityId: row.id, version: row.current_version, mode: "work",
        snapshot: { ...row.content, id: row.id, version: row.current_version, status: "available" } });
    console.log(JSON.stringify({ variant, promptChars: engine.instructions.length, phase: "offline_preflight" }));
  }
  await storage.createSession(token, user.rows[0].id, new Date(Date.now() + 25 * 60_000)); loginCreated = true;
  const readiness = await http("");
  if (!readiness.ready) throw Error("STAND_NOT_READY:" + readiness.reason);
  // A localhost-only SDK fixture, not a copy/bypass of the owner web workspace.
  // No owner credential, provider API key, app data or admission is served here.
  const bundled = await build({ stdin: { contents: `
    import {RetellClient} from 'retell-client-js-sdk';
    import {savedRetellAdmission} from './client/src/lib/secretary-lab-retell';
    window.__speedSdk={RetellClient,savedRetellAdmission};`,
    resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife", logLevel: "silent" });
  const js = bundled.outputFiles[0].text;
  browserServer = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); }
    else { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Local synthetic audio fixture</title><script src='/bundle.js'></script>"); }
  });
  await new Promise<void>(resolve => browserServer!.listen(0, "127.0.0.1", resolve));
  const address = browserServer.address();
  if (!address || typeof address === "string") throw Error("LOCAL_FIXTURE_NOT_LISTENING");
  chrome = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
  const debug = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("CHROME_START_TIMEOUT")), 15000);
    chrome!.stderr!.on("data", raw => { const match = raw.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
    chrome!.on("error", reject);
  });
  cdp = new WebSocket(debug);
  await new Promise<void>((r, j) => { cdp!.once("open", r); cdp!.once("error", j); });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  cdp.on("message", raw => { const e = JSON.parse(raw.toString()), p = pending.get(e.id);
    if (p) { pending.delete(e.id); e.error ? p.reject(Error("CDP_COMMAND_FAILED")) : p.resolve(e.result); }
  });
  const call = (method: string, params: any = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); cdp!.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const target = await call("Target.createTarget", { url: "about:blank" });
  const session = (await call("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await call("Runtime.enable", {}, session); await call("Page.enable", {}, session);
  await call("Page.navigate", { url: `http://127.0.0.1:${address.port}` }, session);
  const evaluate = async (expression: string) => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
    if (r.exceptionDetails) throw Error("BROWSER_EVALUATION_FAILED:" +
      (r.exceptionDetails.exception?.description?.split("\n")[0]?.replace(/https?:\/\/\S+/g, "[url omitted]").slice(0, 120) ?? "unknown"));
    return r.result?.value;
  };
  await new Promise(r => setTimeout(r, 3000));
  // Check the local fixture/SDK/audio BEFORE any paid cloud admission.
  await evaluate(`(async()=>{
    if(!window.__speedSdk?.RetellClient||!window.__speedSdk?.savedRetellAdmission)throw Error('SDK_NOT_LOADED');
    if(!navigator.mediaDevices)throw Error('MEDIA_DEVICES_UNAVAILABLE');
    const ctx=new AudioContext();await ctx.resume();if(ctx.state!=='running')throw Error('AUDIO_NOT_RUNNING');await ctx.close();
  })()`);
  console.log(JSON.stringify({ phase: "local_browser_preflight", status: "passed", paid: false }));
  if (!process.argv.includes("--preflight-only")) for (let scenario = 0; scenario < (cCompare ? 6 : 3); scenario++) for (const variant of (cCompare ? ["C"] : ["A", "B", "C"])) {
    if (attempts.some(a => a.scenario === scenario && a.variant === variant && (cCompare || a.status === "completed"))) continue;
    const language = scenario < 2 || scenario === 4 ? "ru" : "en";
    const pcm = await readFile(cCompare ? `generated-artifacts/katya-c-buffer/fixtures/${language}-question.pcm` :
      `generated-artifacts/eleven-latency/language-${scenario === 1 ? 1 : 0}.pcm`);
    const extras = cCompare ? {
      ack: (await readFile(`generated-artifacts/katya-c-buffer/fixtures/${language}-ack.pcm`)).toString("base64"),
      correction: (await readFile(`generated-artifacts/katya-c-buffer/fixtures/${language}-correction.pcm`)).toString("base64"),
    } : null;
    const attempt: any = { scenario, variant, fixtureHash: createHash("sha256").update(pcm).digest("hex"),
      phase: "admission", status: "started", ...(cCompare ? { responseBuffer: scenario % 2 === 1, language } : {}),
      sampleBasis: "synthetic stored PCM; decoded remote browser audio" };
    attempts.push(attempt); await save();
    console.log(JSON.stringify({ variant, scenario, phase: attempt.phase }));
    try {
    const before = await new SpeedBudget().state();
    if (cCompare ? attempts.length > 6 : Object.values(before.runs).filter(r => r.variant === variant).length >= 4)
      throw Error("AUTOMATION_MAX_FOUR_CONVERSATIONS");
    const created = await http("/sessions", "POST", { consent: true, clientRequestId: randomUUID(), speedVariant: variant,
      ...(cCompare ? { responseBuffer: scenario % 2 === 1 } : {}),
      instruction: "Fictional test: briefly explain how you can help; never invent prices or actions.",
      personality: { id: p.rows[0].id, version: p.rows[0].current_version, mode: "work" } });
    active = created.id; stopAttempted = false; attempt.id = active; attempt.phase = "browser_gateway"; await save();
    const admission = JSON.stringify(created.call), fixture = JSON.stringify(pcm.toString("base64"));
    await evaluate(`(async()=>{
      const {RetellClient,savedRetellAdmission}=window.__speedSdk;
      const state=window.__speed={status:'connecting',error:null,lastSound:0,firstSound:null,fixtureEnd:null,played:false,
        samples:[],quietSince:null,ackPlayed:false,correctionPlayed:false};
      const ctx=new AudioContext(); await ctx.resume(); window.__speedCtx=ctx;
      const dest=ctx.createMediaStreamDestination(); navigator.mediaDevices.getUserMedia=async()=>dest.stream;
      const original=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'srcObject');
      if(!window.__speedOriginal)window.__speedOriginal=original;
      Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{configurable:true,get:original.get,set:function(stream){
        original.set.call(this,stream); if(stream&&stream.getAudioTracks().length){
          const src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser(),silent=ctx.createGain();
          silent.gain.value=0;an.fftSize=512;src.connect(an);an.connect(silent);silent.connect(ctx.destination);
          const data=new Float32Array(512);const inspect=()=>{if(ctx.state==='closed')return;an.getFloatTimeDomainData(data);
            let n=0;for(const x of data)n+=x*x;if(Math.sqrt(n/data.length)>0.003){state.lastSound=performance.now();
              const sample=state.samples.at(-1);if(sample&&state.lastSound>=sample.end&&sample.first===null){
                sample.first=state.lastSound;sample.cleanGap=state.quietSince!==null&&state.lastSound-state.quietSince>=80;}
              state.quietSince=null;
              if(state.fixtureEnd!==null&&state.lastSound>=state.fixtureEnd&&state.firstSound===null)state.firstSound=state.lastSound;
            }else{state.quietSince??=performance.now();}
            requestAnimationFrame(inspect)};inspect();}}});
      const client=new RetellClient({key:'',fetch:savedRetellAdmission(${admission})});
      window.__speedClient=client;
      window.__speedSession=client.createWebCall({agent_id:'server-managed',transcript:false,hooks:{
        onStatus:s=>{state.status=s},onError:()=>{state.error='SDK_GATEWAY_ERROR'}}});
      const raw=atob(${fixture});const pcm=new Int16Array(raw.length/2);
      for(let i=0;i<pcm.length;i++)pcm[i]=(raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8))<<16>>16;
      const extra=${JSON.stringify(extras)};
      const decode=(raw)=>{raw=atob(raw);const x=new Int16Array(raw.length/2);
        for(let i=0;i<x.length;i++)x[i]=(raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8))<<16>>16;return x;};
      state.play=(kind='question')=>{const data=kind==='question'?pcm:decode(extra[kind]);
        let last=data.length-1;while(last>0&&Math.abs(data[last])<200)last--;
        const b=ctx.createBuffer(1,data.length,16000),ch=b.getChannelData(0);for(let i=0;i<data.length;i++)ch[i]=data[i]/32768;
        const source=ctx.createBufferSource();source.buffer=b;source.connect(dest);
        state.fixtureEnd=performance.now()+(last+1)/16;state.firstSound=null;state.played=true;
        state.samples.push({kind,end:state.fixtureEnd,first:null,cleanGap:false});source.start();};
    })()`);
    const began = Date.now(); let played = false, audio: any;
    while (Date.now() - began < (cCompare ? 70_000 : 50_000)) {
      audio = await evaluate("JSON.parse(JSON.stringify(window.__speed,(k,v)=>typeof v==='function'?undefined:v))");
      if (cCompare) attempt.audio = { samples: audio.samples, ackPlayed: audio.ackPlayed, correctionPlayed: audio.correctionPlayed, gatewayStatus: audio.status };
      if (audio.error || audio.status === "ended") throw Error(audio.error || "GATEWAY_ENDED_EARLY");
      if (!played && audio.status === "live" && audio.lastSound > 0 &&
        await evaluate("performance.now()-window.__speed.lastSound>1000")) {
        await http(`/sessions/${active}/connected`, "POST", {});
        await evaluate("window.__speed.play()"); played = true; attempt.phase = "audio_response"; await save();
      }
      if (cCompare && played && audio.firstSound !== null && !audio.ackPlayed) {
        await new Promise(r => setTimeout(r, 350));
        await evaluate("window.__speed.ackPlayed=true;window.__speed.play('ack')"); continue;
      }
      if (cCompare && audio.ackPlayed && !audio.correctionPlayed && audio.firstSound !== null &&
        await evaluate("performance.now()-window.__speed.firstSound>1000")) {
        await evaluate("window.__speed.correctionPlayed=true;window.__speed.play('correction')"); continue;
      }
      if (played && (!cCompare || audio.correctionPlayed) && audio.firstSound !== null &&
        await evaluate("performance.now()-window.__speed.lastSound>1200&&performance.now()-window.__speed.firstSound>2000")) break;
      await new Promise(r => setTimeout(r, 150));
    }
    attempt.audio = { fixturePlayed: played, speechEndToDecodedAudioMs: audio?.firstSound == null ? null : audio.firstSound - audio.fixtureEnd,
      ...(cCompare ? { samples: audio?.samples, ackPlayed: audio?.ackPlayed, correctionPlayed: audio?.correctionPlayed } : {}) };
    stopAttempted = true;
    const final = await http(`/sessions/${active}`, "DELETE");
    const report = final.report; active = "";
    attempt.report = report; attempt.status = attempt.audio.speechEndToDecodedAudioMs === null ? "unmeasured" : "completed";
    if (cCompare && (!report.engine?.speed?.requestBudget?.verifiable || report.status !== "ended")) {
      await save(); throw Error("C_UNBOUNDED_OR_UNCONFIRMED_STOP_NO_RETRY");
    }
    await evaluate("(async()=>{await window.__speedSession?.end().catch(()=>undefined);await window.__speedCtx?.close();if(window.__speedOriginal)Object.defineProperty(HTMLMediaElement.prototype,'srcObject',window.__speedOriginal)})()");
    await save();
    console.log(JSON.stringify({ variant, scenario, status: attempt.status, audio: attempt.audio }));
    const state = await http("");
    if (state.speedBudget.remainingUsd <= 0) throw Error("BUDGET_EXHAUSTED");
    if (attempt.status !== "completed") { attempt.status = "failed_known"; attempt.error = "AUDIO_UNMEASURED"; await save(); }
    } catch (e: any) {
      if (active && !stopAttempted) {
        stopAttempted = true;
        const closed = await http(`/sessions/${active}`, "DELETE");
        const speed = closed.report?.engine?.speed;
        if (closed.report?.status === "ended" && speed && (cCompare ? speed.requestBudget?.verifiable :
          speed.requests === speed.usageRequests &&
          speed.requestLog.every((r: any) => r.complete || (r.error === "OUTPUT_INCOMPLETE" && r.usage)))) {
          attempt.report = closed.report; attempt.status = "failed_known"; attempt.error = String(e.message).slice(0, 180);
          active = ""; await save();
          console.log(JSON.stringify({ variant, scenario, status: "failed_known", error: attempt.error }));
          await evaluate("(async()=>{await window.__speedSession?.end().catch(()=>undefined);await window.__speedCtx?.close();if(window.__speedOriginal)Object.defineProperty(HTMLMediaElement.prototype,'srcObject',window.__speedOriginal)})()").catch(() => {});
          continue;
        }
      }
      throw e;
    }
  }
} catch (e: any) {
  const last = attempts[attempts.length - 1];
  const reason = String(e.message).replace(/https?:\/\/\S+/g, "[url omitted]").slice(0, 220);
  if (last) { last.status = "stopped"; last.error = reason; }
  await writeFile(out + "/stop.json", JSON.stringify({ at: new Date().toISOString(), reason, attempts: attempts.length }, null, 2));
  await save(); console.log(JSON.stringify({ stopped: true, reason }));
  process.exitCode = 1;
} finally {
  if (active && !stopAttempted) { try { stopAttempted = true; await http(`/sessions/${active}`, "DELETE"); } catch { console.log("STOP_OUTCOME_UNKNOWN_NO_RETRY"); } }
  cdp?.close(); chrome?.kill("SIGTERM");
  browserServer?.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  if (loginCreated) await storage.deleteSession(token);
  await pool.end();
}
