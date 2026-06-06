---
name: Live hint pipeline gotchas
description: Non-obvious failure modes of the live-call hint/throttle pipeline in server/websocket.ts
---

# Live hint pipeline gotchas

**Goal-achieved hard stop must hold on BOTH speaker paths.**
The goal can be achieved on the OWNER's (HON) reply, not just the guest's (GST). If only the GST path sets the hard-stop flag, late hints leak after "цель достигнута".
**Why:** a real call showed two extra "confirm appointment" hints after the goal was already achieved.
**How to apply:** set the hard-stop flag wherever `goalUpdate.goalAchieved` is true (both utterance handlers), AND re-check it right before broadcasting the suggestion — `translateAndSuggest` is awaited (network ~hundreds ms), so a concurrent utterance can pass the early check before the flag is set.

**Speakerphone bleeds the same speech onto BOTH Deepgram tracks.**
inbound=HON, outbound=GST is correct, but on a speaker the mic captures the remote audio (and vice versa), so identical text is transcribed on both tracks → role confusion ("the doctor's words shown as YOU").
**How to apply:** dedup cross-track at the utterance-complete chokepoint — drop an utterance if a highly-similar one (≥0.85) from the OPPOSITE speaker arrived within ~1.2s. Keep window short + similarity high so legitimate turn-taking/confirmations aren't dropped.

**Duplicate-suggestion filter must compare against a WINDOW, not just the last hint.**
Near-identical hints (e.g. "Please confirm … Monday at 5 PM" vs "I need to confirm … Monday at 5 PM") score ~0.67 Jaccard — under a 0.7 threshold and invisible if only the immediately-previous hint is compared.
**How to apply:** keep last ~4 suggestions, block at ≥0.5 similarity to any of them.

**Farewell suppression must exempt questions/actionable lines.**
Blocking hints on farewell phrases ("see you", "thanks") is right for closings, but a bare `thanks`/`thank you` match suppresses valid lines like "Thanks, what time works best?".
**How to apply:** treat as farewell only if it matches the farewell regex AND has no "?" AND no actionable/scheduling keyword.

**Fast Layer filler and the GPT hint are independent paths — gate them together.**
The filler ("One moment"/"Sure") is scheduled at guest-utterance-end, but the real hint that follows runs through separate block guards (goal-achieved, reaction-only, farewell, cooldown, wait-state). If the filler isn't suppressed when the hint will be blocked, the user sees a filler with NO real hint after it — the classic "после филлера тишина" complaint.
**Why:** the filler does NOT touch `lastHintTs`/`lastHintUtteranceId`, so it never *causes* a block — it simply leaks on exactly the turns where the hint is independently suppressed.
**How to apply:** compute a `suppressFiller` flag before `fastLayer.onGstUtteranceEnd()` covering every condition that returns early before the suggestion broadcast. NOTE: as of this writing the **wait_state** block (`waitingForInfo && waitAckShown`) is NOT yet in `suppressFiller`, so filler can still leak during wait-state — extend it there too.
