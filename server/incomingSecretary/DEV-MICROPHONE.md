# Incoming Secretary: development microphone test

## GPT-Live 1 comparison

After the owner's successful microphone trial, new bench sessions use GPT-Live 1 only.
Realtime-2.1 is no longer offered; omitted-model requests also select GPT-Live.
GPT-Live uses its native `/v1/live/sessions` protocol with PCMU 8 kHz, Marin,
Responses delegation to `gpt-6.1-sol` (medium reasoning), and `store:false`.
No provider-side audio recording is requested. Backend tools are only the shared
`save_request` / `submit_request`; no dial, SMS, calendar or hosted tools.

The same explicit owner-approved Work-card snapshot, one-use capability,
owner isolation, permission revocation and separate TEST table apply to both.
Selected voice/backend metadata is retained in each new TEST request for comparison.
Native Live manages full-duplex speech; its adapter never sends Realtime truncate
or cancel events. Local queued audio is cleared on a new recognized caller fragment;
this is not proof of real-device interruption/noise performance.

The gated incoming phone runtime now uses the same Live conversation coordinator,
and outgoing Secretary uses a task-specific Live configuration without intake tools.
This does not activate an incoming number, publish a server or install an iOS build.
Calendar remains disconnected: intake is still a request, never a confirmed booking.

## Work Calendar preparation

The owner approved a separate Google calendar, TalkHint — Work, in
America/New_York. The collapsed Calendar panel in the Dev bench tests metadata
access and occupancy only. It does not add tools to the voice agent, insert
events, activate phone answering, send messages or confirm appointments.

The workspace connector is not per-user app OAuth. Calendar routes require
the existing app admin role, ownership of the selected Work number, and an exact
match between the authenticated app email and the connected Google primary
calendar owner. The exact approved Work resource and connection are pinned;
there is no primary-calendar or first-connection fallback. Revalidate privacy
ACLs and fail closed on permissions/errors. No personal event data is read.

The Work profile timezone must explicitly match the calendar. Checks honor
working days/hours, end-before-closing and at least 30 minutes travel. Slot
occupancy does not prove that a service, duration or travel address is offered.
Voice-agent calendar tools and durable booking still require a separate
implementation and business setup; do not describe this panel as booking.

Run `NODE_ENV=development npx tsx script/probe-incoming-live.ts --audio` for
synthetic spoken EN → RU → ES input, Monday-hours lookup and corrected name
saved in memory. It uses real OpenAI voice/backend sessions, not a real mic,
telephone, owner data or persistent owner request. TTS is only the simulated caller.
No microphone/iPhone/headphone quality claim follows from this probe.

This is the **new incoming** agent, not the outgoing Secretary lab.

## Open and use

Run the existing development workflow and open `/incoming-secretary` with
the ordinary TalkHint owner account. Microphone controls are shown only in
development to an account allowed by the existing benchmark admin gate.
The independent Dev panel needs no telephone number. Select existing Work cards
and explicitly allow their customer-facing use for this test, then start the
microphone. Permission selection is stored separately per owner. No second
business questionnaire is used: identity, activity, services, prices, hours and
timezone come only from the selected cards. An empty selection means unknown
business facts, not a default massage business or schedule.

The existing number-bound panel also remains available. Enabling AI on a real
number is **not** necessary for either microphone test. Legacy settings are
retained as data but are not an additional Secretary knowledge source.

Click Start, allow browser microphone access, and use fictional client
details. Stop immediately closes local microphone tracks, scheduled speech
and AudioContext; the server closes its Realtime connection and finalizes the
test request. A lost connection is not an instruction to start another session.
The owner can stop a reserved session after a lost HTTP response.

No phone dialing, Twilio media bridge, SMS, calendar event or notification
delivery is involved. No native iOS rebuild is needed for the web microphone
test. HTTPS and browser microphone/audio permissions are needed.

## Same agent, separate records

Instructions, `gpt-live-1`, `marin`, PCMU 8 kHz, multilingual input
transcription, tools and intake validation are shared with the prepared
incoming telephone implementation. There is no provider/model fallback.
Only the selected owner's explicitly allowed Work cards enter instructions.
Sharing a card is not disclosure consent.

