---
name: Secretary voice choice policy
description: Owner-approved default and boundaries for direct OpenAI Secretary audio.
---

After personally testing GPT-Live 1 with Marin in the incoming microphone bench, the owner said it worked magnificently and requested only this combination throughout Secretary, including iOS and ChatGPT. This supersedes the earlier Realtime-2.1/default-with-clone-options choice. It is a confirmed microphone experience, not a PSTN benchmark.

**Why:** The user explicitly chose this combination after the Dev comparison. Their priority is an intelligent, natural-speaking Secretary, not cost reduction.

**How to apply:** New Secretary calls use GPT-Live 1 with built-in Marin and the tested Sol reasoning backend, with no silent fallback or new clone-provider choices. Keep historical provider decoding and existing task data; reject obsolete new-call choices instead of silently changing their approved parameters. Translator/Copilot remain independent.

Older native clients may explicitly send cloned-voice choices. Require a fresh preparation under the current Secretary choice rather than silently rerouting a signed old request. Native Settings must clearly identify the Secretary model separately from Translator/Copilot.

**Why:** Overriding an explicit client value would silently change the caller's selected voice, including already approved requests.

**How to apply:** Keep Secretary selection independent of the Translator/Copilot clone preference; do not infer the Secretary preference from that older shared value. Preserve attempted draft choices on retries. Distinguish prepared native changes from installed builds: they require a separate iOS update. A Dev or handshake check is not authorization to publish or proof that a PSTN call succeeded.

The owner wants the standard introduction to say “secretary”, not “assistant” or “AI assistant”, across native calls, ChatGPT-originated calls and every voice option. Answer direct questions about AI truthfully and preserve applicable mandatory notices.

**Why:** The owner confirmed that a real call succeeded but objected to the spoken role being “assistant”.

**How to apply:** Use only an explicitly confirmed account-bound owner name; never infer a full identity from a short phone label, transfer another owner's name, or accept identity changes from stale task wording. Per-response introduction instructions must retain the full shared identity and safety policy, rather than replacing it with an older greeting.
