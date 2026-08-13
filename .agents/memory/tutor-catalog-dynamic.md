---
name: Tutor catalog is dynamic (multi-tutor)
description: Tutors (Emma/Fiona/Lucy…) come from the engine catalog at runtime — never hardcode ids; GLB caching and name substitution rules.
---

The engine's `GET /api/v1/tutors` is allow-list driven and the ONLY source of tutor availability. TalkHint proxies it as `/api/tutor/tutors` (normalized, absolute asset URLs) and passes ONLY the chosen `tutor_id` into session create (avatar/voice/persona ids are rejected by the engine).

**Rules:**
- Never hardcode tutor ids anywhere client-side (tests enforce: page must not contain lucy/fiona ids). Default id comes from `TUTOR_ENGINE_TUTOR_ID` env only.
- Chosen `tutorId` must be validated against the live catalog server-side before session create.
- Avatar GLBs are cached in the browser Cache API (`tutor-glb-v1`) keyed `tutor_id + asset_version`, prefetched on selection, old versions evicted, blob URLs revoked after replacement. Never re-download per session; never bake GLBs into the bundle.
- No provider secrets (ElevenLabs etc.) ever land in TalkHint — all providers run engine-side.
- UI strings were written for "Emma"; the page substitutes the live tutor name via a single `tn()` helper + `applyTutorName()` — add new user-facing tutor strings through that path, not with a hardcoded name.
- Avatar-init failure is remembered per tutorKey (`avatarFailedKey`), so choosing another tutor retries cleanly.

**Why:** engine task 2026-08-13 (Lucy) — acceptance requires removing a tutor from the engine allow-list to hide it in TalkHint without a client deploy, and repeat launches to load the GLB with zero network.
