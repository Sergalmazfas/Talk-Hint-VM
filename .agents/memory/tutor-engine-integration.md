---
name: Tutor Engine (Emma) integration
description: TalkHint as API client of external AI Tutor Engine — auth, Call Memory lifecycle, gotchas
---

- TalkHint is a pure CLIENT of the external Tutor Engine (`https://ai-tutor-engine.replit.app`, override via TUTOR_ENGINE_BASE). No STT/LLM/TTS/teaching logic on our side. Key: TUTOR_ENGINE_API_KEY (falls back to legacy `API_KEY` secret with a startup warning); key never leaves the backend — client gets only session_id + short-lived realtime token + asset URLs.
- **Engine gotcha:** the engine's prod URL serves its old SPA (HTML) for unknown paths. `engineFetch` detects HTML bodies and reports "engine needs Republish" — if smoke checks (`GET /api/tutor/smoke`) fail with that, the fix is on the ENGINE side (owner must republish it), not ours.
- Call Memory lifecycle (enforced in `tutorStorage.ts`, guarded by tests): MEMORY_CONFIRMATION → (explicit user confirm only) REAL_CALL_READY → (atomic claim at real-call start) COMPLETED. **Why:** unconfirmed practice output must never steer a real call; rows are never deleted (history preserved).
- **How to apply:** injection uses `claimActiveCallMemory` — the SAME conditional update selects + consumes (used_at, call SID), so concurrent calls can't share a memory and crashes can't resurrect one. Never split into load-then-mark.
- `/end` must verify session ownership (`getTutorSessionRow`) and is idempotent via unique (user_id, engine_session_id) index — prevents IDOR on engine session ids and duplicate memories.
- WKWebView auth: session token must NOT go in the page URL (history/log leakage). Page sends `needAuth` bridge message; native injects via `window.__setAuth()`. Browser testing fallback: URL FRAGMENT `#auth=` (never sent to server).
- Prompt injection: TUTOR_MEMORY is a context provider in `contactMemory.ts` after STATIC_CARDS; uncertain facts are rendered with an explicit "never assert" instruction.

## Verified production contract (2026-08-10)
- REST namespace is `/api/v1/...` (NOT `/v1` — those paths return the SPA HTML).
- Tenancy from API key only; sending application_id/organization_id → 400. TUTOR_ENGINE_APP_ID is stored reference only.
- Session create needs `user_id` (`user_ref` rejected), plus scenario_id/tutor_id/mode/target_language/native_language.
- Completion endpoint: POST `/sessions/:id/complete`. Call Memory: POST `/sessions/:id/call-memory` starts generation (GET never triggers; 404 CALL_MEMORY_NOT_GENERATED until started; 409 NO_COMPLETED_TURNS if practice had no finished turns). GET returns status pending/ready/failed with `latest.content` items as `{id,text,status,provenance}` objects; dates_times is an extra category.
- Realtime WS `tutor-realtime/1.0`: token goes in FIRST message `{type:"auth",token,session_id}` (never URL query — query connect gets 4401 "auth timeout"). Flow: session.ready → turn.start → repeat (`audio.chunk` JSON descriptor immediately followed by binary pcm16@24k frame) → `audio.end` closes the turn (there is NO turn.end/turn.commit). Server replies speech.partial/final, transcript.*, tutor.text.delta, `tutor.audio.chunk` (mp3 descriptor+binary), turn.completed.
