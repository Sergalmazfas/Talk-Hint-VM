# LIVE Hint Policy v2.1 — Adaptive Hint Types: Evidence Report

Task #234. Date: 2026-08-16.

## Verdict: PASS (code + tests + live model smoke) / real-call acceptance PENDING deploy

## 1. CURRENT policy before the change

- Prompt: `buildLiveSystemPrompt` (shared/prompts.ts) = header (goal + language) + CONVERSATION HISTORY (last 10 turns) + context providers (USER_CONTEXT → CONTACT_CONTEXT → STATIC_CARDS → TUTOR_MEMORY) + LIVE_GROUNDING_RULES + GOAL_PRIORITY_RULES + LIVE_ANTI_LOOP_RULES + task ("under 25 words" suggestion) + JSON schema `{"translation","suggestion":{"en","translation"},"sentiment"}`.
- Parser: regex `\{[\s\S]*\}` + JSON.parse in `parseHint` (server/websocket.ts); no type/options/native_helper.
- Wire: `suggestion` event with `en`/`translation`/`utteranceId`/`callSid`; talkhint/ui reads only `data.en || data.english` and `data.translation` (script.js:1289-1299) — unknown extra fields are ignored (safe).
- One BRAIN call per guest turn via `routeGenerate`; gpt-5.x body = `max_completion_tokens: 250, reasoning_effort: "none"` (server/hintProvider.ts).

## 2. Exact changes

### Prompt (shared/prompts.ts)
- New exported `ADAPTIVE_HINT_TYPE_RULES` (10 rules, verbatim per task spec) inserted into BOTH branches of `buildLiveSystemPrompt` after `LIVE_ANTI_LOOP_RULES`. Includes:
  - DIRECT / CHOICE / USER_INPUT / STRATEGIC definitions with the canonical examples (installed app, SMS code, phone unlocked, SSN placeholder, payment-allocation dispute);
  - CHOICE vs USER_INPUT boundary ("press Install eSIM" → user_input; "is the eSIM installed?" unconfirmed → choice);
  - Unknown-state rule (strengthens grounding, never weakens): never guess what the user physically did/received/saw/owns/knows/has — use CHOICE or USER_INPUT instead;
  - Adaptive length rule ("never long just because 25 words are available");
  - placeholder-first for SSN/PIN/verification codes/account/card values, even if seen earlier in transcript/context; non-sensitive confirmed substitution explicitly preserved;
  - native_helper = instruction to the user (never spoken to Guest); options are not facts; GOAL priority rules remain authoritative.
- JSON instruction extended with `type`, `options[]`, `native_helper`. Translate-OFF branch orders empty translations AND empty native_helper.
- No existing rule text was modified or removed (asserted by existing tests: liveGroundingRules, livePromptObjectionRules, goalCompassNotRails — all pass unchanged).

### Parser + wire (server/hintShape.ts — new pure module; server/websocket.ts)
- `normalizeSuggestion(raw, {translateEnabled, stripPreamble})`: validates `type` (unknown/missing → legacy behavior), filters junk options (cap 3, ≥2 required for choice), keeps `native_helper` only for user_input, force-empties ALL translated fields incl. native_helper when Translation OFF, fails closed on malformed choice (no empty cards).
- For every valid CHOICE the compat `en`/`translation` are ALWAYS composed deterministically from the validated options (`If yes: "…" / If no: "…"`) — a model-supplied main reply is ignored, so the legacy client display, dedup, telemetry, and hint-usage matching all consume the same canonical string (architect-review fix).
- Sensitive-value backstop `redactSensitive` behind the prompt rule (architect-review fix): SSN-with-separators and 13-19-digit card runs redacted in EVERY hint field; user_input frames + native_helper additionally redact any bare 6+-digit run (a placeholder frame must not contain digits). Short 4-5-digit codes in non-user_input hints are left to the prompt rule — indistinguishable from prices/ZIPs; deeper enforcement is Task #237.
- `parseHint` now delegates to `normalizeSuggestion`; downstream (dedup, cooldown, telemetry `latencyRecorder.sent(utteranceId, en)`, hint-usage matching) all operate on the composed `en` — untouched logic.
- `suggestion` broadcast: additive optional fields `suggestionType`, `options`, `nativeHelper`; `en`/`translation` always populated. Old clients (talkhint/ui, iOS) read only en/translation → no crash, no empty card.
- Options/native_helper never reach transcript or contact memory: suggestions are never written to conversationLog/fullConversation (only actual speech is), plus prompt rule 9.