Apply `dev-schema.sql` explicitly to the **development database only**.
The separate `incoming_secretary_dev_requests` table is not part of the
production schema. Each session has one unique call locator and persists TEST
history independently of real requests and notification outboxes. There is
no automatic TEST retention/deletion schedule.

Owner-authenticated routes:

- `GET /api/incoming-secretary/dev`: TEST history, current session locator,
  safe ordinary-alert diagnostics.
- `POST /api/incoming-secretary/dev/sessions`: reserve one session using an
  owned Work `numberId`; returns a short-lived one-use capability in JSON.
- `POST /api/incoming-secretary/dev/sessions/:id/stop`: idempotent owner stop.
- `/incoming-secretary-dev-stream`: same-origin WebSocket, first-message
  capability authentication; no token in the URL or local storage.

All routes and the socket reject production use. Fresh card/settings checks
precede AI connection, and permission changes stop active tests.
Expired, interrupted or restarted sessions retain partial details and are
recovered as incomplete, never booked. Failed writes show an error, not
successful acceptance. A new explicit Start is a new TEST, not a reconnect.

## APNs diagnostics

The existing result notifier uses ordinary alert tokens (`ios_alert`) and
separate `APNS_ALERT_CERT_PEM` / `APNS_ALERT_KEY_PEM`. VoIP credentials/tokens
are not a substitute. The diagnostic parses PEM (including normalized
newlines), validity and key pairing, and reports the owner's active ordinary
device environments/bundles without token values. Basic PEM checks do not
prove Apple acceptance or delivery.

The runtime inspection in this development environment found both separate
alert credentials absent. No credential was added or changed. To prepare a
later notification test, the owner needs an ordinary APNs certificate and
matching private key for the real app bundle, securely configured for Dev
without changing shared/production settings. If no active ordinary token is
shown, notification permission and registration in the matching native build
need checking. Xcode/debug and TestFlight/App Store environments must match
the stored device environment.

No test push was sent. APNs is not required to run the microphone test.

## Verification boundaries

Automated tests cover Dev guards, owner/card isolation, one-use capability,
duplicate prevention, finalization failures, Unicode and language transitions,
corrections/reconfirmation, interruption clear, stale audio rejection,
generated worklet execution/resampling and microphone cleanup races.

A real OpenAI connection accepted the exact model/voice/audio configuration.
After a reproduced active-response conflict was fixed, a synthetic spoken
EN→RU→ES dialogue produced actual ASR, voice replies, corrections and clear
events without provider errors or session closure. Tool continuations wait
for response completion and all tool outputs, and are suppressed during
caller speech. The existing automatic provider interruption is used, rather
than sending a redundant cancellation.

Explicit development probes (paid OpenAI API use):
`NODE_ENV=development npx tsx script/probe-incoming-dev-dialogue.ts` sends
synthetic text turns; adding `--audio` generates synthetic caller fixtures
with a separate TTS model and streams PCMU through the same Dev input path.
This fixture TTS is not the Secretary voice/model and never a fallback.
Silence keeps streaming between utterances, as a browser microphone would.
Both probes use an isolated memory store, not an owner's request history,
and have no dialing or notification transport.

This is **not** a real browser microphone/headphone/acoustic or native push
delivery test. Fatal provider codes are retained in safe TEST diagnostics;
raw provider messages/credentials/IDs are not logged. The browser shows an
interruption counter and includes finished chunks in playback-time reports.

Malformed tool JSON and invalid phone/date/time/language/duration fields are
recoverable: the agent receives `saved:false` and safe field issue codes, asks
for clarification, and keeps prior valid facts. No phone digits/country code
are guessed. A real database failure remains an unconfirmed save, not success.
A write that committed before a failed voice acknowledgement is reported
separately. End reasons distinguish processing, provider socket and browser
socket failures.

`--uncertain-phone` exercises country-code clarification, correction and
reconfirmation with fictional numbers; combine with `--audio` for synthetic
spoken input. The probe fails unless the final corrected number is exact and
confirmed. No owner data or real requests are used.

Before any later telephone activation, the owner should test EN→RU, EN→ES,
EN→RU→ES, ¿/¡ and Cyrillic, interruption, hold/resume, headphones versus
speaker echo, corrected name/phone/address/date/time, final detail review,
one TEST request, permission changes and connection loss in their browser.
Real telephone testing and activation require separate approval.
