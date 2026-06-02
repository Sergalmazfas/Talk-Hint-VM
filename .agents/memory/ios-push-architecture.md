---
name: iOS push / APNs architecture
description: How incoming-call push to native iOS works and why; APNs cert conventions for this project.
---

# iOS incoming-call push

**Decision: direct APNs from our own Engine, NOT a Twilio Voice Push Credential.**
- The Engine sends the VoIP push itself (`server/pushChannels/iosPushChannel.ts`, cert-based via `@parse/node-apn`).
- iOS reuses the SAME incoming-call flow as web: pendingCalls + accept/reject + hold-loop `<Dial><Client>`. No iOS-specific call flow.
- **Why:** preserves "One Engine — Multiple Interfaces"; the hold-loop/pendingCalls/accept-reject machinery already exists and is tested; avoids Twilio vendor lock-in for push routing. (User confirmed this fork explicitly.)

## APNs facts for this app
- Auth is **certificate-based** (VoIP Services cert), not `.p8` token auth. Secrets: `APNS_CERT_PEM` + `APNS_KEY_PEM` (PEM strings, matched pair). `isConfigured()` is false until both present.
- **Bundle id is `app.talkhint`** (env `APNS_BUNDLE_ID`), NOT `com.talkhint.app` (an earlier plan assumed the wrong one).
- **VoIP push topic = `${bundleId}.voip`** i.e. `app.talkhint.voip`. Team `6G9ZS426J3`.
- VoIP certs work for both sandbox and production; pick the APNs host per `device_tokens.environment`. One node-apn `Provider` per host, cached (persistent HTTP/2). `sandbox|development|dev` -> sandbox host, everything else -> production.
- Dead tokens: on APNs reasons `BadDeviceToken|Unregistered|DeviceTokenNotForTopic` the channel throws `TerminalTokenError` and the router sets that `device_tokens` row `isActive=false` (stops infinite retry).
- Web push is NOT routed through `device_tokens`/router — it stays on the legacy `sendPushToUser()` + `pushSubscriptions` (needs p256dh/auth keys the router doesn't store).
- End-to-end send can only be verified with a real device token (needs the iOS client built). Until then, validate by constructing a node-apn Provider from the PEMs — it warns on cert/key mismatch.
