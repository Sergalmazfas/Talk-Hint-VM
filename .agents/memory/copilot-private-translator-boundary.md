---
name: Copilot private translator boundary
description: Copilot is a two-way on-screen translator; neither V1 nor V2 is a conversation Brain.
---
Copilot V1 is a separate two-way screen translator: Guest EN→RU TEXT while original Guest voice remains audible, and private push-to-talk Owner RU→EN TEXT that Owner reads aloud themselves. Neither V1 nor V2 includes a text Brain, SAY/CHOOSE, advice, TTS or Hint extension. This supersedes the earlier no-private-microphone and conversation-Brain proposals. Implementation still requires approval of the exact routing design.

**Why:** The user rejected typing as the primary realtime input and rejected adding Terra/reasoning to simple translation. Owner dictates the actual desired message privately, then speaks its English translation to Guest themselves.

**How to apply:** V2 may improve translation disambiguation using bounded role-aware conversation context, not decide what to answer. Never equate private/generated/displayed content with speech Guest heard. A later Guest utterance must not by itself erase the Owner’s private intention; distinguish technical stale responses from semantic intent cancellation. No private content persistence beyond operational necessity without separate approval. The example “скажи, что…” needs an explicit translation convention, not an assumed command Brain. Read the current user request before using older Copilot proposals.