# Emma Tutor — AS-BUILT UI/UX Design Baseline

Frozen snapshot of the Emma Tutor experience exactly as implemented on **August 10, 2026** (Tutor UI v3, Praktika-style). Documentation only — nothing was changed while producing this document.

Scope note: everything below describes the **product viewport only** (390×844 iPhone frame in previews). Replit Preview/browser chrome is not part of the product and is ignored.

---

## 1. Architecture overview (where the UI lives)

| Layer | Location | Role |
|---|---|---|
| Web tutor page | `server/tutorAvatarPage.ts` → `TUTOR_AVATAR_PAGE_HTML`, served at `GET /tutor` (`server/tutorRoutes.ts`) | The ENTIRE tutor UI: layout, styles, chat, avatar, realtime transport |
| iOS wrapper | `ios/TalkHint/UI/TutorViewController.swift` | Full-screen WKWebView loading `/tutor`; injects Bearer token via `window.__setAuth` (never in URL); receives bridge events (`callMemoryReady`, `closeRequested`, latency/lip-sync diagnostics); hides tab bar during session |
| iOS entry point | `ios/TalkHint/UI/AssistantViewController.swift` — row «Тренировка» (`cell-tutor`) pushes `TutorViewController` | The only entry point. Native, cannot be rendered in Replit |
| PTT state machine | `server/tutorPttMachine.ts` (`pttNext`, `micAllowed`), embedded into the page via `.toString()` and unit-tested server-side | Single source of truth for mic/turn states |
| Preview harness | `server/tutorPreviewPage.ts`, dev-only `GET /tutor/preview?state=…` (404 in production) | Drives the REAL page through scenarios with a stubbed engine; used for the canvas frames |
| Backend APIs used by the page | `/api/tutor/status`, `/api/tutor/sessions` (+`/:id/end`), `/api/tutor/translate` (`server/tutorTranslate.ts`), `/api/tutor/memories/:id` (+`/confirm`) | All auth-scoped (Bearer) |

There is **no** separate design file: the canvas frames render the real implementation via the preview harness. Design == implementation.

---

## 2. Screen Catalog

Canvas artifacts: live iframes `https://<dev-domain>/tutor/preview?state=<state>` at 390×844. Shape IDs are given per screen. All screens below are **implemented** unless stated otherwise.

### E01 — Entry point (iOS native)
- Purpose: launch the tutor. How reached: Assistant tab → row «Тренировка».
- Artifact: none (native iOS, cannot render in Replit). Status: implemented.
- Visible: table row with title «Тренировка» and subtitle explaining practice + call memory. Opens full-screen `TutorViewController` (nav title «Репетитор Emma», tab bar hidden).

