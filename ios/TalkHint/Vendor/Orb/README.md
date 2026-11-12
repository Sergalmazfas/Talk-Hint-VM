# Orb — vendored source, not a Swift package

- Upstream: https://github.com/metasidd/Orb
- Author: **Siddhant Mehta (metasidd)**.
- Source revision: `a48fc3382ad40905ca4aa9691c6b504004740ad1`.
- License: the original MIT notice is preserved verbatim in `LICENSE`.
- Sources: `Sources/Config/OrbConfiguration.swift`, `Sources/Extensions/RealisticShadows.swift`,
  `Sources/OrbView/OrbView.swift` and its three `Subviews/*.swift`, flattened into this folder.

Local changes: explicit `@available(iOS 17.0, *)` on every upstream type,
removed upstream `#Preview` macros, normalized whitespace. Rendering logic is unchanged.
No `Package.swift`, package dependency, or `import Orb` is used.
The six Swift files compile as part of the existing TalkHint module through XcodeGen's
existing source glob. The application minimum stays **iOS 15.0**.

`ChatVoiceOrbView` is the only application adapter. It references the upstream renderer
inside `if #available(iOS 17, *)`. iOS 15–16 use an independent SwiftUI circle.
Reduce Motion also uses the static circle; inactive scenes pause the fallback.
The adapter disables upstream SpriteKit particles to avoid recreating particle scenes
on audio-level updates. Levels must come from real recording/playback; the adapter never
generates an audio session or synthetic microphone samples.

## Mac verification (not executed in the Linux workspace)

Regenerate the existing project using its normal XcodeGen procedure. Do not add an Orb
Swift Package. Open `ChatVoiceOrbView.swift` in Xcode Canvas to see the isolated fixtures.
Run `ChatVoiceOrbTests` in the existing native test target, and build the app with minimum
iOS 15 unchanged. Verify the fallback on iOS 15/16 and the upstream renderer on iOS 17+
in light/dark mode, with Reduce Motion and background/foreground transitions.

This component does **not** enable the existing black voice button. A complete voice session,
STT/TTS, interruption, shared chat history and explicit task approval remain separate wiring
within the approved voice-mode task. They are not implemented or represented as working here.
