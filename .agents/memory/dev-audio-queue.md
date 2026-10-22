---
name: Dev audio queue timing
description: Why a short browser playback backlog can incorrectly terminate a healthy incoming Realtime conversation.
---

Bound the audio queue for safety, but allow a normal complete spoken turn even when OpenAI generates it much faster than playback. Interruption must discard the whole unplayed queue independently of that bound.

**Why:** An actual incoming-agent greeting exceeded the old short browser queue budget even though OpenAI, format negotiation and transcription all worked. Treating that backlog as a broken connection recreates the user's symptom of an abruptly ending Dev conversation.

**How to apply:** When changing Realtime prompts, playback or buffering, test generated speech length against real playback time as well as network throughput. A successful handshake or codec unit test alone does not establish a usable spoken conversation.

Schedule a tool-result continuation only after the preceding response has ended and all its tool outputs are ready; suppress stale continuation during caller speech. An active-response conflict is recoverable, not grounds to tear down the voice session.

**Why:** A real synthetic dialogue reproduced `conversation_already_has_active_response`; the generic fatal-error handler closed an otherwise usable conversation. Automatic provider interruption also makes a second explicit cancellation redundant.

**How to apply:** Exercise multi-turn real provider dialogue, not only the initial greeting, when changing the Dev coordinator. Keep provider error codes in safe diagnostics, never raw provider payloads.

The owner liked the Marin voice and response speed, but later rejected Realtime-2.1's conversational behavior after noisy-room and closed-day tests. Preserve that distinction: good voice is not approval of the agent's dialogue or model.

**Why:** The later feedback changed the model preference, not the earlier positive assessment of the voice.

Treat malformed/uncertain tool fields as recoverable validation errors, not database failure. Return saved=false, ask for clarification, and never broaden accepted phone/date formats or guess a country code just to avoid a rejection.

**Why:** Normal spoken phone dictation can produce invalid structured arguments; the original broad save-error catch terminated an otherwise healthy conversation. A successfully committed write followed by an acknowledgement transport failure is a different case again.

**How to apply:** Keep tool JSON-schema constraints aligned with intake validation. Test invalid input followed by correction, real write failure, and post-write transport failure separately.
