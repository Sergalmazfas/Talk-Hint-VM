# GPT-Live + compact C — isolated Dev comparison

This is the owner-approved first step, **not a complete engine/tool handoff**.
GPT-Live-1 handles full-duplex speech. The compact C policy is reused, but tools,
backend models and side effects are not connected. The UI explicitly says so.
Language follows the caller's RU/EN/ES. The voice is built-in feminine Marin.
Retell is absent. Existing GPT, Retell and ElevenLabs branches are unchanged.

## Access and reuse

Use `/admin/secretary-lab?stand=live-engine` on the **development** host.
The same owner-admin bearer guard, one-use first-frame ticket, same-origin
WebSocket guard, microphone capture, PCMU codec and bounded browser player are
reused. HTTP registration and WebSocket upgrade both reject deployed/production
processes. The real transport is the existing native LiveAudio, not a renamed
Realtime model. Its default production configuration validator is unchanged;
only this guarded Dev caller supplies a narrower client-delegation validator.

No dialer, telephone configuration update, product changes, Xcode or Publish.
No OpenAI key or client credential is sent to the browser.

## Independent budget

`LiveBudget` persists a separate $20 total series ledger, not a daily reset.
The owner approved this series separately from Retell C's $10 series.
Each session reserves $0.50 before any provider handshake. At most one unresolved
session is admitted. Server duration limit is five minutes, with graceful close.
Only `session.closed.usage.seconds` releases the hold to a known amount.
Unconfirmed startup/close/usage keeps the whole envelope as unknown and blocks
new admissions. There is no budget reset/refill HTTP method or blind retry.

Rate: [$0.05/minute billed per second](https://developers.openai.com/api/docs/models/gpt-live-1).
No engine, tools, separate STT/TTS or subtitle-model calls in this first step.
Provider usage plus public tariff is an estimated cost, **not an invoice**.
Reports retain provider duration, frozen rate and explicit backend-disconnected
status. Native transcript timestamps are not speech-end VAD measurements.

Reports use the existing owner-scoped permanent Dev archive. No new table is
created, no production database is queried or changed. Failed persistence is
surfaced rather than treated as a confirmed finalization.

## Voice checks

Two paid real GPT-Live sessions were exercised using local synthetic caller
speech: one RU and one EN, eight inputs each: amounts, correction, repeat,
tomorrow-not-today, and acknowledgments during output.
This proves a real provider audio exchange, **not a live iPhone speaker test**.
The server harness uses the same native adapter, media peer and session budget.
Speech-end is the last non-silent synthetic input frame; first sound is an
energetic decoded provider packet. Network receipt is not browser playback.
Intentional-overlap/acknowledgment samples must not enter clean latency
percentiles. RU synthetic speech had recognition errors; final corrected $215
and tomorrow were retained, but that is not evidence of reliable RU amounts.

The existing C report is not a paired run on this same corpus. Do not compare
its TTFT, filler onset or old unbuffered timings to this run as a speed gain.
No extra C run is charged to this new Live-only budget.
