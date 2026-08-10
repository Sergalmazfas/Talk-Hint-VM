# Emma Tutor UI v4 — Praktika-Quality Redesign · Design Package (DESIGN ONLY)

**NO PRODUCTION CODE WAS CHANGED.** All mockups live in `artifacts/mockup-sandbox/src/components/mockups/tutor-v4/` (isolated sandbox). `server/tutorAvatarPage.ts`, realtime logic, PTT machine, APIs, iOS wrapper and engine integration are untouched.

## A. Mockups (live canvas frames, 390×844)
Row at y≈2160 on the canvas: `praktika-ref` (benchmark image) · `v4-01-ready` · `v4-02-dialog` · `v4-03-translate` · `v4-04-recording` · `v4-05-thinking` · `v4-06-speaking` · `v4-07-long` · `v4-08a/b/c-framing`.

## B. Side-by-side comparison
- CURRENT EMMA: as-built frames row at y≈341 (`tutor-ready` …) — see `docs/emma-tutor-ui-baseline.md`.
- PRAKTIKA BENCHMARK: image frame `praktika-ref` (uploaded reference).
- PROPOSED EMMA: v4 row directly below the current rows.

## C. Design specification (from the actual mockup code)
- Viewport: 390×844, max-w 430, page bg **#fbfafc**, text **#29252f**, font `ui-rounded / Avenir Next / system-ui`.
- Header: 40px row; X and Settings — 36px circles, white, 1px border #e8e5eb, icon 17–18px; title "Emma" 17px/700, tracking −0.02em.
- Avatar card: height **260px** (compact **190px** in long-conversation proposal), radius **28px**, warm shadow `0 12px 32px rgba(72,55,44,.13)`, image object-cover with per-framing focal point (close 18% / half 24% / wide 38%), bottom gradient overlay black/25→transparent. Overlay controls: 36px circles, `bg-black/20` + blur + white/30 border, white icons 16px. Speaking indicator: white/70 blur pill with 4 violet equalizer bars.
- Emma imagery: 3 generated environment shots (`emma-close/half/wide.png`) — stylized 3D brunette tutor in softly lit cozy study, bokeh depth. **Recommendation: B (half-body, `emma-half`)** — face is focal but hands/posture keep her "alive"; close-up (A) is strongest for fullscreen mode; wide (C) loses facial presence at 260px height.
- Chat: bubbles radius 20 (anchored corner 6), padding 16×12, text 14px lh 1.38, max-width 86%, 16px gap. Tutor: #efedf0 / #39343e. User: #7c3aed / white + violet shadow `0 5px 14px rgba(124,58,237,.18)`; pending user bubble: violet 55% + italic. Translation: inside the same bubble under 1px #d9d5db divider, 12px #77717d. Thinking: three animated violet dots in a tutor bubble.
- Action row (under Emma bubbles): 11px/600 #8a8792, icons 13–14px lucide — **Volume2 «Повторить» + Languages «Перевод»** primary (violet when active), Copy subdued at 55% opacity.
- Hint chip: pill `border #ddd0f8, bg #f5efff, text #7131d6`, 12px/700, Lightbulb 15px.
- Status label: 9px/700 uppercase, tracking .14em, #aaa5af, right-aligned above mic.
- Bottom controls: keyboard/paperclip 48px circles bg #f0edf2 icons 20px; **mic 70px** violet #7c3aed, white filled Mic 27px, glow `0 9px 24px rgba(124,58,237,.3)`; RECORDING: **#e64d5a** + two expanding pulse rings (#ef5361 at 35%/20%); PROCESSING/DISABLED: #d8d5dc, no shadow, icon #aaa6ae. Home indicator bar 112×4 #d8d4da.
- Safe areas: `env(safe-area-inset-top)+14px` top, `env(safe-area-inset-bottom)+4px` bottom.
- Icons: **lucide-react** stroke set (X, Settings, Volume2, Expand, Languages, Copy, Lightbulb, Keyboard, Mic, Paperclip) — one stroke language, replaceable components. No emoji glyphs.

## D. Component inventory
IconButton (circle, 3 tints: white-border, translucent-dark, soft-grey) · AvatarCard (image + gradient + overlay controls + speaking EQ) · ChatBubble (tutor/user/pending, inline translation) · ActionRow · HintChip · StatusLabel · MicButton (ready/recording/disabled + pulse rings) · shared scaffold `_shared/TutorScreen.tsx`, keyframes in `_group.css` (pulse, dots, equalizer).

## E. Existing functionality preserved (unchanged by this design)
Hold-to-talk PTT machine & states, realtime WS lifecycle, streaming text, replay of engine audio, on-demand translation API, copy, mute, fullscreen expand, settings, quit sheet → Call Memory flow, localization split (RU chrome / EN lesson content / RU translation), lip-sync & latency diagnostics.

## F. Visual-only changes proposed
New palette-tuned light theme (#fbfafc), rounded-font typography, redesigned header buttons (bordered white circles), avatar card as image-led hero with gradient + glass overlay controls, restyled bubbles/action rows with lucide icons + text labels, restyled hint chip, new bottom-controls hierarchy (70px mic + 48px secondaries), pulse/dots/equalizer micro-animations, status label moved beside chip row.

## G. Changes requiring engineering after approval
1. TalkingHead camera re-framing to match option B (closer `cameraView`, custom camera position/scale) — the mockups use images; production keeps the real 3D Emma.
2. Environmental scene behind the 3D model (background image/environment + lighting in the avatar card) instead of flat #dfe3ee.
3. SVG icon system replacing all emoji glyphs in `tutorAvatarPage.ts`.
4. Avatar-card height/typography/spacing restyle of the production page CSS.
5. Long-conversation proposal: avatar card compacts (260→190px) when the feed grows — new scroll-linked behavior. Recommendation: keep avatar fixed + feed scrolling (matches Praktika, keeps lip-sync visible); compaction is optional polish.
6. Speaking equalizer + thinking dots + recording pulse animations.
7. (unchanged placeholders) keyboard input, attachments, hints backend, change-tutor — separate tasks.

## H. Statement
**NO PRODUCTION CODE WAS CHANGED.** Awaiting explicit approval before any implementation task is created.
