---
name: iOS push / APNs architecture
description: How incoming-call push to native iOS works and why; APNs cert conventions for this project.
---

# iOS incoming-call push

**Decision: direct APNs from our own Engine, NOT a Twilio Voice Push Credential.**
- The Engine sends the VoIP push itself (`server/pushChannels/iosPushChannel.ts`, cert-based via `@parse/node-apn`).
- iOS reuses the SAME push + pendingCalls + accept/reject + hold-loop machinery as web, BUT the audio bridge differs (see below).
- **Why:** preserves "One Engine — Multiple Interfaces"; the hold-loop/pendingCalls/accept-reject machinery already exists and is tested; avoids Twilio vendor lock-in for push routing. (User confirmed this fork explicitly.)

## Audio bridge: browser vs iOS (Path A)
- **Browser** path is unchanged: hold-loop dials the agent via `<Dial><Client user-{id}>`.
- **iOS** path uses a **Twilio Conference** `call-{callSid}`, NOT `<Dial><Client>`:
  - `pending_calls.client_type` ("browser" default | "ios") records which bridge to use; set via `POST /api/call/accept` body `{clientType:"ios"}`.
  - Hold-loop (accepted + clientType==="ios"): caller joins conference with `startConferenceOnEnter:false` (waits), `endConferenceOnExit:true`. Transcription `<Start><Stream both_tracks>` stays on the caller leg for both paths.
  - iOS app joins the same conference via an **outbound** `TwilioVoiceSDK.connect()` carrying custom param `conferenceRoom:"call-{callSid}"`; Twilio POSTs it to `/twilio/voice`, which joins with `startConferenceOnEnter:true`, `endConferenceOnExit:true`.
- **Why conference, not `<Dial><Client>`:** user chose Path A — the Engine (not Twilio) sends the VoIP push, and the iOS app connects in *outbound*; a conference cleanly bridges the held caller leg with the app's outbound leg regardless of join order.
- **Conference-join authorization (security-critical):** `/twilio/voice` trusts `From=client:user-{id}` (Twilio sets it from the signed access-token identity — not client-spoofable). It then requires the `pending_calls` row for the room's callSid to have matching `userId`, `status==="accepted"`, `clientType==="ios"`; else say-unavailable + hangup. accept/reject also scope their UPDATE by `userId`. **This trust boundary collapses if Twilio signature verification is disabled in prod — keep it ENABLED.**
- Twilio's `dial.conference(..., name)` `beep` flag must be a string (`"false"`), not a boolean, or TS rejects it (`ConferenceBeep` type).

## APNs facts for this app
- Auth is **certificate-based** (VoIP Services cert), not `.p8` token auth. Secrets: `APNS_CERT_PEM` + `APNS_KEY_PEM` (PEM strings, matched pair). `isConfigured()` is false until both present.
- **Bundle id is `app.talkhint`** (env `APNS_BUNDLE_ID`), NOT `com.talkhint.app` (an earlier plan assumed the wrong one).
- **VoIP push topic = `${bundleId}.voip`** i.e. `app.talkhint.voip`. Team `6G9ZS426J3`.
- VoIP certs work for both sandbox and production; pick the APNs host per `device_tokens.environment`. One node-apn `Provider` per host, cached (persistent HTTP/2). `sandbox|development|dev` -> sandbox host, everything else -> production.
- Dead tokens: on APNs reasons `BadDeviceToken|Unregistered|DeviceTokenNotForTopic` the channel throws `TerminalTokenError` and the router sets that `device_tokens` row `isActive=false` (stops infinite retry).
- Web push is NOT routed through `device_tokens`/router — it stays on the legacy `sendPushToUser()` + `pushSubscriptions` (needs p256dh/auth keys the router doesn't store).
- End-to-end send can only be verified with a real device token (needs the iOS client built). Until then, validate by constructing a node-apn Provider from the PEMs — it warns on cert/key mismatch.
