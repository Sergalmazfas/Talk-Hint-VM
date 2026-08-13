// Standalone tutor page served at /tutor, loaded by the iOS WKWebView.
// Emma Tutor v4 — implemented exactly per docs/emma-tutor-v4-design-freeze.md:
//   - single Main Conversation Screen (fullscreen mode REMOVED from v1)
//   - compact header (task 163): X (quit w/ confirmation sheet) · centered
//     circular LIVE avatar (same TalkingHead renderer — camera framing +
//     container clipping only, the GLB itself is NEVER scaled or mutated) with
//     tutor name + compact status underneath · settings popover
//   - chat feed gets nearly all remaining space (tutor grey / user violet
//     bubbles, inline translation,
//     Replay/Translate/Copy action row), streaming bubble pinned to bottom
//     with natural auto-scroll + "return to latest" FAB when scrolled away
//   - hint chip «Что сказать?», bottom dock: keyboard · 70px hold-to-talk
//     mic (READY/RECORDING+pulse/DISABLED) · paperclip
//   - text composer + attachment sheet UI (engine text/file turns are
//     deferred — honest "soon" toast, no fake behavior)
//   - quit sheet → Call Memory: pending card → v4 review → confirmed screen
//   - ALL icons are inline lucide SVGs — no emoji glyphs in chrome
// This page is ONLY render + realtime transport:
//   - fetches client-safe status/session data from our backend (Bearer token
//     injected by the native app via window.__setAuth, never in the URL)
//   - renders the tutor with @met4citizen/talkinghead (Three.js, client-side)
//   - streams mic audio (PCM16 @ 24 kHz) ONLY while the mic button is held,
//     plays streamed engine TTS with lip-sync via speakAudio().
// No teaching logic, no engine API key, nothing engine-side lives here.
// TalkHint renders only text actually received from the Tutor Engine.
import { pttNext, micAllowed } from "./tutorPttMachine";
import { classifyEngineEvent } from "./tutorRealtimeUi";

