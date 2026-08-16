---
name: iOS Calls mockup style rules
description: User-mandated style constraints for ios-calls canvas mockups
---
Rules for all ios-calls mockups (user directive, Aug 2026):
- NO simulated iPhone chrome: no status bar, time, battery, signal, Dynamic Island, device frame. Design only the app UI starting at nav/header.
- The black legacy live-call screens are NOT a reference; everything (including In-Call) stays in the light TalkHint style: white bg, green primary #16A34A, purple AI accent #7C5CFC, Inter, large radii.
- Don't redesign the live-call screen beyond agreed frames; keep to the Calls / Prepare Call flow.
**Why:** user explicitly corrected dark InCall mockups and status bars; iOS provides chrome natively.
**How to apply:** any new frame or variant in mockups/ios-calls must follow these tokens and omit StatusBar.
