# Goal-Driven Simulation integration — TalkHint status report

Date: 2026-08-13. Response to the Engine's task "Integrate Goal-Driven
Simulation Sessions (Engine contract v1)".

## What is implemented in TalkHint (all shipped, 584 tests green)

1. **Session create path** (`server/tutorEngine.ts`, `server/tutorSimulation.ts`,
   `server/tutorRoutes.ts`):
   - `mode:"simulation"` + `simulation` block exactly per contract §1
     (`language:{target,native}` object; roles; context `none` /
     `call_memory` by reference only). Practice payload is byte-identical to
     before and can never carry a `simulation` field (unit-tested).
   - Full fail-closed error matrix: `SIMULATION_NOT_ALLOWED_FOR_MODE`,
     `SIMULATION_REQUIRED`, `SIMULATION_INVALID`, `CALL_MEMORY_DISABLED`
     (also via the 403 path), `CALL_MEMORY_NOT_FOUND`,
     `CALL_MEMORY_NOT_CONFIRMED` — each maps to an explicit user-facing
     error. There is NO fallback to practice and NO auto-retry of the
     non-idempotent POST /sessions.
   - Additional guard: if the 201 response carries no `simulation` echo, the
     session is refused (completed immediately) and the user sees an explicit
     error — again, no silent free-talk session (see "Live verification").
2. **Goal/roles input**: `/tutor` now opens with a start chooser (free
   practice — default — vs call simulation). The simulation form takes the
   literal goal text (≤500), Emma's role (≤120) and the user's role (default
   "caller"). No keywords/slots/goalAchieved internals are ever sent.
3. **Call Memory wiring**: confirmed memories (REAL_CALL_READY) that carry an
   engine-side reference are offered as context; the reference
   (`call_memory_group_id` + `version`) is now captured from the engine's
   call-memory GET response and persisted (`tutor_call_memories.engine_group_id`,
   `engine_version`). Memories saved before this change have no reference and
   are refused explicitly (never inlined). The echoed `items_injected` counts
   are shown to the user as a labelled local card.
4. **Opening turn (§3)**: the client consumes `turn.started` (`opening:true`)
   via the shared classifier, gates the mic until the opening `turn.completed`
   (label «Emma начинает разговор…»), tolerates a turn it did not initiate
   (text deltas now create the streaming bubble), renders the opening hint
   card (translation included — `tutor.hint.translation` was already
   rendered since task 154), and treats `OPENING_IN_PROGRESS` as benign and
   retriable (toast, no error state). `turn.started` never drives the PTT
   machine.
5. **Tests**: `server/__tests__/tutorSimulation.test.ts` (18 tests: payload
   shapes, 422×3 + 403/404/409 matrix, no-silent-fallback, opening-turn
   fixture behavior) + 3 new classifier tests. Full suite: 49 files / 584
   tests pass.

## Live verification against the Engine (2026-08-13, ~05:15 UTC)

Probe: real `createTutorSession` with `mode:"simulation"`,
`simulation:{goal, roles:{learner:"caller", tutor:"clinic receptionist"},
context:{source:"none"}}` against `TUTOR_ENGINE_BASE`
(ai-tutor-engine.replit.app), then WS auth and a 60 s listen window.

Result — **contract v1 is NOT live at this base URL yet**:
- `+2.14s` — `201` session created (`79a59da6-…`), but the response carried
  **no `simulation` echo** (contract §1 says the echo must be verified).
- `+2.24s` — `session.ready` (tutor-realtime/1.0, scenario v2) and then
  **no engine-initiated opening turn** for 60 s (no `turn.started`, no
  deltas, no hint).
- The old silently-ignore behavior is still in place — the promised hard
  `422 SIMULATION_NOT_ALLOWED_FOR_MODE` semantics are absent too.
- Probe session was completed and cleaned up.

TalkHint's echo guard handles exactly this case: the user gets an explicit
«Движок не подтвердил параметры симуляции» error instead of a silent
free-talk session. **Action needed on the Engine side: publish contract v1 to
the deployment TalkHint points at** (or tell us the dev base URL to point a
verification run at). We will re-run the live evidence (source:"none" and,
once a referenced memory exists, source:"call_memory") as soon as it is live.

## Open questions for the Engine (also in docs/tutor-goal-contract-open-question.md)

1. **Where does TalkHint get `call_memory_group_id` + `version`?** The
   contract says "the group id you already have from the memory flow", but
   the documented `GET /api/v1/sessions/:id/call-memory` response we consume
   has never included a group id or version. We now opportunistically capture
   `group_id`/`call_memory_group_id`/`latest.group_id` and
   `latest.version`/`version` if present — please confirm the exact field
   names and that they appear in the ready response.
2. **What makes a version "confirmed (ready_for_real_call)" on the ENGINE
   side?** TalkHint's confirmation flow is local (user review → our DB);
   TalkHint never calls any engine confirm endpoint. If the engine requires
   its own confirmation state, every `source:"call_memory"` create will 409
   `CALL_MEMORY_NOT_CONFIRMED`. Is there a confirm endpoint we must call, or
   does the engine treat the latest generated version as confirmed?

Per contract §5, we did not work around either question.
