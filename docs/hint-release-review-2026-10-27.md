# Hint — pre-publish review

## Boundaries
Owner publishes server and builds iOS. No publish, real phone call, replay,
autonomous CrewAI run, independent QA acceptance or TestFlight upload was performed
for this fix. One explicitly requested historical Mint baseline mail was sent;
Gmail SENT confirmed. Its denominator of hint need and overall percent are unknown.

## This fix
- Server: opt-in `HINT_ACTION_RESULTS_ENABLED` policy on normal Brain, realtime,
  Ask-refine, Ask-assistant and LIVE chat. Owner-result turns bypass canned library
  answers and Guest-wait ACK suppression. No second model call added.
- Native: measured bilingual labels, English first, scrollable hint surface;
  Prepare opening with manual one-tap hide, no speech inference.
- Telemetry: actual visible text including scrolled choices; separate Prepare
  presentation IDs; owner/call scope, bounded dedup. No audio-path changes.
- Lab: `LAB_START_PAUSED=true` forces the saved control off at startup, including
  on restart. Other boots never re-enable a previously disabled control.
- Mail v3 can show a clearly labelled manual observation per each of eight stages.
  Such observations do not supply a verified denominator or a success percent.

## What the next Publish includes beyond this fix
The full workspace publishes, not the isolated Xcode branch:
1. Product/organisation admin: company/team screens, actions, responsibilities,
   handoffs, competitors, product book/passport chapters and roadmap views.
2. Product Crew MCP and its setup/OAuth/public-dev boundary; project-model routes,
   versioned history, data-size checks, document/export code and research helpers.
3. Hint lab: Python worker packaging, pinned CrewAI, private status/report endpoints,
   source-scope restrictions, queue, independent QA worker, Gmail/outbox and v3 form.
4. Live server: latency/ACK/UI visibility and current action-result policy.
5. Earlier Secretary/ChatGPT patches: approval/final-result widgets, task handling,
   incoming intake-related files, owner-only web authentication changes.
6. Build/dependencies/schema: React Flow and existing additions, worker packaging,
   release gates; three new lab tables and three new history-table columns.
7. iOS source/tests/config files are in the workspace, but Publish does NOT install
   them on the phone. The isolated native handoff contains only relevant native deltas.

The downloadable inventory contains every tracked path changed since the nearest
local commit before the last build started (plus current new source files).
IMPORTANT: the deployment metadata does not expose its source commit SHA; this is
a timestamp-based audit boundary, NOT a proven byte-exact live-build diff.
Scripts being packaged does not mean they execute on startup, nor that Dev product
documents/model records are automatically copied into production.

## Observed database diff (read-only)
Dev adds `call_lab_controls` (7 columns), `call_lab_jobs` (11), `call_lab_outbox` (9)
and three columns on `talkhint_project_model_history`. No production-only column
was found. Final Publish schema review remains mandatory; do not accept destructive
changes or an unrelated rename prompt. No production DDL was run by the agent.

## Startup and after Publish
Prepared run flags: `LAB_ENABLED=true`, `LAB_START_PAUSED=true`,
`LAB_TARGET_ENVIRONMENT=production`, `HINT_ACTION_RESULTS_ENABLED=true`.
The first flag permits the service code, but the persisted owner control is forced
OFF before the polling loop starts: no automatic analysis/mail until explicit activation.
Any restart with the pause flag re-pauses it; a later rollout may change this only
with the owner. Verify `/api/admin/call-lab/status` under the owner's login:
expected `control.enabled=false`. Readiness/activation is not inferred from a green build.
Only after checking readiness and explicit owner confirmation, the owner-only POST
`/api/admin/call-lab/enable` accepts `{"confirm":"hint-owner-only"}`. It checks pinned
Gmail and installed worker version, then sets activation time to now so paused-period
calls are excluded. It was NOT called in this work; no public activation was added.

## STT
No recognition model, owner audio mapping, Twilio routing or phone settings changed.
The historical call has candidatePipeline disabled and no recorded sttEffective.
Bad transcript examples justify investigation; without an audio reference they
do not identify the provider fault, channel fault or WER.
