// DEV-ONLY visual-review harness for the Tutor page (task 144).
// Serves the EXACT production TUTOR_AVATAR_PAGE_HTML with a driver <script>
// injected right after <body>. The driver runs BEFORE the page's module
// script (inline classic scripts execute first) and:
//   - forces RU UI locale (like the user's iPhone),
//   - supplies a fake auth token via the #auth= fragment path,
//   - stubs fetch()/WebSocket/getUserMedia so NO real engine or backend
//     calls happen, then replays scripted engine messages to put the real
//     page code into a requested state (?state=ready|recording|...).
// The page implementation itself is NOT modified — every pixel rendered is
// the real current code. This route must never be exposed in production.
import { TUTOR_AVATAR_PAGE_HTML } from "./tutorAvatarPage";

// 1.6 s of silent mp3 (ffmpeg anullsrc) so decodeAudioData/speakAudio run for real.
const SILENT_MP3_B64 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//OEwAAAAAAAAAAAAEluZm8AAAAPAAAARQAABzgAHSEkJCcrKy4xMTU4ODs/QkJFSUlMT09TVlZZXWBgY2dnam1tcXR0d3t7foGEhIiLi46SkpWYmJyfoqKmqamssLCztra6vb3AxMfHys7O0dTU2Nvb3uLl5ejs7O/y8vb5+fz/AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQDAAAAAAAAAAc4AkeifAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//MUxAAAAANIAAAAAExBTUUzLjEwMExB//MUxAsAAANIAAAAAE1FMy4xMDBVVUxB//MUxBYAAANIAAAAAE1FMy4xMDBVVUxB//MUxCEAAANIAAAAAE1FMy4xMDBVVUxB//MUxCwAAANIAAAAAE1FMy4xMDBVVUxB//MUxDcAAANIAAAAAE1FMy4xMDBVVUxB//MUxEIAAANIAAAAAE1FMy4xMDBVVUxB//MUxE0AAANIAAAAAE1FMy4xMDBVVUxB//MUxFgAAANIAAAAAE1FMy4xMDBVVUxB//MUxGMAAANIAAAAAE1FMy4xMDBVVUxB//MUxG4AAANIAAAAAE1FMy4xMDBVVUxB//MUxHkAAANIAAAAAE1FMy4xMDBVVUxB//MUxIQAAANIAAAAAE1FMy4xMDBVVUxB//MUxI8AAANIAAAAAE1FMy4xMDBVVUxB//MUxJoAAANIAAAAAE1FMy4xMDBVVUxB//MUxKUAAANIAAAAAE1FMy4xMDBVVUxB//MUxLAAAANIAAAAAE1FMy4xMDBVVUxB//MUxLsAAANIAAAAAE1FMy4xMDBVVUxB//MUxMYAAANIAAAAAE1FMy4xMDBVVUxB//MUxNEAAANIAAAAAE1FMy4xMDBVVUxB//MUxNwAAANIAAAAAE1FMy4xMDBVVUxB//MUxOcAAANIAAAAAE1FMy4xMDBVVUxB//MUxPIAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVUxB//MUxPQAAANIAAAAAE1FMy4xMDBVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV//MUxPQAAANIAAAAAFVVVVVVVVVVVVVV";

