// Standalone tutor avatar page served at /tutor, loaded by the iOS WKWebView.
// This page is ONLY the avatar/render + realtime transport layer:
//   - fetches client-safe status/session data from our backend (Bearer token
//     passed by the native app via ?auth=)
//   - renders the tutor with @met4citizen/talkinghead (Three.js, client-side)
//   - streams mic audio (PCM16 @ 24 kHz) to the engine realtime WebSocket and
//     plays streamed TTS audio with word-timestamp lip-sync via speakAudio().
// No teaching logic, no engine API key, nothing engine-side lives here.
export const TUTOR_AVATAR_PAGE_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>TalkHint — Репетитор</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;background:#0f0f14;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
  #avatar{position:absolute;inset:0}
  #overlay{position:absolute;left:0;right:0;bottom:0;padding:16px;display:flex;flex-direction:column;gap:10px;pointer-events:none}
  #subtitle{min-height:44px;background:rgba(20,20,30,.8);border-radius:14px;padding:10px 14px;font-size:16px;line-height:1.4;backdrop-filter:blur(8px)}
  #controls{display:flex;gap:10px;justify-content:center;pointer-events:auto}
  button{border:0;border-radius:14px;padding:14px 20px;font-size:16px;font-weight:700;color:#fff;background:#6366f1}
  button:disabled{background:#333;color:#888}
  #endBtn{background:#3a3a4a}
  #status{font-size:12px;color:#8888aa;text-align:center}
  #review{position:absolute;inset:0;background:#0f0f14;overflow-y:auto;padding:16px;display:none}
  #review h2{font-size:18px;margin-bottom:12px}
  #review label{display:block;font-size:12px;color:#8888aa;margin:12px 0 4px}
  #review input,#review textarea{width:100%;background:#1c1c28;border:1px solid #33334a;border-radius:10px;color:#fff;padding:10px;font-size:15px;font-family:inherit}
  #review textarea{min-height:80px;resize:vertical}
  #review .hint{font-size:11px;color:#666680;margin-top:2px}
  #confirmBtn{width:100%;margin-top:16px;background:#22c55e}
  #micDot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#555;margin-right:6px}
  .rec #micDot{background:#ef4444}
</style>
</head>
<body>
<div id="avatar"></div>
<div id="review">
  <h2>Память разговора</h2>
  <div class="hint">Проверьте подготовку. Она попадёт в подсказки только после подтверждения и будет использована один раз — в следующем реальном звонке.</div>
  <label>Цель</label><input id="rObjective"/>
  <label>Факты (по одному в строке)</label><textarea id="rFacts"></textarea>
  <label>Вопросы, которые вы хотите задать</label><textarea id="rQuestions"></textarea>
  <label>Отрепетированные ответы</label><textarea id="rAnswers"></textarea>
  <label>Словарь</label><textarea id="rVocab"></textarea>
  <label>Непроверенные факты (ассистент не будет их утверждать)</label><textarea id="rUncertain"></textarea>
  <button id="confirmBtn">Сохранить и подтвердить</button>
  <div id="reviewStatus" class="hint" style="margin-top:8px"></div>
</div>
<div id="overlay">
  <div id="subtitle"></div>
  <div id="status"><span id="micDot"></span><span id="statusText">Загрузка…</span></div>
  <div id="controls">
    <button id="startBtn" disabled>Начать тренировку</button>
    <button id="endBtn" style="display:none">Завершить</button>
  </div>
</div>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js/+esm",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/",
  "talkinghead": "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.4/modules/talkinghead.mjs"
} }
</script>
<script type="module">
// Auth: the token NEVER travels in the page URL (query strings leak into
// webview history/logs). The native app injects it via window.__setAuth(...)
// after requesting it with the "needAuth" bridge message; for plain-browser
// testing a URL FRAGMENT (#auth=..., never sent to the server) is accepted.
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

const statusText = document.getElementById("statusText");
const subtitle = document.getElementById("subtitle");
const startBtn = document.getElementById("startBtn");
const endBtn = document.getElementById("endBtn");
const setStatus = t => statusText.textContent = t;

