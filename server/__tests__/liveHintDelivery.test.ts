import { describe, it, expect } from "vitest";
import { canUpdateEnglishFirst } from "../liveHintDelivery";
describe("late hint translation delivery fences", () => {
  const stamp = Symbol();
  const valid = { closed: false, utterance: 2, latestUtterance: 2, deliveredEpoch: stamp, currentEpoch: stamp,
    mode: "english-first", revision: 1, startedRevision: 1, liveHints: true, translation: true,
    originalEnglish: "Hello.", updatedEnglish: "Hello." };
  it("updates the same live card", () => expect(canUpdateEnglishFirst(valid)).toBe(true));
  it.each([
    { closed: true }, { latestUtterance: 3 }, { mode: "legacy" }, { revision: 2 },
    { currentEpoch: Symbol() }, { deliveredEpoch: undefined }, { liveHints: false },
    { translation: false }, { updatedEnglish: "Changed by Ask." },
  ])("rejects stale/rolled-back/replaced/disabled card %o", change => {
    expect(canUpdateEnglishFirst({ ...valid, ...change })).toBe(false);
  });
});
