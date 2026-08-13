Tutor Engine — Public Contract v1

**Status:** CANONICAL. This is THE single human-readable source of truth for the
public Tutor Engine contract (REST + realtime). The machine-readable mirror is
`src/api/v1/contract-registry.ts` — this document is checked against it by
contract tests (`tests/contract-discovery.test.ts`, `tests/contract-fixtures.test.ts`);
if they disagree, the registry + tests win and this document must be fixed.

- Contract: `tutor-engine` **1.0.0** (major 1)
- Engine: `tutor-engine/0.9.0`
- Realtime protocol: `tutor-realtime/1.0`

Consumers (TalkHint task 160 and future clients) MUST treat this contract as
the only source of truth. Anything not documented here or in the registry is an
internal implementation detail and may change without notice.

---

## 1. Compatibility rule (binding)

The Engine MAY, without warning, in any release:
- add new server→client events;
- add new OPTIONAL fields to existing events and REST responses;
- add new REST endpoints and new capability flags.

Clients MUST ignore unknown events and unknown fields.

The Engine MUST NOT, without a MAJOR contract version bump and an explicit
migration window:
- remove or rename a canonical event or REST endpoint;
- remove a required field, change its type, or change the semantics of a
  stable event;
- demote a required server-emitted field to optional (readers lose the
  guarantee);
- add or promote a REQUIRED field on a client→server message (old clients
  never sent it).

Version metadata: `GET /v1/capabilities` (unauthenticated) is the
**authoritative pre-session compatibility handshake** — it returns
`engine_version`, `contract {name, version, major, hash}` and
`realtime {protocol, version, protocol_version}`. The `session.ready` echo of
`engine_version`/`contract_version` is secondary verification only.

Legacy aliases: the Engine emits **none** today. If a migration window is ever
needed, an alias will be listed here explicitly marked
`LEGACY / COMPATIBILITY ONLY` with a removal deadline.

## 2. `tutor.hint` vs `tutor.suggested_reply` — do not confuse them

The 2026-08-13 incident (a client treating a renamed hint event as canonical)
is why this section exists. These are TWO DISTINCT stable events:

| | `tutor.hint` | `tutor.suggested_reply` |
|---|---|---|
| Semantics | **Teaching hint** from the lesson pipeline (practice/teaching modes): guidance ABOUT the learner's language | **Suggested USER reply** (Tutor LIVE / simulation): the literal next phrase the STUDENT may say |
| Payload | `hint: string`, `mode: string` | `text: string`, `translation: string\|null`, `carryover: boolean` |
| Spoken by tutor? | never | never (never reaches TTS) |
| Emission | when structured output contains `hint` | engine-initiated, deterministic hint policy (cooldown/dedup/stale) |

Neither is an alias of the other. Clients render them differently.

## 3. REST surface

Base path: `/api/v1`. Auth: `Authorization: Bearer <application_api_key>` on
every endpoint except `GET /v1/capabilities`. Tenancy comes ONLY from the key —
`organization_id`/`application_id` in a request body are rejected (400).
Errors: `{ "error": { "code": string, "message": string, "retriable": boolean } }`.

Canonical endpoint list (removal/incompatible change of any = MAJOR):

| Endpoint | Purpose / detailed doc |
|---|---|
| `GET /v1/capabilities` | discovery + compatibility handshake (unauthenticated) |
| `GET /v1/test-connection` | key smoke test |
| `GET /v1/tutors` | tutor persona catalog, manifest v2 — `universal-tutor-api-v1.md` |
| `POST /v1/sessions` | create session: `mode` ∈ `practice` \| `teacher` \| `assisted` \| `simulation` \| `exam` (`simulation` requires the goal/roles/context block — `simulation-session-contract-v1.md`); optional `tutor_id`; returns `session_id`, `realtime {connection_url, token}`, `capabilities`, frozen `version_snapshot`, echo `simulation` block |
| `GET /v1/sessions/:id` | session state |
| `GET /v1/sessions/:id/turns` | completed turn list |
| `POST /v1/sessions/:id/complete` | end session; triggers Session Result + (declared) Call Memory |
| `POST /v1/sessions/:id/realtime-token` | fresh single-use realtime token (reconnect) |
| `GET /v1/sessions/:id/result` | universal Session Result — `universal-tutor-api-v1.md` |
| `GET /v1/sessions/:id/summary` | summary view over the same result |
| `GET/POST /v1/sessions/:id/call-memory` | call-memory discovery / explicit retry |
| `GET /v1/users/:userId/memory` | persistent student memory |
| `GET /v1/users/:userId/learning-profile` | deterministic learning profile |
| `GET/PUT /v1/users/:userId/context` | learner context |
| `GET /v1/users/:userId/scenario-progress`, `POST …/events` | managed learner progress |
| `GET /v1/call-memories/:groupId`, `…/confirmed` | call-memory versions / confirmed view |
| `POST /v1/call-memories/:groupId/corrections`, `…/confirm`, `…/handoff` | confirmation flow / handoff |
| `GET /v1/handoffs/:id`, `POST /v1/handoffs/:id/consume` | handoff consumption |