let head = null, ws = null, sessionId = null, micCtx = null, micNode = null, micStream = null;

// Notify the native app (auth handshake, memory lifecycle events).
const notifyNative = (msg) => { try { window.webkit?.messageHandlers?.tutor?.postMessage(msg); } catch(_){} };
// Ask the native shell for the session token (it answers via window.__setAuth).
notifyNative({ event: "needAuth" });

// --- Call Memory review/confirm UI ---------------------------------------
const review = document.getElementById("review");
const reviewStatus = document.getElementById("reviewStatus");
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
  reviewStatus.textContent = "Сохраняем…";
  try {
    await api("/api/tutor/memories/" + reviewMemoryId, { method: "PATCH", body: JSON.stringify({
      objective: document.getElementById("rObjective").value.trim(),
      facts: splitLines("rFacts"), questions: splitLines("rQuestions"),
      rehearsed_answers: splitLines("rAnswers"), vocabulary: splitLines("rVocab"),
      uncertain_facts: splitLines("rUncertain"),
    })});
    await api("/api/tutor/memories/" + reviewMemoryId + "/confirm", { method: "POST" });
    reviewStatus.textContent = "Готово! Подготовка будет использована в вашем следующем реальном звонке.";
    notifyNative({ event: "callMemoryConfirmed", memoryId: reviewMemoryId });
  } catch (e) {
    reviewStatus.textContent = "Ошибка: " + e.message;
    btn.disabled = false;
  }
};

async function init() {
  let status;
  try { status = await api("/api/tutor/status"); }
  catch (e) { setStatus("Ошибка подключения: " + e.message); return; }
  if (!status.configured) { setStatus("Репетитор не настроен."); return; }
  if (!status.ready) { setStatus("Движок репетитора недоступен (нужна публикация движка)."); return; }
  if (!status.callMemoryReady) setStatus("Тренировка доступна; перенос в реальный звонок пока недоступен.");

  try {
    const { TalkingHead } = await import("talkinghead");
    head = new TalkingHead(document.getElementById("avatar"), { cameraView: "upper", ttsEndpoint: "none" });
    const url = status.tutor.glbUrl + (status.tutor.assetVersion ? "?v=" + encodeURIComponent(status.tutor.assetVersion) : "");
    await head.showAvatar({ url, body: status.tutor.body || "F" });
    setStatus("Готово. Нажмите «Начать тренировку».");
    startBtn.disabled = false;
  } catch (e) {
    setStatus("Не удалось загрузить аватара: " + e.message);
  }
}

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
  document.body.classList.add("rec");
}

function stopMic() {
  document.body.classList.remove("rec");
  try { micNode?.disconnect(); } catch(_){}
  try { micStream?.getTracks().forEach(t=>t.stop()); } catch(_){}
  try { micCtx?.close(); } catch(_){}
  micNode = micCtx = micStream = null;
}

// Play a tutor TTS chunk (mp3 binary frame) with lip-sync via TalkingHead.
let pendingTtsMeta = null; // descriptor JSON that precedes each binary frame
async function playTtsBinary(buf, meta) {
  try {
    const actx = head.audioCtx || new AudioContext();
    const audio = await actx.decodeAudioData(buf.slice(0));
    head.speakAudio({ audio, words: [], wtimes: [], wdurations: [] });
    if (meta?.subtitle) subtitle.textContent = meta.subtitle;
  } catch (e) { console.error("TTS play failed", e); }
}

// Realtime protocol (tutor-realtime/1.0, verified in production):
//   client → auth {token, session_id} → server session.ready
//   client → turn.start → stream (audio.chunk descriptor + binary pcm16@24k)
//   client → audio.end when the user stops speaking (silence-detected)
//   server → speech.partial/final, tutor.text.delta,
//            tutor.audio.chunk (mp3 descriptor) + binary frame, turn.completed
let turnOpen = false, speaking = false, lastVoiceAt = 0, silenceTimer = null;
const SILENCE_MS = 1300;

function rms(int16) {
  let s = 0; for (let i = 0; i < int16.length; i++) { const v = int16[i] / 32768; s += v * v; }
  return Math.sqrt(s / (int16.length || 1));
}