### E02 — Loading / connecting (`state` LOADING)
- Shape: part of every frame's first moments; no dedicated frame.
- Top bar → empty avatar card (#dfe3ee) → empty feed → status label «Загружаем Emma…» then «Подключаемся…» → disabled grey mic (#c9cbd8, no shadow).

### E03 — Ready (`tutor-ready`, state READY)
- Top bar: ✕ (46px white round btn) · «Emma» (19px/800) · ⚙︎.
- Avatar card 36vh, radius 24, overlay buttons 🔊 (right:58) and ⛶ (right:12), 38px translucent black blur.
- Feed: local greeting card «Привет, {имя}! 👋» + small grey tag «Приветствие TalkHint — не реплика Emma» (11px #8a8ea2).
- Hint chip «💡 Что сказать?» right-aligned above the bottom row (violet #7c3aed on #ece6fb, radius 22) — visible ONLY in READY. Tap → toast «Скоро — нужна поддержка движка» (placeholder).
- Bottom: status «УДЕРЖИВАЙТЕ И ГОВОРИТЕ» (13px/700 uppercase #6b6f85) · row ⌨︎ (52px white) — placeholder toast · purple mic 92px (#7c3aed, 36px 🎤, glow shadow) · 📎 (52px white) — placeholder toast.

### E04 — User speaking / recording (`tutor-recording`, RECORDING)
- Mic turns red #ef4444, scale 1.1, 12px red halo; status «Слушаю…»; hint chip hidden. Live partial transcript appears as a right-aligned purple user bubble at 65% opacity (`.pending`).

### E05 — Transcribing → Emma thinking (`tutor-processing`, PROCESSING)
- After release: user bubble becomes solid purple (speech.final); mic grey-violet #9b9db2, disabled; status «Emma думает…».

### E06 — Emma speaking (`tutor-speaking`, SPEAKING)
- Avatar lip-syncs (derived word timings — see §5); tutor grey bubble streams text (tutor.text.delta appended live); mic stays disabled (#9b9db2); status «Emma говорит…». On `turn.completed` the bubble gets the action row and state returns to READY.

### E07 — Dialog / chat history (`tutor-dialog`)
- Alternating bubbles: tutor left, grey #efeff3, radius 20 (bottom-left 6); user right, purple #7c3aed white text (bottom-right 6). 17px/600, line-height 1.4, max-width 86%, 8px gap, auto-scroll to bottom on every append.
- Completed tutor bubbles show action row (18px gap): 🔊 replay (only if audio buffers exist), ⧉ copy (→ ✓ for 1.2s), 文А translate.

### E08 — Translation expanded (`tutor-translate`)
- Tap 文А → button shows «…» while fetching `/api/tutor/translate` (cached, auth-scoped); translation appears inside the same bubble below a 1px #dcdde6 divider, 15px/400 #3f4257. Tap again toggles collapse (no refetch). Failure → «Не удалось перевести» inline.

### E09 — Long dialog / scrolling (`tutor-long`)
- Feed is the only scrollable region; avatar card, top bar and bottom controls are fixed. Momentum scrolling (`-webkit-overflow-scrolling: touch`).

### E10 — Error (`tutor-error`, ERROR)
- Mic hidden; purple «Повторить» button (radius 16, 13×24 padding) shown instead; status shows the error text (e.g. «Соединение закрыто.»). Retry re-runs `connect()`.

### E11 — Session ending / memory pending (`tutor-pending`, ENDING→MEMORY)
- After confirming end: sheet closes, fullscreen collapses, ws closes, mic stops; status «Завершаем тренировку…» → «Готовим память разговора…». Double-tap safe: `endInFlight` one-shot guard + button disabled.

### E12 — Call Memory review (`tutor-review`, MEMORY)
- Full-screen overlay (#f6f6f8, z-90): title «Память разговора» (19px/800), hint text about one-time use in the next real call, then editable fields: Цель (input), Факты / Вопросы / Отрепетированные ответы / Словарь / Непроверенные факты (textareas ≥80px, white, 1px #d9dce8, radius 12), green confirm button «Сохранить и подтвердить» (#22c55e, radius 28).

### E13 — Call Memory confirmed (`tutor-confirmed`)
- Same screen; button disabled, status line «Готово! Подготовка будет использована в вашем следующем реальном звонке.» Native side receives `callMemoryConfirmed`.

### E14 — Fullscreen avatar mode (`tutor-fullscreen`)
- `body.fs`: avatar card fixed inset 0, radius 0; feed + hint chip hidden; title hidden; top-bar buttons become translucent white blur; overlay card buttons hidden; side buttons hidden; mic 78px translucent white blur (red when recording); status label white with shadow.
- Subtitles `#subs`: fixed, bottom 26vh, white 26px/800, shadow, updated live from tutor.text.delta / audio chunk subtitle; shown only when fullscreen AND subtitles setting is On.
- ✕ in fullscreen = collapse to compact (does NOT quit). Same realtime session continues — mode switch is pure CSS class toggle, no reconnect.

### E15 — Settings popover (`tutor-menu`)
- Anchored top-right under ⚙︎; frosted panel (rgba(248,248,250,.96), blur 14, radius 22, min-width 250) with invisible backdrop-to-dismiss. Rows (17px/600, 13×12 padding): 💬 Субтитры [Вкл/Выкл] · 🔊/🔇 Звук Emma [Вкл/Выкл] · 👤 Сменить репетитора (placeholder toast) · 🏁 Завершить тренировку (→ quit sheet). Value labels violet 14px/700.

### E16 — Quit confirmation bottom sheet (`tutor-quit`)
- Backdrop rgba(0,0,0,.35); white sheet radius 26 top, grabber 44×4, black «!» circle 58px, title «Завершить тренировку?» (23px/800), body varies: if the user has spoken → memory explanation; if not → «Вы ещё ничего не сказали. Память разговора не будет создана.»
- Buttons: «Продолжить» (purple primary, radius 28) then «Завершить» (grey secondary). Continue/backdrop dismiss. ✕ with no session sends `closeRequested` to native instead.

### Screens that do NOT exist (not invented)
- Text/keyboard input screen, «Новое сообщение…» composer — **not implemented** (⌨︎ shows «Скоро»).
- Attachment menu / Take photo / Photo library / Attach file — **not implemented** (📎 shows «Скоро»).
- «What to say?» suggestions UI — chip exists, suggestions do not (toast).
- Change-tutor picker — row exists, action is a toast.
- Camera (user's own camera) control — **does not exist at all** (Praktika has it; we don't).
- REAL_CALL_READY / "use in call" screen — no dedicated screen; confirmation status text (E13) + native `callMemoryConfirmed` event is the entire flow. Consumption happens later in the live-call hint pipeline, invisible here.
- Timestamps in chat — none.

---

## 3. Visual specification (as implemented, from CSS in `tutorAvatarPage.ts`)

- Font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` everywhere. Page bg #f6f6f8, text #111.
- Brand violet: **#7c3aed** (mic, user bubbles, chips, links/values, primary buttons). Recording red #ef4444. Confirm green #22c55e. Disabled grey #c9cbd8; thinking grey #9b9db2.
- Top bar: safe-area padded; round buttons 46px, white, shadow `0 1px 6px rgba(20,20,40,.10)`, 19px glyphs.
- Avatar card: 36vh height, margin 6×14, radius 24, bg #dfe3ee, shadow `0 2px 12px rgba(20,20,40,.10)`; overlay buttons 38px, `rgba(20,20,30,.35)` + blur 6.
- Bubbles: radius 20 (anchored corner 6), padding 12×15, 17px/600, lh 1.4, max 86%; tutor #efeff3/#111, user #7c3aed/#fff, pending opacity .65; action row margin-top 10, buttons 17px #55586e (active → violet); translation block: divider #dcdde6, 15px/400 #3f4257.
- Mic: 92px circle, 36px icon, shadow `0 8px 22px rgba(124,58,237,.35)`; rec: scale 1.1 + `0 0 0 12px rgba(239,68,68,.16)`; fullscreen: 78px, `rgba(255,255,255,.22)` + blur 8.
- Side buttons 52px white; status label 13px/700 uppercase, letter-spacing .08em, #6b6f85.
- Toast: bottom 130px, `rgba(20,20,30,.85)`, white 14px/600, radius 14, fade .25s, auto-hide 1.8s.
- z-index layers: avatar-fs 10 < subs 15 < bottom-fs 20 < topbar-fs 30 < menu backdrop 55 / menu 60 < sheet backdrop 70 / sheet 71 < toast 80 < review 90.

## 4. Avatar card specification

- Renderer: **@met4citizen/TalkingHead 1.4** + Three.js 0.170 from jsDelivr CDN (production dependency loaded at runtime — flagged in §10).
- Options: `cameraView: "upper"` (head + upper torso visible), `ttsEndpoint: "none"` (no TalkingHead TTS — audio only from engine). Default TalkingHead lighting/framing; no custom scene/environment/background (card bg #dfe3ee shows behind the model). No user camera.
- Model: GLB from engine status (`https://ai-tutor-engine.replit.app/api/tutor-assets/avatars/brunette_female_01.glb` + `?v=assetVersion`), body "F". Tutor display name from engine (currently "Emma").
- Animations — REAL: TalkingHead idle (built-in), greeting wave `playGesture("handup", 3, false, 800)` once per page load, lip-sync during speech. Lip-sync timing source: engine sends **no word timings**, so the page derives them by distributing the real subtitle words across the real decoded mp3 duration proportionally to word length (`deriveTimings`) — alignment of received data, not invented content. Diagnostics reported to native (`lipsyncDiag`).
- Mute (card 🔊 button and settings row): REAL — zeroes decoded PCM channels before `speakAudio`, so lip-sync + subtitles continue silently; replay buffers unaffected (each decode uses a copy).
- Expand ⛶ / collapse: REAL (see E14). Camera control: does not exist.
- Constraint: headless browsers without WebGL (Replit Screenshot tool) render the card empty — the avatar only appears in a real browser/WKWebView.

## 5. Conversation / chat specification

- Scrolling: only `#feed` scrolls; avatar card does NOT scroll with chat. Auto-scroll to bottom on every bubble append/finish/translation expand. No timestamps.
- Streaming: tutor text accumulates per `tutor.text.delta` into the current bubble live; user partials update a pending bubble per `speech.partial`, finalized on `speech.final`.
- Replay 🔊: replays the stored engine mp3 buffers through the avatar (with lip-sync) — no TalkHint TTS. Copy ⧉: clipboard, ✓ feedback. Translate 文А: §E08.
- While Emma speaks: mic disabled (PTT machine forbids barge-in). While user holds mic: PCM streams; releasing early with nothing captured returns silently to READY (no abandoned engine turn — `turn.start` is sent lazily with the first chunk).
- Local greeting bubble is explicitly labelled as NOT an Emma reply.

## 6. Input area specification

- Mic: 92px, 🎤 emoji glyph, **hold-to-talk** via pointer events (down/up/cancel/leave-while-recording); haptic `navigator.vibrate(10)` on press; capture 24 kHz mono PCM16 via AudioWorklet; permission denial → status «Нет доступа к микрофону», safe reset. Disabled outside READY/RECORDING.
- ⌨︎ keyboard: placeholder («Скоро — нужна поддержка движка»). No text composer exists.
- 📎 attach: placeholder. No attachment menu / photo / file exists.
- «💡 Что сказать?» chip: placeholder toast; READY-only visibility.

## 7. Compact vs Fullscreen

Same DOM, same session, same WebSocket — switching is `body.fs` class toggle only. Changes in fullscreen: avatar fills viewport; chat + chip hidden; big white subtitles appear (if enabled); controls become translucent/blur; mic shrinks 92→78px; side buttons and card overlay buttons hidden; ✕ becomes "collapse". Nothing reconnects or resets.

## 8. Settings

| Setting | UI | Real? |
|---|---|---|
| Subtitles | popover toggle Вкл/Выкл | REAL (affects fullscreen subtitles only) |
| Звук Emma (mute) | popover toggle + card 🔊/🔇 button (synced) | REAL (§4) |
| Сменить репетитора | popover row | placeholder toast |
| Завершить тренировку | popover row → quit sheet | REAL |
| Camera / more settings | — | do not exist |

Settings are in-memory per page load — not persisted.

## 9. Localization

- **A. ui_locale**: single switch `navigator.language.startsWith("ru")` → full RU dict, else full EN dict (all chrome strings, states, sheet, review, menu). No per-string mixing by design.
- **B/C. session language target/native**: NOT represented in this UI — lesson content language comes entirely from the engine; the page renders whatever text/audio arrives (may legitimately mix RU+EN inside bubbles).
- **D. per-message translation**: `/api/tutor/translate` — backend translates the tapped bubble's exact text (target language decided server-side).
- **Bugs / hardcoded strings found (not fixed, per task rules):**
  1. EN dict contains Russian `translateFailed: "Не удалось перевести"` — English UI shows a Russian error. **Mixed-language bug.**
  2. iOS native strings are hardcoded Russian regardless of device locale: «Тренировка», «Репетитор Emma», Assistant row subtitle (`AssistantViewController.swift`, `TutorViewController.swift`). **Mixed-language bug for non-RU devices.**
  3. Translate button label is the literal glyph pair `文А` in both locales (intentional icon-as-text, but it is a text placeholder for a real icon).

## 10. Assets & components inventory

| Asset | Kind | Production or placeholder |
|---|---|---|
| Avatar GLB `brunette_female_01.glb` | 3D model, served by engine | production (engine-owned) |
| Three.js / TalkingHead from jsDelivr CDN | runtime JS | works, but CDN dependency at runtime — review candidate for self-hosting |
| ✕ ⚙︎ 🔊 🔇 ⛶ ⌨︎ 🎤 📎 💡 ⧉ ✓ 💬 👤 🏁 ! and «文А» | emoji/unicode glyphs used as icons | **all placeholders** — no SVG icon set exists anywhere in this UI |
| Card/page backgrounds | flat CSS colors | production-intent |
| Silent mp3 (preview harness only) | base64 in `tutorPreviewPage.ts` | dev-only |
No images, no custom fonts, no animation asset files.

## 11. Source mapping

| Component | File | Symbol |
|---|---|---|
| Entire tutor page (layout/styles/logic) | `server/tutorAvatarPage.ts` | `TUTOR_AVATAR_PAGE_HTML` |
| Routes `/tutor`, `/tutor/preview`, `/api/tutor/*` | `server/tutorRoutes.ts` | — |
| PTT state machine | `server/tutorPttMachine.ts` | `pttNext`, `micAllowed` |
| Translation endpoint | `server/tutorTranslate.ts` | — |
| Preview harness / scenario driver | `server/tutorPreviewPage.ts` | `buildTutorPreviewHtml` |
| iOS entry row | `ios/TalkHint/UI/AssistantViewController.swift` | `.tutor` case |
| iOS webview host + bridge | `ios/TalkHint/UI/TutorViewController.swift` | `TutorViewController` |
| Tests touching UI source | `server/__tests__/tutorPttMachine.test.ts`, `server/__tests__/tutorTranslate.test.ts` | — |

## 12. Master screen table

| ID | Screen/state | Major components | Implemented? | Source | Placeholders/problems |
|---|---|---|---|---|---|
| E01 | iOS entry | table row → WKWebView | yes (native) | AssistantViewController | RU-only strings |
| E02 | Loading/connecting | status label, disabled mic | yes | tutorAvatarPage | — |
| E03 | Ready | top bar, avatar card, greeting, chip, controls | yes | tutorAvatarPage | chip/⌨︎/📎 are toasts; emoji icons |
| E04 | Recording | red mic, pending bubble | yes | tutorAvatarPage | — |
| E05 | Thinking | final user bubble, grey mic | yes | tutorAvatarPage | — |
| E06 | Speaking | lip-sync, streaming bubble | yes | tutorAvatarPage | derived (not engine) word timings |
| E07 | Dialog | bubbles + action rows | yes | tutorAvatarPage | no timestamps |
| E08 | Translation | inline expandable block | yes | tutorAvatarPage + tutorTranslate | 文А text-glyph icon |
| E09 | Long/scroll | fixed chrome, scrolling feed | yes | tutorAvatarPage | — |
| E10 | Error | retry button | yes | tutorAvatarPage | — |
| E11 | Ending/mem pending | status transitions | yes | tutorAvatarPage | — |
| E12 | Memory review | editable form | yes | tutorAvatarPage | — |
| E13 | Memory confirmed | status + native event | yes | tutorAvatarPage | no dedicated "ready for call" screen |
| E14 | Fullscreen | subtitles, translucent chrome | yes | tutorAvatarPage | — |
| E15 | Settings popover | 4 rows | yes | tutorAvatarPage | change-tutor is toast; no camera |
| E16 | Quit sheet | !, title, 2 buttons | yes | tutorAvatarPage | — |
| — | Text input, attach menu, hints UI, tutor picker, camera | — | **NO** | — | buttons exist, features don't |

## 13. Component table

| Component | Visual | Interaction | Source | Status |
|---|---|---|---|---|
| Mic button | 92px violet circle / red rec / grey disabled | hold-to-talk, haptic, pointer events | tutorAvatarPage + tutorPttMachine | production |
| Tutor bubble | grey, radius 20, action row | replay/copy/translate | tutorAvatarPage | production (emoji icons placeholder) |
| User bubble | violet, pending 65% | streams partials | tutorAvatarPage | production |
| Hint chip | violet-on-lilac pill | toast only | tutorAvatarPage | **placeholder** |
| Keyboard/attach buttons | 52px white circles | toast only | tutorAvatarPage | **placeholder** |
| Avatar card | 36vh rounded, TalkingHead | mute/expand overlays | tutorAvatarPage | production (CDN runtime dep) |
| Subtitles | white 26px overlay | auto from stream, toggleable | tutorAvatarPage | production |
| Settings popover | frosted panel | toggles/rows | tutorAvatarPage | production (1 placeholder row) |
| Quit sheet | white bottom sheet | continue/end, double-tap-safe | tutorAvatarPage | production |
| Memory review form | full-screen form | edit + confirm (PATCH+POST) | tutorAvatarPage | production |
| Toast | dark pill | auto-hide 1.8s | tutorAvatarPage | production |

## 14. State matrix

| State | Avatar | Chat | Mic | Status indicator | Available actions |
|---|---|---|---|---|---|
| LOADING | loading/empty | greeting after load | disabled grey | «Загружаем Emma…»/«Подключаемся…» | ✕ (close to native), ⚙︎ |
| READY | idle | history | enabled violet | «Удерживайте и говорите» | hold mic, chip, replay/copy/translate, mute, expand, settings, quit |
| LISTENING (RECORDING) | idle | pending user bubble | red, held | «Слушаю…» | release |
| TRANSCRIBING | idle | bubble finalizes | grey-violet | «Emma думает…» | wait (chrome buttons still work) |
| THINKING (PROCESSING) | idle | — | grey-violet disabled | «Emma думает…» | same |
| SPEAKING | lip-sync | streaming tutor bubble | grey-violet disabled | «Emma говорит…» | mute, expand, settings |
| ERROR | frozen | history preserved | hidden | error text | «Повторить» |
| SESSION_ENDING | idle | frozen | disabled | «Завершаем тренировку…» | none |
| MEMORY_PENDING | idle | frozen | disabled | «Готовим память разговора…» | none |
| MEMORY_CONFIRMATION | hidden (overlay) | hidden | hidden | form + save status | edit fields, confirm |
| REAL_CALL_READY | — | — | — | «Готово! …» text only | no dedicated screen (gap vs spec) |

## 15. Visual output

Canonical visual artifacts are the **live canvas frames** (real implementation, not mockups), 390×844:
`tutor-ready` (E03), `tutor-recording` (E04), `tutor-processing` (E05), `tutor-speaking` (E06), `tutor-dialog` (E07), `tutor-translate` (E08), `tutor-long` (E09), `tutor-error` (E10), `tutor-pending` (E11), `tutor-review` (E12), `tutor-confirmed` (E13), `tutor-fullscreen` (E14), `tutor-menu` (E15), `tutor-quit` (E16), plus legend note `tutor-review-legend`.

Static screenshot export limitation (documented, not worked around): the headless screenshot browser has **no WebGL**, so the avatar never renders and the scenario driver (which waits for avatar readiness) does not advance — exported PNGs would show only the loading state, misrepresenting the design. The frames must be viewed live in a browser. E01 is native iOS and cannot be rendered in Replit at all.
