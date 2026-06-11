---
name: Twilio media-stream track → speaker mapping
description: Why inbound/outbound→Owner/Guest must depend on which call leg the <Stream> rides
---

# Twilio track → speaker (Owner/Guest) mapping

The `inbound`/`outbound` track of a Twilio Media Stream is relative to the call
**leg the `<Stream>` is attached to**, not to the conversation. So the
track→speaker mapping is NOT global — it depends on whose leg carries the stream.

- **Owner-leg stream** (browser OUTBOUND call: the browser dials out, stream on
  the browser's own leg): `inbound = Owner (HON)`, `outbound = Guest (GST)`.
- **Caller-leg stream** (INCOMING answered calls — both browser `<Dial><Client>`
  and the iOS `<Dial><Conference>` bridge — stream attached to the original
  caller's leg): mirrored → `inbound = Guest (GST)`, `outbound = Owner (HON)`.

**Why:** A long-standing bug showed CALLER/YOU swapped only in the iOS app.
Clients (web `script.js` and iOS `CallHintStream`) are identical and correct —
both map server `owner_transcript`→YOU, `guest_transcript`→CALLER. The inversion
was purely server-side: the mapping was hardcoded to the owner-leg case, but iOS
only works via incoming calls whose stream rides the caller's leg. Web "worked"
because it's exercised mainly via outbound (owner-leg) calls; browser INCOMING
answered calls had the same latent inversion.

**How to apply:** The hold TwiML tags the caller-leg stream with
`customParameters.callType === "incoming_answered"`. In the Twilio stream handler
set `streamOnCallerLeg` from that and invert the track→speaker derivation when
true. Outbound (no callType) stays as-is. Note `isPstnForwarding` (callType
`pstn_forwarding`) is currently non-functional in the mapping — don't confuse it
with this flag.

The mapping is now the single source of truth in `server/speakerRoles.ts`
(`streamRidesCallerLeg`, `resolveSpeakerRole`), pinned by a scenario matrix test.
**Rule:** any change to callType handling or track→speaker logic must update that
helper + its test together, never re-inline the ternaries in `websocket.ts`.
