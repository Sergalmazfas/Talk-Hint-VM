---
name: Copilot private translator boundary
description: Copilot is only a simple two-way screen translator for incoming and outgoing calls; no V2 or Brain.
---
Copilot is only a simple two-way screen translator for BOTH incoming and outgoing calls: Guest speech → large text in the user's selected language (not hardcoded Russian), and private push-to-talk Owner speech in their language → text in the Guest's language that Owner reads aloud themselves. Reuse the existing realtime translator and its translation-only prompt; no V2, separate Brain, SAY/CHOOSE, advice, TTS or Hint extension. This supersedes earlier V2/context-roadmap and outgoing-only scope proposals. Implementation still requires approval.

**Why:** The user rejected typing as the primary realtime input and rejected adding Terra/reasoning to simple translation. Owner dictates the actual desired message privately, then speaks its English translation to Guest themselves.

**How to apply:** Do not add a V2 roadmap or exclude incoming calls. Never equate private/generated/displayed content with speech Guest heard. A later Guest utterance must not by itself erase the Owner’s private intention; distinguish technical stale responses from semantic intent cancellation. No private content persistence beyond operational necessity without separate approval. The example “скажи, что…” needs an explicit translation convention, not an assumed command Brain. Read the current user request before using older Copilot proposals.