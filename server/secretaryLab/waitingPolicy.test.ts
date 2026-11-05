import { describe, it, expect } from "vitest";
import { DevWaitingPolicy, waitingCue, addressedReturn } from "./waitingPolicy";
import { waitingAudit } from "./waitingAudit";

function fixture() {
  let at = 0;
  const p = new DevWaitingPolicy(() => at);
  return { p, at: (n: number, active = false) => { at = n; p.audio(active); } };
}
describe("Dev C owner waiting rules", () => {
  it.each(["one sec", "give me a minute", "one moment", "секундочку", "одну минуту"])("short wait %s", text => {
    const { p, at } = fixture(); p.observe(text, false, true);
    at(59_999); expect(p.tick()).toBeUndefined();
    at(60_000); expect(p.tick()).toMatchObject({ end: false, elapsedMs: 60_000 });
    at(61_000); expect(p.tick()).toBeUndefined();
    at(80_000); expect(p.tick()).toMatchObject({ end: true });
    expect(p.tick()).toBeUndefined();
    expect(p.events.filter(e => e.type === "probe")).toHaveLength(1);
  });
  it.each(["let me check", "I'm in the back", "warehouse", "I'm on the other line",
    "I'll be right back", "сейчас проверю", "на складе"])("5 minute hold %s", text => {
    const { p, at } = fixture(); p.observe(text, false, true);
    for (const t of [20_000, 60_000, 120_000, 299_999]) { at(t); expect(p.tick()).toBeUndefined(); }
    at(300_000); expect(p.tick()).toMatchObject({ end: true });
    expect(p.events.filter(e => e.type === "probe")).toHaveLength(0);
  });
  it("unexpected silence: one Hello at 20s, reply window then one farewell", () => {
    const { p, at } = fixture(); p.playbackEnded();
    at(19_999); expect(p.tick()).toBeUndefined();
    at(20_000); expect(p.tick()).toMatchObject({ text: "Hello?", end: false });
    p.playbackEnded(); // A probe's playback never resets its deadline.
    at(40_000); expect(p.tick()).toMatchObject({ text: "I'll let him know and call back later.", end: true });
    expect(p.tick()).toBeUndefined();
  });
  it("missing or stale acoustic evidence is NOT silence", () => {
    let time = 0; const p = new DevWaitingPolicy(() => time); p.playbackEnded();
    time = 20_000; expect(p.tick()).toBeUndefined();
    p.audio(false); time += 3001; expect(p.tick()).toBeUndefined();
  });
  it("music/working/colleagues' speech means no checks, bounded by 5 minutes", () => {
    const { p, at } = fixture(); p.playbackEnded();
    at(1000, true);
    at(20_000, true); expect(p.tick()).toBeUndefined();
    at(60_000, true); expect(p.tick()).toBeUndefined();
    p.observe("Tell him to put that box over there", true, true);
    expect(p.waiting).toBe(true);
    at(300_000, true); expect(p.tick()).toMatchObject({ kind: "background", end: true });
  });
  it("background audio during a brief wait suppresses probes, including a later quiet gap", () => {
    const { p, at } = fixture(); p.observe("one sec", false, true);
    at(55_000, true); at(58_500, true); at(60_000, false);
    expect(p.tick()).toBeUndefined();
    expect(p.snapshot.state).toBe("background");
  });
  it("the same ASR sentence/case/punctuation does not extend the deadline", () => {
    const { p, at } = fixture(); p.observe("let me check", true, false);
    at(100_000); p.observe("Let me check.", true, false); p.observe("Let me check.", false, true);
    at(300_000); expect(p.tick()).toMatchObject({ elapsedMs: 300_000, end: true });
  });
  it("a finalized return unlocks a partial return, but a reminder never invents a return", () => {
    const { p } = fixture(); p.observe("let me check", false, true);
    p.observe("I'm back, we have one", true, false);
    expect(p.waiting).toBe(true);
    p.observe("I'm back, we have one", false, true);
    expect(p.waiting).toBe(false);
  });
  it("an old completed Hello is not a new return after Katya's reply", () => {
    const { p } = fixture(); p.observe("Hello", false, true, "1:hello");
    p.playbackEnded(); p.observe("HELLO", false, true, "1:HELLO");
    expect(p.waiting).toBe(true);
    p.observe("Hello", false, true, "2:hello");
    expect(p.waiting).toBe(false);
  });
  it("does not probe during user or agent speech", () => {
    const { p, at } = fixture(); p.observe("one sec", false, true);
    at(60_000); p.audio(false, true); expect(p.tick()).toBeUndefined();
    p.audio(false, false); p.observe("talking to colleague", true, false);
    expect(p.tick()).toBeUndefined();
  });
  it("does not classify unrelated references to a warehouse as a completed return", () => {
    expect(waitingCue("in the warehouse, I'll be right back")).toBe("checking");
    expect(addressedReturn("Ask the warehouse guy about it")).toBe(false);
    expect(addressedReturn("I'm back, the price is $150")).toBe(true);
    expect(addressedReturn("[background] hello, colleague")).toBe(false);
  });
  it("a real answer mentioning warehouse releases hold, but a future check does not", () => {
    const { p } = fixture();
    p.observe("let me check in the warehouse", false, true);
    p.observe("We have one in the warehouse, the price is $150", false, true);
    expect(p.waiting).toBe(false);
    expect(waitingCue("I have to check in the warehouse")).toBe("checking");
  });
  it.each(["Hey Mike, can you check the shelf?", "Tell him we have one", "Ask her if the price is $150",
    "John, we have one in the back"])("does not mistake colleague speech for a return: %s", s => {
    const { p } = fixture(); p.observe("let me check", false, true);
    p.observe(s, false, true);
    expect(p.waiting).toBe(true);
  });
  it("review packet reports checks, but never claims audio verification or self-acceptance", () => {
    const { p, at } = fixture(); p.observe("one sec", false, true);
    at(60_000); p.tick(); at(65_000); p.observe("I'm back", false, true);
    const audit = waitingAudit(p.events);
    expect(audit.rows).toEqual([expect.objectContaining({ type: "brief", durationMs: 65_000, probes: 1, interruptions: null })]);
    expect(audit.actualInterruptions).toBeNull();
    expect(audit.review.hold).toEqual({ unnecessaryChecks: 0, interruptionsWhileWaiting: 0 });
  });
});
