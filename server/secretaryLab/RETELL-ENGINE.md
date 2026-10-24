# Retell + Engine: Dev-only Custom LLM bench

Open `/admin/secretary-lab?stand=retell-engine`. GPT and managed Retell remain
independent comparison modes. One shared assignment field; the explicitly
fictional bench context is also appended on the server for all three modes.
No changes to the production telephone Secretary, phone numbers or native app.

## Actual execution

The third agent's `response_engine.type` is **custom-llm**. It is NOT a renamed
Retell-managed model. Retell handles browser audio, ASR, turn-taking/barge-in and
Merritt speech. The private per-session WebSocket feeds TalkHint's
transport-independent Secretary conversation adapter, which reuses the trusted
Secretary identity/core policy and calls our OpenAI **Responses API** with
`gpt-6.1-sol`, medium reasoning, 1600 max output tokens, no retry or model fallback.
Do not pass GPT-Live audio through Retell as a second synthesis stage.

The adapter is a new **text entry point**, not the existing audio Twilio Engine
running unchanged. Its tools are deliberately sandboxed:

- `read_test_context`: fixed fictional fixture, no production DB/Calendar.
- `save_test_message`: session-local TEST action ledger, no notification/delivery.
- `prepare_test_booking`: known fixture slot only, always pending owner approval.

No business-tool, calendar, SMS, push, dialer or phone-provider client is injected.
ASR mistakes trigger clarification, not invented facts or automatic hanging up.
Only the user's stop button stops the browser session in this phase.

## Boundary and lifecycle

All admissions/readiness/reports/actions remain behind the existing admin gate.
Only registered **web** call IDs can enter the custom socket. Retell does not
send auth headers on this protocol, so use a random per-session 256-bit capability
in the URL; do not log it or return it in browser admission/history. The configured
agent contains a dynamic-variable placeholder, not a permanent API secret.
Remote callbacks are rejected in production. Registry capabilities are revoked
on end and expire after five minutes. No public generic LLM endpoint exists.

The model streams text chunks immediately. New response IDs or `user_turn`
abort old generation and suppress stale speech/tools. Every current turn is
closed even on failure/timeout. A 25-second model timeout is explicit and uses
no replacement model. Response IDs and action fingerprints survive socket
reconnect for that session; successful actions are not executed again.
Stopping the provider session revokes its capability and aborts generation;
provider stop failure remains visible and prevents a second admission.

The remote agent is separate, draft/unpublished, with Merritt, EN/RU/ES,
sensitivity 0.9, responsiveness 1, no backchannels, no voice fallback, no contact
memory, no tools/webhooks on the Retell side, basic-attributes-only retention,
five-minute duration and silence limits. The ASR provider/model and precise VAD
thresholds are Retell-managed; no unsupported equivalence to GPT is claimed.

Readiness means configuration/model access verified, NOT a proven audio call.
The report separately shows Custom LLM connected/events, test actions and actual
original transcript. ASR can misrecognize words: a model API check or synthetic
WebSocket test is not a real microphone/barge-in quality test.

## Verification / privacy / costs

Automated tests cover true WebSocket message exchange with an injected model,
streaming, interruptions, response supersession, replay/reconnect, stop, timeout,
test-only permission checks, booking restrictions, action deduplication,
separate-agent configuration and one-time idempotent web admission.
Text/action reports are in memory for one hour or until server restart; export
before restarting. Retell does not retain audio/transcripts under this config.

Our OpenAI account pays model generation. Retell workspace pays its voice
runtime; no cost advantage is presumed. Existing paid-processing consent is
required before starting. Creating/verifying an agent does not place a call.

Before claiming audible readiness, perform a live browser/headphone test:
the same assignment in all three modes; correct a sentence mid-answer; switch
EN/RU/ES; save the same TEST message twice; prepare a known fixture slot and
confirm it remains a proposal; stop/reload and confirm no duplicate session,
no late speech and no real action. Also check iPhone autoplay/microphone.
None of this establishes PSTN or native monitoring readiness.

Protocol references:
- https://docs.retellai.com/integrate-llm/overview
- https://docs.retellai.com/integrate-llm/setup-websocket-server
- https://docs.retellai.com/api-references/llm-websocket
- https://docs.retellai.com/integrate-llm/integrate-llm
