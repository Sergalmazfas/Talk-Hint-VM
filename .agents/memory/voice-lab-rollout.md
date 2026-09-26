---
name: Voice Lab rollout boundary
description: Approval boundary for cloned voice experiments versus live calls
---

Keep cloned-voice experiments in the internal Voice Lab, separate from live Translator, Copilot, Hint, routing, and call History. Do not add a cloned voice to live calls merely because the laboratory can generate it. Cartesia belongs in the same lab for later side-by-side testing, not in the initial ElevenLabs test.

**Why:** The requested experiment must establish whether speaker likeness and latency are acceptable before changing any production call behavior; automated tests cannot judge likeness without the owner's actual recording and listening review.

**How to apply:** For future voice-provider work, offer a same-text comparison in the lab and wait for explicit user approval before changing the live audio path.

The owner confirmed after hands-on testing that the ElevenLabs clone resembles him and speaks excellent English; he likes the result. Treat ElevenLabs as the proven quality baseline, not an untested candidate. This is approval of the Voice Lab result, **not** approval to change the live Translator/Copilot pipeline.