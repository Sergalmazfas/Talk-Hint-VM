// Standalone tutor page served at /tutor, loaded by the iOS WKWebView.
// Tutor UI v3 (Praktika-style, per user reference screens):
//   - top bar: ✕ (quit w/ confirmation sheet) · tutor name · ⚙ settings popover
//   - compact mode: rounded avatar video card + chat-bubble feed + big purple
//     hold-to-talk mic, keyboard/attach side buttons ("soon" — engine support
//     needed), "What to say?" hint chip
//   - fullscreen mode: avatar fills the screen, large white subtitles overlay,
//     status label + mic at the bottom, collapse button
//   - quit confirmation bottom sheet (Continue / End) → call-memory flow
// This page is ONLY render + realtime transport:
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
  html,body{height:100%;background:#f6f6f8;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
  button{font-family:inherit}
  #app{display:flex;flex-direction:column;height:100%}
  /* --- Top bar ------------------------------------------------------------ */
  #topbar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:calc(8px + env(safe-area-inset-top)) 14px 6px}
  .roundBtn{width:46px;height:46px;border-radius:50%;border:0;background:#fff;box-shadow:0 1px 6px rgba(20,20,40,.10);font-size:19px;display:flex;align-items:center;justify-content:center;color:#111}
  #title{font-size:19px;font-weight:800}
  /* --- Avatar card (compact) --------------------------------------------- */
  #avatarWrap{flex:0 0 36vh;margin:6px 14px;border-radius:24px;overflow:hidden;position:relative;background:#dfe3ee;box-shadow:0 2px 12px rgba(20,20,40,.10);transition:border-radius .2s}
  #avatar{position:absolute;inset:0}
  .ovlBtn{position:absolute;bottom:10px;z-index:5;width:38px;height:38px;border-radius:50%;border:0;background:rgba(20,20,30,.35);backdrop-filter:blur(6px);color:#fff;font-size:17px;display:flex;align-items:center;justify-content:center}
  #muteBtn{right:58px}
  #expandBtn{right:12px}
  /* --- Feed (chat bubbles) ------------------------------------------------ */
  #feed{flex:1;overflow-y:auto;padding:8px 14px 12px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}
  .card{max-width:86%;border-radius:20px;padding:12px 15px;font-size:17px;line-height:1.4;font-weight:600;white-space:pre-wrap;word-break:break-word}
  .card.tutor{align-self:flex-start;background:#efeff3;color:#111;border-bottom-left-radius:6px}
  .card.user{align-self:flex-end;background:#7c3aed;color:#fff;border-bottom-right-radius:6px}
  .card.user.pending{opacity:.65}
  .card .acts{display:flex;gap:18px;margin-top:10px}
  .card .acts button{border:0;background:none;font-size:17px;color:#55586e;padding:2px 0}
  .card.tutor .acts button:active{color:#7c3aed}
  .card .translation{margin-top:8px;padding-top:8px;border-top:1px solid #dcdde6;font-size:15px;font-weight:400;color:#3f4257;display:none}
  .card .translation.show{display:block}
  .card.local .localTag{display:block;margin-top:6px;font-size:11px;font-weight:400;color:#8a8ea2}
  /* --- Hint chip ----------------------------------------------------------- */
  #hintChip{align-self:flex-end;margin:0 14px;border:0;border-radius:22px;padding:12px 18px;font-size:16px;font-weight:700;color:#7c3aed;background:#ece6fb;display:none}
  /* --- Bottom controls ----------------------------------------------------- */
  #bottom{flex:0 0 auto;padding:8px 18px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:8px}
  #stateLabel{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b6f85;min-height:17px;text-align:center}
  #controls{width:100%;display:flex;align-items:center;justify-content:space-between}
  .sideBtn{width:52px;height:52px;border-radius:50%;border:0;background:#fff;box-shadow:0 1px 6px rgba(20,20,40,.10);font-size:20px;color:#111}
  #micBtn{width:92px;height:92px;border-radius:50%;border:0;background:#7c3aed;color:#fff;font-size:36px;box-shadow:0 8px 22px rgba(124,58,237,.35);display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .12s,background .12s}
  #micBtn:disabled{background:#c9cbd8;box-shadow:none}
  #micBtn.rec{background:#ef4444;transform:scale(1.1);box-shadow:0 0 0 12px rgba(239,68,68,.16)}
  #micBtn.think{background:#9b9db2}
  #retryBtn{display:none;border:0;border-radius:16px;padding:13px 24px;font-size:16px;font-weight:700;color:#fff;background:#7c3aed}
  /* --- Fullscreen mode ------------------------------------------------------ */
  body.fs #avatarWrap{position:fixed;inset:0;margin:0;border-radius:0;flex:none;z-index:10}
  body.fs #feed,body.fs #hintChip{display:none!important}
  body.fs #topbar{position:fixed;top:0;left:0;right:0;z-index:30;background:none}
  body.fs #title{display:none}
  body.fs .roundBtn{background:rgba(255,255,255,.28);backdrop-filter:blur(8px);color:#fff}
  body.fs .ovlBtn{display:none}
  body.fs #bottom{position:fixed;left:0;right:0;bottom:0;z-index:20}
  body.fs #stateLabel{color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.5)}
  body.fs #micBtn{background:rgba(255,255,255,.22);backdrop-filter:blur(8px);box-shadow:none;width:78px;height:78px}
  body.fs #micBtn.rec{background:#ef4444}
  body.fs .sideBtn{visibility:hidden}
  #subs{display:none;position:fixed;left:20px;right:20px;bottom:26vh;z-index:15;color:#fff;font-size:26px;line-height:1.3;font-weight:800;text-shadow:0 2px 10px rgba(0,0,0,.55);pointer-events:none}
  body.fs #subs.on{display:block}
  /* --- Settings popover ------------------------------------------------------ */
  #menu{position:fixed;top:calc(60px + env(safe-area-inset-top));right:14px;z-index:60;background:rgba(248,248,250,.96);backdrop-filter:blur(14px);border-radius:22px;box-shadow:0 8px 30px rgba(20,20,40,.22);padding:8px;min-width:250px;display:none}
  #menu.show{display:block}
  #menu .mrow{display:flex;align-items:center;gap:12px;width:100%;border:0;background:none;padding:13px 12px;font-size:17px;font-weight:600;color:#111;border-radius:14px;text-align:left}
  #menu .mrow:active{background:rgba(20,20,40,.06)}
  #menu .mrow .ic{width:26px;text-align:center;font-size:18px}
  #menu .mrow .val{margin-left:auto;font-size:14px;color:#7c3aed;font-weight:700}
  #menuBackdrop{position:fixed;inset:0;z-index:55;display:none}
  #menuBackdrop.show{display:block}
  /* --- Quit sheet ------------------------------------------------------------ */
  #sheetBackdrop{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.35);display:none}
  #quitSheet{position:fixed;left:0;right:0;bottom:0;z-index:71;background:#fff;border-radius:26px 26px 0 0;padding:20px 22px calc(22px + env(safe-area-inset-bottom));display:none;text-align:center}
  #quitSheet .grab{width:44px;height:4px;border-radius:2px;background:#d9dbe4;margin:0 auto 16px}
  #quitSheet .bang{width:58px;height:58px;border-radius:50%;background:#111;color:#fff;font-size:26px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
  #quitSheet h3{font-size:23px;font-weight:800;margin-bottom:10px}
  #quitSheet p{font-size:17px;line-height:1.35;color:#333;margin-bottom:18px}
  #quitSheet .primary{width:100%;border:0;border-radius:28px;padding:16px;font-size:18px;font-weight:800;color:#fff;background:#7c3aed;margin-bottom:10px}
  #quitSheet .secondary{width:100%;border:0;border-radius:28px;padding:16px;font-size:18px;font-weight:800;color:#111;background:#f1f1f5}
  body.sheet #sheetBackdrop,body.sheet #quitSheet{display:block}
  /* --- Toast ------------------------------------------------------------------ */
  #toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(130px + env(safe-area-inset-bottom));z-index:80;background:rgba(20,20,30,.85);color:#fff;font-size:14px;font-weight:600;padding:10px 16px;border-radius:14px;opacity:0;transition:opacity .25s;pointer-events:none}
  #toast.show{opacity:1}
  /* --- Memory review ----------------------------------------------------------- */
  #review{position:absolute;inset:0;background:#f6f6f8;overflow-y:auto;padding:16px;padding-bottom:calc(24px + env(safe-area-inset-bottom));display:none;z-index:90}
  #review h2{font-size:19px;font-weight:800;margin-bottom:10px}
  #review label{display:block;font-size:12px;color:#6b6f85;margin:12px 0 4px}
  #review input,#review textarea{width:100%;background:#fff;border:1px solid #d9dce8;border-radius:12px;color:#111;padding:10px;font-size:15px;font-family:inherit}
  #review textarea{min-height:80px;resize:vertical}
  #review .hint{font-size:11px;color:#8a8ea2;margin-top:2px}
  #confirmBtn{width:100%;margin-top:16px;background:#22c55e;border:0;border-radius:28px;padding:15px;font-size:16px;font-weight:800;color:#fff}
</style>
</head>
<body>
<div id="app">
  <div id="topbar">
    <button id="xBtn" class="roundBtn" aria-label="close">✕</button>
    <div id="title">Emma</div>
    <button id="gearBtn" class="roundBtn" aria-label="settings">⚙︎</button>
  </div>
  <div id="avatarWrap">
    <div id="avatar"></div>
    <button id="muteBtn" class="ovlBtn" aria-label="mute">🔊</button>
    <button id="expandBtn" class="ovlBtn" aria-label="fullscreen">⛶</button>
  </div>
  <div id="feed"></div>
  <button id="hintChip">💡 </button>
  <div id="bottom">
    <div id="stateLabel"></div>
    <div id="controls">
      <button id="kbBtn" class="sideBtn" aria-label="keyboard">⌨︎</button>
      <button id="micBtn" disabled aria-label="mic">🎤</button>
      <button id="attachBtn" class="sideBtn" aria-label="attach">📎</button>
    </div>
    <button id="retryBtn"></button>
  </div>
</div>
<div id="subs"></div>
<div id="menuBackdrop"></div>
<div id="menu">
  <button class="mrow" id="mSubs"><span class="ic">💬</span><span></span><span class="val"></span></button>
  <button class="mrow" id="mMute"><span class="ic">🔊</span><span></span><span class="val"></span></button>
  <button class="mrow" id="mTutor"><span class="ic">👤</span><span></span></button>
  <button class="mrow" id="mEnd"><span class="ic">🏁</span><span></span></button>
</div>
<div id="sheetBackdrop"></div>
<div id="quitSheet">
  <div class="grab"></div>
  <div class="bang">!</div>
  <h3></h3>
  <p></p>
  <button class="primary" id="continueBtn"></button>
  <button class="secondary" id="endBtn"></button>
</div>
<div id="toast"></div>
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
  speakingLocked: "Emma говорит…",
  error: "Ошибка соединения", retry: "Повторить",
  ending: "Завершаем тренировку…", memPending: "Готовим память разговора…",
  micDenied: "Нет доступа к микрофону", notConfigured: "Репетитор не настроен.",
  engineDown: "Движок репетитора недоступен.",
  replay: "🔊", copy: "⧉", copied: "✓",
  translate: "文А", translating: "…", translateFailed: "Не удалось перевести",
  reviewTitle: "Память разговора",
  reviewHint: "Проверьте подготовку. Она попадёт в подсказки только после подтверждения и будет использована один раз — в следующем реальном звонке.",
  objective: "Цель", facts: "Факты (по одному в строке)", questions: "Вопросы, которые вы хотите задать",
  answers: "Отрепетированные ответы", vocab: "Словарь", uncertain: "Непроверенные факты (ассистент не будет их утверждать)",
  confirm: "Сохранить и подтвердить", saving: "Сохраняем…",
  confirmed: "Готово! Подготовка будет использована в вашем следующем реальном звонке.",
  memUnavailable: "Память разговора недоступна.", closed: "Соединение закрыто.",
  greet: (n) => n ? ("Привет, " + n + "! 👋") : "Привет! 👋",
  greetTag: "Приветствие TalkHint — не реплика Emma",
  hintChip: "Что сказать?", soon: "Скоро — нужна поддержка движка",
  quitTitle: "Завершить тренировку?",
  quitBody: "Из ваших реплик будет создана память разговора — проверьте и подтвердите её, чтобы использовать в реальном звонке.",
  quitBodyEmpty: "Вы ещё ничего не сказали. Память разговора не будет создана.",
  continueBtn: "Продолжить", endBtn: "Завершить",
  mSubs: "Субтитры", mMute: "Звук Emma", mTutor: "Сменить репетитора", mEnd: "Завершить тренировку",
  on: "Вкл", off: "Выкл",
} : {
  loading: "Loading Emma…", connecting: "Connecting…", ready: "Hold to talk",
  recording: "Listening…", processing: "Emma is thinking…", speaking: "Emma is speaking…",
  speakingLocked: "Emma is speaking…",
  error: "Connection error", retry: "Retry",
  ending: "Finishing practice…", memPending: "Preparing your call notes…",
  micDenied: "Microphone access denied", notConfigured: "Tutor is not configured.",
  engineDown: "Tutor engine is unavailable.",
  replay: "🔊", copy: "⧉", copied: "✓",
  translate: "文А", translating: "…", translateFailed: "Не удалось перевести",
  reviewTitle: "Call memory",
  reviewHint: "Review your preparation. It reaches live hints only after you confirm it, and is used once — in your next real call.",
  objective: "Objective", facts: "Facts (one per line)", questions: "Questions you want to ask",
  answers: "Rehearsed answers", vocab: "Vocabulary", uncertain: "Uncertain facts (assistant will not assert them)",
  confirm: "Save and confirm", saving: "Saving…",
  confirmed: "Done! Your preparation will be used in your next real call.",
  memUnavailable: "Call memory is unavailable.", closed: "Connection closed.",
  greet: (n) => n ? ("Hi, " + n + "! 👋") : "Hi! 👋",
  greetTag: "TalkHint greeting — not an Emma reply",
  hintChip: "What to say?", soon: "Coming soon — needs engine support",
  quitTitle: "End the practice?",
  quitBody: "We'll build call memory from what you said — review and confirm it to use in a real call.",
  quitBodyEmpty: "You haven't said anything yet. No call memory will be created.",
  continueBtn: "Continue", endBtn: "End",
  mSubs: "Subtitles", mMute: "Emma's voice", mTutor: "Change tutor", mEnd: "End practice",
  on: "On", off: "Off",
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
retryBtn.textContent = L.retry;

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
  hintChip.style.display = state === "READY" ? "" : "none";
}
function dispatch(ev) {
  const next = pttNext(state, ev);
  if (next === state) return false;
  state = next;
  if (!micAllowed(state)) stopMic();
  render();
  return true;
}

// ---- Chrome: hint chip, side buttons, toast --------------------------------
const hintChip = document.getElementById("hintChip");
hintChip.textContent = "💡 " + L.hintChip;
const toast = document.getElementById("toast");
let toastT = null;
function showToast(t) { toast.textContent = t; toast.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(()=>toast.classList.remove("show"), 1800); }
// Keyboard / attach / hint / change-tutor need engine-side support (text turns,
// files, suggestions) — honest "soon" toast, no fake behavior.
hintChip.onclick = () => showToast(L.soon);
document.getElementById("kbBtn").onclick = () => showToast(L.soon);
document.getElementById("attachBtn").onclick = () => showToast(L.soon);

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
    play.setAttribute("aria-label", "replay");
    play.onclick = () => replayAudio(audioBufs, text);
    acts.appendChild(play);
  }
  const copy = document.createElement("button");
  copy.textContent = L.copy;
  copy.setAttribute("aria-label", "copy");
  copy.onclick = async () => { try { await navigator.clipboard.writeText(text); copy.textContent = L.copied; setTimeout(()=>copy.textContent=L.copy, 1200); } catch(_){} };
  acts.appendChild(copy);
  // "Перевод": on-demand RU translation of THIS card's exact text via our
  // backend (auth-scoped, cached). Toggles visibility; never blocks lip-sync
  // or the realtime stream — it is a plain fetch on tap.
  const tr = document.createElement("button");
  tr.className = "translateBtn";
  tr.textContent = L.translate;
  tr.setAttribute("aria-label", "translate");
  const trBox = document.createElement("div");
  trBox.className = "translation";
  let trLoaded = false, trLoading = false;
  tr.onclick = async () => {
    if (trBox.classList.contains("show")) { trBox.classList.remove("show"); return; }
    if (trLoaded) { trBox.classList.add("show"); return; }
    if (trLoading) return;
    trLoading = true;
    tr.textContent = L.translating;
    try {
      const r = await api("/api/tutor/translate", { method: "POST", body: JSON.stringify({ text }) });
      trBox.textContent = r.translation || "";
      trLoaded = true;
      trBox.classList.add("show");
    } catch (e) {
      trBox.textContent = L.translateFailed;
      trBox.classList.add("show");
    }
    trLoading = false;
    tr.textContent = L.translate;
    feed.scrollTop = feed.scrollHeight;
  };
  acts.appendChild(tr);
  el.appendChild(acts);
  el.appendChild(trBox);
  feed.scrollTop = feed.scrollHeight;
}

// ---- Fullscreen + subtitles + mute -----------------------------------------
const subs = document.getElementById("subs");
let subsOn = true, mutedFlag = false;
function setFs(on) { document.body.classList.toggle("fs", on); subs.classList.toggle("on", on && subsOn); }
document.getElementById("expandBtn").onclick = () => setFs(true);
function updateSubs(text) { subs.textContent = text || ""; }

// ---- Settings popover --------------------------------------------------------
const menu = document.getElementById("menu");
const menuBackdrop = document.getElementById("menuBackdrop");
const mSubs = document.getElementById("mSubs");
const mMute = document.getElementById("mMute");
const mTutor = document.getElementById("mTutor");
const mEnd = document.getElementById("mEnd");
mSubs.children[1].textContent = L.mSubs;
mMute.children[1].textContent = L.mMute;
mTutor.children[1].textContent = L.mTutor;
mEnd.children[1].textContent = L.mEnd;
function renderMenu() {
  mSubs.querySelector(".val").textContent = subsOn ? L.on : L.off;
  mMute.querySelector(".val").textContent = mutedFlag ? L.off : L.on;
  mMute.querySelector(".ic").textContent = mutedFlag ? "🔇" : "🔊";
  document.getElementById("muteBtn").textContent = mutedFlag ? "🔇" : "🔊";
}
function toggleMenu(show) { menu.classList.toggle("show", show); menuBackdrop.classList.toggle("show", show); if (show) renderMenu(); }
document.getElementById("gearBtn").onclick = () => toggleMenu(!menu.classList.contains("show"));
menuBackdrop.onclick = () => toggleMenu(false);
mSubs.onclick = () => { subsOn = !subsOn; subs.classList.toggle("on", document.body.classList.contains("fs") && subsOn); renderMenu(); };
mMute.onclick = () => { mutedFlag = !mutedFlag; renderMenu(); };
mTutor.onclick = () => showToast(L.soon);
mEnd.onclick = () => { toggleMenu(false); openQuitSheet(); };
document.getElementById("muteBtn").onclick = () => { mutedFlag = !mutedFlag; renderMenu(); };

// ---- Quit confirmation sheet ---------------------------------------------------
const quitSheet = document.getElementById("quitSheet");
quitSheet.querySelector("h3").textContent = L.quitTitle;
document.getElementById("continueBtn").textContent = L.continueBtn;
const endBtn = document.getElementById("endBtn");
endBtn.textContent = L.endBtn;
let saidAnything = false;
function openQuitSheet() {
  quitSheet.querySelector("p").textContent = saidAnything ? L.quitBody : L.quitBodyEmpty;
  document.body.classList.add("sheet");
}
function closeQuitSheet() { document.body.classList.remove("sheet"); }
document.getElementById("continueBtn").onclick = closeQuitSheet;
document.getElementById("sheetBackdrop").onclick = closeQuitSheet;
document.getElementById("xBtn").onclick = () => {
  if (document.body.classList.contains("fs")) { setFs(false); return; }
  if (!sessionId) { notifyNative({ event: "closeRequested" }); return; }
  openQuitSheet();
};

// ---- Avatar + lip-sync -----------------------------------------------------
let head = null;
let greeted = false; // local wave+greeting shown at most once per page load
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
  // Mute = user chose silence: still lip-sync/subtitle, but zero the samples.
  if (mutedFlag) {
    for (let c = 0; c < audio.numberOfChannels; c++) audio.getChannelData(c).fill(0);
  }
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
  if (status.tutor?.name) document.getElementById("title").textContent = status.tutor.name;

  if (!head) {
    try {
      const { TalkingHead } = await import("talkinghead");
      head = new TalkingHead(document.getElementById("avatar"), { cameraView: "upper", ttsEndpoint: "none" });
      const url = status.tutor.glbUrl + (status.tutor.assetVersion ? "?v=" + encodeURIComponent(status.tutor.assetVersion) : "");
      await head.showAvatar({ url, body: status.tutor.body || "F" });
    } catch (e) { stateLabel.textContent = L.error + ": " + e.message; dispatch("error"); return; }
  }

  // Local welcome (once per page load, NOT engine content): Emma waves and a
  // clearly-labelled local card greets the user by name. No TTS is invented —
  // TalkHint only ever voices audio actually received from the engine.
  if (!greeted) {
    greeted = true;
    try { head.playGesture("handup", 3, false, 800); } catch(e) { console.warn("wave gesture failed", e); }
    const g = addCard("tutor local");
    g.textContent = L.greet(status.displayName || "");
    const tag = document.createElement("div");
    tag.className = "localTag";
    tag.textContent = L.greetTag;
    g.appendChild(tag);
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
      updateSubs(tutorText || meta.subtitle || "");
    }
    return;
  }
  let msg; try { msg = JSON.parse(e.data); } catch { return; }
  if (msg.type === "session.ready") {
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
    if ((msg.text || "").trim()) saidAnything = true;
    userCard = null;
  }
  else if (msg.type === "tutor.text.delta") { if (latencyT0 && !latencyFirstText) latencyFirstText = performance.now() - latencyT0; tutorText += msg.text || msg.delta || ""; if (tutorCard) tutorCard.textContent = tutorText; updateSubs(tutorText); }
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
let endInFlight = false; // one-shot guard: two rapid taps must never fire two /end calls
endBtn.onclick = async () => {
  if (!sessionId || endInFlight) return;
  endInFlight = true;
  closeQuitSheet();
  setFs(false);
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
