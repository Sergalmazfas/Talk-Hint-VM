# Secretary Lab: GPT / Retell comparison

Dev only. Owner/admin authorization is unchanged.

## Open

- `/admin/secretary-lab?stand=gpt`: existing GPT-Live / Marin path.
- `/admin/secretary-lab?stand=retell`: Retell browser call.

Both use the same instruction field and `buildSecretaryInstructions` core policy,
including account-bound identity and EN/RU/ES conversation rules. This is a
comparison of **whole voice runtimes**, not an isolated LLM benchmark:
GPT-Live + Sol + Marin versus Retell's cascading Sol + Merritt pipeline.
Retell may add its own system rules, ASR, turn detection and synthesis.
Telephone Secretary, Hint, Translator, native app and live phone routing are not
switched to Retell.

## API compatibility and credentials

Sources checked 2026-10-24:

- https://docs.retellai.com/accounts/manage-api-keys
- https://docs.retellai.com/deprecation-notice/2026/07-31_agent_list_endpoints
- https://docs.retellai.com/api-references/create-web-call
- https://docs.retellai.com/api-references/monitor-call-websocket
- https://docs.retellai.com/agent/multilingual
- https://github.com/RetellAI/retell-client-js-sdk

`RETELL_API_KEY` stays on the server. Retell authentication is Bearer. Scoped
permissions for this implementation: **Agent Edit** (isolated agent setup),
**Call Edit** (web calls, monitoring, stop), **History Read** (status).
No Phone or Export permission is required by this code. A successful read-only
key probe does not establish paid-call entitlement or account balance.
HTTP 401, 402, 403 and 429 are distinct; arbitrary upstream error bodies are not
returned to the browser. Rotation is through Secrets, never pasted into chat.
No key rotation or account-level webhook-key changes are performed by the app.

The removed `GET /list-agents` returns HTTP 400. Use `POST /v2/list-agents`
with voice-channel filter, `items`, `has_more`, and `pagination_key`.
Browser SDK is 3.0.3; web admission uses **POST /v3/create-web-call**, its declared
`gateway` transport and `ice_servers`. Do not pass this token to a legacy guessed
LiveKit transport.

## Isolation, costs and privacy

Only the dedicated named Dev agent is created/reused. Existing template agents
are not modified. The server verifies the dedicated configuration before each
admission: exact model and voice, no backup model, no tools, no session tools,
no external knowledge, no contact memory, no webhook events, no retained
transcript/recording, 300-second hard duration limit and interruption sensitivity
0.9. A drifted agent fails closed.

The browser receives only a short-lived single-call admission after admin
authorization, explicit paid-processing consent, microphone permission and
server-side request reservation. No permanent API key, public-key workaround or
generic provider proxy is sent to it. SDK `transcript:false` prevents a
key-bearing browser monitoring socket. Only the pre-created admission is
returned to one SDK request.

An authenticated **server-side** monitoring WebSocket relays original spoken
turns via owner-scoped report snapshots. Upsert by stable ID; no guessed
translation, final-turn markers or measured barge-in latency. Monitoring loss
does not imply the audio call ended. Reconnect is bounded and never creates a
new call. Retell's `basic_attributes_only` storage means final transcripts may
not be recoverable after monitoring failure: report the gap, do not invent it.
Text reports expire after one hour/server restart. Credentials are omitted from
history/export and destroyed locally on end.

Repeated clientRequestId returns the same admission, never another create.
Changed tasks cannot reuse an ID. Unknown provider creation results and
unconfirmed stops block a new session. Refresh restores report/stop controls,
not credentials or audio. If provider creation times out **without returning an
ID**, support inspection is needed: never blindly clear the guard and redial.
Max six Retell starts/hour/admin. Stop is scoped to the session's known web call.
Browser heartbeat loss triggers stop; the provider duration bound also applies.

## Manual acceptance (not established by mocked tests)

Use headphones, authorize paid processing, then test each runtime with the
unchanged instruction:

1. Hear the introduction; verify both sides' actual audio and original text.
2. Interrupt halfway through an answer with a correction. Observe whether
   obsolete speech stops and whether the corrected detail is used.
3. Say “please hold”, wait, then return to the same task.
4. Switch Russian → English → Spanish; verify audio, not just translated text.
5. Stop, deny microphone, recover autoplay, refresh during a call, and verify no
   duplicate call/new session. Compare the same scenarios on desktop and iPhone.
6. Export the report and record manual outcomes as observations, not automatic
   evidence that Retell is better or that PSTN/native audio works.

No real web/phone conversation is started by setup or the automated tests.
