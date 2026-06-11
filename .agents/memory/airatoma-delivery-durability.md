---
name: AirAtoma delivery durability backstop
description: How a finished call's AirAtoma webhook delivery survives a server crash during call teardown.
---

# AirAtoma delivery durability

The primary AirAtoma delivery is enqueued from the `/twilio-stream` WebSocket
close handler. If the process crashes mid-teardown that enqueue never runs, so
there is a second, independent recovery path driven by the Twilio `/twilio/status`
callback (a terminal status: completed/busy/failed/no-answer/canceled).

**The transcript must be persisted DURING the call for the backstop to work.**
The live transcript lives in memory (`fullConversation`); `calls.transcript` is
the durable copy the `/twilio/status` backstop reads back. It is written with a
**leading-edge + trailing throttle**: the first turn (and any turn after a quiet
window) is written immediately, bursts coalesce into one trailing write.

**Why leading-edge matters:** a trailing-only throttle loses short calls — if the
process crashes before the timer fires, `calls.transcript` is empty and the
backstop has nothing to recover. The leading-edge write closes that window.

**Why:** durability of the call→AirAtoma handoff; a brief crash must never silently
drop a finished call.

**Short/silent calls are sent too.** A call under ~5s, or one where Deepgram caught
nothing, has an empty transcript. Both paths still deliver a **minimal record**
(callId, callerName→phone fallback, durationSecs; transcript field is `""`) — they
must NOT skip empty transcripts. `buildAirAtomaPayload([])` renders `transcript:""`.
**Why:** short/missed calls were silently dropped before; the user wants every call
logged in the CRM. Tradeoff: this can add CRM noise (e.g. missed/unanswered calls on
terminal statuses) — intended, restrict trigger statuses if that becomes a problem.

**How to apply:**
- Idempotency is by `getAirAtomaDeliveryByCallId(callId)` — the backstop only sends
  when NO delivery row exists yet, so the normal WS-close path is never doubled.
- Re-sends are safe regardless: the queue upserts on unique `callId` and AirAtoma
  dedupes on `callId`, so a rare race causes at most one extra POST, no dup rows.
- `parseTranscriptText` is the inverse of `renderTranscriptText` (split on `\n`,
  then first `": "`). It cannot perfectly reconstruct turns whose text contains a
  newline — acceptable, only mildly degrades speaker attribution.
- Transcript stays plain `Speaker: text` lines, so iOS call-history display is
  unaffected.
