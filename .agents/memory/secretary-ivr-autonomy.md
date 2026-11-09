---
name: Secretary IVR autonomy boundary
description: Owner-approved scope for multi-level menu navigation and failure of owner help notifications.
---

The owner requires Katya to navigate every new IVR level autonomously. For parking,
reservations or reaching a person, use the closest heard manager/general-manager
option when no exact option exists. Keep the five-digit limit without a new menu.
Failed owner-help push must not leave a silent indefinite wait: use an offered
safe choice or repeat-menu option. Menu fixes do not authorize personality or
ordinary conversation changes.

**Why:** The owner reported an actual second-level stall and explicitly approved
KATYA.1/KATYA.4 corrections while reserving other behavior for Katya's laboratory.

**How to apply:** Separate menus at dispatch boundaries rather than agent-spoken
turns: Katya may be silent while sending tones, and the provider may extend the
same ASR turn. Treat push provider acceptance as different from delivery. A
recorded-menu replay with fake transport is not proof of real STT, audible tones,
or PSTN success; owner review and a post-Publish control call remain separate.

Owner-approved Dev rules from 2026-11-09: match the authorized goal to heard
department options, not only a closed parking/repair list. When deterministic
selection is empty, allow silent model tool selection; if nothing fits, use
operator/0. This is a navigation-only zero exception, never permission to enter
private identifiers. Before the first menu digit is actually sent, repeating IVR
must not be treated as 20 seconds of unsuccessful human contact. The overall
telephone limit still bounds the call.

**Why:** FleetPride's recorded menu was understood but no digit was selected;
an early no-human timeout then prevented reaching a person. A complete C replay
also exposed the distinction between an idle speech buffer and a valid silent
navigation response.

**How to apply:** Exercise both reserved and streaming C conversation paths
through the actual response/DTMF frame boundary. Keep stale-generation checks
on silent tools. Give both reviewers the same primary dispatch audit; neither
absence of speech nor a sent tone proves the destination accepted a selection.
