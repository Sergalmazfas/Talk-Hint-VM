---
name: Candidate pipeline live experiments
description: Rules for running per-user experimental live-call pipelines (alternate STT/Brain) without contaminating production or the verdict data.
---

- Live STT swaps must be transactional. **Why:** the production STT opens before the call owner is known, and a candidate socket can fail its handshake — reporting success while merely connecting leaves a call with no transcription yet labeled "swapped". **How to apply:** wait (bounded) for the candidate socket's handshake before tearing down the production STT; on failure keep production and label the failure.
- Production STT auto-reconnect can resurrect after a swap and silently overwrite the candidate connection. Guard every reconnect path with swap state.
- A candidate call always has a production-STT lead-in (owner identity arrives only with the stream "start"). Record the lead-in duration; never claim pure candidate coverage.
- Verdict labeling is by what actually carried the call, never by intent — and STT vs Brain candidacy are independent: a failed STT swap with an active Brain override is a Brain-candidate call, never baseline (otherwise candidate results contaminate the baseline cohort).
- Brain overrides are per-call parameters, never the UI-global model variable (that one is shared across users).
- Latency summaries must return nulls, not fabricated zeros, when no hints were sent; flush metrics to call metadata detached so teardown never blocks.
- New user columns must also be added to the benchmark self-provisioning DDL — the Reserved VM build runs no drizzle migrations.
