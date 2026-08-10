---
name: Tutor visual-preview harness
description: Dev-only /tutor/preview route renders real tutor page states on the canvas by stubbing engine/network client-side.
---
Dev-only route `/tutor/preview?state=...` serves the REAL tutor page HTML plus an injected classic driver script (runs before the module script) that stubs fetch/WebSocket/getUserMedia and replays tutor-realtime/1.0 messages to reach any UI state. Page code untouched; route 404s in production.

**Why:** user reviews all UI states as canvas frames before approving changes/publish; screenshots must show real implementation, not mockups.

**How to apply:** for new tutor UI states, extend the driver scenarios instead of hand-drawing mockups. Note: the agent's headless Screenshot browser has NO WebGL — the 3D avatar renders only in the user's browser (canvas iframes), so validate driver logic, not avatar pixels, via Screenshot.

**Screenshot timing:** headless Screenshot captures ~1s after page load — preview driver scenarios must complete in <1s. Turns are emitted directly via realtime message shapes (no real mic hold, sleeps ≤120ms); never re-introduce real-time pointer holds in scenarios.
