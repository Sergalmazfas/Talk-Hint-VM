---
name: Secretary Lab boundary
description: Why the admin conversation bench reuses the Secretary and what it does not prove.
---

ElevenLabs latency profiles must remain local to its Dev adapter; keep other working benches unchanged, preserve the original profile and compare the same model before combining changes.

**Why:** The owner explicitly requires preserving the other working benches. Lower reasoning in a named ElevenLabs experiment is not permission to change the global Secretary default.

**How to apply:** Record profile snapshots and distinguish first-text/audio-frame measurements from physical audibility. Do not promote Eager based on text-only tests.

Eleven Agents rejects Flash v2.5 with English as the primary language; the same configuration is accepted with Russian primary. Multilingual speech and switching must still be tested, not inferred from admission.

**Why:** Actual agent creation returned “English Agents must use turbo or flash v2.” A Russian-primary configuration was accepted. This is an extra comparison variable, not an equivalent TTS-only switch.

**How to apply:** Disclose the primary language in profile snapshots, preserve baseline, never silently substitute Flash v2 or Realtime for Custom LLM.

The installed Eleven browser SDK separates raw control messages from audio output listeners.

**Why:** A synthetic probe received audio but incorrectly timed out waiting for agent-response events on the audio listener. Independently, valid multi-second PCM frames exceeded the old 256KiB upstream cap.

**How to apply:** Subscribe to control events as well as audio in probes, answer ping, and inspect saved provider close reasons before labeling a timeout as silence or slow Engine. Keep bounded payload limits appropriate for base64 PCM.

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

The owner positively confirmed live voice quality and interruption handling specifically with Retell + TalkHint Engine, while repeated clarification remained a recognition concern.

**Why:** Their good listening experience did not mean that every utterance was understood correctly, nor did it validate the standalone Retell mode or production telephony.

**How to apply:** Preserve the tested separation of voice transport and our Engine. Evaluate recognition accuracy independently from pleasant voice/playback and do not treat this confirmation as production-rollout approval.

Treat consent to paid voice processing and consent to retaining comparison transcripts as separate decisions. Archiving must remain an explicit selection, not an automatic extension of temporary Lab history.

**Why:** The owner requested an explicitly agreed comparison store, not permanent retention of every microphone test. Even fictional scenarios can contain user-spoken private details.

**How to apply:** Explain the retention period and administrator visibility before each save. Preserve the boundary between offline test-action snapshots and real calendar/notification execution; reopening a saved comparison must never resume audio or replay actions.

Retell's Custom LLM WebSocket does not send authentication headers. Do not assume the webhook signature mechanism protects that separate protocol.

**Why:** The provider's setup guide explicitly requires endpoint admission protection; authenticating ordinary webhooks does not authenticate model sockets.

**How to apply:** Require a short-lived per-session capability plus the registered web-call identity, reject production callbacks, and never expose capabilities in browser admissions, report exports or URL logs.

The owner approved “ElevenLabs + Engine” only as a fourth existing-Dev-browser comparison, keeping the other modes. Reuse the owner's existing clone; never create a new one or silently substitute a catalog voice.

**Why:** The comparison is their existing voice versus an explicit catalog voice with TalkHint retaining generation, context, permissions and tools—not a separate ElevenLabs business agent.

**How to apply:** Reuse the common Engine through an adapter, do not rewrite it. Use the shared persistent reports repository, not another store. Do not call an in-memory action or “I will pass it on” a saved result. If the required common integration is unavailable, report the dependency and stop rather than shipping a falsely ready stand. Keep live headphone/iPhone quality and interruption claims unconfirmed until actually heard.

For the ElevenLabs catalog comparison, the owner specified a female American-accent voice capable of Russian and language switching.

**Why:** This is the owner's explicit comparison requirement, superseding the earlier male catalog candidate.

**How to apply:** Keep clone/catalog choices explicit and verify live multilingual speech rather than inferring it from the voice's English label.

The owner subsequently confirmed that ElevenLabs + Engine works with a normal, clearly audible voice, but reported substantially longer waits and a less lively conversation than Retell + Engine.

**Why:** This is live user confirmation of audibility after startup fixes, not a measured recognition, interruption or latency comparison.

**How to apply:** Treat basic live audibility as user-confirmed; investigate response timing by stage and keep Retell as the user's responsiveness reference. Do not silently downgrade the common Engine to improve a voice-provider comparison.

ElevenLabs Custom LLM configuration needs an OpenAI base URL: the provider itself appends `/chat/completions`. A successful audio metadata handshake does not prove that the provider can reach our Engine or produce speech.

**Why:** Supplying the full endpoint produced a doubled callback path and `Brain returned no response`; a metadata-only probe missed it while the owner's conversation stayed silent.

**How to apply:** Verify the actual provider-initiated HTTP callback through the public Dev domain and receipt of synthesized audio, separately from microphone capture, audible playback and recognition. Do not declare the stand functional from agent creation or connection metadata alone.

An existing Instant Voice Clone can be ready for TTS and accessible via Voices API but still be prohibited with ElevenLabs Agents Custom LLM.

**Why:** Actual agent creation rejected the owner's saved IVC while the catalog voice accepted exactly the same Custom LLM configuration. This was provider eligibility, not an invalid key or a missing clone.

**How to apply:** Preserve that clone, show the provider restriction, and never bypass it by silently selecting a managed LLM/catalog voice or making a new clone. Ordinary TTS plus another speech transport would be a separately approved architecture.

Official ElevenLabs JS SDK appends `source` and `version` to a supplied signed URL, including a same-origin proxy URL. A blanket rejection of WebSocket query parameters breaks startup before ElevenLabs is contacted.

**Why:** Agent configuration and text probes passed, but real browser startup failed because the upgrade gate rejected the installed SDK's own URL.

**How to apply:** Allow only validated SDK metadata while preserving capability, Dev-only and one-session admission checks. Verify the installed SDK through the actual HTTP upgrade/proxy to provider conversation metadata; agent creation alone is not a speech-connection test.
