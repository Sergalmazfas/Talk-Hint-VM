---
name: Tutor Engine realtime protocol facts
description: Verified tutor-realtime/1.0 event catalog, session modes, and ignored fields of the external AI Tutor Engine (never modify the Engine).
---

Verified live (probe sessions, Aug 2026), external engine ai-tutor-engine.replit.app:

- Session modes accepted: `practice, teacher, assisted, simulation, exam` (roleplay rejected). Extra session-create fields `goal/objective/hints/context` are **silently ignored** — no error, no effect. Only known scenario: `english_free_talk` v2; no scenario-list endpoint.
- No WS command exists to request a hint (all candidates → UNKNOWN_TYPE); hints arrive automatically, engine-initiated (a suggested USER reply — must never be TTS'd or treated as user speech). The engine RENAMED the event `tutor.hint` → `tutor.suggested_reply` (payload `{text, translation, turn_id, carryover}`), verified live 2026-08-13; classifier accepts both. Event names can drift silently — when a rendered feature "stops working", probe the live event stream before touching UI code.
- Event catalog beyond the PTT basics: `tutor.hint {hint}`, `tutor.correction {correction:{user_said,better,explanation,translation,category}}`, `tutor.text.final {text}` (authoritative, arrives AFTER turn.state TURN_COMPLETE but BEFORE turn.completed), `turn.state` (LISTENING/TRANSCRIBING/THINKING/SPEAKING/TURN_COMPLETE), `transcript.raw` / `transcript.normalized` (has turn_id), `avatar.lipsync`, `speech.started`, `turn.started`.
- Client integration lives in `server/tutorRealtimeUi.ts` (pure classifier shared with the page via toString interpolation, like pttNext).

**Why:** open Goal-contract question documented in `docs/tutor-goal-contract-open-question.md` — do not invent engine commands or add local LLM hint generation; render only what the engine sends.
**How to apply:** any /tutor client work consuming engine events must go through the classifier + these verified shapes; text-only turns (final text without audio) are possible and must still render.
