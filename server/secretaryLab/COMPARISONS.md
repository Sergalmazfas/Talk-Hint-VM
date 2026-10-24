# Saved Dev voice comparisons

This is an opt-in archive, not automatic session history or a customer CRM.
The existing one-hour in-memory reports remain unchanged. In the shared Secretary
Lab page, refresh **Сохранённые прогоны**, select 1–6 finished runs with the same
assignment, supply a title and optional 1–5 score/note, and explicitly consent.
GPT, Retell and Retell + Engine sources are read on the server under their owner,
not accepted as caller-provided report JSON.

Snapshots include the assignment, runtime, model, voice, configuration/runtime
verification level, turns, metrics, events, human interruption observations and
the allowlisted **test-only** Engine action ledger. No audio, admission objects,
provider responses, one-use access tokens, Custom LLM capabilities or callback URLs
are stored. URLs and credential-labelled values in free text are redacted. Engine
context is reduced to its fixture identifier; no client calendar or notification
objects are copied. Reading/exporting never reconnects audio or executes tools.
Agent configuration verification does not prove audible audio or PSTN quality.

All archive endpoints require the existing benchmark admin gate and development
environment. Other authorized administrators can read, rate and delete records;
this is the owner's shared private admin lab, not per-customer storage.
The library and details work without live providers and after process restart.
There is no memory fallback on DB/schema failure: requests return an explicit 503.

Retention is **30 days from initial save**, with a stored consent timestamp and
expiry. Rating edits do not extend it. Expired rows become unreadable immediately.
A Dev-only sweep deletes expired rows on startup and hourly while Dev runs; if
Dev is stopped, cleanup resumes when started. Explicit delete physically removes
the row immediately. This does not erase previously downloaded JSON copies or
provider-retained basic call attributes.

## Setup and checks

- Schema source: `shared/schema.ts`; independent table `secretary_lab_comparisons`.
- Additive development DDL: `NODE_ENV=development npx tsx scripts/ensure-secretary-comparisons-schema.ts`.
  Also runs in the existing development-only post-merge setup. No startup DDL.
- Unit/API checks: `npx vitest run server/secretaryLab/comparisons.test.ts`.
- Real DB/restart probe: `NODE_ENV=development npx tsx scripts/probe-secretary-comparisons.ts`.
  Uses fictional rows, reads committed data from a separate Node process, checks
  expiry and physical deletion, and cleans up its temporary owner.

No publishing, telephone activation, calendar integration or notification delivery
is part of this feature.
