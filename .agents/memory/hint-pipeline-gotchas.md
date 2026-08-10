---
name: Live hint pipeline gotchas
description: Non-obvious failure modes of the live-call hint/throttle pipeline in server/websocket.ts
---

# Live hint pipeline gotchas

**Goal status must NEVER gate hint delivery (do not reintroduce the hard stop).**
TalkHint is a continuous prompter for the whole call: goal achieved/cancelled/replaced are context/UI/analytics signals only. There is no hard stop, no forced canned closing phrase on the achieving turn, no wait state, and `wantSuggestion` must never reference goal status.
**Why:** explicit user requirement — real conversations continue after the goal (payment questions, new topics); the earlier hard stop + canned "All set!" phrase left the user without hints mid-call.
**How to apply:** `goalAchievedFlag` may be WRITTEN in both utterance handlers, but its only allowed READ is the neutral prompt-context note ("original goal appears resolved, continue normally"); reset it when `goalChanged`. A source-level guard test (`goalStatusNeverStops.test.ts`) enforces this — keep it passing. The golden prompt's stop rule was also rewritten ("Goal achieved is NOT a stop"); don't restore "STOP generating suggestions".

**Speakerphone bleeds the same speech onto BOTH Deepgram tracks.**
inbound=HON, outbound=GST is correct, but on a speaker the mic captures the remote audio (and vice versa), so identical text is transcribed on both tracks → role confusion ("the doctor's words shown as YOU").
**How to apply:** dedup cross-track at the utterance-complete chokepoint — drop an utterance if a highly-similar one (≥0.85) from the OPPOSITE speaker arrived within ~1.2s. Keep window short + similarity high so legitimate turn-taking/confirmations aren't dropped.

**Duplicate-suggestion filter must compare against a WINDOW, not just the last hint.**
Near-identical hints (e.g. "Please confirm … Monday at 5 PM" vs "I need to confirm … Monday at 5 PM") score ~0.67 Jaccard — under a 0.7 threshold and invisible if only the immediately-previous hint is compared.
**How to apply:** keep last ~4 suggestions, block at ≥0.5 similarity to any of them.

**Farewell suppression must exempt questions/actionable lines.**
Blocking hints on farewell phrases ("see you", "thanks") is right for closings, but a bare `thanks`/`thank you` match suppresses valid lines like "Thanks, what time works best?" or "Thanks. I'm just looking for your account" (real prod incident).
**How to apply:** detection lives in `server/farewellFilter.ts` (unit-tested). Hard closers (bye/take care/see you) always count; soft politeness (thanks/appreciate it) counts only if stripping politeness+filler leaves nothing substantive; questions/actionable keywords never count. Beware regex alternation order — "thank" must not eat "thank you so much".

**Hint model + mode + language are intentionally module-global, NOT per-user.**
`currentModel` (set via `set_model`), `currentMode`, and `currentLanguage` are all module-level globals in server/websocket.ts; any /ui client mutates them for everyone.
**Why:** the app is operated as effectively single-user; the model selector was added to match the existing mode/language pattern. Making only the model per-user would be inconsistent and confusing.
**How to apply:** if you ever scope one of these per-user/per-call, scope ALL THREE together and thread them through the call/stream context, not just the env var. Until then, keep them consistent. `set_model` is allowlist-validated (`ALLOWED_HINT_MODELS`); default + env override is `HINT_MODEL`.

**Gemini 2.5 quirks for short live hints.**
Gemini 2.5 models "think" by default — for short JSON hints that adds latency AND can consume the whole output budget, leaving `candidates[0].content.parts[].text` empty. Always set `generationConfig.thinkingConfig.thinkingBudget=0` for hint-style calls.
**Why:** without it the call "succeeds" (HTTP 200) but returns no usable text, which looks like a parsing bug.
**How to apply:** also don't validate Gemini API keys by an `AIza` prefix — a valid working key here was ~53 chars and did NOT start with `AIza`. New hint providers just need an `ALLOWED_HINT_MODELS` entry + a model-name branch in `translateAndSuggest`; no SDK (both providers use global `fetch`). Gemini is the default hint model, so the Gemini path auto-falls-back to OpenAI (`gpt-4.1-mini`) on error/empty output — keep that fallback whenever the default depends on a non-OpenAI provider, or a provider outage silently kills all live hints.

