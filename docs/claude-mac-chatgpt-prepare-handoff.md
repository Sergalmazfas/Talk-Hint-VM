# Mac handoff: ChatGPT plans in Hint Prepare

## Repository and exact code

- Repository: https://github.com/Sergalmazfas/Talk-Hint-VM
- Branch: `xcode-chatgpt-prepare-2026-11-02`
- Original Prepare code commit: `1052648cfa54da4ba5f6adcaa09d7035aa9a9e50`
- Latest code commit (preserved UX test correction + offline visual fixtures):
  `cd3b715f45af41d1f694a9e085e88fa103bb11f7`
- Remote base: `efaaaec857c9a55ebc60b85f5c63756e46e39563`
- Branch HEAD also contains this handoff in a separate documentation commit.
- The updated branch also restores both original Mac fixes: the call-screen
  safe-area constraint fix (original patch from the owner's uploaded archive,
  equivalent to the Mac DTMF-branch cherry-pick) and the existing asynchronous
  Secretary review test fix. They are now in both Replit Dev and this branch.
  No DTMF patch or historical full-file snapshot was reapplied.
- Restored crash fix commit: `03e015037d2e287d90f3d9866b5ace668a14a288`.
  Its stable patch-id is `0377117b84337c149cb0f9e57d6da58b2dfa6164`,
  identical to the owner's original crash patch.
- Restored Secretary test commit: `6d41960460c6206db896f33e7c6d529038641ac1`.
  Its stable patch-id is `e6a2fdddfa0a10ebc0fa2559743a1edfb0dd02fb`,
  identical to the original asynchronous test patch.
- Original author attribution is retained in both restoration commits. Original
  Mac hashes need not be ancestors of this branch: verify the equivalent deltas
  above and their tests, rather than rejecting the branch for different hashes.
- The earlier STOP for these two missing fixes is resolved in this delivery.
  Verify their code and regression tests on the fetched HEAD; do not cherry-pick
  them again. The original Prepare code commit below remains an ancestor.
- Native delta only. It does not replace the repository with the Replit Dev tree.
  All eight existing changed native files matched the remote base before this delta.

## Before checkout

The Mac report for `cd58373ab8a1cb0c129db30843f3d633742bfcf7` recorded a successful
build and 222 passed / 1 failed / 0 skipped XCTest; the final xcresult gate did
not run. The only failure was an old test's one-tap-hide expectation. This
delivery preserves the current collapse/expand UX and updates only tests,
fixture rendering and documentation. It is not yet a passing native release.

Run `git status --short`, record the current branch and HEAD, and inspect local
commits. **Do not use stash, reset, force, rebase, merge, or overwrite another
person's changes.** If there are local modifications, missing objects, or an
untransferred Mac-side fix needed by these sources, stop and report it.
The owner's unrelated untracked Mac files must stay untouched. Use a fresh,
uniquely named local branch for this updated remote HEAD, without overwriting
the existing DTMF branch or an earlier local Prepare branch.

Fetch this exact branch from the existing authorized origin. If a local branch
already exists, do not overwrite it. Use a clean checkout of the remote branch;
verify that the code commit above is its ancestor and that the native changes
relative to the base are the eleven original Prepare paths plus the three
restored Mac paths (`InCallViewController.swift`, `InCallCaptionTests.swift`,
`SecretaryPersonalityUITests.swift`). No changes to `main`
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
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer bash ios/scripts/validate-native.sh
```

Run the **entire** `TalkHintTests` target. No `-only-testing`, `-skip-testing`,
renamed targets, disabled tests or weakening `verify-xcresult.py`.
The existing script regenerates XcodeGen sources and verifies source inclusion,
entitlements and xcresult. New Swift files must be included exactly once.
Verify that the final `verify-xcresult.py` step actually executes.
The reported Mac has Xcode 26.5 at `/Applications/Xcode.app`; the previously
templated `Xcode_16.4.app` is absent. Check the actual Xcode version first.
Do not rename Xcode, create a misleading symlink, or claim to have used 16.4.

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

### Additional offline visual fixture tests — all required

10. `testVisualFixturesSavedPlanCompactLightAndDark`
11. `testVisualFixturesLargeTypeReachesLastField`
12. `testVisualFixturesLoadingEmptyAndError`

These render the actual `PreparedHintPlansView` with synthetic data and an
injected throwing loader, not a live session or an approximate mockup. They attach
top/bottom images for light/dark, normal/accessibility Dynamic Type at 320×568,
plus loading/error/empty images to xcresult. Inspect the attachments as well as
the assertions. There are no production requests or real calls in these fixtures.

All existing mandatory tests remain mandatory, especially `InCallCaptionTests`,
`PrepareGoalProposalAppearanceTests`, `CallHintStreamPrepareTests`,
Secretary confirmation/recovery and DTMF tests.

### Restored Mac regressions — must execute and pass

- `InCallCaptionTests.testPrepareOpeningShowsOnSmallScreenAndTogglesCollapse`
  (also required by `verify-xcresult.py`).
  The old `...OneTapHidesIt` name is intentionally replaced: first tap hides the
  translation and makes English one truncated line; second tap restores wrapping
  and translation. The scroll view stays visible. The screen-load, height-cap
  and single-use checks remain, and the 0.38/0.22 runtime constants are untouched.
- `SecretaryPersonalityUITests.testReviewBlocksRetellWithoutSavedOutgoingLine`
  must be `async throws`, wait for the fixture's default-line refusal, keep Start
  disabled and prove that no task-start request was sent.

Record both separately alongside all twelve Prepare tests. No tests were disabled;
the height-cap multipliers remain 0.38/0.22. The new fix does not alter Katya's
runtime behavior.

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
- Each of the twelve mandatory Prepare tests and both restored regressions
  separately, including absence/skips.
- Whether source/entitlement/xcresult final verification ran and passed.
- Build/test/xcresult logs and fixture screenshots, with no credentials or
  personal call data.
- What was not verified.
- Verdict: **«готово к релизу»** or **«блокер»**. Even a passing verdict does not
  authorize Archive/TestFlight; those need a separate owner's yes.

Replit has not built or executed iOS here. Server Publish alone does not update
the installed iPhone application. Mac report is pending; no release is authorized.
