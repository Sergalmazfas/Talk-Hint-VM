# Mac handoff: ChatGPT plans in Hint Prepare

## Repository and exact code

- Repository: https://github.com/Sergalmazfas/Talk-Hint-VM
- Branch: `xcode-chatgpt-prepare-2026-11-02`
- Code commit: `1052648cfa54da4ba5f6adcaa09d7035aa9a9e50`
- Remote base: `efaaaec857c9a55ebc60b85f5c63756e46e39563`
- Branch HEAD also contains this handoff in a separate documentation commit.
- Native delta only. It does not replace the repository with the Replit Dev tree.
  All eight existing changed native files matched the remote base before this delta.

## Before checkout

Run `git status --short`, record the current branch and HEAD, and inspect local
commits. **Do not use stash, reset, force, rebase, merge, or overwrite another
person's changes.** If there are local modifications, missing objects, or an
untransferred Mac-side fix needed by these sources, stop and report it.

Fetch this exact branch from the existing authorized origin. If a local branch
already exists, do not overwrite it. Use a clean checkout of the remote branch;
verify that the code commit above is its ancestor and that the native changes
relative to the base are only the eleven intended paths. No changes to `main`
or `clean-main`. Do not push Mac fixes without reporting the exact diff.

## What changed

Hint Prepare gets a read-only list of saved ChatGPT call plans. It displays goal,
target number (or next outgoing call), expiry, confirmed facts, things to say/ask,
expected questions/answers, unknowns and disclosure restrictions.

The existing session-authenticated APIClient performs only
`GET /api/prepare/hint-plans`. The backend endpoint is a separate Dev change
awaiting owner Publish; native tests use offline injected transport.

Opening, refreshing or resetting the manual dialog must not dial, activate a
goal, reserve/consume a plan, extend expiry, change prompts or confirm a Secretary
assignment. Secretary Prepare must not display/fetch this Hint section. Expired
plans disappear locally; errors are shown as errors, not an empty list.
Reappearing on screen refreshes from the server, which excludes consumed plans.
The existing manual preparation and confirmation flow is preserved.

## Build and full tests

Use exactly:

```sh
DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer bash ios/scripts/validate-native.sh
```

Run the **entire** `TalkHintTests` target. No `-only-testing`, `-skip-testing`,
renamed targets, disabled tests or weakening `verify-xcresult.py`.
The existing script regenerates XcodeGen sources and verifies source inclusion,
entitlements and xcresult. New Swift files must be included exactly once.
Verify that the final `verify-xcresult.py` step actually executes.

### Mandatory new tests, all must execute and pass

Class: `PreparedHintPlansTests`

1. `testDecodesCommonPlanAndUnknownAnswers`
2. `testAuthenticatedPreviewUsesGETAndNoBody`
3. `testMissingLoginDoesNotReadPlans`
4. `testPreviewServiceFailureIsNotEmpty`
5. `testPreviewDisplaysGoalNumberAnswersAndExpiry`
6. `testExpiredAndNonHintPlansAreHidden`
7. `testReadOnlyViewHasNoCallControls`
8. `testRefreshFailureShowsErrorNotEmpty`
9. `testCancelledRefreshCannotRepopulatePlan`

All existing mandatory tests remain mandatory, especially `InCallCaptionTests`,
`PrepareGoalProposalAppearanceTests`, `CallHintStreamPrepareTests`,
Secretary confirmation/recovery and DTMF tests.

## Visual checks without real calls

Use only synthetic/offline fixtures. Check the new view on a compact iPhone,
large Dynamic Type and light/dark appearance. No clipped goal, number, answer or
expiry; scrolling reaches all content. Unknown answers must be explicitly unknown.
Check empty, loading, error and expiry states; tapping Refresh must issue only a
GET. Use the existing localization keys for en/ru/es/kk/uk. Verify Hint-only
mounting and manual-reset preservation without a signed-in production account.
If a particular state cannot be exercised safely, report it as unverified rather
than bypassing authentication or calling the real backend.

## Strict limits

No Publish, Archive, TestFlight or store upload. No real calls, microphone/STT/model
requests, payments, agents or provider changes. No secrets, production login
sessions, Apple Team changes, certificate/provisioning changes or entitlement
workarounds. Do not change Katya, OAuth, scopes, prompts or confirmation behavior.
If compilation or tests fail, report the exact failure and proposed smallest fix;
do not weaken the gate.

## Return to owner/Replit

- Branch and full HEAD; `git status` before/after; any diff.
- Xcode version, XcodeGen version, SDK, simulator model and runtime versions.
- Build result and full-target passed/failed/skipped counts.
- Each of the nine mandatory tests separately, including absence/skips.
- Whether source/entitlement/xcresult final verification ran and passed.
- Build/test/xcresult logs and fixture screenshots, with no credentials or
  personal call data.
- What was not verified.
- Verdict: **«готово к релизу»** or **«блокер»**. Even a passing verdict does not
  authorize Archive/TestFlight; those need a separate owner's yes.

Replit has not built or executed iOS here. Server Publish alone does not update
the installed iPhone application. Mac report is pending; no release is authorized.
