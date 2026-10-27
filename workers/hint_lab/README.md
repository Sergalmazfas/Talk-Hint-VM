# Hint post-call laboratory

Official self-hosted CrewAI: https://github.com/crewAIInc/crewAI/releases/tag/1.15.30
Package pinned in `pyproject.toml` and `uv.lock`; MIT. No CrewAI cloud login.

`pipeline.py` accepts one authorized owner-scoped Hint snapshot on stdin. Its
environment only needs the existing `OPENAI_API_KEY` and optional `LAB_MODEL`
(default `gpt-5.2`, already listed among this project's candidate models).
There is no model fallback. No browser/search/phone/mail tools are given to agents.
The worker never receives DB, Twilio, Gmail, SendGrid or session credentials.
The Node bridge invokes the project's managed Python module with an explicit
package path; no separate virtualenv or CrewAI cloud deployment is created.

Flow: agent-1 analysis → explicit replay-not-run → independent agent-2 QA →
agent-1 letter. At most two QA returns; missing QA/exhausted returns do not label
the analysis accepted. Mail is a separate server outbox operation, never an agent
tool. HEAD.07 is a later selective acceptor, not a per-letter blocking gateway.

```
python workers/hint_lab/pipeline.py --output generated-artifacts/plab-synthetic/report.json \
  < workers/hint_lab/synthetic.json
```

This command makes model API requests with the existing key. It does not send
email, place calls, replay audio, or modify the source/organisation model.
Synthetic results are not proof of a production call or inbox delivery.
No new per-call monetary ceilings are introduced.

## Event/outbox integration

`server/callLab` persists private execution state in the application's existing DB.
An explicit owner-bound Hint provenance marker is written by the existing Hint
close/metadata flush only when the pilot is enabled in its target environment.
The worker reconciles new completed calls, not historical or guessed-mode calls.
No new audio capture, call, phone configuration or webhook repoint is added.

Default: `LAB_ENABLED=false`. Gmail connection is pinned with
`LAB_GMAIL_CONNECTION_ID`; owner is verified against the existing administrator
and resolved separately in each DB. `LAB_TARGET_ENVIRONMENT=production` keeps
Dev automatic processing off. A stored disabled control is never re-enabled by
restart. A disabled worker still performs expiry of its own private copies.

Analysis/QA/letter run sequentially in one isolated child. A DB advisory lock
prevents parallel processing for the same owner/environment. Crash recovery is
bounded; an uncertain Gmail send is **looked up**, never blindly resent.
HEAD.07 remains selective subsequent control; outbox transports unverified or
returned results with their real status instead of inventing acceptance.

Gmail only uses profile verification, lookup of its own deterministic Message-ID
in SENT, and self-send. No general inbox ingestion, per-user Gmail feature or
access from anonymous Product Crew is added.

Private authenticated endpoints:
- `GET /api/admin/call-lab/status`
- `GET /api/admin/call-lab/reports/:key`
- `POST /api/admin/call-lab/disable`

Dev schema setup is guarded in `scripts/prepare-call-lab.ts`. Production schema
is applied by the owner's normal Publish flow; runtime does not run DDL.
`scripts/lab-self-mail.ts` prepares the actual synthetic result in the durable
outbox. Its `--send` flag is only used after explicit owner confirmation.
