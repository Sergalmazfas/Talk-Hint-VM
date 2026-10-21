---
name: Secretary voice choice policy
description: Owner-approved default and boundaries for direct OpenAI Secretary audio.
---

The owner requested GPT-Realtime-2.1 with the built-in OpenAI voice as the default Secretary combination, while keeping ElevenLabs and Cartesia selectable. They consider it better and faster; that is their preference, not a measured PSTN benchmark.

**Why:** The user explicitly chose this combination after the Dev comparison. Their priority is an intelligent, natural-speaking Secretary, not cost reduction.

**How to apply:** Default only newly prepared Secretary calls with no explicit choice to direct OpenAI audio. Preserve providers on existing tasks, signed approvals and explicit client selections. Never silently substitute another model if access fails. Do not change Translator/Copilot voice defaults to implement this Secretary-specific decision.

Old native clients explicitly send the shared cloned-voice preference. Respect it rather than interpreting it as an omitted server default. The owner subsequently requested that native Settings also clearly show the Secretary default, separate from Translator/Copilot.

**Why:** Overriding an explicit client value would silently change the caller's selected voice, including already approved requests.

**How to apply:** Keep Secretary selection independent of the Translator/Copilot clone preference; do not infer the Secretary preference from that older shared value. Preserve attempted draft choices on retries. Distinguish prepared native changes from installed builds: they require a separate iOS update. A Dev or handshake check is not authorization to publish or proof that a PSTN call succeeded.

The owner wants the standard introduction to say “secretary”, not “assistant” or “AI assistant”, across native calls, ChatGPT-originated calls and every voice option. Answer direct questions about AI truthfully and preserve applicable mandatory notices.

**Why:** The owner confirmed that a real call succeeded but objected to the spoken role being “assistant”.

**How to apply:** Use only an explicitly confirmed account-bound owner name; never infer a full identity from a short phone label, transfer another owner's name, or accept identity changes from stale task wording. Per-response introduction instructions must retain the full shared identity and safety policy, rather than replacing it with an older greeting.
