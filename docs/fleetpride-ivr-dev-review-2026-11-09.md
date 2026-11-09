# FleetPride IVR — Dev review for Clavdiy

## Boundary

Owner-approved fix in Dev only. No Publish, production mutations, Retell agent
updates, real telephone calls or paid rehearsals. No model, voice, ordinary
conversation, greeting, voicemail policy or call-duration configuration changes.
No schema migration.

The code delta is relative to Dev base
`28015c01d068fa068945960edf3e3a5a8f729cd7`.
The diagnosed production calls recorded an earlier deployed source version;
this package is not a claim that Dev is already serving production.

## Confirmed cause

The recorded FleetPride menu is:

> Thank you for calling Fleet Pride. For parts, press one. For service, press two.

Previously the parser could extract both options but the selector had no parts
intent. After automatic selection returned empty, the opening gate returned
silence instead of allowing the model to select a navigation tool. The no-human
watchdog then ended both calls, with no model generation.

Offline end-to-end replay found an additional blocker: C's conversational
response buffer denied DTMF while a silent IVR response intentionally bypassed
that buffer. Testing only the selector would not have found it.

## Changes

1. **Selection (`ivrSelection.ts`).** Match the authorized plan goal against
   heard labels using informative-word overlap and department synonyms:
   parts, tires, service, sales, billing, dispatch, parking and roadside.
   Arbitrary labels such as warranty claims are supported by overlap, not a
   closed department enum. Ties go to model interpretation. For structured
   plans, incidental facts and prohibitions do not choose the department.
   Existing manager/operator/repeat choices remain available.
2. **Model handoff (`conversationEngine.ts`, `ivrPhone.ts`, `ivr.ts`).**
   Only a current, actionable, complete, non-sensitive menu can enter tool-only
   model selection. Model text is not spoken over the recording. Valid digits
   must quote the current menu. No usable choice, exhausted tool selection,
   unavailable model or advisory-help dead end falls back to the operator/0.
   The special unlisted-0 exception is restricted to that server fallback.
3. **Transport (`retellEngine.ts`).** A silent IVR response may send DTMF
   despite an idle conversation buffer only when response ID, abort signal and
   current generation match. Ordinary buffered and stale responses cannot use
   this exception. DTMF is sent as `digit_to_press` on the existing Retell
   connection; no new transport or Twilio redirect.
4. **Watchdog (`phoneLineGuard.ts`).** The no-human countdown is suspended
   after a recognizable menu, before the first actual DTMF dispatch.
   After dispatch, the existing 20-second progress guard applies; repetition of
   the same dispatched menu does not extend it indefinitely. The existing
   overall telephone limit remains; no new 180-second live-call limit.
   Ordinary recordings, ringing, human answers and voicemail retain their rules.
5. **Evidence (`secretaryReview.ts`, `secretaryAutomation.ts`).**
   Both reviewers receive bounded, redacted `ivrNavigation` from the same
   call-metadata snapshot: digit, menu, timestamps, source-turn anchor and result.
   The report includes the audit independently of model wording. An empty audit
   is explicit, not a fabricated successful press. Large audits identify
   omitted rows. Dispatch-pending, command-sent and destination acceptance
   remain different states. Original Retell turn indexes are not presented as
   indexes into the redacted review excerpt.

## Offline acceptance

- FleetPride + parts goal -> actual Retell response frame with digit `1`,
  matching `response_id`, empty audible text, no model call.
- Check both C-reserve and streaming-v1.
- All six requested departments, Russian objectives, arbitrary menu labels,
  structured goal vs prohibitions, ambiguity.
- Tool-only model choice, model unavailable, no useful tool, operator/0.
- Sensitive menu, unfinished menu, stale quote, aborted signal, duplicate send,
  write-ahead audit and no claim of destination acceptance.
- Repeated menu before first press cannot trigger no-human timeout; same-menu
  repetition after the first press cannot reset the timer forever.
- Existing Pilot 208, Flying J, R&D and Anytime real-transcript regressions.
- Shared call evidence and PII redaction.

Final gate results and complete file coverage are in the archive's
`verification-summary.json`, shard JSON reports/logs and `test-files.txt`.
Skipped opt-in tests are not counted as passed.

## Remaining verification boundary

This is offline replay with fake transport/model and real production menu text.
It proves command construction and guards, not audible PSTN tones, destination
acceptance or successful connection to FleetPride. No new real call was placed.
After Clavdiy review, Publish belongs to the owner. Any live control call also
requires the owner's decision. Existing reports/history are not rewritten.

## Review / rollback

Inspect `changes.patch` and the files under `source/`. Use
`git apply --check changes.patch` against the intended base before applying.
All source changes are retained in the archive with hashes.
To undo only this package, use its reverse patch after
`git apply --reverse --check changes.patch`, or select the appropriate Replit
checkpoint. Do not reset unrelated work.

Two proposed lessons are included in `proposed-lessons.json`.
**They have not been appended to production employee books.** After the
owner's Publish, any append requires a fresh tool list, fresh book read,
revision/hash/UUID checks, append-only proposed status and readback.