Session-creation error codes clients must handle: `SCENARIO_NOT_FOUND` (404),
`TUTOR_NOT_ALLOWED` / `LANGUAGE_NOT_SUPPORTED_BY_TUTOR` / `CALL_MEMORY_DISABLED`
(403), `SIMULATION_REQUIRED` / `SIMULATION_NOT_ALLOWED_FOR_MODE` /
`SIMULATION_INVALID` (422), `CALL_MEMORY_NOT_FOUND` (404),
`CALL_MEMORY_NOT_CONFIRMED` (409). `POST /sessions` is non-idempotent: never
auto-retry.

## 4. Realtime protocol (`tutor-realtime/1.0`)

Transport: WebSocket at the `realtime.connection_url` from session creation
(`/api/v1/realtime`). Handshake: connect WITHOUT a token in the URL; send
`{"type":"auth","token":…}` as the FIRST message (single-use, session-bound;
5s auth timeout → close 4401).

Framing: text frames are JSON envelopes; every binary frame is PRECEDED by its
JSON descriptor (`audio.chunk` up, `tutor.audio.chunk` down). Envelope fields
on EVERY server frame: `type: string`, `session_id: string|null`,
`seq: number` (monotonic per direction).

### 4.1 Server → client events (all `stable`)

Field notation: `name: type` — required unless marked *(opt)*.

| Event | Fields (beyond envelope) | Semantics |
|---|---|---|
| `session.ready` | `protocol_version: string`, `scenario_id: string`, `scenario_version: string`, `version_snapshot: object`, `teaching_state: object`, *(opt)* `engine_version: string`, *(opt)* `contract_version: string` | first event after auth; echoes the frozen session snapshot; version echo is secondary verification only |
| `turn.started` | `turn_id: string`, *(opt)* `opening: boolean` | turn began; `opening:true` = tutor-first opening turn (simulation): expect a full tutor stream with NO user transcript; PTT during it → `error OPENING_IN_PROGRESS` |
| `turn.state` | `turn_id: string\|null`, `state: string` | pipeline state machine (observability; keep out of PTT logic) |
| `speech.started` | `turn_id`, `at_ms: number` | VAD: user speech detected |
| `speech.partial` | `turn_id`, `text: string`, `at_ms: number` | streaming STT partial |
| `speech.final` | `turn_id`, `text: string`, `at_ms: number` | STT final |
| `transcript.raw` | `turn_id`, `text: string` | raw transcript of the user turn |
| `transcript.normalized` | `turn_id`, `text: string`, `normalizations: array`, `scenario_dictionary_version: string` | term-normalized transcript (authoritative user text) |
| `tutor.text.delta` | `turn_id`, `delta: string` | streaming tutor reply text |
| `tutor.text.final` | `turn_id`, `text: string` | full tutor reply |
| `avatar.lipsync` | `turn_id`, `chunk_seq: number`, `timeline: object` | renderer-agnostic lip-sync timing; ALWAYS precedes its audio chunk |
| `tutor.audio.chunk` | `turn_id`, `chunk_seq: number`, `subtitle: string`, `format: string` (`"mp3"`) | audio descriptor; the NEXT binary frame is the audio payload |
| `tutor.correction` | `turn_id`, `correction: object` (`user_said`, `better`, `explanation`, `translation: string\|null`, `category`), `mode: string` | teaching correction of the learner's utterance |
| `tutor.hint` | `turn_id`, `hint: string`, `mode: string` | teaching hint — see §2 |
| `tutor.suggested_reply` | `turn_id`, `text: string`, `translation: string\|null`, `carryover: boolean` | suggested USER reply — see §2 |
| `teaching.mode_changed` | `from: string`, `to: string`, `command: string` | voice-command mode switch |
| `teaching.preference_changed` | `preference: string`, `value: string`, `command: string` | voice-command preference change |
| `turn.completed` | `turn_id`, `cancelled: boolean`, `latency: object`, `total_perceived_latency_ms: number\|null`, `usage: object`, `cost_estimate: object`, `errors: array` | end of turn (also for cancelled turns) |
| `error` | `code: string`, `retriable: boolean`, *(opt)* `turn_id: string\|null`, *(opt)* `message: string` | codes: `OPENING_IN_PROGRESS` (retriable — wait for opening `turn.completed`), `TURN_FAILED` (retriable), `BAD_MESSAGE`, `UNKNOWN_TYPE` |
| `session.ended` | — | confirmation of `session.end`; socket closes 1000 |

