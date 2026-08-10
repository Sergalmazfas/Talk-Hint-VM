// Standalone tutor page served at /tutor, loaded by the iOS WKWebView.
// Tutor UI v2 (hold-to-talk): light shell, avatar viewport on top, scrollable
// teaching-card feed, large push-to-talk mic. This page is ONLY render +
// realtime transport:
//   - fetches client-safe status/session data from our backend (Bearer token
//     injected by the native app via window.__setAuth, never in the URL)
//   - renders the tutor with @met4citizen/talkinghead (Three.js, client-side)
//   - streams mic audio (PCM16 @ 24 kHz) ONLY while the mic button is held,
//     plays streamed engine TTS with lip-sync via speakAudio().
// No teaching logic, no engine API key, nothing engine-side lives here.
// TalkHint renders only text actually received from the Tutor Engine.
import { pttNext, micAllowed } from "./tutorPttMachine";

export const TUTOR_AVATAR_PAGE_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>TalkHint — Tutor</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html,body{height:100%;background:#f4f5f9;color:#1c1d26;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
  #app{display:flex;flex-direction:column;height:100%}
  /* Avatar viewport: rounded card, head/upper body, never the whole screen */
  #avatarWrap{flex:0 0 34vh;margin:10px 12px 6px;border-radius:20px;overflow:hidden;position:relative;background:#dfe3ee;box-shadow:0 2px 10px rgba(20,20,40,.08)}
  #avatar{position:absolute;inset:0}
  #endBtn{position:absolute;top:10px;right:10px;z-index:5;border:0;border-radius:12px;padding:8px 12px;font-size:13px;font-weight:600;color:#fff;background:rgba(28,29,38,.55);backdrop-filter:blur(6px)}
  /* Conversation feed */
  #feed{flex:1;overflow-y:auto;padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}
  .card{max-width:88%;border-radius:16px;padding:11px 14px;font-size:16px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
  .card.tutor{align-self:flex-start;background:#fff;box-shadow:0 1px 4px rgba(20,20,40,.07)}
  .card.user{align-self:flex-end;background:#4f46e5;color:#fff}
  .card.user.pending{opacity:.65}
  .card .acts{display:flex;gap:14px;margin-top:8px}
  .card .acts button{border:0;background:none;font-size:13px;color:#6b6f85;padding:2px 0;font-family:inherit}
  .card.tutor .acts button:active{color:#4f46e5}
  /* Bottom hold-to-talk area */
  #bottom{flex:0 0 auto;padding:6px 16px calc(14px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:6px;background:linear-gradient(#f4f5f900,#f4f5f9 30%)}
  #stateLabel{font-size:14px;color:#6b6f85;min-height:18px;text-align:center}
  #micBtn{width:84px;height:84px;border-radius:50%;border:0;background:#4f46e5;color:#fff;font-size:34px;box-shadow:0 6px 18px rgba(79,70,229,.35);display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .12s,background .12s}
  #micBtn:disabled{background:#c2c5d4;box-shadow:none}
  #micBtn.rec{background:#ef4444;transform:scale(1.12);box-shadow:0 0 0 10px rgba(239,68,68,.18)}
  #micBtn.think{background:#8b8fa8}
  #retryBtn{display:none;border:0;border-radius:14px;padding:12px 22px;font-size:16px;font-weight:600;color:#fff;background:#4f46e5}
  /* Memory review */
  #review{position:absolute;inset:0;background:#f4f5f9;overflow-y:auto;padding:16px;padding-bottom:calc(24px + env(safe-area-inset-bottom));display:none;z-index:20}
  #review h2{font-size:18px;margin-bottom:10px}
  #review label{display:block;font-size:12px;color:#6b6f85;margin:12px 0 4px}
  #review input,#review textarea{width:100%;background:#fff;border:1px solid #d9dce8;border-radius:10px;color:#1c1d26;padding:10px;font-size:15px;font-family:inherit}
  #review textarea{min-height:80px;resize:vertical}
  #review .hint{font-size:11px;color:#8a8ea2;margin-top:2px}
  #confirmBtn{width:100%;margin-top:16px;background:#22c55e;border:0;border-radius:14px;padding:14px;font-size:16px;font-weight:700;color:#fff}
</style>
</head>
<body>
<div id="app">
  <div id="avatarWrap">
    <div id="avatar"></div>
    <button id="endBtn" style="display:none"></button>
  </div>
  <div id="feed"></div>
  <div id="bottom">
    <div id="stateLabel"></div>
    <button id="micBtn" disabled aria-label="mic">🎤</button>
    <button id="retryBtn"></button>
  </div>
</div>
<div id="review">
  <h2></h2>
  <div class="hint" id="reviewHint"></div>
  <label id="lObjective"></label><input id="rObjective"/>
  <label id="lFacts"></label><textarea id="rFacts"></textarea>
  <label id="lQuestions"></label><textarea id="rQuestions"></textarea>
  <label id="lAnswers"></label><textarea id="rAnswers"></textarea>
  <label id="lVocab"></label><textarea id="rVocab"></textarea>
  <label id="lUncertain"></label><textarea id="rUncertain"></textarea>
  <button id="confirmBtn"></button>
  <div id="reviewStatus" class="hint" style="margin-top:8px"></div>
</div>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js/+esm",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/",
  "talkinghead": "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.4/modules/talkinghead.mjs"
} }
</script>
<script type="module">
// ---- Localization: ONE UI language (spec §6). Lesson content itself may mix
// RU+EN — that comes from the engine, never from these strings. -------------
const RU = navigator.language?.toLowerCase().startsWith("ru");
const L = RU ? {
  loading: "Загружаем Emma…", connecting: "Подключаемся…", ready: "Удерживайте и говорите",
  recording: "Слушаю…", processing: "Emma думает…", speaking: "Emma говорит…",
  speakingLocked: "Emma говорит — микрофон появится после ответа",
  error: "Ошибка соединения", retry: "Повторить", end: "Завершить",
  ending: "Завершаем тренировку…", memPending: "Готовим память разговора…",
  micDenied: "Нет доступа к микрофону", notConfigured: "Репетитор не настроен.",
  engineDown: "Движок репетитора недоступен.",
  replay: "▶ Ещё раз", copy: "Копировать", copied: "Скопировано",
  reviewTitle: "Память разговора",
  reviewHint: "Проверьте подготовку. Она попадёт в подсказки только после подтверждения и будет использована один раз — в следующем реальном звонке.",
  objective: "Цель", facts: "Факты (по одному в строке)", questions: "Вопросы, которые вы хотите задать",
  answers: "Отрепетированные ответы", vocab: "Словарь", uncertain: "Непроверенные факты (ассистент не будет их утверждать)",
  confirm: "Сохранить и подтвердить", saving: "Сохраняем…",
  confirmed: "Готово! Подготовка будет использована в вашем следующем реальном звонке.",
  memUnavailable: "Память разговора недоступна.", closed: "Соединение закрыто.",
} : {
  loading: "Loading Emma…", connecting: "Connecting…", ready: "Hold to talk",
  recording: "Listening…", processing: "Emma is thinking…", speaking: "Emma is speaking…",
  speakingLocked: "Emma is speaking — mic returns after her reply",
  error: "Connection error", retry: "Retry", end: "End practice",
  ending: "Finishing practice…", memPending: "Preparing your call notes…",
  micDenied: "Microphone access denied", notConfigured: "Tutor is not configured.",
  engineDown: "Tutor engine is unavailable.",
  replay: "▶ Play again", copy: "Copy", copied: "Copied",
  reviewTitle: "Call memory",
  reviewHint: "Review your preparation. It reaches live hints only after you confirm it, and is used once — in your next real call.",
  objective: "Objective", facts: "Facts (one per line)", questions: "Questions you want to ask",
  answers: "Rehearsed answers", vocab: "Vocabulary", uncertain: "Uncertain facts (assistant will not assert them)",
  confirm: "Save and confirm", saving: "Saving…",
  confirmed: "Done! Your preparation will be used in your next real call.",
  memUnavailable: "Call memory is unavailable.", closed: "Connection closed.",
};

// ---- Auth: token NEVER travels in the page URL. ---------------------------
let AUTH = "";
let authResolve;
const authReady = new Promise(res => authResolve = res);
window.__setAuth = (t) => { AUTH = t || ""; authResolve(); };
if (location.hash.startsWith("#auth=")) window.__setAuth(decodeURIComponent(location.hash.slice(6)));
const api = async (path, opts={}) => {
  await authReady;
  const r = await fetch(path, { ...opts, headers: { "Authorization": "Bearer " + AUTH, "Content-Type": "application/json", ...(opts.headers||{}) } });
  if (!r.ok) throw new Error((await r.json().catch(()=>({}))).message || ("HTTP "+r.status));
  return r.json();
};
const notifyNative = (msg) => { try { window.webkit?.messageHandlers?.tutor?.postMessage(msg); } catch(_){} };
notifyNative({ event: "needAuth" });

// ---- Push-to-talk state machine (source shared with server tests) ---------
const pttNext = ${pttNext.toString()};
const micAllowed = ${micAllowed.toString()};
let state = "LOADING";
const micBtn = document.getElementById("micBtn");
const stateLabel = document.getElementById("stateLabel");
const retryBtn = document.getElementById("retryBtn");
const endBtn = document.getElementById("endBtn");
endBtn.textContent = L.end; retryBtn.textContent = L.retry;

function render() {
  const labels = { LOADING: L.loading, READY: L.ready, RECORDING: L.recording,
    PROCESSING: L.processing, SPEAKING: L.speakingLocked, ERROR: L.error,
    ENDING: L.ending, MEMORY: "" };
  stateLabel.textContent = labels[state] ?? "";
  micBtn.disabled = !(state === "READY" || state === "RECORDING");
  micBtn.classList.toggle("rec", state === "RECORDING");
  micBtn.classList.toggle("think", state === "PROCESSING" || state === "SPEAKING");
  retryBtn.style.display = state === "ERROR" ? "" : "none";
  micBtn.style.display = state === "ERROR" ? "none" : "";
}
function dispatch(ev) {
  const next = pttNext(state, ev);
  if (next === state) return false;
  state = next;
  if (!micAllowed(state)) stopMic();
  render();
  return true;
}
render();

// ---- Conversation feed -----------------------------------------------------
const feed = document.getElementById("feed");
function addCard(kind) {
  const el = document.createElement("div");
  el.className = "card " + kind;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
  return el;
}
// Tutor card with replay (reuses engine mp3 — no TalkHint-side TTS) + copy.
function finishTutorCard(el, text, audioBufs) {
  el.textContent = text;
  const acts = document.createElement("div");
  acts.className = "acts";
  if (audioBufs.length) {
    const play = document.createElement("button");
    play.textContent = L.replay;
    play.onclick = () => replayAudio(audioBufs, text);
    acts.appendChild(play);
  }
  const copy = document.createElement("button");
  copy.textContent = L.copy;
  copy.onclick = async () => { try { await navigator.clipboard.writeText(text); copy.textContent = L.copied; setTimeout(()=>copy.textContent=L.copy, 1200); } catch(_){} };
  acts.appendChild(copy);
  el.appendChild(acts);
  feed.scrollTop = feed.scrollHeight;
}

// ---- Avatar + lip-sync -----------------------------------------------------
let head = null;
// Lip-sync diagnostics (spec §8): report what actually happened, never fake.
const lipDiag = { audioArrived: false, timingsFromEngine: false, timingsDerived: false, speakAudioCalled: false, playbackStarted: false };
function reportLipDiag() { notifyNative({ event: "lipsyncDiag", ...lipDiag }); }

// The engine sends mp3 + subtitle text but NO word timings. TalkingHead only
// moves lips when speakAudio gets words/wtimes/wdurations, so we align the
// REAL subtitle words evenly across the REAL decoded audio duration. This is
// alignment of actual received data, not invented mouth movement.
function deriveTimings(text, durationMs) {
  const words = (text || "").split(/\\s+/).filter(Boolean);
  if (!words.length || !durationMs) return null;
  const totalChars = words.reduce((s,w)=>s+w.length, 0) || 1;
  let t = 0; const wtimes = [], wdurations = [];
  for (const w of words) {
    const d = durationMs * (w.length / totalChars);
    wtimes.push(t); wdurations.push(d); t += d;
  }
  return { words, wtimes, wdurations };
}

// latencyMark: { t0: DOMHighResTimeStamp, firstTextMs: number } — present only
// for the FIRST audio chunk of a turn; cleared after one emission per turn.
async function speakBuffer(buf, subtitleText, engineTimings, latencyMark) {
  const actx = head.audioCtx || new AudioContext();
  const audio = await actx.decodeAudioData(buf.slice(0));
  let timing = null;
  if (engineTimings?.words?.length) { timing = engineTimings; lipDiag.timingsFromEngine = true; }
  else { timing = deriveTimings(subtitleText, audio.duration * 1000); if (timing) lipDiag.timingsDerived = true; }
  lipDiag.speakAudioCalled = true;
  head.speakAudio(timing ? { audio, ...timing } : { audio, words: [], wtimes: [], wdurations: [] });
  lipDiag.playbackStarted = true;
  reportLipDiag();
  // Emit latency AFTER decode + speakAudio so firstPlaybackMs = release → playback start.
  if (latencyMark?.t0) {
    notifyNative({ event: "latency",
      firstTextMs: Math.round(latencyMark.firstTextMs),
      firstPlaybackMs: Math.round(performance.now() - latencyMark.t0) });
  }
  return audio.duration;
}
async function replayAudio(bufs, text) {
  try { for (const b of bufs) await speakBuffer(b.buf, b.subtitle || text, b.timings); } catch(e){ console.error("replay failed", e); }
}

// ---- Mic (push-to-talk gated; NO continuous capture) -----------------------
// Turn lifecycle: turn.start is sent LAZILY with the first PCM chunk, so a
// fast tap-release or a mic-permission failure never leaves an abandoned open
// turn on the engine. audio.end is sent only when a turn was actually opened.
let micCtx = null, micNode = null, micStream = null, sentAudio = false, turnOpen = false;
async function startMic(sendPcm) {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 24000, echoCancellation: true, noiseSuppression: true } });
  micCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
  const src = micCtx.createMediaStreamSource(micStream);
  await micCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([\`
    class PcmSender extends AudioWorkletProcessor {
      process(inputs){ const ch = inputs[0][0]; if (ch) { const out = new Int16Array(ch.length);
        for (let i=0;i<ch.length;i++){ const s = Math.max(-1, Math.min(1, ch[i])); out[i] = s<0 ? s*0x8000 : s*0x7FFF; }
        this.port.postMessage(out.buffer, [out.buffer]); } return true; }
    } registerProcessor("pcm-sender", PcmSender);\`], { type: "application/javascript" })));
  micNode = new AudioWorkletNode(micCtx, "pcm-sender");
  micNode.port.onmessage = (e) => sendPcm(e.data);
  src.connect(micNode);
}
function stopMic() {
  try { micNode?.disconnect(); } catch(_){}
  try { micStream?.getTracks().forEach(t=>t.stop()); } catch(_){}
  try { micCtx?.close(); } catch(_){}
  micNode = micCtx = micStream = null;
}

// ---- Realtime session (tutor-realtime/1.0, verified in production) --------
let ws = null, sessionId = null;
let latencyT0 = 0;                // set at audio.end; cleared on first tutor audio
let latencyFirstText = 0;         // release → first tutor.text.delta (ms)
let pendingTtsMeta = null;
let userCard = null;              // pending user transcript card
let tutorText = "";               // accumulated tutor.text.delta for this turn
let tutorAudio = [];              // engine mp3 buffers for replay
let tutorCard = null;

async function connect() {
  state = "LOADING"; render();
  let status;
  try { status = await api("/api/tutor/status"); }
  catch (e) { stateLabel.textContent = L.error + ": " + e.message; dispatch("error"); return; }
  if (!status.configured) { stateLabel.textContent = L.notConfigured; return; }
  if (!status.ready) { stateLabel.textContent = L.engineDown; return; }

  if (!head) {
    try {
      const { TalkingHead } = await import("talkinghead");
      head = new TalkingHead(document.getElementById("avatar"), { cameraView: "upper", ttsEndpoint: "none" });
      const url = status.tutor.glbUrl + (status.tutor.assetVersion ? "?v=" + encodeURIComponent(status.tutor.assetVersion) : "");
      await head.showAvatar({ url, body: status.tutor.body || "F" });
    } catch (e) { stateLabel.textContent = L.error + ": " + e.message; dispatch("error"); return; }
  }

  stateLabel.textContent = L.connecting;
  let session;
  try { session = await api("/api/tutor/sessions", { method: "POST" }); }
  catch (e) { stateLabel.textContent = L.error + ": " + e.message; dispatch("error"); return; }
  sessionId = session.sessionId;
  turnOpen = false; sentAudio = false; // fresh session — reset turn bookkeeping
  ws = new WebSocket(session.realtime.wsUrl);
  ws.binaryType = "arraybuffer";
  // Token goes in the FIRST WS MESSAGE, never in the URL.
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: session.realtime.token, session_id: sessionId }));
  ws.onmessage = onWsMessage;
  ws.onclose = (e) => { stopMic(); turnOpen = false; notifyNative({ event: "wsClosed", code: e.code, reason: e.reason || "" }); if (sessionId && state !== "ENDING" && state !== "MEMORY") { stateLabel.textContent = L.closed; dispatch("error"); } };
  ws.onerror = () => { notifyNative({ event: "wsError" }); dispatch("error"); };
}

function onWsMessage(e) {
  if (typeof e.data !== "string") {
    if (pendingTtsMeta) {
      const meta = pendingTtsMeta; pendingTtsMeta = null;
      lipDiag.audioArrived = true;
      // Capture latency mark for this chunk (only the first chunk per turn has t0 set).
      const lmark = latencyT0 ? { t0: latencyT0, firstTextMs: latencyFirstText } : null;
      latencyT0 = 0; latencyFirstText = 0;
      tutorAudio.push({ buf: e.data, subtitle: meta.subtitle || meta.text || "", timings: meta.words ? { words: meta.words, wtimes: meta.wtimes, wdurations: meta.wdurations } : null });
      if (meta.subtitle && !tutorText) tutorText = meta.subtitle;
      turnOpen = false; // engine moved on to its reply — our user turn is over
      dispatch("tutorSpeaking"); // force-stops mic even if still RECORDING
      // lmark passed so latency is emitted AFTER decode + speakAudio (playback start).
      speakBuffer(e.data, meta.subtitle || tutorText, tutorAudio[tutorAudio.length-1].timings, lmark).catch(err => console.error("TTS play failed", err));
      if (!tutorCard) tutorCard = addCard("tutor");
      tutorCard.textContent = tutorText || meta.subtitle || "…";
    }
    return;
  }
  let msg; try { msg = JSON.parse(e.data); } catch { return; }
  if (msg.type === "session.ready") {
    endBtn.style.display = "";
    notifyNative({ event: "wsReady" });
    dispatch("ready");
  }
  else if (msg.type === "speech.partial") {
    if (!userCard) userCard = addCard("user pending");
    userCard.textContent = msg.text || "…";
  }
  else if (msg.type === "speech.final") {
    if (!userCard) userCard = addCard("user");
    userCard.classList.remove("pending");
    userCard.textContent = msg.text || "";
    userCard = null;
  }
  else if (msg.type === "tutor.text.delta") { if (latencyT0 && !latencyFirstText) latencyFirstText = performance.now() - latencyT0; tutorText += msg.text || msg.delta || ""; if (tutorCard) tutorCard.textContent = tutorText; }
  else if (msg.type === "tutor.audio.chunk") pendingTtsMeta = msg;
  else if (msg.type === "turn.completed") {
    if (tutorCard) { finishTutorCard(tutorCard, tutorText || tutorCard.textContent, tutorAudio.slice()); }
    tutorCard = null; tutorText = ""; tutorAudio = []; userCard = null;
    dispatch("turnCompleted");
  }
  else if (msg.type === "error") { console.error("Engine error:", msg.code); notifyNative({ event: "wsEngineError", code: msg.code }); }
}

// ---- Hold-to-talk gestures -------------------------------------------------
async function pressDown(ev) {
  ev.preventDefault();
  if (!dispatch("pressDown")) return; // only from READY — no double start
  try { navigator.vibrate?.(10); } catch(_){}
  sentAudio = false;
  try {
    await startMic((buf) => {
      // Hard gate: socket ready AND we are still RECORDING. turn.start goes
      // out lazily with the FIRST chunk — audio can never precede it.
      if (ws?.readyState !== 1 || !micAllowed(state)) return;
      if (!turnOpen) { ws.send(JSON.stringify({ type: "turn.start" })); turnOpen = true; }
      ws.send(JSON.stringify({ type: "audio.chunk", format: "pcm16", sample_rate: 24000, size: buf.byteLength }));
      ws.send(buf);
      sentAudio = true;
    });
    if (!micAllowed(state)) stopMic(); // released before mic warmed up
  } catch (err) {
    stateLabel.textContent = L.micDenied;
    if (state === "RECORDING") { state = "READY"; render(); }
    stopMic();
  }
}
function release(ev) {
  ev.preventDefault();
  if (!dispatch("release")) return; // only from RECORDING — no duplicate send
  stopMic();
  if (ws?.readyState === 1 && turnOpen && sentAudio) {
    ws.send(JSON.stringify({ type: "audio.end" }));
    latencyT0 = performance.now(); // measure release → first tutor audio
    turnOpen = false;
  } else {
    // Nothing captured (tap-release too fast, mic denied, socket gone):
    // no turn was opened, so nothing to finalize — just return to READY.
    turnOpen = false;
    state = "READY"; render();
  }
}
micBtn.addEventListener("pointerdown", pressDown);
micBtn.addEventListener("pointerup", release);
micBtn.addEventListener("pointercancel", release);
micBtn.addEventListener("pointerleave", (e) => { if (state === "RECORDING") release(e); });
retryBtn.onclick = () => { dispatch("retry"); connect(); };

// ---- End practice + Call Memory -------------------------------------------
endBtn.onclick = async () => {
  if (!sessionId) return;
  endBtn.disabled = true;
  dispatch("end");
  stopMic();
  try { ws?.close(); } catch(_){}
  stateLabel.textContent = L.memPending;
  try {
    const result = await api("/api/tutor/sessions/" + encodeURIComponent(sessionId) + "/end", { method: "POST" });
    if (result.callMemory) {
      notifyNative({ event: "callMemoryReady", memoryId: result.callMemory.id });
      showReview(result.callMemory);
      dispatch("memoryReview");
    } else {
      stateLabel.textContent = result.message || L.memUnavailable;
      notifyNative({ event: "callMemoryUnavailable" });
    }
  } catch (e) {
    stateLabel.textContent = L.error + ": " + e.message;
    notifyNative({ event: "endFailed", message: e.message });
  }
  sessionId = null;
};

// ---- Call Memory review/confirm (unchanged security flow) ------------------
const review = document.getElementById("review");
const reviewStatus = document.getElementById("reviewStatus");
review.querySelector("h2").textContent = L.reviewTitle;
document.getElementById("reviewHint").textContent = L.reviewHint;
document.getElementById("lObjective").textContent = L.objective;
document.getElementById("lFacts").textContent = L.facts;
document.getElementById("lQuestions").textContent = L.questions;
document.getElementById("lAnswers").textContent = L.answers;
document.getElementById("lVocab").textContent = L.vocab;
document.getElementById("lUncertain").textContent = L.uncertain;
document.getElementById("confirmBtn").textContent = L.confirm;
const splitLines = (id) => document.getElementById(id).value.split("\\n").map(s=>s.trim()).filter(Boolean);
let reviewMemoryId = null;

function showReview(mem) {
  reviewMemoryId = mem.id;
  document.getElementById("rObjective").value = mem.objective || "";
  const fill = (id, v) => document.getElementById(id).value = (Array.isArray(v)?v:[]).join("\\n");
  fill("rFacts", mem.facts); fill("rQuestions", mem.questions);
  fill("rAnswers", mem.rehearsedAnswers); fill("rVocab", mem.vocabulary);
  fill("rUncertain", mem.uncertainFacts);
  review.style.display = "block";
}

document.getElementById("confirmBtn").onclick = async () => {
  const btn = document.getElementById("confirmBtn");
  btn.disabled = true;
  reviewStatus.textContent = L.saving;
  try {
    await api("/api/tutor/memories/" + reviewMemoryId, { method: "PATCH", body: JSON.stringify({
      objective: document.getElementById("rObjective").value.trim(),
      facts: splitLines("rFacts"), questions: splitLines("rQuestions"),
      rehearsed_answers: splitLines("rAnswers"), vocabulary: splitLines("rVocab"),
      uncertain_facts: splitLines("rUncertain"),
    })});
    await api("/api/tutor/memories/" + reviewMemoryId + "/confirm", { method: "POST" });
    reviewStatus.textContent = L.confirmed;
    notifyNative({ event: "callMemoryConfirmed", memoryId: reviewMemoryId });
  } catch (e) {
    reviewStatus.textContent = L.error + ": " + e.message;
    btn.disabled = false;
  }
};

connect();
</script>
</body>
</html>`;
