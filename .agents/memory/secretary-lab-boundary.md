---
name: Secretary Lab boundary
description: Why the admin conversation bench reuses the Secretary and what it does not prove.
---

The Secretary bench belongs alongside the existing model/admin benches. Preserve the existing real-agent/owner-voice baseline. An explicitly named direct OpenAI comparison is a separate selectable Dev experiment, never a silent replacement of that baseline or the telephone runtime.

**Why:** The owner wants to hear and understand the actual Secretary before changing conversation behavior or providers after an unexplained short call.

**How to apply:** Reuse the agent through an isolated telephone-protocol peer; never silently substitute a voice or model. Keep test dialogue/reports separate from real-call history and make paid processing explicit. Browser playback/transport simulations are not proof of actual PSTN handover, carrier reliability or iPhone microphone behavior.

Model generation and external cloned-voice playback have independent lifecycles. Test the actual upstream wire semantics, not just a fake method that accepts every cancellation. Include provider PCM with complete 16-bit samples but non-multiple-of-three sample counts, plus native-to-browser codec checks.

**Why:** A cancellation-counting fake hid rejection of cancelling an already-completed model response while its cloned voice was still playing. Uniform PCM fixtures also hid incorrect rejection of valid audio tails. Passing such mocks did not establish a usable conversation.

**How to apply:** Regression coverage must include a new guest utterance during playback, a settled-cancellation race, multiple subsequent replies and actual browser audio rendering. Keep live-device/provider verification explicitly separate.

When attaching a control sideband to an already-created OpenAI WebRTC session, do not assume the initial session-created event will be replayed. Request an idempotent instructions update and verify the complete session-updated acknowledgment before enabling input.

**Why:** The live sideband attach did not replay creation, although a fresh model WebSocket did. Waiting only for creation caused a readiness timeout despite model availability.

**How to apply:** Keep exact model/voice validation and the readiness timeout; distinguish new-session WebSocket handshakes from existing-session sideband attachment.

For the Dev comparison the owner stated: “Приоритет — умный, естественно говорящий секретарь, не экономия.”

**Why:** The user explicitly prioritizes conversation quality over reducing model/voice cost.

**How to apply:** Do not silently replace the requested model with a cheaper model or judge readiness by a first greeting. Preserve the same task across named comparisons and test corrections, free interruption, waiting and resumption.

The owner approved a Retell API comparison in the browser, with one Secretary policy and the same task as the existing GPT stand, especially testing interruption.

**Why:** The request is to compare voice runtimes, not to replace the working telephone Secretary or create another independently maintained persona.

**How to apply:** Keep Retell an explicitly selected Dev-only experiment; share the trusted core instructions, identify actual model/voice/ASR differences, and do not call this an isolated LLM comparison. Do not switch native or telephone calls implicitly. Provider setup/configuration checks are not proof of audible conversation or successful interruption.

Do not treat a Retell API migration error as evidence that the secret needs rotation.

**Why:** A legacy list operation was rejected while the same credential successfully accessed supported voice and agent operations. New browser transport credentials also cannot safely be guessed as an older transport's token.

**How to apply:** Check the provider's current migration notice and explicit response transport first; distinguish authentication, permission, payment and protocol errors. Verify paid conversation separately from configuration access.

The owner subsequently completed a live browser comparison and strongly preferred Retell's audibility/headphone experience. They also confirmed an interruption worked in that trial, while repeatedly reporting poor GPT-stand audio.

**Why:** This is direct user-observed browser evidence, superseding the earlier absence of any live Retell trial. It is not proof of telephone quality, measured interruption latency, or integration with the common execution Engine.

**How to apply:** Prioritize evaluating Retell with TalkHint's task/control backend, without silently replacing the telephone default. Treat the GPT stand's audio path as a separate diagnostic question rather than concluding its language model is inferior.

The owner authorized a third “Retell + Engine” comparison ONLY inside the existing Dev browser bench, using Custom LLM, Merritt and comparable conversation settings. All context/actions are test-only; no production notifications/calendar/telephony or publishing.

**Why:** Sharing a prompt with a Retell-managed model was not enough to compare our own controlled execution logic. This approval does not switch the telephone default or authorize business actions.

**How to apply:** Keep the original two modes available. Distinguish the new text adapter from the existing audio Engine; enforce a sandbox allowlist rather than exposing real tools. Treat interruption as cancellation of obsolete speech/generation, not rollback of an already committed action, and deduplicate action replays across response IDs/reconnects.

Retell's Custom LLM WebSocket does not send authentication headers. Do not assume the webhook signature mechanism protects that separate protocol.

**Why:** The provider's setup guide explicitly requires endpoint admission protection; authenticating ordinary webhooks does not authenticate model sockets.

**How to apply:** Require a short-lived per-session capability plus the registered web-call identity, reject production callbacks, and never expose capabilities in browser admissions, report exports or URL logs.
