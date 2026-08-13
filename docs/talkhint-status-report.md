# TalkHint Status Report — response to Engine's `talkhint-status-request.md`

Date: 2026-08-13. Prepared by the TalkHint agent. Every claim below was re-verified
against the CURRENT codebase (file references included) or, where runtime-only,
against a live dev run performed today. Items that could not be verified right
now are marked **UNKNOWN** — nothing is guessed. No secret values are included
(env var NAMES only).

Note: the request file itself lives in the Engine's repo and was not available in
this workspace; this report follows the 10 sections as communicated. If specific
sub-questions differ, send the file and we will amend.

---

## 1. Live call pipeline — VERIFIED

- TwiML builds `wss://<host>/twilio-stream` (`server/routes.ts:1149-1153`; incoming/hold
  `<Start><Stream>` at `:964-971`, outbound at `:1419-1420`). WS upgrade accepts
  `/twilio-stream` (and legacy `/media`) in `server/websocket.ts:736-786`.
- Each Twilio `start` captures streamSid/callSid + `customParameters.callType` and opens
  TWO Deepgram streams (inbound/outbound); `media.track` routes to the matching DG socket
  (`server/websocket.ts:1998-2029, 2167-2205`).
- Track→speaker mapping (`server/speakerRoles.ts:4-55`): owner-leg/outbound (browser)
  inbound=Owner, outbound=Guest; caller-leg `incoming_answered` (browser `<Dial><Client>`,
  iOS `<Dial><Conference>`) is MIRRORED: inbound=Guest, outbound=Owner. Applied at
  `server/websocket.ts:2170-2183`.
- Legacy `talkhint/backend/twilio-stream.js` is an older handler with no role logic; the
  live path is `server/websocket.ts`.

## 2. Twilio — VERIFIED

- `POST /twilio/voice`, `/twilio/status`, `/twilio/dial-status` all pass
  `validateTwilioSignature` (403 on failure) — `server/routes.ts:84-112, 1132-1135, 1449, 1498`.
- `DISABLE_TWILIO_SIGNATURE_CHECK` works only outside production; in prod it is force-ignored
  with a warning (`server/routes.ts:39-50`). Missing auth token → 500, fail-closed.
- Incoming answered: browser uses `<Dial><Client>`, iOS uses `<Dial><Conference>` bridge;
  outbound uses `<Dial>` + stream (`server/routes.ts:964-1010, 1419-1438`).
- Number pool: all numbers on the MAIN account (subaccount numbers break signatures +
  conference bridging). `configureAllPoolWebhooks` sets voice URL `/twilio/voice` and derived
  status callback `/twilio/status` for every pool number (`server/twilioService.ts:93-231`,
  `scripts/configure-twilio-webhooks.ts`).
- Call records: created in `/twilio/voice`, finalized in `/twilio/status`; `/twilio/status`
  also acts as the transcript-recovery backstop (`server/routes.ts:1450-1515`). Outbound
  final status is number-level and known-unreliable (documented; see §10).

## 3. Deepgram configuration — VERIFIED

- Live calls: Deepgram **Flux v2** (`/v2/listen`), model `flux-general-en`, `encoding=mulaw`,
  `sample_rate=8000`, `eot_threshold=0.7`, `eot_timeout_ms=3000` — inline in `setupDeepgram`
  (`server/websocket.ts:1800-1810`).
- Turn detection is Flux-native `TurnInfo` (EndOfTurn only — no is_final/VAD); **eager mode
  OFF** (no `eager_eot_threshold`); no KeepAlive to DG (Twilio WS pings every 15s,
  `server/websocket.ts:1116-1125`). Reconnect logic in `setupDeepgram`.
- A separate non-call `/v1/listen?model=nova-3` endpoint exists (`server/routes.ts:2836`) —
  do not confuse with the live Flux path.

## 4. Deterministic (non-LLM) modules — VERIFIED

- **Goal scoring** (`server/goalEngine.ts:178-293`): keyword scoring (0.3 + 0.25/keyword,
  change threshold 0.75); achievement needs a non-question confirmation or filled slots.
  Runs on every guest turn (`server/websocket.ts:1243-1278`). `goalAchievedFlag` is
  informational only — it **never blocks hint delivery** (`server/websocket.ts:1015, 1337-1390`).
- **Hint dedup** (`server/hintDedup.ts:38-102`): duplicate ≥0.8 vs last 4 suggestions,
  self-overlap ≥0.7 vs last 3 owner utterances; one bounded duplicate exemption per
  normalized guest question. Cross-track echo dedup is separate: opposite-track transcript
  within 1200 ms with similarity ≥0.85 is dropped (`server/websocket.ts:1040-1043, 1173-1191`).
