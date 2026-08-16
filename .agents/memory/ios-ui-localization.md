---
name: iOS UI localization
description: App UI follows iPhone system language (en/ru/es/kk/uk); conventions and invariants for adding/changing strings.
---
UI language = iOS system language. Supported: en (base/fallback), ru, es, kk, uk.

Rules:
- All user-visible iOS strings go through `NSLocalizedString("<screen>.<key>", comment: "")`; format strings via `String(format: ...)` with %@/%d. Files: `ios/TalkHint/Resources/<lang>.lproj/Localizable.strings` (XcodeGen picks them up via the TalkHint source glob; CFBundleLocalizations lists the 5 langs in Info.plist).
- **Invariant:** all five .strings files must keep identical key sets and identical placeholder counts; every key used in Swift must exist in en and vice versa. Any string change must update all 5 files.
- UI language ≠ hint/translation language: `SessionStore.language` (ru/es, endonyms «Русский»/«Español») is a separate setting — never localize those endonyms or its codes.
- Tutor web page (`server/tutorAvatarPage.ts`) has its own L dictionaries (ru/en/es/kk/uk, 58 keys, chosen by navigator.language) — new UI strings there must be added to ALL dictionaries.
**Why:** partial dictionaries silently fall back or show `undefined`; Swift can't be compiled in this workspace, so key/placeholder parity checks are the only safety net.
**How to apply:** when touching any user-facing text in iOS or the tutor page.
