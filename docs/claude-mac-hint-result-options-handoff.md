# Hint: readable options + Prepare opening — native handoff

This is an additive native-only delivery based on the latest
`xcode-hint-lab-v3-2026-10-26` branch, including the already pushed Secretary
async-test fix. Server / DB / production / CI workflows are not changed here.

## Native changes
- Choice replies use English-first labels, measured height and scrollable card.
- Long text is not compressed into overlapping bilingual button titles.
- Prepare opening is a one-shot, goal-scoped, memory-only handoff (15-minute expiry).
- Opening appears only on the ordinary Hint call screen; tap it once to hide.
  Hiding is NOT evidence the user spoke it. It is not restored on reconnect.
- Visible telemetry distinguishes local Prepare presentation from generated hints.
  Clipped/offscreen text is not declared visible. Device clock is not trusted.
- No audio routing, STT, Translator, Copilot or Secretary behavior is changed.

## On the Mac, before TestFlight
1. Save local work; fetch and check out the delivery branch named in the Replit reply.
2. Read the actual commit SHA and diff. Do NOT merge the full Replit clean-main branch.
3. Regenerate the project using the existing XcodeGen/native-gate instructions.
4. Run the existing `ios/scripts/validate-native.sh` and verify its xcresult.
   Include the new `HintReadableViewsTests`; preserve the Secretary test fix.
5. On a small iPhone simulator, exercise long 2–3 option replies and translations:
   English is first/larger, no overlap, vertical scrolling, tap behavior unchanged.
6. Exercise Prepare → connect Hint: opening appears with translation, one tap hides;
   later hints/reconnect must not bring it back. No stale opening on next goal/call.
7. Check keyboard open/closed and portrait/landscape; controls remain reachable.
8. Verify /ui visibility with the new backend. Missing/late events must remain unknown,
   never counted as useful speech or successful completion.

Linux Replit cannot build UIKit or verify an actual iPhone screen. The new native
tests are authored, not claimed passed here. Do not call the build verified until
the Mac gate and simulator checks pass. No automatic TestFlight upload.

## Server publishing is separate
Server adds opt-in action/result hints and an enforced paused laboratory startup.
Owner publishes it; after publication inspect the owner-only lab status before
activating or making the control call. Never infer server readiness from iOS build.
