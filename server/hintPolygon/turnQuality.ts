import type { Turn } from "./metrics";
import type { Segment } from "./contracts";

export const MAX_BAD_TURN_FRACTION = .30;
/** Physical Guest speech tails missing any final become explicit bad samples,
 * rather than either invalidating all good turns or silently disappearing.
 * Owner tails are context diagnostics, not fabricated Guest hint timings. */
export function assessTurns(turns:Turn[], guest:Segment[], finalEndMs:number) {
  const missingTail = guest.filter(s=>s.endMs>finalEndMs+64 &&
    !turns.some(t=>!t.valid && t.windowEndMs!=null &&
      Math.abs(t.windowEndMs-finalEndMs)<=64 && s.startMs<t.windowEndMs!)).length;
  const bad = turns.filter(t=>!t.valid).length + missingTail;
  const total = turns.length + missingTail;
  const fraction = total?bad/total:1;
  return {bad,total,missingTail,fraction,threshold:MAX_BAD_TURN_FRACTION,
    acceptable:total>0 && fraction<=MAX_BAD_TURN_FRACTION};
}