function beginTurn() {
  if (ws?.readyState === 1 && !turnOpen) {
    turnOpen = true; speaking = false;
    ws.send(JSON.stringify({ type: "turn.start" }));
    setStatus("Говорите (можно по-русски или по-английски)…");
  }
}

function endTurnAudio() {
  if (ws?.readyState === 1 && turnOpen && speaking) {
    ws.send(JSON.stringify({ type: "audio.end" }));
    turnOpen = false; speaking = false;
    setStatus("Emma слушает и отвечает…");
  }
}

startBtn.onclick = async () => {
  startBtn.disabled = true;
  setStatus("Создаём сессию…");
  let session;
  try { session = await api("/api/tutor/sessions", { method: "POST" }); }
  catch (e) { setStatus("Ошибка: " + e.message); startBtn.disabled = false; return; }
  sessionId = session.sessionId;
  ws = new WebSocket(session.realtime.wsUrl);
  ws.binaryType = "arraybuffer";
  // Token goes in the FIRST WS MESSAGE, never in the URL.
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: session.realtime.token, session_id: sessionId }));
  ws.onmessage = (e) => {
    if (typeof e.data !== "string") {
      if (pendingTtsMeta) { const meta = pendingTtsMeta; pendingTtsMeta = null; playTtsBinary(e.data, meta); }
      return;
    }
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "session.ready") {
      startBtn.style.display = "none"; endBtn.style.display = "";
      notifyNative({ event: "wsReady" });
      (async () => {
        try {
          await startMic((buf) => {
            if (ws?.readyState !== 1 || !turnOpen) return;
            const int16 = new Int16Array(buf);
            const level = rms(int16);
            if (level > 0.012) {
              speaking = true; lastVoiceAt = Date.now();
              if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
            } else if (speaking && !silenceTimer) {
              silenceTimer = setTimeout(() => { silenceTimer = null; if (Date.now() - lastVoiceAt >= SILENCE_MS) endTurnAudio(); }, SILENCE_MS);
            }
            ws.send(JSON.stringify({ type: "audio.chunk", format: "pcm16", sample_rate: 24000, size: buf.byteLength }));
            ws.send(buf);
          });
          beginTurn();
        } catch (err) { setStatus("Нет доступа к микрофону: " + err.message); }
      })();
    }
    else if (msg.type === "speech.partial") subtitle.textContent = "Вы: " + (msg.text || "");
    else if (msg.type === "speech.final") subtitle.textContent = "Вы: " + (msg.text || "");
    else if (msg.type === "tutor.text.delta") { /* full text arrives as subtitles with audio */ }
    else if (msg.type === "tutor.audio.chunk") pendingTtsMeta = msg;
    else if (msg.type === "turn.completed") { beginTurn(); }
    else if (msg.type === "error") { console.error("Engine error:", msg.code); notifyNative({ event: "wsEngineError", code: msg.code }); }
  };
  ws.onclose = (e) => { stopMic(); turnOpen = false; notifyNative({ event: "wsClosed", code: e.code, reason: e.reason || "" }); if (sessionId) setStatus("Соединение закрыто."); };
  ws.onerror = () => { setStatus("Ошибка соединения с репетитором."); notifyNative({ event: "wsError" }); };
};

endBtn.onclick = async () => {
  endBtn.disabled = true;
  stopMic();
  try { ws?.close(); } catch(_){}
  setStatus("Получаем память разговора…");
  try {
    const result = await api("/api/tutor/sessions/" + encodeURIComponent(sessionId) + "/end", { method: "POST" });
    if (result.callMemory) {
      setStatus("Память разговора готова — подтвердите её перед звонком.");
      notifyNative({ event: "callMemoryReady", memoryId: result.callMemory.id });
      showReview(result.callMemory);
    } else {
      setStatus(result.message || "Память разговора недоступна.");
      notifyNative({ event: "callMemoryUnavailable" });
    }
  } catch (e) {
    setStatus("Ошибка: " + e.message);
    notifyNative({ event: "endFailed", message: e.message });
  }
  sessionId = null;
};

init();
</script>
</body>
</html>`;
