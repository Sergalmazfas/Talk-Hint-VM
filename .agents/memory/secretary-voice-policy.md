---
name: Secretary voice choice policy
description: Owner-approved default and boundaries for direct OpenAI Secretary audio.
---

The owner requested GPT-Realtime-2.1 with the built-in OpenAI voice as the default Secretary combination, while keeping ElevenLabs and Cartesia selectable. They consider it better and faster; that is their preference, not a measured PSTN benchmark.

**Why:** The user explicitly chose this combination after the Dev comparison. Their priority is an intelligent, natural-speaking Secretary, not cost reduction.

**How to apply:** Default only newly prepared Secretary calls with no explicit choice to direct OpenAI audio. Preserve providers on existing tasks, signed approvals and explicit client selections. Never silently substitute another model if access fails. Do not change Translator/Copilot voice defaults to implement this Secretary-specific decision.

Old native clients explicitly send the shared cloned-voice preference. Respect it rather than interpreting it as an omitted server default.

**Why:** Overriding an explicit client value would silently change the caller's selected voice, including already approved requests.

**How to apply:** Distinguish server/ChatGPT defaults from native client defaults; explain that a native selection change requires a separate iOS update. A Dev or handshake check is not authorization to publish or proof that a PSTN call succeeded.
