---
name: Prompt facts and runtime clocks
description: Distinguish system timestamps from business facts in anti-hallucination prompt checks.
---

Assertions that a secretary does not invent hours must evaluate business facts
separately from the explicit runtime UTC timestamp.

**Why:** A full verification run at 22:00 UTC matched the forbidden business-hours
example against the system clock, although no business instructions had changed.

**How to apply:** Exclude only the labelled runtime clock line, or control time in
the test. Never strip approved cards or actual business rules from those checks,
and never change the secretary's runtime instructions merely to make a clock-sensitive
test pass.
