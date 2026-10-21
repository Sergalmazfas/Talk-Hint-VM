# Live microphone Dev test

See [DEV-MICROPHONE.md](DEV-MICROPHONE.md) for the new authenticated incoming-agent
microphone bench, isolated TEST storage and ordinary APNs diagnostic limitations.
It does not dial a phone or require enabling incoming AI on a real number.

# Incoming Work Secretary: preparation-only first stage

Separate from outgoing Secretary, Translator, Copilot and the outgoing voice lab.
Do not enable it on a real number or publish as part of development verification.

## Entry points

- Existing authenticated React page `/incoming-secretary`.
- Existing iOS Settings → Work number → Incoming AI secretary. Rebuild the
  updated native sources in Xcode; a backend deployment does not update iOS.
- Development-only `/incoming-secretary-preview`: public synthetic browser-only
  fixtures. This is **not** authentication, live AI, real storage, or a voice test.
- Authenticated `GET /api/incoming-secretary` returns settings, own Work cards,
  latest 50 requests, model/voice and readiness. There is no calendar connection.
- Owner-only JSON `PUT /api/incoming-secretary/settings/:numberId`.
- Development/admin-only `POST /api/incoming-secretary/preview` uses the actual
  intake policy with isolated memory storage, not real call/request records.

## Safety boundaries

Real routing needs BOTH `INCOMING_SECRETARY_RUNTIME_ENABLED=true` and the owner's
explicit enabled preference on an owned Work number. Defaults are off. No
environment setting is changed by this implementation. Personal/manual handling
and outgoing provider selection are unchanged. The opt-in Work branch returns
before the old SMS/forwarding/owner-ring branch; its notification outbox sends
ordinary APNs/Web Push only.

Do not configure the global gate until a separately approved release and controlled
call tests. Existing Twilio voice/status webhooks stay in place. A signed,
short-lived token binds the new media stream to the exact call and number.
Each CallSid has one persisted request; a claimed/closed media stream is not
restarted. There is no outgoing dial, transfer, calendar or SMS tool.

Only explicitly selected, owner-owned `work` cards enter the incoming prompt.
Neither `shared` nor the owner's personal cards are implicit disclosure consent.
Cards remain untrusted business facts below system rules. Template creation and
selection/save are separate actions. Changing settings or editing/deleting an
in-use card terminates affected AI sessions rather than retaining stale consent.

## Conversation and persistence

Direct OpenAI `gpt-realtime-2.1` / `marin`, PCMU, semantic VAD with interruption,
`gpt-4o-mini-transcribe` without an English language hint or an English-only
output filter. Initial greeting is a neutral English virtual appointment helper;
instructions follow EN/RU/ES. Exact model, voice and audio configuration must be
acknowledged; unavailable/mismatched sessions fail rather than substitute a clone.

No calendar or appointments are created. Collect a request, explicitly confirm
the callback number and review details. Missing/unknown facts and a disconnect
produce incomplete requests, not bookings. Corrected phone numbers invalidate
callback confirmation. Preserve original Unicode text and the business timezone
snapshot. Final text is localized to EN/RU/ES. Caller speech-start invalidates
pending review before model tool execution; asynchronous ASR completion does not
invalidate an already completed review.

Only transcript text, intake fields and results are stored by this new module,
not an audio recording. There is no deletion/retention job in this stage.
Request storage is canonical; the normal call history has the provider call
record and incoming request reference. Intake details/transcripts are read in the
new incoming-requests screen, not copied into unrelated exports.

Store partial data continuously. A save tool must return `saved:true` before
successful acceptance may be spoken. Row locks and CallSid uniqueness protect
updates/idempotence. A closed-request outbox retries owner notifications;
stale sessions recover as incomplete after 20 minutes. Real sessions have a
15-minute safety limit; the emergency connection-ended message is currently
English. APNs delivery still requires working ordinary-alert credentials and a
registered owner device; notification failure must not discard a request.

## Release requirements / verification boundary

Drizzle declares two additive tables. Development schema was prepared explicitly;
no startup DDL or production database operation is introduced. Future Publish
must apply the reviewed schema diff before any enablement.

Owner must choose an explicit IANA business timezone, review the editable future
mobile-massage template and explicitly allow appropriate Work cards. Defaults:
Tue–Sun 08:00–22:00, Monday closed, finish by closing, >=30-minute travel.
Prices, session lengths, service area and cancellation rules remain unknown.
The business is not described as already launched. A future calendar phase must
confirm appointments only after actual successful calendar booking.

Offline checks cover multilingual values, corrections, missing settings, save
failure, disconnect, idempotence, card/owner isolation, interrupted/stale audio,
hold/silence, outbox retry, and existing outgoing/native integration contracts.
Text fixtures and mocked audio do **not** establish actual ASR quality,
voice-language switching, echo cancellation, interrupt latency or PSTN behavior.
Native source wiring is not an Xcode build or iPhone verification.

Before real enablement: separately authorize release; build/install iOS; validate
OpenAI account/model handshake, ordinary APNs alerts and multilingual voice via
a suitable Dev voice harness; then perform separately approved controlled
incoming calls including corrections, hold, interruption and disconnect. Never
use an unrelated third-party business number as a test destination.
