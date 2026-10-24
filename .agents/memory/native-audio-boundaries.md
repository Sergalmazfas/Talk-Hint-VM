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