- **Farewell filter** (`server/farewellFilter.ts:35-53`): hard farewells suppress
  suggestions; soft thanks only if no substantive remainder; questions/actionable keywords
  are explicitly exempt. Translation still delivered when suggestion is skipped
  (`server/websocket.ts:1325-1330, 1513-1518`).
- **Fast-phrase layer** (`server/fastLayer.ts:38-236`): 450 ms threshold / 1200 ms cooldown —
  but the live scheduling call is **commented out** (`server/websocket.ts:1333-1335`), so no
  fast phrase fires on the normal live path today.
- **Wait-ACK** (`server/waitState.ts:69-90`): hold enters/stays; answer or a question/action
  request exits; exactly one static "Sure, I'll wait." ACK per hold, further steering blocked
  (`server/websocket.ts:1521-1552`).
- **Dialogue library**: per-user-per-goal libraries; active library chosen by Jaccard
  similarity of goalText (confident ≥0.35), fallback to goalType; entry/variant fuzzy
  threshold 0.6. Library hit bypasses the LLM; miss falls through to translateAndSuggest
  (`server/dialogueMatch.ts:28-187`, `server/websocket.ts:1398-1403, 1555-1579, 2121-2133`).
- **Per-user toggles**: Live Hints OFF = no model call; Translation OFF gates every
  suggestion payload path incl. wait-ACK and fast phrases (`server/websocket.ts:1532-1540,
  1762-1779`).

## 5. LLM usage — VERIFIED (with two UNKNOWN sub-items)

- Live hint generation: default `gpt-4.1-mini`, overridable via `HINT_MODEL` (allowlist:
  gpt-4.1-mini/nano, gpt-4o-mini/4o, Gemini 2.5 variants). `routeGenerate` sends Gemini
  first with a 700 ms abort, then OpenAI `gpt-4.1-mini` fallback (`server/websocket.ts:151-240`,
  `server/hintProvider.ts:39-62`). Translation + suggestion awaited in parallel; both block
  the delivered result (one blocking LLM round per guest turn).
- Sentiment: OpenAI `gpt-4o-mini`, awaited when invoked (`server/websocket.ts:92-132`);
  exact call-site impact: **UNKNOWN** without a runtime trace.
- Legacy `/api/training` path: `gpt-4o-mini` for greeting/response/translation/hint
  (`server/training.ts:552-849`) — separate from live calls and from Tutor Engine.
- Tutor: NO TalkHint-side LLM in the realtime session — Engine owns STT/LLM/TTS
  (`server/tutorEngine.ts:1-5`). Call Memory = Engine POST + bounded ~20 s polling
  (`server/tutorEngine.ts:146-231`). Tutor card translation = blocking cached OpenAI
  `gpt-4.1-mini` (`server/tutorTranslate.ts`).
- Contact-memory generation on teardown runs detached via `routeGenerate`
  (`server/websocket.ts:442-480`); exact prompt/model at that call site: **UNKNOWN**
  (partially traced only).

## 6. Hint delivery to the user — VERIFIED

- `/ui` WebSocket is per-user routed: `callOwners: Map<callSid,userId>` set by
  authenticated call routes; `sendToUser` drops fail-closed when no owner and sends only to
  that user's clients (`server/websocket.ts:483-542, 974-1006, 2032-2062`; owner cleared on
  teardown `:2349-2354`). Never a global broadcast.
- iOS consumes `/ui` with session token (`ios/TalkHint/Calls/CallHintStream.swift`), decodes
  transcripts, suggestions, fast phrases, `ai_response`.
- Incoming-call wake on iOS: direct cert-based VoIP APNs from our server (topic
  `<bundle>.voip`, pushType voip, prio 10, 30 s TTL) — NOT Twilio push
  (`server/pushChannels/iosPushChannel.ts`).
- Web: legacy UI at `/app` (Contacts + live-call only; web has NO call-history view);
  `/tutor` renders the Emma practice page.

## 7. Engine integration status (as of task 154, merged today) — VERIFIED

- Session create payload (`server/tutorEngine.ts:126-139`): `{user_id, scenario_id
  (default english_free_talk), tutor_id (default emma_us_01), mode:'practice',
  target_language:'en', native_language:'ru'}`. Unchanged by task 154.
