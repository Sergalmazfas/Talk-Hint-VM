---
name: Native audio boundaries
description: Why ordinary calls, Copilot gates and Secretary monitoring must not share audio ownership
---

Ordinary Hint/Translator calls should use Twilio's standard audio device.
Reserve the custom device with private uplink gates and injection for Copilot,
and select it before connecting, never while a call is active or disconnecting.
CallKit alone enables/disables the selected phone-call device.

**Why:** Making ordinary calls depend on Copilot's custom media machinery
created unnecessary cross-mode risk while investigating two-way silence.
Restoring this boundary is an isolation decision, not proof of a particular
hardware failure's root cause.

**How to apply:** Keep new call modes explicit about device selection and test
mode transitions, including Copilot followed by an ordinary call. Do not broaden
private gates to unrelated calls as a shortcut.

Secretary monitoring may control local playback only while its screen is
visible and must not deactivate a CallKit-owned session. A stale screen's
cleanup must not stop a newer monitor's shared player.

**Why:** Hidden screens can survive navigation; foreground/interruption
notifications and delayed deinitialization otherwise compete with the next
call. Audio-start failure must not be overwritten by a networking
“Connecting” state.
The owner confirmed a successful autonomous Secretary conversation with visible
live transcription on iPhone but no audible monitoring. A successful remote
conversation or connected transcript feed is not evidence of owner-side sound.
Both remote parties need concurrent local playback; continuous guest audio
(including silence) must not serialize ahead of the Secretary's speech.

**How to apply:** Release local resources on disappearance without hanging up
the autonomous server call, guard lifecycle callbacks, and preserve explicit
audio errors. Verify hardware behavior on iPhone; source checks and mocked
tests do not establish working microphone or speaker audio.

Require executed native transcript-rendering and audio-routing suites, not
merely a successful application build, when validating Secretary changes.

**Why:** Device-symbolicated failures occurred while rendering both first live
turns and recovered snapshots despite a successful build and passing server
tests. The server-side call could continue after the native UI terminated.

**How to apply:** Keep live/recovery UIKit coverage mandatory in native result
validation. Check the exact revision installed on the phone before attributing
new symptoms to changes that may not yet be in that binary.

Keep UI recovery fixtures independent of OS credential storage and live socket
timing, but require real Keychain integration evidence separately.

**Why:** A reserved `.invalid` backend protects production; it is not a suspended
test transport. DNS failures still produce asynchronous recovery events, and a
simulator test host's secure-storage availability must not be silently assumed.
UI fixtures alone cannot prove real authentication or device audio.

**How to apply:** Inject credentials and controlled sockets for UI transition
tests. Separately require actual Keychain write/read/delete checks with synthetic,
uniquely scoped keys; report unavailable storage as a failing integration check,
never a skip, memory fallback, or reason to weaken normal authentication.

A simulator `errSecMissingEntitlement` does not establish that the user's
iPhone credentials or production account are broken.

**Why:** Mac validation returned missing-entitlement errors while other native
tests passed. Xcode simulator runtime rights can reside in the main Mach-O
`__TEXT,__entitlements` section even when codesign reports an empty dictionary;
checking only the signature can falsely reject a correctly configured host.
Mac validation confirmed that simulator-local ad-hoc signing with those runtime
rights supports real Keychain write/read/delete without changing iPhone signing.

**How to apply:** Keep signing repairs local to simulator validation, inspect
the built main executable's runtime rights separately from signature integrity,
and still require real Keychain XCTest. Do not substitute the debug dylib or
an intermediate build plist for runtime evidence. Leave phone signing, APNs
rights, account settings and production authentication unchanged.

Keep read-only feed recovery separate from audio-source recovery. An absent
source must not prevent re-reading status/transcript or ending the owned call.

**Why:** a source can start while the monitor is hidden; gating feed subscription
on the previously observed missing-source state makes the screen unable to learn
that audio has become available.

**How to apply:** screen re-entry may refresh the feed, never create a new call
or promise to recreate a missing Twilio source. Treat receipt of both tracks,
local playback callbacks, and human-confirmed audibility as separate evidence.

Treat cancelling a native settings request as cancelling local observation,
not rolling back an accepted server write.

**Why:** Hosted personality tests could read an old alert as a new save result;
late completions then changed shared preferences during the next test. A saved
server result can still exist after navigation cancels its client-side wait.

**How to apply:** Validate lifecycle, owner, origin and request generation before
local side effects; re-read the same line after interrupted saving. Hosted UIKit
tests need a scene-attached window, fresh-operation evidence and fully dismissed
presentations. Cancel and drain work before restoring shared test state. Keep
delayed-response fixtures that ignore cancellation; do not fix these races by
increasing timeouts or weakening assertions.

Hosted navigation tests must observe actual disappearance before releasing a
held response and draining the departing screen; issuing push/pop is not proof
that appearance callbacks have completed.

**Why:** Mac lifecycle tracing reproduced a coalesced push/pop with no
disappearance/reappearance callbacks. The test's drain helper suspended a still
visible screen and then incorrectly expected reappearance to resume it.

**How to apply:** Await the departing view leaving its window and navigation
settling before draining; await actual attachment on return. Do not infer an app
lifecycle bug from a test that skipped those preconditions or accept one green
run as proof an intermittent failure is resolved.

Hosted UIKit tests must validate the actual presentation relationship, not
assume a child controller is its sheet's presenter.

**Why:** Once navigation timing was stabilized on Mac, an assertion requiring
Settings itself as presenter failed; UIKit may delegate presentation to the
containing navigation controller.

**How to apply:** Accept only the expected child/container, verify its presented
sheet, window attachment and settled transitions, and dismiss via the actual
presenter. Requiring the navigation controller alone would make the opposite
assumption rather than solve the underlying test-design problem.
