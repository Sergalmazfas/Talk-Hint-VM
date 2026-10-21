---
name: Dev audio queue timing
description: Why a short browser playback backlog can incorrectly terminate a healthy incoming Realtime conversation.
---

Bound the audio queue for safety, but allow a normal complete spoken turn even when OpenAI generates it much faster than playback. Interruption must discard the whole unplayed queue independently of that bound.

**Why:** An actual incoming-agent greeting exceeded the old short browser queue budget even though OpenAI, format negotiation and transcription all worked. Treating that backlog as a broken connection recreates the user's symptom of an abruptly ending Dev conversation.

**How to apply:** When changing Realtime prompts, playback or buffering, test generated speech length against real playback time as well as network throughput. A successful handshake or codec unit test alone does not establish a usable spoken conversation.