- The `/tutor` client now consumes: `tutor.hint` (auto-rendered as a dismissible suggested
  USER reply card — never TTS'd, never treated as user speech), `tutor.correction`
  (secondary card), `tutor.text.final` (reconciles the streaming bubble; text-only turns
  supported), `turn.state` (truthful status labels only — never drives the PTT machine),
  `transcript.normalized` (stored per turn_id, raw stays visible). Classifier:
  `server/tutorRealtimeUi.ts`; 22 dedicated tests; full suite 566 green.
- Live dev verification today (session `6fa77057…`): hint auto-arrived at +10.3 s on turn 1,
  user said something different, Engine replied to actual speech, correction arrived at
  +21.8 s on turn 2 — all rendered by the client classifier.
- Still intentionally discarded: `avatar.lipsync` JSON (lip-sync uses word timings from
  `tutor.audio.chunk`), `speech.started`, `turn.started`, latency/usage inside
  `turn.completed`, `transcript.raw` (raw text already shown from `speech.final`).
- OPEN QUESTION for Engine (documented in `docs/tutor-goal-contract-open-question.md`):
  how to pass goal/role/facts/document context (fields `goal/objective/hints/context` are
  silently ignored at session create today); what `mode:"simulation"` actually does and
  which `scenario_id` it needs; whether an on-demand hint WS command and a `translation`
  field in `tutor.hint` will exist. **Goal-driven simulation is NOT implemented.**

## 8. Persistence — VERIFIED (one prod item UNKNOWN)

- Schema in `shared/schema.ts`: calls (incl. `transcript` column), delivery rows for
  AirAtoma webhooks, call memories, knowledge/context cards, users/settings.
- Crash-safe transcript: leading-edge persist to `calls.transcript` during the call;
  `/twilio/status` recovers delivery ONLY when no delivery row exists (no duplicates by
  design; a rare duplicate-CRM-send edge is an open task, see §10).
- Production DB is managed PG on the deployed app; schema changes go via the Publish flow,
  not ad-hoc scripts. Whether the knowledge-cards table exists in PROD: **UNKNOWN**
  (open task #81; startup drift check would warn).

## 9. Secrets / deploy — VERIFIED (names only, no values)

- Read by code: TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER/TWIML_APP_SID/API_KEY/API_SECRET,
  TH_NUM_1..7_TOKEN, DEEPGRAM_API_KEY, OPENAI_API_KEY, GEMINI_API_KAY (typo-named, real),
  ELEVENLABS_API_KEY, HINT_MODEL, DIALOGUE_LIBRARY_MODEL, AIRATOMA_WEBHOOK_URL,
  TALKHINT_WEBHOOK_SECRET, TUTOR_ENGINE_BASE/API_KEY/APP_ID/TUTOR_ID/SCENARIO_ID,
  STRIPE_SECRET_KEY/PUBLISHABLE_KEY/WEBHOOK_SECRET, APNS_CERT_PEM/KEY_PEM/BUNDLE_ID,
  VAPID_PUBLIC/PRIVATE_KEY/SUBJECT, SESSION_SECRET, admin/alerting vars
  (WRITE_HEALTH_ALERT_*, SENDGRID_API_KEY, HEALTH_STATUS_TOKEN, ADMIN_*).
- Prod runs on a Replit **Reserved VM** (WS/voice need a persistent process; autoscale is
  explicitly not used). Twilio signature check force-enabled in prod. Startup performs a
  schema-drift check and warns (does not auto-migrate); also warns when no write-health
  alert channel or HEALTH_STATUS_TOKEN is configured.
- Known secret hygiene notes: APNS PEMs stored single-line (normalized in code);
  Stripe secret key is TEST while publishable is LIVE (mismatch, webhook secret was missing) —
  flagged previously, not re-verified today: treat as **UNKNOWN current state**.

## 10. Known problems (tracked, honest list)

- Rejected/timed-out call handling correctness — open task.
- Forged phone-provider request rejection in prod — believed enforced (§2) but a dedicated
  prod verification task is open.
- Rare duplicate CRM (AirAtoma) sends at call end — open task.
- Knowledge-cards prod table + per-user privacy checks — open tasks.
- Startup-warning automated checks (migrations, alert channels) — open tasks.
- Per-user translation rate limiting (cost control) — open task.
- DNS-rebinding residual SSRF risk on user webhook URLs (literal private-host checks only,
  `server/airatomaWebhook.ts:176-211`).
- VAD/silence duplicate-flush race risk noted in `LIVE_PIPELINE_AUDIT.md:178` (guarded).
- In-memory training sessions are single-instance-only (fine on Reserved VM; would need
  Redis to scale) — `TRAINING_PIPELINE_AUDIT.md`.
- Pre-existing unrelated tsc error in `server/db.ts` (Drizzle/Pool typing); does not affect
  runtime; full test suite is green (566 tests / 48 files).
