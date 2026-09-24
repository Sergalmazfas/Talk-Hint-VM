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

Copilot's Ready state after Hold is a claim about the public call microphone, not merely the translation socket. If the private finish fence or restored public frame cannot be confirmed, remain fail-closed and show an actionable call-audio failure instead of Ready.

**Why:** A real call exposed a mismatch: the screen said Ready while the guest could not hear the Owner, and repeated Hold stopped capturing. A misleading Ready conceals both a broken call and the privacy boundary.

**How to apply:** Review any changes to audio gates, interruption handling, or call status against multiple consecutive Hold/Release cycles. Device-side acknowledgment is necessary but not proof of guest audibility; validate 5–10 cycles on two physical phones before claiming the behavior is verified.

In Copilot's text-only translation, a deliberate short utterance must not disappear solely because it is under the voice Translator's minimum audio duration. Keep the voice Translator's noise protection separate; empty/unintelligible Copilot transcripts should still be suppressed.

**Why:** Brief words such as “Да” are valid call responses, and a shared duration gate could cancel their text translation before it reached the Copilot screen.

**How to apply:** When changing shared realtime-provider gates, test Copilot's guest, private, and public-text sessions separately from the voice Translator. A duration exemption is not evidence that the model translates accurately; confirm content in a real call.

Copilot's visual contract is a scrolling, Translator-style conversation above a pinned card styled like the Hint card, but explicitly labelled as **translation**, never a hint or advice. The private Russian phrase stays between Owner and Copilot; the Owner reads its English translation and then speaks English to Guest through the regular call.

**Why:** The user explicitly distinguished the translation card from a hint and asked to see both sides of the actual conversation without the oversized full-screen text.

**How to apply:** Keep private phrases out of the public conversation and Guest audio. Distinguish public Owner speech from private drafts; do not present a private draft as something already said to Guest. Keep the English translation visible while the Owner reads it aloud. Preserve the established Translator card layout rather than introducing a separate Copilot design.

Choose any future Copilot translation-model changes from isolated, identical recorded-audio comparisons before changing the live phone flow. A clean synthetic phrase or absence of output on pure silence is not proof against real-call noise, multilingual hallucinations, or segmentation errors.

**Why:** The dedicated live-translation model previously performed worse than the constrained Translator configuration; initial controlled Copilot comparisons showed both useful translations and subtle differences in meaning. Production behavior should not be switched on model branding or one smoke test.

**How to apply:** Test both directions, short answers, names/numbers, consecutive turns, real noisy calls and repeatability; retain provider failures and unavailable source transcripts in evidence. Keep comparison sessions isolated from routing, private mic gating and production settings until a configuration has enough evidence to win.

The guided web stand is sufficient for the current stage; prioritize debugging the actual iPhone Copilot audio/event path rather than polishing the stand or comparing models by default.

**Why:** The user redirected work after the guided run: its speed and general accuracy were good enough to proceed, while the remaining concern is real-call behavior in ordinary noisy places and PRIVATE mic safety.

**How to apply:** Only return to the stand if a specific production Copilot failure needs reproduction. Evaluate Guest and private Owner streams, noisy audio, stale/cancelled responses, public mic restoration, and call continuity on real devices before claiming real-call reliability.