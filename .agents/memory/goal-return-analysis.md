---
name: Goal-return analysis
description: Data limits for offline goal-return/digression analysis of recorded calls.
---

# Goal-return analysis (offline)

- Production call records persist neither the call goal nor delivered hint texts; hint metadata carries timings/outcomes only.
- **Why:** goal and hint history are in-memory per-call state, cleared at call end.
- **How to apply:** offline goal analysis must take the goal from a frozen fixture or an operator-supplied value and record the source honestly. Owner-turn labels measure the owner's goal adherence — never present them as hint effectiveness (ordinary owner speech is indistinguishable from an accepted hint). Hint-level judging runs only over explicit hint records, with a fuzzy owner-turn "spoken match" as an admitted heuristic, fail-closed everywhere.
