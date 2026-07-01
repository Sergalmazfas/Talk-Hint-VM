---
name: Dialogue library keyed per goal
description: Why the auto-built call dialogue library is keyed per-user-per-goal (own UUID id), not per goalType
---

Auto-built call dialogue libraries are stored **per user AND per goal**. Each library's identity is its own UUID `id`; the table has only a plain `index(userId)` — there is deliberately NO `unique(userId, goalType)`.

**Why:** A code review REJECTED an earlier design that keyed one library per `(userId, goalType)`. The product requirement is "saved separately per user and per goal." Goals are free-text (`currentGoal`) plus a `goalType` enum (booking|pricing|support|info|negotiation|other); there is no `goalId` in the system. A user can have multiple distinct goals that share the same goalType, so goalType is a domain attribute, not a key.

**How to apply:**
- Storage/routes are keyed by `(userId, id)`: get/create/update/delete all take the library `id`.
- Runtime selection (`selectActiveLibrary` in server/websocket.ts): pick the library whose `goalText` best fuzzy-matches the active `currentGoal` (textSimilarity ≥ 0.35); else fall back to the first library whose `goalType` === detected goalType.
- Library-first lookup must always fall through to the unchanged `translateAndSuggest` GPT path on a miss, and must never change in-call UI payload shapes (`guest_transcript`, `suggestion`) — only provider metadata differs (`provider_used="library"`).
- Entry `slot` is constrained to the goal-engine SLOT_SET in `sanitizeDialogueEntries`; the UI must round-trip the existing slot (not force null) on edit.
