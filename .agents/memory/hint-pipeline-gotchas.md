---
name: Live hint pipeline gotchas
description: Non-obvious failure modes of the live-call hint/throttle pipeline in server/websocket.ts
---

# Live hint pipeline gotchas

**Goal-achieved hard stop must hold on BOTH speaker paths.**
The goal can be achieved on the OWNER's (HON) reply, not just the guest's (GST). If only the GST path sets the hard-stop flag, late hints leak after "цель достигнута".
**Why:** a real call showed two extra "confirm appointment" hints after the goal was already achieved.
**How to apply:** set the hard-stop flag wherever `goalUpdate.goalAchieved` is true (both utterance handlers), AND re-check it right before broadcasting the suggestion — `translateAndSuggest` is awaited (network ~hundreds ms), so a concurrent utterance can pass the early check before the flag is set.

**Speakerphone bleeds the same speech onto BOTH Deepgram tracks.**
inbound=HON, outbound=GST is correct, but on a speaker the mic captures the remote audio (and vice versa), so identical text is transcribed on both tracks → role confusion ("the doctor's words shown as YOU").
**How to apply:** dedup cross-track at the utterance-complete chokepoint — drop an utterance if a highly-similar one (≥0.85) from the OPPOSITE speaker arrived within ~1.2s. Keep window short + similarity high so legitimate turn-taking/confirmations aren't dropped.

**Duplicate-suggestion filter must compare against a WINDOW, not just the last hint.**
Near-identical hints (e.g. "Please confirm … Monday at 5 PM" vs "I need to confirm … Monday at 5 PM") score ~0.67 Jaccard — under a 0.7 threshold and invisible if only the immediately-previous hint is compared.
**How to apply:** keep last ~4 suggestions, block at ≥0.5 similarity to any of them.

**Farewell suppression must exempt questions/actionable lines.**
Blocking hints on farewell phrases ("see you", "thanks") is right for closings, but a bare `thanks`/`thank you` match suppresses valid lines like "Thanks, what time works best?".
**How to apply:** treat as farewell only if it matches the farewell regex AND has no "?" AND no actionable/scheduling keyword.

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
**Why:** this appeared only after OpenAI became the primary hint provider (Step 1). Gemini's path used `maxOutputTokens: 250` so it never truncated; the OpenAI helper's 80 was fine for the old sentiment-only usage but far too small for the combined hint JSON. The parallel translation/caption split (Step 2) hid it further — the caption comes from a separate translation-only call (80 tokens is plenty for that) so captions kept working while suggestions vanished.
**How to apply:** give the combined suggestion call a real budget (`generateWithOpenAI(..., 250)` via a closure at the `translateAndSuggest` routeGenerate site — covers the Gemini→OpenAI fallback too). Keep the translation-only (`translateGuestText`) and sentiment calls at the small default. `max_tokens` is a cap not spend, so raising it doesn't cost more on short turns. Whenever a call's prompt asks for a bigger JSON than an existing shared helper was sized for, re-check the token cap before assuming a logic bug.