// Inline lucide icons (MIT) — consistent 24x24 stroke set, no emoji.
const LUCIDE: Record<string, string> = {
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  volume2: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  volumeX: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M6 12h.01"/><path d="M10 12h.01"/><path d="M14 12h.01"/><path d="M18 12h.01"/><path d="M7 16h10"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
};
function svg(name: string, size: number, cls = ""): string {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name]}</svg>`;
}

export const TUTOR_AVATAR_PAGE_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>TalkHint — Tutor</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html,body{height:100%;background:#fbfafc;color:#29252f;font-family:ui-rounded,-apple-system,'Avenir Next',BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
  button{font-family:inherit;color:inherit}
  #app{display:flex;flex-direction:column;height:100%;padding:0 20px}
  /* --- Header ------------------------------------------------------------- */
  #topbar{flex:0 0 auto;display:flex;align-items:flex-start;justify-content:space-between;padding:calc(14px + env(safe-area-inset-top)) 0 0}
  .roundBtn{width:36px;height:36px;flex:0 0 36px;border-radius:50%;border:1px solid #e8e5eb;background:#fff;color:#554f5c;display:flex;align-items:center;justify-content:center;transition:transform .12s}
  .roundBtn:active{transform:scale(.9)}
  /* --- Compact circular LIVE avatar (task 163) ------------------------------
     The SAME TalkingHead renderer, just clipped into a FIXED-size circle:
     compactness comes from viewport size + camera framing + border-radius
     clipping ONLY — the GLB model is never scaled or mutated. Fixed px size
     + fixed-height name/status rows = the circle stays visually stable
     across LISTENING/THINKING/SPEAKING and chat scroll (no reflow inputs). */
  #tutorHead{display:flex;flex-direction:column;align-items:center;min-width:0;padding-bottom:2px}
  #avatarWrap{width:80px;height:80px;flex:0 0 auto;border-radius:50%;overflow:hidden;position:relative;background:#efe9f8;box-shadow:0 0 0 3px #fff,0 0 0 4.5px #e2d6f6,0 6px 18px rgba(124,58,237,.16)}
  #avatar{position:absolute;inset:0}
  #title{font-size:15px;font-weight:700;letter-spacing:-.01em;margin-top:8px;line-height:18px;height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60vw}
  #livePill{display:flex;align-items:center;gap:5px;height:16px;margin-top:2px;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8a63d2;visibility:hidden}
  #livePill i{width:6px;height:6px;border-radius:50%;background:#22c55e;flex:0 0 auto}
  body.recording #livePill i{background:#e64d5a}
  body.thinking #livePill i{background:#f59e0b}
  /* --- Feed (chat bubbles) -------------------------------------------------- */
  #feedWrap{flex:1;min-height:0;position:relative;display:flex;flex-direction:column}
  #feed{flex:1;overflow-y:auto;padding:16px 4px 12px 0;display:flex;flex-direction:column;gap:16px;-webkit-overflow-scrolling:touch}
  .card{max-width:86%;border-radius:20px;padding:12px 16px;font-size:14px;line-height:1.38;white-space:pre-wrap;word-break:break-word}
  .card.tutor{align-self:flex-start;background:#efedf0;color:#39343e;border-bottom-left-radius:6px}
  .card.user{align-self:flex-end;background:#7c3aed;color:#fff;border-bottom-right-radius:6px;box-shadow:0 5px 14px rgba(124,58,237,.18)}
  .card.user.pending{background:rgba(124,58,237,.55);box-shadow:none;font-style:italic;color:rgba(255,255,255,.9)}
  .card.tutor.streaming::after{content:"";display:inline-block;width:2px;height:1em;margin-left:2px;vertical-align:-.15em;background:#7c3aed;animation:caret 1s steps(1) infinite}
  @keyframes caret{50%{opacity:0}}
  .acts{display:flex;gap:14px;margin-top:8px;align-self:flex-start}
  .acts button{display:flex;align-items:center;gap:5px;border:0;background:none;font-size:11px;font-weight:600;color:#8a8792;padding:2px 0}
  .acts button:active,.acts button.active{color:#7c3aed}
  .acts button.copyBtn{opacity:.55}
  .bubbleWrap{display:flex;flex-direction:column;max-width:86%;align-self:flex-start}
  .bubbleWrap .card{max-width:100%}
  .card .translation{margin-top:8px;padding-top:8px;border-top:1px solid #d9d5db;font-size:12px;line-height:1.35;color:#77717d;display:none}
  .card .translation.show{display:block}
  .card .trLoading{display:none;margin-top:8px;padding-top:8px;border-top:1px solid #d9d5db}
  .card .trLoading.show{display:flex;gap:4px;align-items:center}
  .card.local .localTag{display:block;margin-top:6px;font-size:11px;font-weight:400;color:#8a8ea2}
  /* Hint card (freeze §H): suggested USER reply from the engine — lilac dashed,
     visually distinct from messages, dismissible, never blocks the mic. */
  .card.hintCard{align-self:stretch;max-width:100%;background:#faf7ff;border:1.5px dashed #c9b6f2;color:#4a3c63;border-radius:18px}
  .card.hintCard .hHead{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8a63d2;margin-bottom:6px}
  .card.hintCard .hHead .hx{margin-left:auto;border:0;background:none;color:#b0a6c4;display:flex;padding:2px}
  .card.hintCard .hText{font-size:14px;font-weight:600;color:#3f3355}
  .card.hintCard .hTr{margin-top:6px;font-size:12px;color:#77717d}
  /* Correction card (spec §5): visually secondary, never interrupts LIVE. */
  .card.corr{align-self:flex-start;background:#f7f4fb;border:1px solid #e8e1f4;color:#4a4453;border-radius:18px;font-size:12.5px}
  .card.corr .cHead{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8a63d2;margin-bottom:5px}
  .card.corr .cBetter{font-size:13.5px;font-weight:700;color:#3f3355}
  .card.corr .cSaid{margin-top:4px;color:#8a8792;text-decoration:line-through;text-decoration-color:#cdb9ee}
  .card.corr .cWhy{margin-top:4px;color:#77717d}
  .dot{width:6px;height:6px;border-radius:50%;background:#7c3aed;animation:dots 1s ease-in-out infinite}
  .dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}
  @keyframes dots{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}
  #thinkBubble{display:none;align-self:flex-start;border-radius:20px;border-bottom-left-radius:6px;background:#efedf0;padding:14px 16px;gap:4px}
  body.thinking #thinkBubble{display:flex}
  .errCard{align-self:stretch;display:flex;align-items:center;gap:12px;border-radius:18px;border:1px solid #f1cfd2;background:#fff3f3;padding:12px 14px;font-size:12px;font-weight:600;color:#a5424b}
  .errCard button{margin-left:auto;display:flex;align-items:center;gap:6px;border:0;border-radius:999px;background:#7c3aed;color:#fff;font-size:12px;font-weight:700;padding:8px 14px}
  /* --- Return to latest FAB -------------------------------------------------- */
  #latestBtn{position:absolute;right:6px;bottom:10px;z-index:8;display:none;width:40px;height:40px;border-radius:50%;border:0;background:#7c3aed;color:#fff;box-shadow:0 6px 16px rgba(124,58,237,.35);align-items:center;justify-content:center}
  #latestBtn.show{display:flex}
  /* --- Hint chip + status row ------------------------------------------------ */
  #chipRow{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:8px 0 0}
  #hintChip{display:flex;align-items:center;gap:8px;border:1px solid #ddd0f8;border-radius:999px;background:#f5efff;color:#7131d6;font-size:12px;font-weight:700;padding:8px 14px}
  #hintChip:disabled{opacity:.55}
  #stateLabel{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#aaa5af;text-align:right}
  /* --- Bottom dock ------------------------------------------------------------ */
  #bottom{flex:0 0 auto;padding:12px 0 calc(8px + env(safe-area-inset-bottom))}
  #controls{display:flex;align-items:center;justify-content:space-between}
  .sideBtn{width:48px;height:48px;border-radius:50%;border:0;background:#f0edf2;color:#6f6875;display:flex;align-items:center;justify-content:center;transition:transform .12s}
  .sideBtn:active{transform:scale(.9)}
  #micWrap{position:relative}
  .ring{display:none;position:absolute;border-radius:50%;pointer-events:none}
  body.recording .ring{display:block;animation:pulse 1.4s ease-out infinite}
  .ring.r1{inset:-12px;border:2px solid rgba(239,83,97,.35)}
  .ring.r2{inset:-24px;border:1px solid rgba(239,83,97,.2);animation-delay:.3s!important}
  @keyframes pulse{0%{transform:scale(.85);opacity:1}100%{transform:scale(1.15);opacity:0}}
  #micBtn{position:relative;width:70px;height:70px;border-radius:50%;border:0;background:#7c3aed;color:#fff;box-shadow:0 9px 24px rgba(124,58,237,.3);display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .12s,background .12s}
  #micBtn:disabled{background:#d8d5dc;color:#aaa6ae;box-shadow:none}
  #micBtn.rec{background:#e64d5a;transform:scale(1.06)}
  #retryBtn{display:none;margin:0 auto;align-items:center;gap:8px;border:0;border-radius:999px;padding:14px 26px;font-size:15px;font-weight:700;color:#fff;background:#7c3aed}
  #homeBar{margin:6px auto 0;width:112px;height:4px;border-radius:2px;background:#d8d4da}
  /* --- Text composer ------------------------------------------------------------ */
  #composer{display:none;align-items:center;gap:8px;padding:8px 0 4px}
  body.composing #composer{display:flex}
  body.composing #controls,body.composing #chipRow{display:none}
  #composer .mini{width:44px;height:44px;flex:0 0 44px;border-radius:50%;border:0;background:#f0edf2;color:#6f6875;display:flex;align-items:center;justify-content:center}
  #composerField{flex:1;display:flex;align-items:center;gap:8px;border:1px solid #e5e0e9;border-radius:22px;background:#fff;box-shadow:0 4px 14px rgba(40,30,60,.06);padding:6px 6px 6px 14px}
  #composerInput{flex:1;border:0;outline:0;font-size:14px;font-family:inherit;background:none;color:#29252f;min-width:0}
  #composerInput::placeholder{color:#aaa5af}
  #sendBtn{width:36px;height:36px;flex:0 0 36px;border-radius:50%;border:0;background:#7c3aed;color:#fff;display:flex;align-items:center;justify-content:center}
  /* --- Sheets (attach / quit) ------------------------------------------------- */
  #sheetBackdrop{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.35);display:none}
  .sheet{position:fixed;left:0;right:0;bottom:0;z-index:71;background:#fff;border-radius:26px 26px 0 0;padding:16px 20px calc(20px + env(safe-area-inset-bottom));display:none}
  .grab{width:44px;height:4px;border-radius:2px;background:#d9dbe4;margin:0 auto 14px}
  body.sheet-quit #sheetBackdrop,body.sheet-quit #quitSheet{display:block}
  body.sheet-attach #sheetBackdrop,body.sheet-attach #attachSheet{display:block}
  #attachSheet .arow{display:flex;align-items:center;gap:14px;width:100%;border:0;background:none;padding:14px 6px;font-size:15px;font-weight:600;border-radius:14px;text-align:left}
  #attachSheet .arow:active{background:rgba(20,20,40,.05)}
  #attachSheet .arow .aic{width:40px;height:40px;flex:0 0 40px;border-radius:50%;background:#f5efff;color:#7131d6;display:flex;align-items:center;justify-content:center}
  #attachCancel{width:100%;border:0;border-radius:22px;padding:14px;font-size:15px;font-weight:700;background:#f1f1f5;margin-top:6px}
  #quitSheet{text-align:center}
  #quitSheet h3{font-size:21px;font-weight:800;margin-bottom:8px}
  #quitSheet p{font-size:14px;line-height:1.4;color:#5c5663;margin-bottom:16px}
  #quitSheet .primary,#startSheet .primary,#simSheet .primary{width:100%;border:0;border-radius:24px;padding:15px;font-size:16px;font-weight:800;color:#fff;background:#7c3aed;margin-bottom:8px}
  #quitSheet .secondary,#startSheet .secondary,#simSheet .secondary{width:100%;border:0;border-radius:24px;padding:15px;font-size:16px;font-weight:800;color:#29252f;background:#f1f1f5}
  /* --- Start chooser + simulation form (Goal-Driven Simulation, contract v1) -- */
  body.sheet-start #sheetBackdrop,body.sheet-start #startSheet{display:block}
  body.sheet-sim #sheetBackdrop,body.sheet-sim #simSheet{display:block}
  #startSheet{text-align:center}
  #startSheet h3{font-size:21px;font-weight:800;margin-bottom:8px}
  #startSheet p{font-size:13px;line-height:1.4;color:#77717d;margin-bottom:16px}
  /* Tutor catalog picker (dynamic from the engine — never hardcoded ids) */
  #tutorRow{display:flex;gap:10px;justify-content:center;margin:0 0 14px;flex-wrap:wrap}
  .tutorChip{border:2px solid transparent;border-radius:16px;background:#f7f6f9;padding:8px 10px;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:76px;font-family:inherit}
  .tutorChip img{width:56px;height:56px;border-radius:50%;object-fit:cover;background:#e8e4ee}
  .tutorChip .tName{font-size:12px;font-weight:700;color:#29252f}
  .tutorChip.sel{border-color:#7c3aed;background:#f3ecfd}
  #simSheet h3{font-size:19px;font-weight:800;margin-bottom:10px;text-align:center}
  #simSheet label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a8792;margin:12px 0 5px}
  #simSheet input,#simSheet textarea,#simSheet select{width:100%;background:#fff;border:1px solid #e5e0e9;border-radius:14px;color:#29252f;padding:11px 12px;font-size:14px;font-family:inherit}
  #simSheet textarea{min-height:64px;resize:vertical}
  #simStatus{font-size:12px;color:#a5424b;margin-top:8px;min-height:16px;text-align:center}
  #simSheet .primary{margin-top:14px}
  /* --- Settings popover --------------------------------------------------------- */
  #menu{position:fixed;top:calc(62px + env(safe-area-inset-top));right:20px;z-index:60;background:rgba(251,250,252,.96);backdrop-filter:blur(14px);border-radius:20px;box-shadow:0 8px 30px rgba(20,20,40,.22);padding:6px;min-width:230px;display:none}
  #menu.show{display:block}
  #menu .mrow{display:flex;align-items:center;gap:12px;width:100%;border:0;background:none;padding:13px 12px;font-size:15px;font-weight:600;border-radius:14px;text-align:left}
  #menu .mrow:active{background:rgba(20,20,40,.06)}
  #menu .mrow .ic{width:24px;display:flex;justify-content:center;color:#6f6875}
  #menu .mrow .val{margin-left:auto;font-size:13px;color:#7c3aed;font-weight:700}
  #menuBackdrop{position:fixed;inset:0;z-index:55;display:none}
  #menuBackdrop.show{display:block}
  /* --- Toast ----------------------------------------------------------------------- */
  #toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(130px + env(safe-area-inset-bottom));z-index:80;background:rgba(20,20,30,.85);color:#fff;font-size:13px;font-weight:600;padding:10px 16px;border-radius:14px;opacity:0;transition:opacity .25s;pointer-events:none;max-width:86%;text-align:center}
  #toast.show{opacity:1}
  /* --- Call Memory: pending card ----------------------------------------------------- */
  #memPending{position:fixed;inset:0;z-index:85;display:none;align-items:center;justify-content:center;background:rgba(251,250,252,.92);backdrop-filter:blur(4px);padding:24px}
  body.mem-pending #memPending{display:flex}
  #memPending .box{background:#fff;border-radius:24px;box-shadow:0 12px 32px rgba(40,30,60,.14);padding:28px 24px;text-align:center;max-width:320px}
  #memPending h3{font-size:17px;font-weight:800;margin:14px 0 6px}
  #memPending p{font-size:13px;color:#77717d}
  .spin{animation:spin 1s linear infinite;color:#7c3aed}
  @keyframes spin{to{transform:rotate(360deg)}}
  /* --- Call Memory: review + confirmed ------------------------------------------------ */
  #review{position:fixed;inset:0;background:#fbfafc;overflow-y:auto;padding:calc(16px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));display:none;z-index:90}
  #review h2{font-size:19px;font-weight:800;margin-bottom:6px}
  #review .intro{font-size:12px;line-height:1.4;color:#77717d;margin-bottom:12px}
  #review label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a8792;margin:14px 0 6px}
  #review input,#review textarea{width:100%;background:#fff;border:1px solid #e5e0e9;border-radius:14px;color:#29252f;padding:11px 12px;font-size:14px;font-family:inherit;box-shadow:0 2px 8px rgba(40,30,60,.04)}
  #review textarea{min-height:76px;resize:vertical}
  #confirmBtn{width:100%;margin-top:18px;background:#7c3aed;border:0;border-radius:24px;padding:15px;font-size:16px;font-weight:800;color:#fff;box-shadow:0 6px 18px rgba(124,58,237,.25)}
  #confirmBtn:disabled{opacity:.6}
  #reviewStatus{font-size:12px;color:#77717d;margin-top:10px;text-align:center}
  #confirmedCard{display:none;text-align:center;padding-top:10vh}
  #review.done #confirmedCard{display:block}
  #review.done .formPart{display:none}
  #confirmedCard .okIc{width:72px;height:72px;border-radius:50%;background:#e9fbef;color:#22c55e;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
  #confirmedCard h2{margin-bottom:6px}
  #confirmedCard .sub{font-size:13px;color:#77717d;margin-bottom:6px}
  #confirmedCard .cnt{font-size:12px;color:#aaa5af;margin-bottom:22px}
  #backBtn{border:0;border-radius:24px;background:#7c3aed;color:#fff;font-size:16px;font-weight:800;padding:15px 44px}
</style>
</head>
<body>
<div id="app">
  <div id="topbar">
    <button id="xBtn" class="roundBtn" aria-label="close">${svg("x", 18)}</button>
    <div id="tutorHead">
      <div id="avatarWrap"><div id="avatar"></div></div>
      <div id="title">Emma</div>
      <div id="livePill"><i></i><span></span></div>
    </div>
    <button id="gearBtn" class="roundBtn" aria-label="settings">${svg("settings", 17)}</button>
  </div>
  <div id="feedWrap">
    <div id="feed">
      <div id="thinkBubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    </div>
    <button id="latestBtn" aria-label="scroll to latest">${svg("arrowDown", 18)}</button>
  </div>
  <div id="chipRow">
    <button id="hintChip">${svg("lightbulb", 15)}<span></span></button>
    <div id="stateLabel"></div>
  </div>
  <div id="composer">
    <button id="composerMic" class="mini" aria-label="voice">${svg("mic", 19)}</button>
    <div id="composerField">
      <input id="composerInput" type="text" autocomplete="off"/>
      <button id="sendBtn" aria-label="send">${svg("send", 16)}</button>
    </div>
    <button id="composerAttach" class="mini" aria-label="attach">${svg("paperclip", 19)}</button>
  </div>
  <div id="bottom">
    <div id="controls">
      <button id="kbBtn" class="sideBtn" aria-label="keyboard">${svg("keyboard", 20)}</button>
      <div id="micWrap">
        <span class="ring r1"></span><span class="ring r2"></span>
        <button id="micBtn" disabled aria-label="mic">${svg("mic", 27)}</button>
      </div>
      <button id="attachBtn" class="sideBtn" aria-label="attach">${svg("paperclip", 20)}</button>
    </div>
    <button id="retryBtn">${svg("rotateCcw", 16)}<span></span></button>
    <div id="homeBar"></div>
  </div>
</div>
<div id="menuBackdrop"></div>
<div id="menu">
  <button class="mrow" id="mMute"><span class="ic">${svg("volume2", 18)}</span><span></span><span class="val"></span></button>
  <button class="mrow" id="mEnd"><span class="ic">${svg("flag", 18)}</span><span></span></button>
</div>
<div id="sheetBackdrop"></div>
<div id="attachSheet" class="sheet">
  <div class="grab"></div>
  <button class="arow" id="aPhoto"><span class="aic">${svg("camera", 19)}</span><span></span></button>
  <button class="arow" id="aLibrary"><span class="aic">${svg("image", 19)}</span><span></span></button>
  <button class="arow" id="aFile"><span class="aic">${svg("fileText", 19)}</span><span></span></button>
  <button id="attachCancel"></button>
</div>
<div id="startSheet" class="sheet">
  <div class="grab"></div>
  <h3></h3>
  <p></p>
  <div id="tutorRow"></div>
  <button class="primary" id="freeBtn"></button>
  <button class="secondary" id="simBtn"></button>
</div>
<div id="simSheet" class="sheet">
  <div class="grab"></div>
  <h3></h3>
  <label id="lSimGoal"></label><textarea id="simGoal" maxlength="500"></textarea>
  <label id="lSimEmma"></label><input id="simEmma" maxlength="120"/>
  <label id="lSimYou"></label><input id="simYou" maxlength="120"/>
  <label id="lSimMem"></label><select id="simMem"></select>
  <div id="simStatus"></div>
  <button class="primary" id="simStartBtn"></button>
  <button class="secondary" id="simBackBtn"></button>
</div>
<div id="quitSheet" class="sheet">
  <div class="grab"></div>
  <h3></h3>
  <p></p>
  <button class="primary" id="continueBtn"></button>
  <button class="secondary" id="endBtn"></button>
</div>
<div id="toast"></div>
<div id="memPending"><div class="box">${svg("loader", 34, "spin")}<h3></h3><p></p></div></div>
<div id="review">
  <div class="formPart">
    <h2></h2>
    <div class="intro" id="reviewHint"></div>
    <label id="lObjective"></label><input id="rObjective"/>
    <label id="lFacts"></label><textarea id="rFacts"></textarea>
    <label id="lQuestions"></label><textarea id="rQuestions"></textarea>
    <label id="lAnswers"></label><textarea id="rAnswers"></textarea>
    <label id="lVocab"></label><textarea id="rVocab"></textarea>
    <label id="lUncertain"></label><textarea id="rUncertain"></textarea>
    <button id="confirmBtn"></button>
    <div id="reviewStatus"></div>
  </div>
  <div id="confirmedCard">
    <div class="okIc">${svg("check", 34)}</div>
    <h2></h2>
    <div class="sub"></div>
    <div class="cnt"></div>
    <button id="backBtn"></button>
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
// ---- Localization: ONE UI language, no mixed chrome (freeze §E). Lesson
// content itself may mix RU+EN — that comes from the engine, never from here.
const RU = navigator.language?.toLowerCase().startsWith("ru");
const L = RU ? {
  loading: "Загрузка…", connecting: "Подключаемся…", ready: "Удерживайте и говорите",
  recording: "Слушаю…", processing: "Emma думает…", speaking: "Emma говорит…",
  speakingLocked: "Emma говорит…",
  error: "Ошибка", errorBody: "Что-то пошло не так. Повторите попытку.", retry: "Повторить",
  ending: "Завершаем практику…",
  micDenied: "Нет доступа к микрофону", notConfigured: "Репетитор не настроен.",
  engineDown: "Движок репетитора недоступен.",
  replay: "Повторить", copy: "Копировать", copied: "Скопировано",
  translate: "Перевод", translateFailed: "Не удалось перевести",
  memPendingTitle: "Готовлю память разговора…", memPendingSub: "Это займёт несколько секунд",
  reviewTitle: "Проверьте память разговора",
  reviewHint: "Факты предложены Emma — проверьте и подтвердите их. Только после подтверждения они попадут в подсказки и будут использованы один раз, в следующем реальном звонке.",
  objective: "Цель", facts: "Факты (по одному в строке)", questions: "Вопросы, которые вы хотите задать",
  answers: "Отрепетированные ответы", vocab: "Словарь", uncertain: "Непроверенные факты (ассистент не будет их утверждать)",
  confirm: "Подтвердить", saving: "Сохраняем…",
  confirmedTitle: "Память подтверждена", confirmedSub: "Готово к реальному звонку",
  confirmedCnt: (n) => n + " " + (n === 1 ? "факт подтверждён" : (n < 5 ? "факта подтверждено" : "фактов подтверждено")),
  back: "Вернуться",
  memUnavailable: "Память разговора недоступна.", closed: "Соединение закрыто.",
  greet: (n) => n ? ("Привет, " + n + "! 👋") : "Привет! 👋",
  greetTag: "Приветствие TalkHint — не реплика Emma",
  hintChip: "Что сказать?", soon: "Скоро — нужна поддержка движка",
  hintTitle: "Подсказка — можно сказать", noHintYet: "Подсказка появится по ходу разговора",
  teachHintTitle: "Подсказка учителя",
  corrTitle: "Как сказать лучше", transcribing: "Распознаём…",
  quitTitle: "Завершить практику?",
  quitBody: "Из ваших реплик будет создана память разговора — проверьте и подтвердите её, чтобы использовать в реальном звонке.",
  quitBodyEmpty: "Вы ещё ничего не сказали. Память разговора не будет создана.",
  continueBtn: "Продолжить практику", endBtn: "Завершить",
  mMute: "Звук Emma", mEnd: "Завершить практику",
  on: "Вкл", off: "Выкл",
  tutorPrefix: "Репетитор ",
  stLive: "Live", stListen: "Слушаю", stThink: "Думает", stSpeak: "Говорит",
  composerPh: "Новое сообщение…",
  aPhoto: "Сделать фото", aLibrary: "Медиатека", aFile: "Прикрепить файл", aCancel: "Отмена",
  startTitle: "Как хотите практиковаться?",
  startSub: "Свободный разговор с Emma — или репетиция реального звонка по вашей цели.",
  freeTalk: "Свободная практика", simTalk: "Симуляция звонка",
  simTitle: "Симуляция звонка",
  simGoalL: "Цель разговора", simGoalPh: "Например: записаться к врачу на пятницу",
  simEmmaL: "Кем будет Emma (собеседник)", simEmmaPh: "например: администратор клиники",
  simYouL: "Ваша роль", simYouPh: "по умолчанию: звонящий",
  simMemL: "Память разговора (контекст)", simMemNone: "Без контекста",
  simStart: "Начать симуляцию", simBack: "Назад",
  simGoalReq: "Укажите цель разговора.", simEmmaReq: "Укажите, кем будет Emma.",
  openingWait: "Emma начинает разговор…",
  simKnows: (f,q,v) => "Emma знает контекст: факты — " + f + ", вопросы — " + q + ", словарь — " + v,
  simTag: "Симуляция — параметры TalkHint, реплики Emma из движка",
} : {
  loading: "Loading…", connecting: "Connecting…", ready: "Hold to talk",
  recording: "Listening…", processing: "Emma is thinking…", speaking: "Emma is speaking…",
  speakingLocked: "Emma is speaking…",
  error: "Error", errorBody: "Something went wrong. Please try again.", retry: "Retry",
  ending: "Finishing practice…",
  micDenied: "Microphone access denied", notConfigured: "Tutor is not configured.",
  engineDown: "Tutor engine is unavailable.",
  replay: "Replay", copy: "Copy", copied: "Copied",
  translate: "Translate", translateFailed: "Translation failed",
  memPendingTitle: "Preparing your call memory…", memPendingSub: "This takes a few seconds",
  reviewTitle: "Review your call memory",
  reviewHint: "These facts are proposed by Emma — review and confirm them. Only after confirmation do they reach live hints, used once in your next real call.",
  objective: "Objective", facts: "Facts (one per line)", questions: "Questions you want to ask",
  answers: "Rehearsed answers", vocab: "Vocabulary", uncertain: "Uncertain facts (assistant will not assert them)",
  confirm: "Confirm", saving: "Saving…",
  confirmedTitle: "Call memory confirmed", confirmedSub: "Ready for your real call",
  confirmedCnt: (n) => n + (n === 1 ? " fact confirmed" : " facts confirmed"),
  back: "Back",
  memUnavailable: "Call memory is unavailable.", closed: "Connection closed.",
  greet: (n) => n ? ("Hi, " + n + "! 👋") : "Hi! 👋",
  greetTag: "TalkHint greeting — not an Emma reply",
  hintChip: "What to say?", soon: "Coming soon — needs engine support",
  hintTitle: "Hint — you could say", noHintYet: "A hint will appear as you talk",
  teachHintTitle: "Teaching hint",
  corrTitle: "Better way to say it", transcribing: "Transcribing…",
  quitTitle: "End the practice?",
  quitBody: "We'll build call memory from what you said — review and confirm it to use in a real call.",
  quitBodyEmpty: "You haven't said anything yet. No call memory will be created.",
  continueBtn: "Continue practice", endBtn: "End",
  mMute: "Emma's voice", mEnd: "End practice",
  on: "On", off: "Off",
  tutorPrefix: "Tutor ",
  stLive: "Live", stListen: "Listening", stThink: "Thinking", stSpeak: "Speaking",
  composerPh: "New message…",
  aPhoto: "Take photo", aLibrary: "Photo library", aFile: "Attach file", aCancel: "Cancel",
  startTitle: "How do you want to practice?",
  startSub: "Free talk with Emma — or rehearse a real call around your goal.",
  freeTalk: "Free practice", simTalk: "Call simulation",
  simTitle: "Call simulation",
  simGoalL: "Goal of the call", simGoalPh: "e.g.: book a doctor appointment for Friday",
  simEmmaL: "Who Emma plays (the other side)", simEmmaPh: "e.g.: clinic receptionist",
  simYouL: "Your role", simYouPh: "default: caller",
  simMemL: "Call memory (context)", simMemNone: "No context",
  simStart: "Start simulation", simBack: "Back",
  simGoalReq: "Enter the goal of the call.", simEmmaReq: "Enter who Emma plays.",
  openingWait: "Emma is starting the conversation…",
  simKnows: (f,q,v) => "Emma knows the context: facts " + f + ", questions " + q + ", vocabulary " + v,
  simTag: "Simulation — parameters by TalkHint, Emma's lines from the engine",
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
  if (!r.ok) {
    const body = await r.json().catch(()=>({}));
    const err = new Error(body.message || ("HTTP "+r.status));
    err.code = body.error || null; // backend error code (e.g. simulation fail-closed table)
    throw err;
  }
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
const livePill = document.getElementById("livePill");
retryBtn.querySelector("span").textContent = L.retry;

function render() {
  const labels = { LOADING: L.loading, READY: L.ready, RECORDING: L.recording,
    PROCESSING: L.processing, SPEAKING: L.speakingLocked, ERROR: L.error,
    ENDING: L.ending, MEMORY: "" };
  // Engine turn.state refines the waiting label truthfully (spec §7): while we
  // are locally PROCESSING, the engine knows whether it is transcribing or
  // thinking. It never drives the PTT machine — labels only, no noise.
  let label = labels[state] ?? "";
  if (state === "PROCESSING" && engineTurnLabel === "transcribing") label = L.transcribing;
  // Simulation opening turn (contract §3): the engine speaks FIRST. Until its
  // turn.completed arrives the mic stays disabled and the label says so —
  // the PTT machine itself is NOT driven by this flag.
  if (openingPending && (state === "READY" || state === "PROCESSING")) label = L.openingWait;
  stateLabel.textContent = tn(label);
  micBtn.disabled = openingPending || !(state === "READY" || state === "RECORDING");
  micBtn.classList.toggle("rec", state === "RECORDING");
  document.body.classList.toggle("recording", state === "RECORDING");
  document.body.classList.toggle("thinking", state === "PROCESSING");
  document.body.classList.toggle("speaking", state === "SPEAKING");
  document.body.classList.toggle("mem-pending", state === "ENDING");
  // Compact header status (task 163): LIVE / Listening / Thinking / Speaking.
  // Fixed-height pill — text changes never move the avatar circle above it.
  const lpMap = { READY: L.stLive, RECORDING: L.stListen, PROCESSING: L.stThink, SPEAKING: L.stSpeak };
  const lpText = lpMap[state] || "";
  livePill.style.visibility = lpText ? "visible" : "hidden";
  livePill.querySelector("span").textContent = lpText;
  retryBtn.style.display = state === "ERROR" ? "flex" : "none";
  document.getElementById("controls").style.visibility = state === "ERROR" ? "hidden" : "";
  hintChip.disabled = state !== "READY";
  if (state === "PROCESSING" || state === "SPEAKING") scrollFeed();
}
function dispatch(ev) {
  const next = pttNext(state, ev);
  if (next === state) return false;
  state = next;
  if (!micAllowed(state)) stopMic();
  render();
  return true;
}

// ---- Chrome: hint chip, toast ----------------------------------------------
const hintChip = document.getElementById("hintChip");
hintChip.querySelector("span").textContent = L.hintChip;
const toast = document.getElementById("toast");
let toastT = null;
function showToast(t) { toast.textContent = t; toast.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(()=>toast.classList.remove("show"), 1800); }
// «Что сказать?» reveals the CURRENT engine hint (spec §3). It never calls
// the backend, never invents an engine command, never generates locally:
// if the engine hasn't sent a hint yet, we honestly say so.
hintChip.onclick = () => {
  if (hintCardEl) { hintCardEl.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  if (currentHint) { showHintCard(currentHint); return; }
  showToast(L.noHintYet);
};

// ---- Conversation feed: pinned auto-scroll + return-to-latest (freeze §F) --
const feed = document.getElementById("feed");
const latestBtn = document.getElementById("latestBtn");
const thinkBubble = document.getElementById("thinkBubble");
let pinned = true;
feed.addEventListener("scroll", () => {
  pinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  latestBtn.classList.toggle("show", !pinned);
});
function scrollFeed(force) {
  if (pinned || force) { feed.scrollTop = feed.scrollHeight; latestBtn.classList.remove("show"); }
}
latestBtn.onclick = () => { pinned = true; feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" }); latestBtn.classList.remove("show"); };

function addCard(kind) {
  const el = document.createElement("div");
  el.className = "card " + kind;
  feed.insertBefore(el, thinkBubble);
  scrollFeed();
  return el;
}
const ICONS = {
  replay: '${svg("volume2", 14)}', copy: '${svg("copy", 13)}', check: '${svg("check", 13)}',
  translate: '${svg("languages", 14)}',
};
function makeAct(iconHtml, label) {
  const b = document.createElement("button");
  b.innerHTML = iconHtml + "<span>" + label + "</span>";
  return b;
}
// Tutor card with replay (reuses engine mp3 — no TalkHint-side TTS) + copy.
function finishTutorCard(el, text, audioBufs) {
  el.classList.remove("streaming");
  el.textContent = text;
  const wrap = document.createElement("div");
  wrap.className = "bubbleWrap";
  feed.insertBefore(wrap, el);
  wrap.appendChild(el);
  const acts = document.createElement("div");
  acts.className = "acts";
  if (audioBufs.length) {
    const play = makeAct(ICONS.replay, L.replay);
    play.setAttribute("aria-label", "replay");
    play.onclick = () => replayAudio(audioBufs, text);
    acts.appendChild(play);
  }
  // "Перевод": on-demand translation of THIS card's exact text via our
  // backend (auth-scoped, cached). Inline expansion inside the same bubble;
  // never blocks lip-sync or the realtime stream — plain fetch on tap.
  const tr = makeAct(ICONS.translate, L.translate);
  tr.className = "translateBtn";
  tr.setAttribute("aria-label", "translate");
  const trBox = document.createElement("div");
  trBox.className = "translation";
  const trLoad = document.createElement("div");
  trLoad.className = "trLoading";
  trLoad.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  let trLoaded = false, trLoading = false;
  tr.onclick = async () => {
    if (trBox.classList.contains("show")) { trBox.classList.remove("show"); tr.classList.remove("active"); return; }
    if (trLoaded) { trBox.classList.add("show"); tr.classList.add("active"); return; }
    if (trLoading) return;
    trLoading = true;
    tr.classList.add("active");
    trLoad.classList.add("show");
    try {
      const r = await api("/api/tutor/translate", { method: "POST", body: JSON.stringify({ text }) });
      trBox.textContent = r.translation || "";
      trLoaded = true;
      trBox.classList.add("show");
    } catch (e) {
      trBox.textContent = L.translateFailed;
      trBox.classList.add("show");
    }
    trLoad.classList.remove("show");
    trLoading = false;
    scrollFeed();
  };
  const copy = makeAct(ICONS.copy, L.copy);
  copy.className = "copyBtn";
  copy.setAttribute("aria-label", "copy");
  copy.onclick = async () => { try { await navigator.clipboard.writeText(text); copy.innerHTML = ICONS.check + "<span>" + L.copied + "</span>"; setTimeout(()=>{ copy.innerHTML = ICONS.copy + "<span>" + L.copy + "</span>"; }, 1200); } catch(_){} };
  acts.appendChild(tr);
  acts.appendChild(copy);
  el.appendChild(trLoad);
  el.appendChild(trBox);
  wrap.appendChild(acts);
  scrollFeed();
}

// ---- Mute (settings menu only — the compact avatar has no overlay button) ---
let mutedFlag = false;
const MUTE_ON_M = '${svg("volume2", 18)}', MUTE_OFF_M = '${svg("volumeX", 18)}';

// ---- Settings popover ----------------------------------------------------------
const menu = document.getElementById("menu");
const menuBackdrop = document.getElementById("menuBackdrop");
const mMute = document.getElementById("mMute");
const mEnd = document.getElementById("mEnd");
mMute.children[1].textContent = L.mMute;
mEnd.children[1].textContent = L.mEnd;
function renderMenu() {
  mMute.querySelector(".val").textContent = mutedFlag ? L.off : L.on;
  mMute.querySelector(".ic").innerHTML = mutedFlag ? MUTE_OFF_M : MUTE_ON_M;
}
function toggleMenu(show) { menu.classList.toggle("show", show); menuBackdrop.classList.toggle("show", show); if (show) renderMenu(); }
document.getElementById("gearBtn").onclick = () => toggleMenu(!menu.classList.contains("show"));
menuBackdrop.onclick = () => toggleMenu(false);
mMute.onclick = () => { mutedFlag = !mutedFlag; renderMenu(); };
mEnd.onclick = () => { toggleMenu(false); openQuitSheet(); };

// ---- Text composer (UI per freeze §10; engine text turns deferred §L) --------
const composerInput = document.getElementById("composerInput");
composerInput.placeholder = L.composerPh;
function setComposer(on) {
  document.body.classList.toggle("composing", on);
  if (on) composerInput.focus(); else composerInput.blur();
}
document.getElementById("kbBtn").onclick = () => setComposer(true);
document.getElementById("composerMic").onclick = () => setComposer(false);
document.getElementById("sendBtn").onclick = () => showToast(L.soon);
document.getElementById("composerAttach").onclick = () => openAttach();

// ---- Attachment sheet (UI per freeze §11; engine file turns deferred §L) -----
document.getElementById("aPhoto").children[1].textContent = L.aPhoto;
document.getElementById("aLibrary").children[1].textContent = L.aLibrary;
document.getElementById("aFile").children[1].textContent = L.aFile;
document.getElementById("attachCancel").textContent = L.aCancel;
function openAttach() { document.body.classList.add("sheet-attach"); }
function closeAttach() { document.body.classList.remove("sheet-attach"); }
document.getElementById("attachBtn").onclick = openAttach;
document.getElementById("attachCancel").onclick = closeAttach;
for (const id of ["aPhoto","aLibrary","aFile"]) document.getElementById(id).onclick = () => { closeAttach(); showToast(L.soon); };

// ---- Quit confirmation sheet ---------------------------------------------------
const quitSheet = document.getElementById("quitSheet");
quitSheet.querySelector("h3").textContent = L.quitTitle;
document.getElementById("continueBtn").textContent = L.continueBtn;
const endBtn = document.getElementById("endBtn");
endBtn.textContent = L.endBtn;
let saidAnything = false;
function openQuitSheet() {
  quitSheet.querySelector("p").textContent = saidAnything ? L.quitBody : L.quitBodyEmpty;
  document.body.classList.add("sheet-quit");
}
function closeQuitSheet() { document.body.classList.remove("sheet-quit"); }
document.getElementById("continueBtn").onclick = closeQuitSheet;
document.getElementById("sheetBackdrop").onclick = () => { closeQuitSheet(); closeAttach(); };
document.getElementById("xBtn").onclick = () => {
  if (!sessionId) { notifyNative({ event: "closeRequested" }); return; }
  openQuitSheet();
};

// ---- Avatar + lip-sync -----------------------------------------------------
let head = null;
let avatarFailedKey = null; // tutorKey whose avatar init failed — a DIFFERENT tutor may still retry
let lastGlbObjectUrl = null; // blob: URL of the currently shown model (revoked on replace)
// Tutor display name substitution: UI strings were written for Emma; the name
// now comes from the live catalog. Single substitution point, no string dupes.
let tutorName = "Emma";
const tn = (s) => String(s).split("Emma").join(tutorName);
function applyTutorName() {
  document.getElementById("title").textContent = L.tutorPrefix + tutorName;
  startSheet.querySelector("p").textContent = tn(L.startSub);
  document.getElementById("lSimEmma").textContent = tn(L.simEmmaL);
  mMute.children[1].textContent = tn(L.mMute);
  document.getElementById("reviewHint").textContent = tn(L.reviewHint);
}
let fallbackCtx = null;   // audio playback path when the avatar is absent
const fallbackSources = new Set(); // live BufferSources so we can stop them on end/retry/close
function stopFallbackAudio() {
  for (const s of fallbackSources) { try { s.stop(); } catch(_){} }
  fallbackSources.clear();
}
let greeted = false; // local wave+greeting shown at most once per page load
// Lip-sync diagnostics: report what actually happened, never fake.
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
  const actx = head?.audioCtx || (fallbackCtx ||= new AudioContext());
  const audio = await actx.decodeAudioData(buf.slice(0));
  let timing = null;
  if (engineTimings?.words?.length) { timing = engineTimings; lipDiag.timingsFromEngine = true; }
  else { timing = deriveTimings(subtitleText, audio.duration * 1000); if (timing) lipDiag.timingsDerived = true; }
  // Mute = user chose silence: still lip-sync, but zero the samples.
  if (mutedFlag) {
    for (let c = 0; c < audio.numberOfChannels; c++) audio.getChannelData(c).fill(0);
  }
  if (head) {
    lipDiag.speakAudioCalled = true;
    head.speakAudio(timing ? { audio, ...timing } : { audio, words: [], wtimes: [], wdurations: [] });
  } else {
    // No avatar: play the REAL engine audio directly (no lip-sync).
    const src = actx.createBufferSource();
    src.buffer = audio; src.connect(actx.destination);
    fallbackSources.add(src);
    src.onended = () => fallbackSources.delete(src);
    src.start();
  }
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
let wsGen = 0;                    // connection generation — stale socket callbacks are ignored
let latencyT0 = 0;                // set at audio.end; cleared on first tutor audio
let latencyFirstText = 0;         // release → first tutor.text.delta (ms)
let pendingTtsMeta = null;
let userCard = null;              // pending user transcript card
let tutorText = "";               // accumulated tutor.text.delta for this turn
let tutorAudio = [];              // engine mp3 buffers for replay
let tutorCard = null;
let lastUserCard = null;          // last committed user bubble (for transcript.normalized)
let lastUserTurnId = null;        // turn_id of that bubble — normalized text binds by turn
let pendingNormalized = null;     // normalized text that arrived before its speech.final
let tutorTextFinal = false;       // tutor.text.final received — deltas must not append
let engineTurnLabel = null;       // engine turn.state → truthful waiting label (spec §7)
let currentHint = null;           // latest engine hint {text, translation} — spec §§1-3
let hintCardEl = null;            // rendered hint card (dismissible)
let simulation = null;            // active simulation config {goal, learnerRole, tutorRole, memoryId} or null
let selectedTutorId = null;       // tutor chosen from the dynamic engine catalog (never hardcoded)
let loadedTutorKey = null;        // tutorId@assetVersion currently shown by TalkingHead
const glbPrefetch = {};           // tutorKey -> Promise<local GLB url> (prefetch on selection)
let openingPending = false;       // simulation opening turn in flight — mic gated until turn.completed

// Shared PURE classifier for engine events beyond the PTT machine — the same
// source is unit-tested server-side (tutorRealtimeUi.test.ts, spec §14).
const classifyEngineEvent = ${classifyEngineEvent.toString()};

// Hint = suggested USER reply (spec §1). Rendered as a dismissible card ONLY:
// never sent to TTS, never added as a user bubble, never sent to the engine.
function showHintCard(hint) {
  if (hintCardEl) { hintCardEl.remove(); hintCardEl = null; }
  const el = addCard("hintCard");
  const head = document.createElement("div");
  head.className = "hHead";
  head.innerHTML = '${svg("lightbulb", 13)}<span>' + L.hintTitle + "</span>";
  const x = document.createElement("button");
  x.className = "hx"; x.setAttribute("aria-label", "dismiss hint");
  x.innerHTML = '${svg("x", 14)}';
  x.onclick = () => { el.remove(); if (hintCardEl === el) hintCardEl = null; }; // hint stays in currentHint — chip re-reveals it
  head.appendChild(x);
  el.appendChild(head);
  const t = document.createElement("div");
  t.className = "hText"; t.textContent = hint.text;
  el.appendChild(t);
  if (hint.translation) {
    const tr = document.createElement("div");
    tr.className = "hTr"; tr.textContent = hint.translation;
    el.appendChild(tr);
  }
  hintCardEl = el;
  scrollFeed();
}

// Teaching hint (contract v1 §2): tutor.hint {hint, mode} — guidance ABOUT
// the learner's language. A DISTINCT event from tutor.suggested_reply: it is
// NOT the phrase to say next, so it never touches currentHint / the hint
// chip, has no translation, and — like every hint — never reaches TTS.
function showTeachingHintCard(h) {
  const el = addCard("hintCard");
  const head = document.createElement("div");
  head.className = "hHead";
  head.innerHTML = '${svg("lightbulb", 13)}<span>' + L.teachHintTitle + "</span>";
  const x = document.createElement("button");
  x.className = "hx"; x.setAttribute("aria-label", "dismiss teaching hint");
  x.innerHTML = '${svg("x", 14)}';
  x.onclick = () => el.remove();
  head.appendChild(x);
  el.appendChild(head);
  const t = document.createElement("div");
  t.className = "hText"; t.textContent = h.text;
  el.appendChild(t);
  scrollFeed();
}

// Correction (spec §5): visually secondary, appended to the feed — the
// conversation continues, nothing is interrupted, no extra LLM call.
function showCorrectionCard(c) {
  const el = addCard("corr");
  const head = document.createElement("div");
  head.className = "cHead";
  head.innerHTML = '${svg("check", 12)}<span>' + L.corrTitle + "</span>";
  el.appendChild(head);
  const better = document.createElement("div");
  better.className = "cBetter"; better.textContent = c.better;
  el.appendChild(better);
  if (c.userSaid) {
    const said = document.createElement("div");
    said.className = "cSaid"; said.textContent = c.userSaid;
    el.appendChild(said);
  }
  const why = c.explanation || "";
  const tr = c.translation || "";
  if (why || tr) {
    const w = document.createElement("div");
    w.className = "cWhy"; w.textContent = why + (why && tr ? " — " : "") + tr;
    el.appendChild(w);
  }
  scrollFeed();
}

// Persistent GLB cache (Cache API), key = tutor_id + asset_version. Cache hit
// = zero network; version change = download once + evict older versions of the
// SAME tutor. Falls back to a direct URL when Cache API is unavailable.
async function loadGlbUrl(t) {
  const version = t.assetVersion != null ? String(t.assetVersion) : "0";
  const cachePath = "/glb-cache/" + encodeURIComponent(t.tutorId) + "/" + encodeURIComponent(version);
  try {
    const cache = await caches.open("tutor-glb-v1");
    let res = await cache.match(cachePath);
    if (!res) {
      const net = await fetch(t.glbUrl);
      if (!net.ok) throw new Error("glb http " + net.status);
      await cache.put(cachePath, net.clone());
      const prefix = "/glb-cache/" + encodeURIComponent(t.tutorId) + "/";
      for (const k of await cache.keys()) {
        const p = new URL(k.url).pathname;
        if (p.startsWith(prefix) && p !== cachePath) cache.delete(k); // evict old versions
      }
      res = await cache.match(cachePath);
    }
    return URL.createObjectURL(await res.blob());
  } catch (e) {
    console.warn("GLB cache unavailable — loading directly", e);
    return t.glbUrl + (t.assetVersion ? "?v=" + encodeURIComponent(t.assetVersion) : "");
  }
}
function prefetchTutorGlb(t) {
  if (!t || !t.glbUrl) return;
  const key = t.tutorId + "@" + (t.assetVersion ?? "0");
  if (!glbPrefetch[key]) glbPrefetch[key] = loadGlbUrl(t);
}

async function connect(simCfg) {
  if (simCfg !== undefined) simulation = simCfg; // retry re-uses the stored config (deliberate user action)
  state = "LOADING"; render();
  let status;
  try { status = await api("/api/tutor/status" + (selectedTutorId ? "?tutorId=" + encodeURIComponent(selectedTutorId) : "")); }
  catch (e) { stateLabel.textContent = L.error + ": " + e.message; dispatch("error"); return; }
  if (!status.configured) { stateLabel.textContent = L.notConfigured; return; }
  if (!status.ready) { stateLabel.textContent = L.engineDown; return; }
  if (status.tutor?.name) { tutorName = status.tutor.name; applyTutorName(); }

  const tutorKey = status.tutor ? status.tutor.tutorId + "@" + (status.tutor.assetVersion ?? "0") : null;
  // A failure only blocks retries of the SAME tutorKey — picking a different
  // tutor (or a new asset version) gets a fresh attempt.
  if (status.tutor?.glbUrl && (!head || loadedTutorKey !== tutorKey) && avatarFailedKey !== tutorKey) {
    try {
      if (!head) {
        const { TalkingHead } = await import("talkinghead");
        // Compact circle (task 163): frontal close-up framing — face + lips
        // fill the circle. Camera view only; the GLB is never scaled/mutated.
        head = new TalkingHead(document.getElementById("avatar"), { cameraView: "head", ttsEndpoint: "none" });
      }
      // Persistent GLB cache keyed by tutor_id + asset_version: repeated
      // launches load the model locally with zero network (catalog policy).
      const url = await (glbPrefetch[tutorKey] || (glbPrefetch[tutorKey] = loadGlbUrl(status.tutor)));
      await head.showAvatar({ url, body: status.tutor.body || "F" });
      loadedTutorKey = tutorKey; avatarFailedKey = null;
      // Blob lifecycle: revoke the replaced model's URL and any unused
      // prefetches only AFTER the new model is fully shown.
      if (lastGlbObjectUrl && lastGlbObjectUrl !== url) URL.revokeObjectURL(lastGlbObjectUrl);
      lastGlbObjectUrl = url.startsWith("blob:") ? url : null;
      for (const k of Object.keys(glbPrefetch)) {
        if (k === tutorKey) continue;
        glbPrefetch[k].then((u) => { if (u && u.startsWith("blob:") && u !== lastGlbObjectUrl) URL.revokeObjectURL(u); }).catch(() => {});
        delete glbPrefetch[k];
      }
    } catch (e) {
      // Honest degradation: no WebGL / CDN failure must not kill practice.
      // The card keeps its scene background; audio plays without lip-sync.
      console.error("avatar init failed", e);
      avatarFailedKey = tutorKey; head = null;
      notifyNative({ event: "avatarInitFailed", message: String(e?.message || e) });
    }
  }

  // Local welcome (once per page load, NOT engine content): Emma waves once
  // (freeze §J: single greeting wave, then neutral idle) and a clearly
  // labelled local card greets the user by name. No TTS is invented —
  // TalkHint only ever voices audio actually received from the engine.
  if (!greeted) {
    greeted = true;
    try { head?.playGesture("handup", 3, false, 800); } catch(e) { console.warn("wave gesture failed", e); }
    const g = addCard("tutor local");
    g.textContent = L.greet(status.displayName || "");
    const tag = document.createElement("div");
    tag.className = "localTag";
    tag.textContent = tn(L.greetTag);
    g.appendChild(tag);
  }

  stateLabel.textContent = L.connecting;
  let session;
  try {
    // Only the selected tutor_id travels — avatar/voice/persona are frozen by
    // the engine at creation; internal profile ids are never sent.
    const createBody = {};
    if (simulation) createBody.simulation = simulation;
    if (selectedTutorId) createBody.tutorId = selectedTutorId;
    session = await api("/api/tutor/sessions", {
      method: "POST",
      body: Object.keys(createBody).length ? JSON.stringify(createBody) : undefined,
    });
  } catch (e) {
    // Fail-closed (contract §1): a simulation create failure is surfaced and
    // the form reopens — NEVER a silent fallback to free talk, no auto-retry.
    if (simulation) {
      simulation = null;
      openSimSheet(e.message);
      state = "LOADING"; render();
      return;
    }
    stateLabel.textContent = L.error + ": " + e.message; dispatch("error"); return;
  }
  sessionId = session.sessionId;
  turnOpen = false; sentAudio = false; // fresh session — reset turn bookkeeping
  // Simulation: the engine auto-starts a tutor-first opening turn right after
  // WS auth (contract §3) — gate the mic until its turn.completed.
  openingPending = !!simulation;
  if (simulation && session.simulation) {
    const inj = session.simulation.context && session.simulation.context.items_injected;
    if (inj) {
      // Show the echoed injection counts so the user sees what Emma knows.
      const c = addCard("tutor local");
      c.textContent = tn(L.simKnows(inj.facts ?? 0, inj.questions ?? 0, inj.vocabulary ?? 0));
      const tag = document.createElement("div");
      tag.className = "localTag"; tag.textContent = tn(L.simTag);
      c.appendChild(tag);
    }
  }
  // Generation guard: callbacks from a superseded socket (old session after a
  // deliberate retry) must never touch the new session's state — an old
  // turn.completed could otherwise clear the new opening gate, and an old
  // close could push the fresh session into ERROR.
  const gen = ++wsGen;
  const sock = new WebSocket(session.realtime.wsUrl);
  ws = sock;
  sock.binaryType = "arraybuffer";
  // Token goes in the FIRST WS MESSAGE, never in the URL.
  sock.onopen = () => { if (gen === wsGen) sock.send(JSON.stringify({ type: "auth", token: session.realtime.token, session_id: sessionId })); };
  sock.onmessage = (e) => { if (gen === wsGen) onWsMessage(e); };
  sock.onclose = (e) => { if (gen !== wsGen) return; stopMic(); stopFallbackAudio(); turnOpen = false; notifyNative({ event: "wsClosed", code: e.code, reason: e.reason || "" }); if (sessionId && state !== "ENDING" && state !== "MEMORY") { stateLabel.textContent = L.closed; dispatch("error"); } };
  sock.onerror = () => { if (gen !== wsGen) return; notifyNative({ event: "wsError" }); dispatch("error"); };
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
      // Late-audio race guard: if turn.completed already returned us to READY,
      // a straggler audio frame must NOT re-enter SPEAKING — there is no later
      // completion to release the mic. Play the audio, keep state as-is.
      if (state !== "READY") dispatch("tutorSpeaking"); // force-stops mic even if still RECORDING
      // lmark passed so latency is emitted AFTER decode + speakAudio (playback start).
      speakBuffer(e.data, meta.subtitle || tutorText, tutorAudio[tutorAudio.length-1].timings, lmark).catch(err => console.error("TTS play failed", err));
      if (!tutorCard) { tutorCard = addCard("tutor streaming"); }
      tutorCard.textContent = tutorText || meta.subtitle || "…";
      scrollFeed();
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
    scrollFeed();
  }
  else if (msg.type === "speech.final") {
    if (!userCard) userCard = addCard("user");
    userCard.classList.remove("pending");
    userCard.textContent = msg.text || "";
    if ((msg.text || "").trim()) saidAnything = true;
    lastUserCard = userCard; // transcript.normalized may follow (spec §7)
    lastUserTurnId = msg.turn_id || null;
    if (pendingNormalized && pendingNormalized.turnId && pendingNormalized.turnId === lastUserTurnId) {
      lastUserCard.dataset.normalized = pendingNormalized.text; // arrived early — bind now
      pendingNormalized = null;
    }
    userCard = null;
    scrollFeed();
  }
  else if (msg.type === "tutor.text.delta") { if (latencyT0 && !latencyFirstText) latencyFirstText = performance.now() - latencyT0; if (tutorTextFinal) return; tutorText += msg.text || msg.delta || ""; if (!tutorCard) tutorCard = addCard("tutor streaming"); tutorCard.textContent = tutorText; scrollFeed(); }
  else if (msg.type === "tutor.audio.chunk") pendingTtsMeta = msg;
  else if (msg.type === "turn.completed") {
    if (tutorCard) { finishTutorCard(tutorCard, tutorText || tutorCard.textContent, tutorAudio.slice()); }
    tutorCard = null; tutorText = ""; tutorAudio = []; userCard = null;
    pendingTtsMeta = null; // a binary frame after completion belongs to a closed turn
    engineTurnLabel = null; tutorTextFinal = false;
    openingPending = false; // opening turn (if any) is over — mic is released
    dispatch("turnCompleted");
    render();
  }
  else if (msg.type === "error") {
    // OPENING_IN_PROGRESS is benign & retriable (contract §3): the user tried
    // to talk while Emma's opening turn was in flight — keep gating, no error state.
    if (msg.code === "OPENING_IN_PROGRESS") {
      // Recover the full capture state: stop the mic immediately and move a
      // stuck RECORDING to PROCESSING so the opening's turn.completed can
      // return us to READY (turnCompleted is a no-op from RECORDING).
      stopMic();
      turnOpen = false; sentAudio = false; openingPending = true;
      if (state === "RECORDING") state = "PROCESSING";
      render(); showToast(tn(L.openingWait)); return;
    }
    console.error("Engine error:", msg.code); notifyNative({ event: "wsEngineError", code: msg.code });
  }
  else {
    // Engine events beyond the PTT machine (task 154) — classified by the
    // shared pure function; unknown/malformed types return null and are
    // ignored safely (spec §8). No event here ever reaches TTS or the mic.
    const act = classifyEngineEvent(msg);
    if (!act) return;
    if (act.kind === "turnStarted") {
      // Simulation opening turn announced by the engine (contract §3):
      // consume the opening flag ONLY — never drives the PTT machine.
      if (act.opening) { openingPending = true; render(); }
    }
    else if (act.kind === "hint") { currentHint = act; showHintCard(act); } // auto-display, no button needed (spec §2)
    else if (act.kind === "teachingHint") showTeachingHintCard(act); // DISTINCT event (contract v1 §2) — own card, never stored as the suggested reply
    else if (act.kind === "correction") showCorrectionCard(act);
    else if (act.kind === "finalText") {
      // Authoritative Emma text: reconcile the SAME streaming bubble — never
      // a duplicate card (spec §6). A text-only turn (no audio yet) must
      // still show Emma's reply, so create the streaming card if missing.
      tutorText = act.text;
      tutorTextFinal = true; // later deltas of this turn must not append stale text
      if (!tutorCard) tutorCard = addCard("tutor streaming");
      tutorCard.textContent = act.text;
      scrollFeed();
    }
    else if (act.kind === "turnState") { engineTurnLabel = act.state; render(); }
    else if (act.kind === "normalized") {
      // Conservative (spec §7): keep the RAW transcript visible; store the
      // normalized form on the bubble without rewriting what the user saw.
      // Bind by turn_id — never blindly to the previous turn's bubble.
      const tid = msg.turn_id || null;
      if (lastUserCard && (!tid || tid === lastUserTurnId)) lastUserCard.dataset.normalized = act.text;
      else pendingNormalized = { turnId: tid, text: act.text };
    }
  }
}

// ---- Hold-to-talk gestures -------------------------------------------------
async function pressDown(ev) {
  ev.preventDefault();
  if (openingPending) { showToast(tn(L.openingWait)); return; } // mic gated until the tutor's opening turn completes
  if (!dispatch("pressDown")) return; // only from READY — no double start
  engineTurnLabel = null; // stale turn.state must not color the new turn
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
    console.error("mic start failed", err);
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
retryBtn.onclick = () => { stopFallbackAudio(); dispatch("retry"); connect(); };

// ---- End practice + Call Memory -------------------------------------------
const memPendingBox = document.getElementById("memPending");
memPendingBox.querySelector("h3").textContent = L.memPendingTitle;
memPendingBox.querySelector("p").textContent = L.memPendingSub;
let endInFlight = false; // one-shot guard: two rapid taps must never fire two /end calls
endBtn.onclick = async () => {
  if (!sessionId || endInFlight) return;
  endInFlight = true;
  closeQuitSheet();
  setComposer(false);
  endBtn.disabled = true;
  dispatch("end");
  stopMic();
  stopFallbackAudio();
  try { head?.stopSpeaking?.(); } catch(_){}
  try { ws?.close(); } catch(_){}
  try {
    const result = await api("/api/tutor/sessions/" + encodeURIComponent(sessionId) + "/end", { method: "POST" });
    if (result.callMemory) {
      notifyNative({ event: "callMemoryReady", memoryId: result.callMemory.id });
      showReview(result.callMemory);
      dispatch("memoryReview");
      document.body.classList.remove("mem-pending");
    } else {
      document.body.classList.remove("mem-pending");
      stateLabel.textContent = result.message || L.memUnavailable;
      notifyNative({ event: "callMemoryUnavailable" });
    }
  } catch (e) {
    document.body.classList.remove("mem-pending");
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
const confirmedCard = document.getElementById("confirmedCard");
confirmedCard.querySelector("h2").textContent = L.confirmedTitle;
confirmedCard.querySelector(".sub").textContent = L.confirmedSub;
document.getElementById("backBtn").textContent = L.back;
document.getElementById("backBtn").onclick = () => notifyNative({ event: "closeRequested" });
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
    const facts = splitLines("rFacts"), questions = splitLines("rQuestions"),
      answers = splitLines("rAnswers"), vocab = splitLines("rVocab"), uncertain = splitLines("rUncertain");
    await api("/api/tutor/memories/" + reviewMemoryId, { method: "PATCH", body: JSON.stringify({
      objective: document.getElementById("rObjective").value.trim(),
      facts, questions,
      rehearsed_answers: answers, vocabulary: vocab,
      uncertain_facts: uncertain,
    })});
    await api("/api/tutor/memories/" + reviewMemoryId + "/confirm", { method: "POST" });
    confirmedCard.querySelector(".cnt").textContent = L.confirmedCnt(facts.length + questions.length + answers.length);
    review.classList.add("done");
    notifyNative({ event: "callMemoryConfirmed", memoryId: reviewMemoryId });
  } catch (e) {
    reviewStatus.textContent = L.error + ": " + e.message;
    btn.disabled = false;
  }
};

// ---- Start chooser: free practice vs goal-driven call simulation -----------
const startSheet = document.getElementById("startSheet");
startSheet.querySelector("h3").textContent = L.startTitle;
startSheet.querySelector("p").textContent = L.startSub;
const freeBtn = document.getElementById("freeBtn");
freeBtn.textContent = L.freeTalk;
const simBtn = document.getElementById("simBtn");
simBtn.textContent = L.simTalk;
const simSheet = document.getElementById("simSheet");
simSheet.querySelector("h3").textContent = L.simTitle;
document.getElementById("lSimGoal").textContent = L.simGoalL;
document.getElementById("simGoal").placeholder = L.simGoalPh;
document.getElementById("lSimEmma").textContent = L.simEmmaL;
document.getElementById("simEmma").placeholder = L.simEmmaPh;
document.getElementById("lSimYou").textContent = L.simYouL;
document.getElementById("simYou").placeholder = L.simYouPh;
document.getElementById("lSimMem").textContent = L.simMemL;
document.getElementById("simStartBtn").textContent = L.simStart;
document.getElementById("simBackBtn").textContent = L.simBack;
const simStatus = document.getElementById("simStatus");
const simMemSel = document.getElementById("simMem");

function openStartChoice() {
  document.body.classList.remove("sheet-sim");
  document.body.classList.add("sheet-start");
}
let memsLoaded = false;
async function openSimSheet(statusText) {
  document.body.classList.remove("sheet-start");
  document.body.classList.add("sheet-sim");
  simStatus.textContent = statusText || "";
  if (!memsLoaded) {
    memsLoaded = true;
    simMemSel.innerHTML = '<option value="">' + L.simMemNone + "</option>";
    try {
      const mems = await api("/api/tutor/memories");
      // Only confirmed memories WITH an engine-side reference can seed a
      // simulation (context goes by reference only — contract §1).
      for (const m of (Array.isArray(mems) ? mems : [])) {
        if (m.status !== "REAL_CALL_READY" || !m.engineGroupId || m.engineVersion == null) continue;
        const o = document.createElement("option");
        o.value = m.id;
        o.textContent = (m.objective || "").slice(0, 60) || m.id.slice(0, 8);
        simMemSel.appendChild(o);
      }
    } catch (e) { console.error("memories load failed", e); }
  }
}
// Tutor picker — rendered ONLY from the live catalog; removing a tutor from
// the engine allow-list makes it disappear here without a client deploy.
const tutorRow = document.getElementById("tutorRow");
let tutorList = [];
try { selectedTutorId = localStorage.getItem("tutorId") || null; } catch (e) {}
function renderTutorRow() {
  tutorRow.innerHTML = "";
  for (const t of tutorList) {
    const b = document.createElement("button");
    b.className = "tutorChip" + (t.tutorId === selectedTutorId ? " sel" : "");
    if (t.previewUrl) { const img = document.createElement("img"); img.src = t.previewUrl; img.alt = ""; b.appendChild(img); }
    const n = document.createElement("div"); n.className = "tName"; n.textContent = t.name;
    b.appendChild(n);
    b.onclick = () => {
      selectedTutorId = t.tutorId;
      try { localStorage.setItem("tutorId", t.tutorId); } catch (e) {}
      tutorName = t.name; applyTutorName(); // header + strings switch immediately
      renderTutorRow();
      prefetchTutorGlb(t); // download the GLB before Live so start never waits
    };
    tutorRow.appendChild(b);
  }
}
(async () => {
  try {
    const d = await api("/api/tutor/tutors");
    tutorList = Array.isArray(d.tutors) ? d.tutors : [];
    if (!tutorList.length) { tutorRow.style.display = "none"; return; }
    if (!selectedTutorId || !tutorList.some((t) => t.tutorId === selectedTutorId)) {
      selectedTutorId = tutorList.some((t) => t.tutorId === d.defaultTutorId) ? d.defaultTutorId : tutorList[0].tutorId;
    }
    renderTutorRow();
    const cur = tutorList.find((t) => t.tutorId === selectedTutorId);
    if (cur) { tutorName = cur.name; applyTutorName(); prefetchTutorGlb(cur); }
  } catch (e) { console.error("tutor catalog load failed", e); tutorRow.style.display = "none"; }
})();

freeBtn.onclick = () => { document.body.classList.remove("sheet-start"); connect(null); };
simBtn.onclick = () => openSimSheet("");
document.getElementById("simBackBtn").onclick = openStartChoice;
document.getElementById("simStartBtn").onclick = () => {
  const goal = document.getElementById("simGoal").value.trim();
  const tutorRole = document.getElementById("simEmma").value.trim();
  const learnerRole = document.getElementById("simYou").value.trim();
  if (!goal) { simStatus.textContent = L.simGoalReq; return; }
  if (!tutorRole) { simStatus.textContent = tn(L.simEmmaReq); return; }
  const cfg = { goal: goal, tutorRole: tutorRole };
  if (learnerRole) cfg.learnerRole = learnerRole;
  if (simMemSel.value) cfg.memoryId = simMemSel.value;
  document.body.classList.remove("sheet-sim");
  connect(cfg);
};

openStartChoice();
</script>
</body>
</html>`;