const DRIVER = `<script>
(() => {
  const STATE = new URLSearchParams(location.search).get("state") || "ready";
  // RU UI like the user's phone.
  try { Object.defineProperty(navigator, "language", { get: () => "ru-RU" }); } catch(_){}
  location.hash = "#auth=preview";

  const b64 = "${SILENT_MP3_B64}";
  const bin = atob(b64); const mp3 = new ArrayBuffer(bin.length);
  { const v = new Uint8Array(mp3); for (let i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i); }

  const MEMORY = {
    id: "preview-memory", objective: "Попросить прислать мастера починить обогреватель",
    facts: ["Квартира №14", "Обогреватель сломан с понедельника"],
    questions: ["When can the repairman come?", "Do I need to be home?"],
    rehearsedAnswers: ["The heater has been broken since Monday."],
    vocabulary: ["landlord — арендодатель", "repairman — мастер"],
    uncertainFacts: ["Возможно, ремонт покрывается договором аренды"],
  };
  const TRANSLATIONS = {};
  const T_DEFAULT = "Отлично! Можно сказать: «Я звоню по поводу моих документов». Что вам от них нужно?";

  // ---- fetch stub (only /api/tutor/*) --------------------------------------
  const realFetch = window.fetch.bind(window);
  const json = (obj) => Promise.resolve(new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } }));
  window.fetch = (url, opts) => {
    const u = String(url);
    if (!u.startsWith("/api/tutor")) return realFetch(url, opts);
    if (u === "/api/tutor/status") return json({ configured: true, ready: true, callMemoryReady: true, displayName: "Сергей",
      tutor: { tutorId: "emma_us_01", name: "Emma", body: "F", assetVersion: 1,
        glbUrl: "https://ai-tutor-engine.replit.app/api/tutor-assets/avatars/brunette_female_01.glb" } });
    if (u === "/api/tutor/sessions") return json({ sessionId: "preview-session", realtime: { wsUrl: "wss://preview.invalid/rt", token: "preview-token-not-real-000000000" } });
    if (u.endsWith("/end")) {
      if (STATE === "pending") return new Promise(() => {}); // stays "Готовим память…"
      return json({ callMemory: MEMORY });
    }
    if (u === "/api/tutor/translate") { const t = JSON.parse(opts?.body || "{}").text || ""; return json({ translation: TRANSLATIONS[t] || T_DEFAULT }); }
    if (u.includes("/api/tutor/memories/")) return json({ ok: true, status: u.endsWith("/confirm") ? "REAL_CALL_READY" : "MEMORY_CONFIRMATION" });
    return json({});
  };

  // ---- getUserMedia stub (silent stream; worklet path runs for real) -------
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext({ sampleRate: 24000 });
    const dst = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0.0001;
    osc.connect(g).connect(dst); osc.start();
    return dst.stream;
  };

  // ---- WebSocket stub replaying the real tutor-realtime/1.0 shapes ---------
  let sock = null;
  let onUtterance = () => {};
  class FakeWS {
    constructor() { sock = this; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 60); }
    set binaryType(_) {} get binaryType() { return "arraybuffer"; }
    send(d) {
      if (typeof d !== "string") return; // pcm frames swallowed
      let m; try { m = JSON.parse(d); } catch { return; }
      if (m.type === "auth") setTimeout(() => emit({ type: "session.ready" }), 80);
      if (m.type === "audio.end") setTimeout(() => onUtterance(), 250);
    }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: "" }); }
  }
  window.WebSocket = FakeWS;
  const emit = (obj) => sock?.onmessage?.({ data: JSON.stringify(obj) });
  const emitBin = () => sock?.onmessage?.({ data: mp3.slice(0) });

  // ---- gesture + scenario helpers ------------------------------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const mic = () => document.getElementById("micBtn");
  const pev = (t) => new PointerEvent(t, { bubbles: true, cancelable: true });
  async function waitReady(timeout = 40000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (mic() && !mic().disabled) return true; await sleep(200); }
    return false;
  }
  function tutorReply(userText, tutorText) {
    emit({ type: "speech.final", text: userText });
    emit({ type: "tutor.text.delta", text: tutorText });
    emit({ type: "tutor.audio.chunk", format: "mp3", subtitle: tutorText });
    emitBin();
  }
  async function fullTurn(userText, tutorText) {
    mic().dispatchEvent(pev("pointerdown"));
    await sleep(900);
    onUtterance = () => { tutorReply(userText, tutorText); setTimeout(() => emit({ type: "turn.completed" }), 700); };
    mic().dispatchEvent(pev("pointerup"));
    await sleep(2200);
  }
  const CORRECTION = 'Better: "I want to ask my lawyer."\\nAfter \\'want\\' we use \\'to + verb\\'.';
  const REPLY2 = "Great! You can say: \\'I\\'m calling about my documents.\\' What do you need from them?";

  // ---- scenarios ------------------------------------------------------------
  window.addEventListener("load", async () => {
    if (!(await waitReady())) return;
    await sleep(300);
    if (STATE === "ready") return;
    if (STATE === "error") { sock.readyState = 3; sock.onclose?.({ code: 4400, reason: "preview" }); return; }
    if (STATE === "recording") { mic().dispatchEvent(pev("pointerdown")); return; }
    if (STATE === "processing") { mic().dispatchEvent(pev("pointerdown")); await sleep(900); onUtterance = () => {}; mic().dispatchEvent(pev("pointerup")); return; }
    if (STATE === "speaking") {
      mic().dispatchEvent(pev("pointerdown")); await sleep(900);
      onUtterance = () => tutorReply("I want ask my lawyer.", CORRECTION); // no turn.completed → stays SPEAKING
      mic().dispatchEvent(pev("pointerup")); return;
    }
    if (STATE === "dialog" || STATE === "translate") {
      await fullTurn("I want ask my lawyer.", CORRECTION);
      await fullTurn("Tomorrow I call the office about my documents.", REPLY2);
      if (STATE === "translate") { await sleep(400); const btns = document.querySelectorAll(".card.tutor .translateBtn"); btns[btns.length-1]?.click(); }
      return;
    }
    if (STATE === "long") {
      await fullTurn("Hello Emma, I want to practice English.", "Hi! Great to see you. What would you like to practice today?");
      await fullTurn("I want ask my lawyer.", CORRECTION);
      await fullTurn("Tomorrow I call the office about my documents.", REPLY2);
      await fullTurn("I need make appointment for next week.", 'Almost! Say: "I need to make an appointment." When exactly next week?');
      await fullTurn("Maybe Tuesday morning, if they is open.", 'Small fix: "if they are open." Tuesday morning sounds good!');
      return;
    }
    if (STATE === "pending" || STATE === "review" || STATE === "confirmed") {
      await fullTurn("I want ask my lawyer.", CORRECTION);
      document.getElementById("endBtn").click();
      if (STATE === "confirmed") { await sleep(1200); document.getElementById("confirmBtn").click(); }
      return;
    }
  });
})();
</script>`;

export function buildTutorPreviewHtml(): string {
  return TUTOR_AVATAR_PAGE_HTML.replace("<body>", "<body>" + DRIVER);
}
