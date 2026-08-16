---
name: Tutor / Calls product separation
description: Agreed architecture — Tutor tab is learning-only (Session Report), all call prep lives in Calls; Engine stays call-agnostic.
---

**Rule:** The Tutor tab must contain NOTHING telephone-related. No Call Memory review, no objective/facts/questions for a call, no handoff into real calls. Call preparation lives exclusively in the Calls flow: Prepare (voice goal) → Practice (engine simulation initiated FROM Calls) → Confirm Call Context → Real Call → Live Hints → Call Summary.

**Tutor session ending:** free practice ends with a "Lesson Summary" screen fed by a universal engine **Session Report** (agreed with the engine owner): `{session_id, duration_seconds, learner_turns, summary, corrections[{original,better,explanation}], vocabulary[{phrase,translation,example}], practice_targets[], progress{improved,needs_work}}`. Produced asynchronously by the engine's Progress/Assessment pipeline (no extra "summary AI", realtime lesson agent untouched).

**Why:** Tutor Engine is a reusable product (MBLEx next); baking TalkHint call concepts into it makes it TalkHint-specific. Dependency direction: TalkHint Calls → calls Tutor Engine for training, never the reverse.

**How to apply:** any new tutor-page feature that mentions calls/goals belongs in Calls, not Tutor. Learning history / Student Memory source of truth = Tutor Engine; TalkHint only renders "My lessons", it must not become a second learning engine. Call-memory generation stays reachable only from the Calls-initiated practice flow.
