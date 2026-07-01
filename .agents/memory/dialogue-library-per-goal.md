---
name: Dialogue library keyed per goal
description: Why the auto-built call dialogue library is per-user-per-goal, and its warn-not-block sizing rule
---

Auto-built call dialogue libraries are stored **per user AND per goal**, each identified by its own row id — deliberately NOT one library per goalType.

**Why:** A code review rejected an earlier per-`(userId, goalType)` design. The product requirement is "saved separately per user and per goal." Goals are free-text plus a goalType enum (booking|pricing|support|info|negotiation|other); there is no goalId. One user can have several distinct goals of the same type (e.g. two CDL interviews), so goalType is a domain attribute, not a key.

**How to apply:**
- Runtime picks the active library by best free-text similarity of the live goal vs each library's saved goal text; only when that is not confident does it fall back within the same goalType, and even then it prefers the best in-domain text match over an arbitrary first row.
- The pure selection/matching logic is isolated in a standalone module (parameterized by the library list) so it is unit-testable apart from the websocket handler; keep it pure when changing it.
- Regeneration and editing both go through the same wholesale entries-array replace, so a regenerate never mixes old + new lines.
- Library-first lookup must always fall through to the unchanged live GPT hint path on a miss, and must never change in-call payload shapes.
- Generation aims for a large library and auto-tops-up with extra deduped passes if the first pass is short. If it is still under the useful floor, **save it and warn the user** — do not hard-block (matches the user's "не запрещаем, предупреждаем" principle).
