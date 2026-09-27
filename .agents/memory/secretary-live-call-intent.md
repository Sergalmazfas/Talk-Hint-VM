---
name: Secretary live-call intent
description: Product constraint for the owner-initiated Secretary call and safe retry behavior.
---

The owner explicitly confirmed: “Только один звонок сразу; повтор запускаю сам.” A confirmed assignment and Call press authorize exactly one immediate outbound attempt. An uncertain network response is not permission to dial again. Recover or monitor the same attempt instead; a genuinely new call needs a fresh owner action and confirmation.

**Why:** The owner wants to enter the number personally, hear the Secretary conversation live, and decide if and when to repeat a call. Automatic retry can make an unexpected duplicate phone call.

**How to apply:** Keep the live monitoring feed read-only (no owner microphone) and separate from the legacy queued-task mechanism. For timeout and restart recovery, identify the original attempt durably rather than creating a new one.

The Secretary must conduct the entire conversation autonomously. The owner only sets the assignment and number, then listens and reads the two-party dialogue and native-language subtitles; they do not speak or send live hints to the Secretary. The Hint interface is a reference for assignment entry and design, not a feature to extend for Secretary work.

**Why:** The owner explicitly corrected a misunderstanding that had led to unrelated live-Hint translation work. The Secretary is the speaker on the call, not the owner.

**How to apply:** Keep Secretary translation and call reporting confined to Secretary flows. Do not route owner audio or Hint suggestions into Secretary, and do not modify Hint merely because its task-entry design was reused.