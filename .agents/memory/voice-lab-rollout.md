---
name: Voice Lab rollout boundary
description: Approval boundary for cloned voice experiments versus live calls
---

The owner explicitly approved comparing his ElevenLabs and Cartesia clones in live iOS calls after testing both in Voice Lab. The prior lab-only restriction no longer applies to the owner's cloned English speech in Translator and deliberate tap-to-speak Copilot. Keep ElevenLabs as the default; this approval does not authorize automatic Copilot speech, changes to private-audio routing, or replacement of other voices.

**Why:** Lab tests established enough confidence for an opt-in live comparison, but the English speech and provider choice remain distinct from the call's other audio paths. Publishing server code does not update the native iOS binary; live listening still requires a newly installed iOS build.

**How to apply:** Resolve only the signed-in owner's ready provider-specific clone for live synthesis; never accept a client-supplied voice ID or silently switch providers. A dev clone record is not production data: when reusing its provider voice, verify it belongs to the same TalkHint owner and is accessible to the production provider account. Creating any new clone still requires a separate provider-specific consent action.

Cartesia TTS success or a valid API key does not establish voice-cloning entitlement. Cartesia currently requires Pro or above for Instant Voice Clone; a free-tier key can synthesize a public voice but returns `plan_upgrade_required` for cloning. Verify provider error codes before blaming or resending the user's sample.

The owner confirmed after hands-on testing that the ElevenLabs clone resembles him and speaks excellent English; he likes the result. Treat ElevenLabs as the proven quality baseline, not an untested candidate.