## 3. Single Terra call per Guest turn — confirmed
- No new LLM call anywhere: normalization is pure string work (server/hintShape.ts has zero imports of any provider).
- Test: `routeGenerate` with a non-gemini model makes exactly 1 provider call (adaptiveHintTypes.test.ts).
- Model profile unchanged: `buildOpenAIChatBody` untouched (`max_completion_tokens: 250, reasoning_effort: "none"`).

## 4. Live model smoke (real gpt-5.6-terra, production profile, real assembled prompt)

| Scenario | type returned | latency | Result |
|---|---|---|---|
| "Did you receive the SMS code?" (unconfirmed) | `choice` | 2144ms | options yes: "Yes, I received it." / no: "No, I haven't received it yet."; RU translations; compat en composed |
| "Have you already installed the app?" (owner confirmed earlier) | `direct` | 1079ms | "Yes, I have." — 3 words, no CHOICE (known-state precedence) |
| "What's your Social Security number?" | `user_input` | 1452ms | "It's [your Social Security number]." + native_helper RU "Назовите свой номер социального страхования." — no generated SSN |
| Payment-allocation dispute | `strategic` | 1754ms | Substantive negotiation line referencing the $350/August facts |

Latency vs baseline: production Mint call (2026-08-16) brain p50 = 1600ms, p90 = 1824ms. Smoke range 1079–2144ms is within normal Terra variance; no material regression expected (slightly larger prompt + a few JSON fields; `reasoning_effort:"none"` unchanged). Honest p50/p95 comparison to be read from live telemetry after deploy.

## 5. Regression tests
- New `server/__tests__/adaptiveHintTypes.test.ts` (31 tests): all canonical scenarios (DIRECT confirmed-fact, CHOICE SMS-code, USER_INPUT SSN placeholder + RU/ES native helper language, STRATEGIC, known-state precedence, unknown physical action/eSIM boundary), parser validation/compat/Translation-OFF gating, fail-closed malformed choice, single-provider-call guarantee, plus adversarial cases: CHOICE with rogue main reply → canonical composed string; echoed SSN/card/OTP redaction; no over-redaction of prices/ZIPs.
- Full suite: **908/908 tests pass** (67 files), including all pre-existing prompt-contract tests unchanged.

## 6. #226/#227 comparison + real-call acceptance — PENDING deploy
Baselines already collected (hint usage full/partial/ignored %, goal-return adherence, avg hint length, brain p50 1600ms / p90 1824ms, e2e p50 1697ms). After the user publishes and makes a real call, compare: type distribution (direct/choice/user_input/strategic), avg hint length (expect ↓ for factual turns), invented-state violations (expect 0), BRAIN p50/p95, hint usage %. UI rendering of options as separate buttons is deliberately deferred to Task #235.

## 7. Remaining defects / notes
- Old clients see CHOICE as one combined line (`If yes: "…" / If no: "…"`) — by design until Task #235.
- native_helper is suppressed when per-user Translation is OFF (it is a native-language field; obeys the existing gate). If a translation-off user needs helpers, that's a future product decision.
- Library-first hits and wait-state ACKs carry no `suggestionType` (source ≠ model) — unchanged legacy shape, intentional.
- Residual sensitive-leak risk: 4-5-digit codes in direct/choice/strategic hints rely on the prompt rule only (safe redaction impossible without breaking prices/quantities) — full negative-test coverage is Task #237.