**Per-call async data loaded on Twilio "start" must be AWAITED before the first hint, not fire-and-forget.**
Per-user "My Context" (and any per-call lookup kicked off in the `case "start"` handler) loads asynchronously. If you only `.then()` it, the first guest turn can reach `translateAndSuggest` before the load resolves → the first hint(s) run with empty context, violating "injected into EVERY hint".
**Why:** hint generation fires on guest-utterance-complete, which can race ahead of the start-time DB read.
**How to apply:** store the load as a promise (`ownerContextReady`) on the connection scope and `await` it just before `translateAndSuggest`; after first resolution it's a no-op. Reset the value (`ownerContext = ""`) at each `start` to avoid stale carryover. Keep it per-connection, NOT module-global (it's genuinely per-user, unlike model/mode/language).

**A provider fallback gated only on "empty/unparseable" is NOT enough — also fall back on parsed-but-incomplete.**
gemini-2.5-flash-lite often returns well-formed JSON with a `translation` but silently omits `suggestion`. That parses fine, so an empty-output-only fallback never fires and the user gets the translation with NO hint — looks like "hints stopped after one" on a live call.
**Why:** a real 62s call gave exactly one suggestion; logs showed the 2nd guest turn produced a caption/`[TIMING]` but no `[Suggestion]` and no `[BLOCKED]` line → `translated.suggestion` was just absent.
**How to apply:** treat "valid response but missing the field you actually need" as a fallback trigger, not just transport/parse errors. Gate it so you don't waste a 2nd model call on turns that legitimately have no hint — pass `forceSuggestion = !reactionOnly && !isFarewell` into `translateAndSuggest`. Count the missing-suggestion fallback toward the same `geminiHintFallbacks` stat but guard against double-counting when the hard-failure path already incremented (`fellBack` flag).

**The OpenAI `max_tokens` cap must fit the WHOLE combined JSON, or the suggestion is silently truncated off ("one hint then nothing").**
The shared `generateWithOpenAI` helper had a hard `max_tokens: 80`. The combined `translateAndSuggest` prompt returns translation + suggestion(en+translation) + sentiment in one JSON — on normal-length turns that overflows 80 tokens, the reply is cut off mid-JSON, `parseHint`'s `/\{[\s\S]*\}/` finds no closing `}`, returns null → no suggestion, and NO error/`[BLOCKED]` is logged (parse-null is silent). Symptom in prod: `[HINT]` line present but no `[Suggestion] Sending`, only the first (short) turn gets a hint.
**Why:** this appeared only after OpenAI became the primary hint provider. Gemini's path used `maxOutputTokens: 250` so it never truncated; the OpenAI helper's 80 was fine for the old sentiment-only usage but far too small for the combined hint JSON. The parallel translation/caption split hid it further — the caption comes from a separate translation-only call (80 tokens is plenty for that) so captions kept working while suggestions vanished.
**How to apply:** give the combined suggestion call a real budget (`generateWithOpenAI(..., 250)` via a closure at the `translateAndSuggest` routeGenerate site — covers the Gemini→OpenAI fallback too). Keep the translation-only (`translateGuestText`) and sentiment calls at the small default. `max_tokens` is a cap not spend, so raising it doesn't cost more on short turns. Whenever a call's prompt asks for a bigger JSON than an existing shared helper was sized for, re-check the token cap before assuming a logic bug.

