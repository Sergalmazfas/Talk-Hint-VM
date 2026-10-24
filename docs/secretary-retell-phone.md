# Retell + TalkHint Engine: native telephone pilot

## Scope

The existing Swift/Xcode admin app can select **Retell + TalkHint Engine** or
**OpenAI · GPT-Live 1** under Settings → Secretary model and voice.
Retell is the updated native client's default. This does not migrate approved
pending attempts, older integrations with an omitted provider, incoming number
routes, Hint, Translator, or Copilot.

This is a prepared Dev telephone pilot, not a verified PSTN/iPhone release.
No real call was originated during implementation and nothing was published.

## Actual configuration

* Responses: the shared TalkHint text Engine, OpenAI `gpt-6.1-sol`, `medium`.
* Audio: Retell Custom LLM, `retell-Merritt`.
* Languages: `en-US`, `ru-RU`, `es-ES`.
* Interruption sensitivity `0.9`; responsiveness `1`; backchannels disabled.
* Maximum call duration: 300 seconds; no recordings requested by TalkHint.
* Retell storage: `basic_attributes_only`; no contact memory, fallback voices,
  pre/post-session tools, or provider webhooks.
* Our OpenAI account generates responses. Retell is not a second answering model.

The private telephone agent is distinct from both browser agents and separately
named per callback origin. No phone numbers are bought, imported, reassigned,
or repointed.

## Route and safety

1. Existing preparation and explicit assignment confirmation remain required.
2. The authenticated app sends the selected provider and stable request ID.
3. Existing durable task admission and Twilio dialer place the owner-authorized
   outgoing leg using the owner's number.
4. The signed Twilio voice callback registers one Retell phone session and
   bridges the existing leg to its SIP URI. Callback retries share admission;
   a durable ambiguous reservation is never automatically registered again.
5. A separate signed Twilio both-tracks stream supplies the existing
   owner-authenticated iPhone monitoring feed: guest inbound, Secretary outbound.
   Retell's transcript-monitor WebSocket is not used as an audio source.
6. The private Custom LLM socket streams responses through the same text Engine,
   cancels stale generations on interruption, and rejects mismatched identities.
7. Full transcript snapshots update the existing task and call History together,
   with stable turn IDs. They do not append every partial transcript as a new turn.
8. Existing owner End/cancel and guest hangup end the telephone call. Unexpected
   Engine loss has an eight-second reconnect grace, then fails closed.

Telephone context is the real approved assignment, never the browser's fictional
TEST fixture. Calendar writes, notifications, SMS, and other external business
actions are not connected in this pilot. The Engine must not claim otherwise.
Conversation persistence is real; it is not proof that a promised external action
occurred. The browser TEST action ledger is not promoted to real business tools.

## How to test without publishing

On the Mac, obtain these code changes and regenerate/build the existing Xcode
project using its normal workflow. In the **Debug** scheme:

**Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables**

Add:

```text
TALKHINT_API_BASE_URL=https://e62acc35-f5e5-43be-91ea-c3ad7b36be85-00-3l7jbsd7n4zci.janeway.replit.dev
```

Keep the Replit Dev workflow running. Launch from Xcode with this variable and
authenticate against Dev. Select Retell in Secretary settings; prepare and confirm
an assignment; enter a consenting test participant's number; call.

This override only applies when launching a Debug app with that environment.
It does not persist for later launches from the Home Screen. Release and ordinary
launches retain the existing production API URL. Updating only the iOS app does
not update the production server.

## Checks performed and outstanding

The Dev Retell configuration and exact Engine model access were verified through
the provider APIs without registering or dialing a call. Automated checks cover
configuration isolation, registered phone identity, streaming response replay
deduplication, removal of TEST tools/context, callback admission deduplication,
ambiguous-admission refusal, signed monitoring and both audio tracks. TypeScript
checks and the affected server regression suites pass.

Still requires the Mac and a consenting participant:

* Xcode build and native tests;
* a real SIP/PSTN connection and hearing both parties on iPhone/speaker/headphones;
* RU/EN/ES, corrections, interruption, reconnect, owner End, and guest hangup;
* re-open History and compare its transcript/report with the actual conversation.

Automatic conversational hangup by the new text Engine is not implemented here:
the pilot uses owner End, remote hangup, or the duration cap. This must not be
confused with automatic hangup in the GPT audio adapter.

After a backend restart, an already attempted phone admission is refused rather
than reconstructed/redialed. Seamless live-session recovery is not claimed.
