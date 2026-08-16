---
name: Adaptive hint types (v2.1)
description: Wire/parse invariants for DIRECT/CHOICE/USER_INPUT/STRATEGIC live hints
---
Rules that must survive future hint-pipeline changes:
- One BRAIN call per guest turn stays sacred: type classification lives inside the same Terra reply; normalization is pure string work (server/hintShape.ts), never a second model call.
- Wire is additive-only: `suggestion` event's en/translation ALWAYS populated; CHOICE en/translation is ALWAYS the server-composed canonical string from validated options (model main reply ignored) — dedup, telemetry hint text, hint-usage matching, and legacy clients all consume that same string.
- **Why:** legacy clients (talkhint/ui, iOS) render only en/translation and hide empty cards; divergent strings would break dedup/usage matching silently.
- Translation OFF gates translation, option translations, AND native_helper (native-language by definition).
- Sensitive backstop: redactSensitive runs behind the prompt rule — SSN-with-separators + 13-19-digit card runs everywhere; bare 6+-digit runs only in user_input/native_helper (aggressive), because 4-5-digit codes are indistinguishable from prices/ZIPs. Deeper enforcement = task on negative sensitive-leak tests.
- CHOICE options are suggestions, not facts — must never enter transcript/contact memory.
