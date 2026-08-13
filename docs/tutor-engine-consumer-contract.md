# Tutor Engine — consumer contract (TalkHint)

> **ARCHITECTURE RULE.** The **published Tutor Engine public contract is the
> single source of truth**. This document is a *consumer copy*: it records
> what TalkHint actually consumes and the shapes TalkHint depends on, so that
> compatibility tests can catch breaking changes. It must never diverge from
> the Engine's published contract — when the Engine contract changes, this
> file and the fixtures are updated **from** it, not the other way around.
> TalkHint contains no Tutor business logic (no Lesson Agent, GoalTracker,
> hints/corrections logic, memory logic, Scenario Packages, provider or
> avatar logic) — protocol only.

- Engine base: `TUTOR_ENGINE_BASE` (default `https://ai-tutor-engine.replit.app`)
- REST namespace: `/api/v1`; auth: `Authorization: Bearer <TUTOR_ENGINE_API_KEY>`
- Tenancy comes from the API key ONLY — `application_id` / `organization_id`
  are rejected by the Engine and must never be sent.
- Realtime protocol: `tutor-realtime/1.0` over WebSocket; auth via the FIRST
  WS message `{type:"auth", token, session_id}` (token never travels in URLs).
- Contract snapshot verified live: **2026-08-13** (production Engine).

## Compatibility rules

- The Engine may **ADD** optional fields and new event types at any time —
  TalkHint must tolerate them (unknown events are ignored, unknown fields
  are not read).
- **Removing or renaming** an endpoint/event, or changing the **type or
  semantics of a required field**, is a **breaking contract change** — the
  compatibility tests must fail.
