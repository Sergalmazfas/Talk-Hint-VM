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

## Hint latency SLA chain (speech→hint)
- Device delivery is a client-side ack (`suggestion_ack`) routed through a registry with its OWN ownership snapshot — never websocket.ts's callOwners, which is cleared at close while acks must keep landing through a short post-close grace window before the metadata flush.
- Honest gaps by design: speech-end is unmeasurable (STT never gives wall-clock end of speech; usable final already includes EOT detection delay); first-text == full output (non-streaming live model). Name such gaps in stageNotes — never fabricate a stage.
- The static wait-state ACK phrase counts as a real sent hint; it has no Brain stage, so per-stage percentiles must skip absent stages rather than treat them as zero.
- iOS must ack AFTER the main-queue render (measures on-screen delivery, not socket arrival).
