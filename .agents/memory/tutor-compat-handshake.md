---
name: Tutor Engine runtime compatibility handshake
description: Fail-closed pre-session contract check against /v1/capabilities — where it lives and its strictness rules.
---
Every tutor session create runs a cached compatibility handshake inside `createTutorSession` (shared boundary — smoke checks and future callers included), pinning contract major 1 + tutor-realtime/1.0 from GET /api/v1/capabilities.

**Why:** review rejected fail-open variants twice — missing/malformed discovery metadata, a capabilities outage, and any direct session caller bypassing the check are all treated as "unverifiable → refuse the lesson" (503 tutor_incompatible / 502 connection), never silent proceed.

**How to apply:** never add a session-creation path that skips `ensureEngineCompatible`; compatible verdicts cache 5 min, incompatible 60 s, fetch failures are never cached.
