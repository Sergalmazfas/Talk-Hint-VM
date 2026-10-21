/**
 * Explicit, paid Dev-only integration probe. No Twilio, phone numbers, owner
 * profiles or stored audio. Synthetic counterpart clips stay in memory.
 * Run: npx tsx scripts/probe-secretary-lab-realtime.ts --live
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import WebSocket from "ws";
import { OpenAILabRealtime, LAB_REALTIME_MODEL, LAB_REALTIME_VOICE, labRealtimeConfig } from "../server/secretaryLab/openAIRealtime";

if (!process.argv.includes("--live")) throw new Error("Use --live to explicitly allow paid synthetic OpenAI audio testing; never a telephone call.");
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string, timeout = 25_000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error(`Timeout: ${label}`); await pause(100); }
}
async function counterpart(): Promise<Buffer[]> {
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${LAB_REALTIME_MODEL}`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  const clips: Buffer[] = [];
  let ready = false, failure = "", chunks: Buffer[] = [], completed = 0;
  ws.on("open", () => ws.send(JSON.stringify({ type: "session.update", session: {
    type: "realtime", model: LAB_REALTIME_MODEL, output_modalities: ["audio"], reasoning: { effort: "low" },
    instructions: "Read only the quoted test phrase exactly, in English. No commentary.",
    audio: { output: { voice: "cedar", format: { type: "audio/pcm", rate: 24000 } } },
  } })));
  ws.on("error", () => { failure = "Counterpart transport failed"; });
  ws.on("message", raw => {
    const e = JSON.parse(raw.toString());
    if (e.type === "session.updated") ready = e.session.model === LAB_REALTIME_MODEL;
    if (e.type === "error") failure = `Counterpart error: ${e.error?.code ?? "unknown"}`;
    if (e.type === "response.output_audio.delta") chunks.push(Buffer.from(e.delta, "base64"));
    if (e.type === "response.done") {
      if (e.response?.status !== "completed") failure = "Counterpart response incomplete";
      clips.push(Buffer.concat(chunks)); chunks = []; completed++;
    }
  });
  try {
    await until(() => ready || !!failure, "counterpart session"); if (failure) throw new Error(failure);
    const phrases = [
      "Hello. Actually, please ask only about Saturday.",
      "Please hold while I check.",
      "I'm back. We are open Saturday from nine until noon.",
    ];
    for (let i = 0; i < phrases.length; i++) {
      ws.send(JSON.stringify({ type: "response.create", response: { instructions: `Say exactly: "${phrases[i]}"`, max_output_tokens: 1024 } }));
      await until(() => completed > i || !!failure, "synthetic counterpart clip");
      if (failure || !clips[i]?.length) throw new Error(failure || "No synthetic audio");
    }
    return clips;
  } finally { ws.close(); }
}

const clips = await counterpart();
if (process.argv.includes("--websocket-check")) {
  // Independent provider check with a continuous, sample-clocked silence tail.
  // It is NOT a runtime fallback or proof of browser/device playback.
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${LAB_REALTIME_MODEL}`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  const config = labRealtimeConfig("Find out whether the office is open Saturday and its opening hours. This is a synthetic test.");
  Object.assign(config.audio.input, { format: { type: "audio/pcm", rate: 24000 } });
  let ready = false, failure = "", generating = false, audioBytes = 0, speechStarts = 0;
  const turns: Array<{ role: string; text: string }> = [];
  const queue: Buffer[] = [], silence = Buffer.alloc(960);
  let sender: ReturnType<typeof setInterval> | undefined;
  const send = (event: object) => ws.send(JSON.stringify(event));
  ws.on("open", () => send({ type: "session.update", session: config }));
  ws.on("error", () => { failure = "provider_connection_error"; });
  ws.on("message", raw => {
    const e = JSON.parse(raw.toString());
    if (e.type === "session.updated") ready = e.session.model === LAB_REALTIME_MODEL && e.session.audio?.output?.voice === LAB_REALTIME_VOICE;
    if (e.type === "error" && e.error?.code !== "response_cancel_not_active") failure = `provider_${e.error?.code ?? "error"}`;
    if (e.type === "input_audio_buffer.speech_started") speechStarts++;
    if (e.type === "response.created") generating = true;
    if (e.type === "response.done") generating = false;
    if (e.type === "response.output_audio.delta") audioBytes += Buffer.byteLength(e.delta, "base64");
    if (e.type === "response.output_audio_transcript.done") turns.push({ role: "secretary", text: e.transcript });
    if (e.type === "conversation.item.input_audio_transcription.completed") turns.push({ role: "guest", text: e.transcript });
  });
  try {
    await until(() => ready || !!failure, "provider exact session"); if (failure) throw new Error(failure);
    sender = setInterval(() => send({ type: "input_audio_buffer.append", audio: (queue.shift() ?? silence).toString("base64") }), 20);
    send({ type: "response.create" });
    await until(() => audioBytes > 0 || !!failure, "provider introduction");
    const play = async (clip: Buffer) => {
      for (let i = 0; i < clip.length; i += 960) {
        const frame = Buffer.alloc(960); clip.copy(frame, 0, i, Math.min(i + 960, clip.length)); queue.push(frame);
      }
      await until(() => queue.length === 0 || !!failure, "clocked counterpart audio");
    };
    await play(clips[0]);
    await until(() => (turns.filter(t => t.role === "guest").length >= 1 && turns.filter(t => t.role === "secretary").length >= 2 && !generating) || !!failure, "provider correction and reply");
    if (failure) throw new Error(failure);
    await play(clips[1]);
    await until(() => turns.filter(t => t.role === "guest").length >= 2 || !!failure, "provider hold");
    const before = turns.filter(t => t.role === "secretary").length;
    await pause(8000);
    const holdReplies = turns.filter(t => t.role === "secretary").length - before;
    if (failure || holdReplies > 1) throw new Error(failure || "unsolicited_hold_replies");
    await play(clips[2]);
    await until(() => (turns.filter(t => t.role === "guest").length >= 3 && turns.filter(t => t.role === "secretary").length > before + holdReplies && !generating) || !!failure, "provider resume");
    if (failure) throw new Error(failure);
    console.log(JSON.stringify({ passed: true, transport: "Independent real OpenAI WebSocket audio validation, NOT browser WebRTC acceptance",
      model: LAB_REALTIME_MODEL, voice: LAB_REALTIME_VOICE, reasoning: "high", audioBytes, speechStarts,
      actualHoldSeconds: 8, holdReplies, turns, audioSaved: false }, null, 2));
  } finally { if (sender) clearInterval(sender); ws.close(); }
  process.exit(0);
}
const profile = await mkdtemp(join(tmpdir(), "secretary-rtc-probe-"));
const host = createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Isolated audio probe</title>"); });
await new Promise<void>(resolve => host.listen(0, "127.0.0.1", resolve));
const address = host.address() as { port: number };
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run",
  "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
let cdp: WebSocket | undefined, driver: OpenAILabRealtime | undefined;
const turns: Array<{ role: string; text: string; interrupted?: boolean }> = [];
const stages: string[] = [];
let ended = "", speaking = false, ready = false, clearCount = 0;
try {
  const debugUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Browser startup timeout")), 10_000);
    chrome.stderr.on("data", raw => {
      const match = raw.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.once("error", reject);
  });
  cdp = new WebSocket(debugUrl);
  await new Promise<void>((resolve, reject) => { cdp!.once("open", resolve); cdp!.once("error", reject); });
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const call = (method: string, params: object = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); cdp!.send(JSON.stringify({ id, method, params, sessionId }));
  });
  let session = "";
  const evaluate = async (expression: string) => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
    if (result.exceptionDetails) throw new Error("Browser probe execution failed");
    return result.result?.value;
  };
  cdp.on("message", async raw => {
    const e = JSON.parse(raw.toString());
    if (e.id && pending.has(e.id)) {
      const p = pending.get(e.id)!; pending.delete(e.id);
      if (e.error) p.reject(new Error("Browser protocol failure")); else p.resolve(e.result);
    } else if (e.method === "Runtime.bindingCalled" && e.params.name === "probeSend") {
      const message = JSON.parse(e.params.payload);
      if (message.type === "offer") {
        stages.push("browser_offer");
        try {
          const sdp = await driver!.connect(message.sdp);
          await evaluate(`window.resolveOffer(${JSON.stringify({ sdp, model: LAB_REALTIME_MODEL, voice: LAB_REALTIME_VOICE })})`);
        } catch { ended = "webrtc_setup_failed"; await evaluate("window.rejectOffer(new Error('Setup failed'))"); }
      } else if (message.type === "rtc_connected") driver!.startIntroduction();
      else if (message.type === "ready") ready = true;
      else if (message.type === "error") ended = String(message.reason);
    }
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  session = (await call("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await call("Runtime.enable", {}, session);
  await call("Page.enable", {}, session);
  await call("Page.navigate", { url: `http://127.0.0.1:${address.port}` }, session);
  // Target.createTarget/navigation can replace the execution context after an
  // early evaluate. Never inject the audio harness into that transient context.
  let loaded = false;
  for (let i = 0; i < 100 && !loaded; i++) {
    try { loaded = await evaluate("document.readyState==='complete' && location.hostname==='127.0.0.1'"); } catch {}
    if (!loaded) await pause(100);
  }
  if (!loaded) throw new Error("Isolated browser page did not finish loading");
  await call("Runtime.addBinding", { name: "probeSend" }, session);
  const bundle = await build({ entryPoints: ["client/src/lib/secretary-lab-rtc.ts"], bundle: true, write: false,
    format: "iife", globalName: "RtcLab", platform: "browser", logLevel: "silent" });
  driver = new OpenAILabRealtime("synthetic-probe", "Find out whether the office is open Saturday and its opening hours. This is a synthetic private test.", {
    ready: () => { void evaluate("window.controller.markModelReady()"); },
    turn: (role, text, interrupted) => turns.push({ role, text, interrupted }),
    state: state => { speaking = state === "speaking"; },
    clear: id => { clearCount++; void evaluate(`window.controller.clearInterruptedOutput(${JSON.stringify(id)})`); },
    event: type => stages.push(type), end: reason => { ended = reason; },
  });
  await evaluate(bundle.outputFiles[0].text);
  await evaluate(`(async()=>{
    window.ctx=new AudioContext(); await ctx.resume();
    window.input=ctx.createMediaStreamDestination();
    // Keep the synthetic sender producing genuine zero-valued audio after a
    // finite clip. Otherwise an inactive WebAudio graph can stop supplying RTP.
    window.keepalive=ctx.createConstantSource(); keepalive.offset.value=0; keepalive.connect(input); keepalive.start();
    window.controller=RtcLab.createLabRtcController({
      stream:input.stream,
      onReady:()=>probeSend(JSON.stringify({type:'ready'})),
      onError:(reason)=>probeSend(JSON.stringify({type:'error',reason})),
      sendSocket:(message)=>probeSend(JSON.stringify(message))
    });
    window.playCounterpart=async(base64)=>{
      const raw=atob(base64), buffer=ctx.createBuffer(1,raw.length/2,24000), samples=buffer.getChannelData(0);
      const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)), view=new DataView(bytes.buffer);
      for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
      const source=ctx.createBufferSource(); source.buffer=buffer; source.connect(input); source.start();
      await new Promise(resolve=>source.onended=resolve); source.disconnect();
    };
    void controller.negotiate(sdp=>new Promise((resolve,reject)=>{
      window.resolveOffer=resolve;window.rejectOffer=reject;probeSend(JSON.stringify({type:'offer',sdp}));
    })).catch(()=>probeSend(JSON.stringify({type:'error',reason:'negotiation_failed'})));
  })()`);
  await until(() => (ready && speaking) || !!ended, "WebRTC ready and introduction", 35_000);
  if (ended) throw new Error(ended);
  await pause(250);
  await evaluate(`playCounterpart(${JSON.stringify(clips[0].toString("base64"))})`);
  await until(() => (turns.some(t => t.role === "guest") && turns.some(t => t.role === "secretary" && !t.interrupted) && !speaking) || !!ended, "reply after barge-in");
  if (ended) throw new Error(ended);
  await evaluate(`playCounterpart(${JSON.stringify(clips[1].toString("base64"))})`);
  await until(() => turns.filter(t => t.role === "guest").length >= 2 || !!ended, "Please hold transcription");
  const beforeHold = turns.filter(t => t.role === "secretary").length;
  await pause(8000);
  if (ended) throw new Error(ended);
  const holdReplies = turns.filter(t => t.role === "secretary").length - beforeHold;
  if (holdReplies > 1) throw new Error("Repeated unsolicited replies during hold");
  await evaluate(`playCounterpart(${JSON.stringify(clips[2].toString("base64"))})`);
  await until(() => (turns.filter(t => t.role === "guest").length >= 3 && !speaking && turns.filter(t => t.role === "secretary").length > beforeHold + holdReplies) || !!ended,
    "resumed same conversation", 35_000);
  if (ended || clearCount < 1) throw new Error(ended || "No real speech-start interruption observed");
  const browser = await evaluate(`({connected:controller.pc.connectionState,audioIsRemote:controller.audio.srcObject!==input.stream,localAudioElements:document.querySelectorAll('audio').length})`);
  console.log(JSON.stringify({ passed: true, model: LAB_REALTIME_MODEL, voice: LAB_REALTIME_VOICE, reasoning: "high",
    transport: "actual browser WebRTC + server sideband", clearCount, actualHoldSeconds: 8, holdReplies, browser,
    turns: turns.map(t => ({ ...t, text: t.text.slice(0, 180) })),
    limitations: "Synthetic counterpart, Chromium only. No real user microphone/iPhone, no telephone call, no audio saved." }, null, 2));
} catch (error) {
  // Only synthetic text and categorical diagnostics; never SDP or credentials.
  console.error(JSON.stringify({ probeFailed: error instanceof Error ? error.message : "unknown",
    ready, ended, speaking, clearCount, stages, turns }, null, 2));
  throw error;
} finally {
  await driver?.stop();
  cdp?.close();
  chrome.kill("SIGKILL");
  await new Promise(resolve => chrome.once("exit", resolve));
  await new Promise<void>(resolve => host.close(() => resolve()));
  await rm(profile, { recursive: true, force: true });
}
