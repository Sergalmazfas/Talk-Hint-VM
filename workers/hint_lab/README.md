# Hint post-call laboratory

Official self-hosted CrewAI: https://github.com/crewAIInc/crewAI/releases/tag/1.15.30
Package pinned in `pyproject.toml` and `uv.lock`; MIT. No CrewAI cloud login.

`pipeline.py` accepts one authorized owner-scoped Hint snapshot on stdin. Its
environment only needs the existing `OPENAI_API_KEY` and optional `LAB_MODEL`
(default `gpt-5.2`, already listed among this project's candidate models).
There is no model fallback. No browser/search/phone/mail tools are given to agents.
The worker never receives DB, Twilio, Gmail, SendGrid or session credentials.

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