**Stale-suggestion freshness guard must key on guest StartOfTurn, not only EndOfTurn.**
A freshness gate that only tracks the newest *completed* guest turn (updated in `handleGuestUtteranceComplete`) will NOT catch the most common "stale hint" case: the guest starts their next phrase while the ~2s suggestion is still generating, and that next turn finishes AFTER the old suggestion resolves. At the moment the old suggestion is ready, no newer turn has *completed* yet, so `utteranceId === latestGuestUtteranceId` and it passes — then it fires, arms the 1.5s cooldown, and the genuinely-fresh next turn gets `[BLOCKED] reason=cooldown`.
**Why:** a real call (guest u3 "you didn't answer, what time can you come over") showed the u3 suggestion appear 1.3s after the guest had already restarted (StartOfTurn u4); u4's own suggestion was then dropped by cooldown. The completed-turn guard alone can't see the in-flight turn.
**How to apply:** the completed-turn guard (compare `utteranceId` vs `latestGuestUtteranceId` after the await, and DON'T arm cooldown when dropping stale) is correct and low-risk — keep it as the safe first layer. But to actually cover the overlap case you must also advance a freshness token on guest **StartOfTurn** (pre-completion) and drop the suggestion if that token moved while generating. StartOfTurn-based dropping is riskier (false starts / brief blips), so gate it and ship it as a separate step after the completed-turn guard.

**Any hint drop that does NOT display a suggestion must NOT arm the cooldown.**
The cooldown (`lastHintTs`/`lastHintUtteranceId`) exists to space out *shown* hints. If a non-display drop (stale, duplicate_suggestion, repeat_intent, self_overlap, reaction_only, etc.) arms it, a blocked *redundant* hint silently suppresses the *next genuinely-new* guest turn with `[BLOCKED] reason=cooldown`.
**Why:** the whole class of "one hint then nothing / next turn gets no help" bugs traces back to cooldown being armed on a turn that never actually produced a visible hint.
**How to apply:** only set `lastHintTs`/`lastHintUtteranceId` on the paths that actually `uiBroadcast` a suggestion/ACK/closing. Every early `return` guard should leave the throttle state untouched. Corollary: do NOT "fix" hint spam by raising the cooldown to tens of seconds — for this 1:1 translation assistant a long blanket timer starves legitimate consecutive turns; throttle on *content/relevance* (duplicate/self-overlap/relevance-gate) instead of time.

**Self-overlap guard: don't re-suggest what the owner (HON) already said.**
The suggestion is what HON should say next; the LLM sees HON's turns as context but nothing hard-stops it from echoing a line HON just spoke. Keep the last few HON turns per connection and drop the suggestion if it's ≥~0.7 Jaccard (`textSimilarity`) to any of them — as a *post-generation* check (topic isn't known pre-generation), grouped with the duplicate-suggestion check, and (per rule above) without arming the cooldown.
**Why:** distinct from duplicate_suggestion (which compares vs recent *hints*) and from cross-track echo (opposite-speaker acoustic bleed, ~1.2s window) — neither catches "hint repeats the owner's own recent speech".
**How to apply:** false positives (blocking a needed hint) are costlier than false negatives here, so keep the threshold moderately high; if over-blocking appears, raise to 0.75–0.8 or require a minimum owner-turn token count before applying.

## Dropped-question carryover (burst-speaking robots)
Rule: a guest question whose hint is dropped must be captured EAGERLY at the next turn's handler entry (HintCarryover.beginTurn, synchronous, before any await) — capturing at the stale guard is too late because the newer turn consumes an empty carryover first.
**Why:** robot callers speak in 3-5s bursts; questions in superseded phrases vanished silently in prod. A first fix that remembered at the stale check was rejected in review for exactly this race.
**How to apply:** every terminal hint-suppression path goes through dropHint(reason, detail, preserveQuestion) — no silent returns. preserveQuestion=true for paths after carryover consume (cooldown/hint_shown/no_suggestion/duplicate/repeat/self_overlap); false when nothing was consumed (reaction/farewell/wait) or nothing can use it (goal hard stop, stale = already captured eagerly).

## Goal-achieved hard stop false positives
- `goal_achieved` silences ALL remaining hints for the call, so its trigger must be conservative: an achieved-phrase ("fixed", "done", "resolved") inside a QUESTION clause or preceded by a negation is NOT a confirmation, and phrase matching must be whole-word + clause-aware, evaluating every occurrence. Slot-completion achievement must also skip question turns ("Would Friday at 3 work?" fills date+time but confirms nothing).
- Real incident: owner asked "What should I do the next to the fixed call and text?" — substring "fixed" marked the goal achieved mid-troubleshooting and every later hint was blocked.

## Goal-achieved is informational only (user requirement, 2026-08-08)
The user explicitly requires: the system must never decide the call is "over" and stop hints — while the guest talks, hints continue like a prompter. goal_achieved now only fires the UI event + one closing phrase on the achieving turn; it never suppresses later suggestions (all hard-stop checks removed from the hint path). Do NOT reintroduce goal-based hint suppression.

**Tutor page late-audio guard:** a tutor audio frame arriving after turn.completed must NOT dispatch tutorSpeaking from READY (no later completion would release the mic); play audio, keep state. Also fallback (no-avatar) BufferSources are tracked and stopped on end/retry/ws-close.
