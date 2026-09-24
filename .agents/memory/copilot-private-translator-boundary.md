---
name: Copilot private translator boundary
description: Copilot is only a simple two-way screen translator for incoming and outgoing calls; no V2 or Brain.
---
Copilot is a third independent phone pipeline for BOTH incoming and outgoing calls: Guest speech → large text in the user's selected language (not hardcoded Russian), and private push-to-talk Owner speech in their language → English text that Owner reads aloud themselves. Reuse the existing realtime translator and its translation-only prompt; no V2, separate Brain, SAY/CHOOSE, advice, TTS or Hint extension. This supersedes earlier V2/context-roadmap and outgoing-only scope proposals.

**Why:** The user rejected typing as the primary realtime input and rejected adding Terra/reasoning to simple translation. Owner dictates the actual desired message privately, then speaks its English translation to Guest themselves.

**How to apply:** Do not add a V2 roadmap or exclude incoming calls. Never equate private/generated/displayed content with speech Guest heard. A later Guest utterance must not by itself erase the Owner’s private intention; distinguish technical stale responses from semantic intent cancellation. No private content persistence beyond operational necessity without separate approval. The example “скажи, что…” needs an explicit translation convention, not an assumed command Brain. Read the current user request before using older Copilot proposals.

Private PTT must be gated before Twilio capture writes, not by changing screens or ordinary mute. Twilio's DefaultAudioDevice exposes no public PCM tap; the official MIT-licensed custom AudioDevice example provides separate capture-write and remote-render callbacks. One custom device would need to be installed before all calls, then route capture frames internally without swapping devices during a call. The render callback exposes remote SDK PCM before local playback mixing, but is not automatically proof of Guest-only audio in every conference configuration.

**Why:** A partial Copilot UI or unsecured server stream could misrepresent privacy; the official example is substantial Core Audio code, and the development host cannot compile or verify iPhone audio routes.

**How to apply:** Preserve existing Hint/Translator behavior; do not ship a PRIVATE-ready button until exact SDK/Xcode compilation, CallKit/route/interruption tests, and controlled Guest-leg leakage tests prove the gate. Never replace DefaultAudioDevice globally merely on paper without regression testing existing calls.

Copilot's visual contract is a scrolling, Translator-style conversation above a pinned card styled like the Hint card, but explicitly labelled as **translation**, never a hint or advice. The private Russian phrase stays between Owner and Copilot; the Owner reads its English translation and then speaks English to Guest through the regular call.

**Why:** The user explicitly distinguished the translation card from a hint and asked to see both sides of the actual conversation without the oversized full-screen text.

**How to apply:** Keep private phrases out of the public conversation and Guest audio. Distinguish public Owner speech from private drafts; do not present a private draft as something already said to Guest. Keep the English translation visible while the Owner reads it aloud. Preserve the established Translator card layout rather than introducing a separate Copilot design.