- **Canonical vs legacy names.** Every public event has exactly ONE canonical
  name from the Engine contract. A legacy alias may be accepted by the client
  during a migration window, but it is marked **LEGACY / COMPATIBILITY ONLY**
  and does NOT satisfy the canonical contract test (see "No silent alias
  success" in `scripts/tutor-engine-contract-probe.ts`).

## REST endpoints consumed by TalkHint

### GET /api/v1/capabilities
Response object (fields TalkHint reads): `realtime_audio: boolean`,
`avatar: boolean`, `code_switching: string[]` (must include `"ru-en"`),
`call_memory: boolean`.

### GET /api/v1/tutors
Tutor catalog — the DYNAMIC allow-list source of truth for tutor
availability (ids are never hardcoded client-side). Response: array (or
`{tutors: [...]}`); each entry TalkHint reads:

| field | type | required | notes |
|---|---|---|---|
| `tutor_id` | string | yes | e.g. `emma_us_01` |
| `display_name` (or `name`) | string | yes | shown to the user |
| `description` | string | no | |
| `preview_url` / `avatar.preview_url` | string | no | absolute or `/`-relative to base |
| `avatar.glb_url` / `glb_url` | string | yes | 3D model |
| `avatar.body` | string | no | e.g. `"F"` |
| `asset_version` / `avatar.asset_version` | string\|number | yes | drives client GLB cache keys |

### POST /api/v1/sessions  (non-idempotent — NEVER auto-retried)
**practice** payload: `{user_id, scenario_id, tutor_id, mode:"practice",
target_language:"en", native_language:"ru"}` — must NEVER carry a
`simulation` field.

**simulation** payload (Goal-Driven Simulation contract v1):
`{user_id, scenario_id, tutor_id, mode:"simulation",
language:{target:"en", native:"ru"},
simulation:{goal, roles:{learner, tutor},
context: {source:"none"} | {source:"call_memory", call_memory_group_id, version}}}`.
Context goes **by reference only** — never inline facts.

**201 response** (both modes): `session_id: string`,
`realtime: {connection_url: string, token: string}`. For simulation the
response MUST also **echo** the `simulation` block (goal, roles, context;
optionally `items_injected` counts). A missing/mismatched echo means the
request was not honored — TalkHint refuses the session (fail-closed, no
silent practice fallback).

**Error codes** (fail-closed table, from the response body):
`SIMULATION_NOT_ALLOWED_FOR_MODE`, `SIMULATION_REQUIRED`,
`SIMULATION_INVALID` (422), `CALL_MEMORY_DISABLED` (403),
`CALL_MEMORY_NOT_FOUND` (404), `CALL_MEMORY_NOT_CONFIRMED` (409).

### POST /api/v1/sessions/:id/complete
The only documented session-completion endpoint. Used for cleanup and at
practice end.

### POST /api/v1/sessions/:id/call-memory
Explicitly starts Call Memory generation. `409 NO_COMPLETED_TURNS` = the
practice had no finished turns (surfaced as "no memory", not an error);
409 with `ALREADY|IN_PROGRESS|EXISTS` = generation exists → poll.

### GET /api/v1/sessions/:id/call-memory
Read-only poll. `status: "pending" | "ready" | "failed"`;
`404 CALL_MEMORY_NOT_GENERATED` = not started. When ready: content under
`latest.content` (or `content`) with categories `objective`, `facts`,
`dates_times`, `questions`, `rehearsed_answers`, `vocabulary`,
`uncertain_facts` (items are `{text,...}` objects or plain strings;
`objective` may arrive as a plain string or as an item array — TalkHint
accepts both), plus —
when available — the engine-side reference `group_id` /
`call_memory_group_id` (+ `latest.version`/`version`) needed to seed a
simulation with `source:"call_memory"`.

## Realtime events consumed by TalkHint (tutor-realtime/1.0)

Legend: **R** = required field, O = optional. TalkHint ignores any event type
not listed here (never fatal) and never sends invented commands (there is no
WS command to request a hint).

| canonical event | fields TalkHint reads | consumed | semantics |
|---|---|---|---|
| `session.ready` | — | yes | WS auth accepted; conversation may begin |
| `turn.started` | `opening: boolean` (O, default false) | yes | engine-initiated turn. `opening:true` ONLY for the simulation opening turn — gates the mic; never drives the PTT machine |
| `turn.state` | `state` (R): `LISTENING\|TRANSCRIBING\|THINKING\|SPEAKING\|TURN_COMPLETE` | yes | truthful status label only |
| `speech.started` / `speech.partial` | — | no (ignored) | |
| `speech.final` | `text` (R string), `turn_id` (O string) | yes | user's recognized utterance |
| `transcript.raw` | — | no (ignored) | |
| `transcript.normalized` | `text` (R string), `turn_id` (O string) | yes | terminology-normalized user text; stored as metadata, never rewrites the visible transcript |
| `tutor.text.delta` | `text`/delta chunk (R string) | yes | streaming tutor text |
| `tutor.text.final` | `text` (R string) | yes | authoritative tutor text; arrives after `turn.state: TURN_COMPLETE`, before `turn.completed` |
| `tutor.audio.chunk` | binary follows | yes | tutor speech audio |
| `avatar.lipsync` | viseme payload | yes (avatar only) | lip-sync frames for the 3D avatar |
| **`tutor.suggested_reply`** | `text` (R string), `translation` (R string for ru-en sessions), `turn_id` (O), `carryover` (O boolean), `seq` (O number) | yes | **suggested USER reply (hint)** — rendered as a dismissible card; NEVER TTS'd, never treated as user speech. Engine-initiated; no request command exists |
| `tutor.correction` | `correction` (R object): `user_said`, `better` (R), `explanation`, `translation` (O), `category` | yes | correction card |
| `turn.completed` | — | yes | closes the turn; releases the opening mic gate |
| `error` | `code` (R string) | yes | e.g. `OPENING_IN_PROGRESS` (benign/retriable — client waits for the opening turn to finish) |

### Legacy aliases — COMPATIBILITY ONLY

| legacy name | canonical name | status |
|---|---|---|
| `tutor.hint` (payload `{hint}`) | `tutor.suggested_reply` (payload `{text, translation}`) | LEGACY / COMPATIBILITY ONLY. The client still renders it during the migration window, but it does **not** satisfy the canonical contract test. Renamed by the Engine, verified live 2026-08-13 |

## Verification layers in TalkHint

1. **Offline fixtures** — `server/__tests__/fixtures/tutorEngineContractFixtures.ts`
   (frozen representative payloads) + `server/__tests__/tutorEngineContract.test.ts`
   (required fields, types, classifier routing, tolerance to unknown
   fields/events). Runs in the normal `npm test` suite.
2. **Live contract probe** — `npm run test:tutor-engine-contract`
   (`scripts/tutor-engine-contract-probe.ts`). NOT part of vitest. Creates
   short probe sessions against the real Engine, verifies protocol shapes
   only (never teaching quality or wording), cleans up, and prints a
   structured MISSING / RENAMED-UNEXPECTED / TYPE MISMATCH report.
   **Required manual pre-publish check** for TalkHint (v1: manual run; CI
   scheduling deferred).
