---
name: Secretary live-call intent
description: Product constraint for the owner-initiated Secretary call and safe retry behavior.
---

The owner explicitly confirmed: “Только один звонок сразу; повтор запускаю сам.” A confirmed assignment and Call press authorize exactly one immediate outbound attempt. An uncertain network response is not permission to dial again. Recover or monitor the same attempt instead; a genuinely new call needs a fresh owner action and confirmation.

**Why:** The owner wants to enter the number personally, hear the Secretary conversation live, and decide if and when to repeat a call. Automatic retry can make an unexpected duplicate phone call.

**How to apply:** Keep the live monitoring feed read-only (no owner microphone) and separate from the legacy queued-task mechanism. For timeout and restart recovery, identify the original attempt durably rather than creating a new one.