---
name: Tutor page WKWebView caching
description: Why the /tutor page must be no-store and how client diagnostics reach server logs
---
**Rule:** GET /tutor must always send `Cache-Control: no-store` and the iOS TutorViewController must load it with `.reloadIgnoringLocalAndRemoteCacheData`.

**Why:** August 2026 incident — 5 deploys "didn't fix" a dead tutor because WKWebView heuristically cached the page (no Cache-Control + ETag) and phones kept running week-old JS. Symptoms: page unresponsive, tutor picker "doesn't change", zero server-side evidence.

**How to apply:** any new server-rendered page loaded by the iOS app needs explicit no-store; never rely on ETag revalidation in WKWebView.

**Diagnostics:** the tutor page sends lifecycle beacons to POST /api/tutor/diag (`[TutorDiag]` in prod logs): session_created → ws_open_auth_sent → session_ready → tutor_first_text, plus ws_close/ws_error/mic_failed/audio_play_failed/engine_error. Beacons MUST use the page's Bearer auth (authReady + AUTH) — the page is loaded without cookies, so `credentials:"include"` alone silently 401s. Server sanitizes detail to one printable line (log-forging guard) and sweeps the rate-limit map.
