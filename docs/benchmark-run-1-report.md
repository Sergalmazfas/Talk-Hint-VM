# LIVE Ears & Brain Benchmark — Run Report
Fixture: Gold Call #1 — bank payment-plan dispute (synthetic, de-identified) · Prompt: brain-v1 · Judge: none · 2026-08-14T20:46:17.131Z

## Candidate availability (real API checks)
- dg-flux-general-en: **AVAILABLE** — WS open @ wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=mulaw&sample_rate=8000&eot_threshold=0.7&eot_timeout_ms=3000; sent 20ms mulaw silence ok
- dg-flux-general-multi: **AVAILABLE** — WS open @ wss://api.deepgram.com/v2/listen?model=flux-general-multi&encoding=mulaw&sample_rate=8000&eot_threshold=0.7&eot_timeout_ms=3000; sent 20ms mulaw silence ok
- dg-nova-3-multi: **AVAILABLE** — WS open @ wss://api.deepgram.com/v1/listen?model=nova-3&language=multi&encoding=mulaw&sample_rate=8000&interim_results=true&punctuate=true; sent 20ms mulaw silence ok
- oai-realtime-server-vad: **AVAILABLE** — client_secret issued; model=gpt-4o-transcribe, turn_detection=server_vad
- oai-realtime-semantic-vad: **AVAILABLE** — client_secret issued; model=gpt-4o-transcribe, turn_detection=semantic_vad
- oai-batch-gpt-4o-transcribe: **UNAVAILABLE** — HTTP 429: {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}

- azure-speech-realtime: **UNAVAILABLE** — no credentials configured (Azure Speech key not present); skipped without network call
- current-production: **UNAVAILABLE** — structured probe failed: HTTP 429 {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}
- gpt-5.2: **UNAVAILABLE** — structured probe failed: HTTP 429 {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}
- gpt-5.6-luna: **UNAVAILABLE** — structured probe failed: HTTP 429 {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}
- gpt-5.6-terra: **UNAVAILABLE** — structured probe failed: HTTP 429 {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}
- gpt-5.6-sol: **UNAVAILABLE** — structured probe failed: HTTP 429 {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}

## EARS WINNER
**No winner can be declared.** No real audio fixtures exist yet (TalkHint has never recorded call audio). Availability of every STT candidate was verified with real API calls (see above), but accuracy/latency comparison requires real dual-channel call audio. Next step: enable diagnostic recording for the approved test account for a few benchmark calls, or upload audio fixtures in the admin UI.
- note: EARS accuracy run skipped: no real audio fixtures yet (TalkHint has never recorded call audio; recording toggle is opt-in and OFF).

## BRAIN WINNER
No BRAIN candidate produced usable results.

## BOTTLENECK
With no EARS timing data, only the BRAIN half of the pipeline is measured: best candidate averages — from Guest-turn end to suggestion ready (client render ≈ +75ms, estimated). In production, total hint delay = STT end-of-turn detection + this. The unmeasured EARS EOT stage (production Flux eot_timeout up to 3000ms on silence) is very likely the larger share — measure it once real audio fixtures exist.

## RECOMMENDED PIPELINE
- EARS: keep production Deepgram Flux (flux-general-en) unchanged — no measured evidence justifies a change yet.
- Re-run this benchmark after collecting real dual-channel audio fixtures to complete the EARS half.