`turn_id` is `string|null` on turn-scoped events (null only in degenerate
error paths); treat null as "no active turn".

### 4.2 Client → server messages (all `stable`)

| Message | Fields | Semantics |
|---|---|---|
| `auth` | `token: string` | MUST be first; anything else pre-auth → close 4401 |
| `turn.start` | — | begin PTT turn |
| `audio.chunk` | *(opt)* `mimeType: string` | descriptor; NEXT frame must be the binary audio (violations → close 4400) |
| `audio.end` | *(opt)* `audioDurationMs: number` | end of user speech |
| `playback.started` | `clientPlaybackAtMs: number`, `clientSpeechEndAtMs: number` | client-side latency telemetry |
| `turn.cancel` | — | cancel the in-flight turn |
| `session.end` | — | end session → `session.ended`, close 1000 |

### 4.3 WebSocket close codes

| Code | Condition |
|---|---|
| `4401` | auth timeout (5s), invalid/expired token, or ANY pre-auth violation: non-auth message, binary frame, or malformed JSON before successful auth |
| `4400` | framing violation after auth: binary frame without a preceding `audio.chunk` descriptor, descriptor not followed by binary, `audio.chunk` without `turn.start` |
| `1000` | normal close after `session.ended` |

Malformed JSON AFTER auth does not close the socket: the Engine replies
`error { code: "BAD_MESSAGE", retriable: false }` and keeps the connection.

## 5. Enforcement (how this contract cannot silently drift)

1. **Typed emission**: `realtime.ts` `send()` accepts only
   `type: ServerEventName` (a literal union derived from the registry) —
   renaming an event "past the registry" does not compile.
2. **Runtime frame validation**: the realtime layer validates EVERY emitted
   frame against the registry (`validateServerFrame`) — a violating frame is a
   thrown error in dev/test (any realtime test fails loudly) and a logged bug
   in production.
3. **Both-ways tests**: every emitted `type:"…"` must be declared in the
   registry and every registered REST route must exist in the router (and vice
   versa); a live WS integration test replays a full simulation opening turn
   and validates every received frame; frozen serialized fixtures are
   validated field-by-field against the registry with structured
   MISSING / TYPE MISMATCH output; adding optional fields does NOT fail them;
   the documented session-mode list is compile-bound to the domain type and
   test-checked against this document.
3. **Deterministic hash**: `contract.hash` in discovery changes iff the wire
   contract changes (docs stripped, keys sorted).

## 6. Pre-publish procedure (MANDATORY before every Engine deploy)

1. Run the full suite — contract tests included:
   `pnpm --filter @workspace/api-server exec vitest run`.
2. If any public API/realtime change was made: classify PATCH/MINOR/MAJOR per
   §1, bump `CONTRACT_VERSION` in `contract-registry.ts`, update this document
   and add a changelog entry below (same commit).
3. MAJOR changes: STOP — a new contract major requires explicit consumer
   migration; never deploy silently.
4. Full procedure and agent obligations: `replit.md` → "MANDATORY: Public
   contract change protocol".

## 7. Changelog

| Date | Contract | Change |
|---|---|---|
| 2026-08-13 | 1.0.0 | Initial canonical contract: current REST + `tutor-realtime/1.0` state frozen as v1. Explicitly documents `tutor.hint` ≠ `tutor.suggested_reply` (post-incident). No legacy aliases emitted. Discovery handshake via `GET /v1/capabilities` (Task #16). |
