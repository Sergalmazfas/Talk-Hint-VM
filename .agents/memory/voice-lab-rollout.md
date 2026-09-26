---
name: Voice Lab rollout boundary
description: Approval boundary for cloned voice experiments versus live calls
---

Keep cloned-voice experiments in the internal Voice Lab, separate from live Translator, Copilot, Hint, routing, and call History. Do not add a cloned voice to live calls merely because the laboratory can generate it. Cartesia belongs in the same lab for later side-by-side testing, not in the initial ElevenLabs test.

**Why:** The requested experiment must establish whether speaker likeness and latency are acceptable before changing any production call behavior; automated tests cannot judge likeness without the owner's actual recording and listening review.

**How to apply:** For future voice-provider work, offer a same-text comparison in the lab and wait for explicit user approval before changing the live audio path. Consent to clone with ElevenLabs (or the presence of a Cartesia API key) is not consent to send a voice sample to Cartesia; require a fresh, provider-specific action.

Cartesia TTS success or a valid API key does not establish voice-cloning entitlement. Cartesia currently requires Pro or above for Instant Voice Clone; a free-tier key can synthesize a public voice but returns `plan_upgrade_required` for cloning. Verify provider error codes before blaming or resending the user's sample.

The owner confirmed after hands-on testing that the ElevenLabs clone resembles him and speaks excellent English; he likes the result. Treat ElevenLabs as the proven quality baseline, not an untested candidate. This is approval of the Voice Lab result, **not** approval to change the live Translator/Copilot pipeline.