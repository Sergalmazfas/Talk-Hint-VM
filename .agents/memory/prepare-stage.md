---
name: PREPARE stage (pre-call voice goal prep)
description: Web pre-call preparation chat — provider policy, state model, and UI gotchas
---

# PREPARE stage (web)

- **One brain, no fallback:** PREPARE uses OpenAI `gpt-5.6-sol` via `/v1/responses` (needs `max_output_tokens`, output parsed from `output[].content[].output_text`). On failure show an honest Russian error — never substitute another model. **Why:** owner's fixed provider policy v1.
- Voice input = complete utterance → OpenAI `gpt-4o-transcribe` (batch `/v1/audio/transcriptions`). Deepgram stays live-call/training only.
- Per-user conversation state is serialized (promise queue) with an epoch bumped on reset; commits are atomic post-success. **Why:** double-send/two tabs interleaved history and a reset could be repopulated by an in-flight reply.
- Goal activates ONLY via `prepare_confirm_goal` → existing `setUserGoal`/`goal_set`. UI must NOT `setGoalActive` on pre-call user messages in live mode (`addMessage('honor')` used to do this — now gated by `isPrepareContext()`).
- The single `#micBtn` is dual-mode: hold-to-talk in training, tap-toggle in PREPARE context (live mode, no call, no training). **How to apply:** any mic changes must keep both paths.
- Remember: after editing `talkhint/ui/*`, copy into `dist/talkhint/ui/` for dev preview (build script copies on publish).
