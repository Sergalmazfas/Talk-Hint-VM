import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for UtteranceGate.commitTurn — the thin finalizer that the Deepgram
// Flux (v2) pipeline calls once per `EndOfTurn`. Unlike the old Nova-3 gate it
// no longer buffers partials on timers; it just decides whether a turn-complete
// transcript should fire the downstream onGenerate callback (GPT/translation).
//
// The contract we pin:
//   - normal turn  -> fires onGenerate once, with a monotonically increasing,
//                     per-speaker utteranceId, and trimmed text.
//   - too short    -> blocked (reason=min_chars), callback NOT fired.
//   - empty/blank  -> blocked (reason=empty), callback NOT fired.
//   - exact repeat -> blocked (reason=duplicate) only when consecutive.
//   - GST and HON keep independent counters / dedup state.
// ---------------------------------------------------------------------------

const { UtteranceGate } = await import("../utteranceGate");

const CALL = "CA_test";

function makeGate() {
  const onGenerate = vi.fn();
  const gate = new UtteranceGate(onGenerate);
  return { gate, onGenerate };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("UtteranceGate.commitTurn", () => {
  it("fires onGenerate for a normal turn and returns shouldGenerate=true", () => {
    const { gate, onGenerate } = makeGate();

    const result = gate.commitTurn(CALL, "GST", "I would like to book an appointment");

    expect(result.shouldGenerate).toBe(true);
    expect(result.reason).toBe("end_of_turn");
    expect(result.utteranceId).toBe(1);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith("GST", "I would like to book an appointment", 1, undefined);
  });

  it("trims surrounding whitespace before committing", () => {
    const { gate, onGenerate } = makeGate();

    const result = gate.commitTurn(CALL, "GST", "   hello there friend   ");

    expect(result.shouldGenerate).toBe(true);
    expect(result.text).toBe("hello there friend");
    expect(onGenerate).toHaveBeenCalledWith("GST", "hello there friend", 1, undefined);
  });

  it("forwards the end-of-turn confidence to onGenerate when provided", () => {
    const { gate, onGenerate } = makeGate();

    gate.commitTurn(CALL, "HON", "I would like to book an appointment", 0.42);

    expect(onGenerate).toHaveBeenCalledWith("HON", "I would like to book an appointment", 1, 0.42);
  });

  it("blocks turns shorter than MIN_CHARS and does not fire onGenerate", () => {
    const { gate, onGenerate } = makeGate();

    const result = gate.commitTurn(CALL, "GST", "ok");

    expect(result.shouldGenerate).toBe(false);
    expect(result.reason).toBe("min_chars");
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("blocks empty / whitespace-only turns", () => {
    const { gate, onGenerate } = makeGate();

    const result = gate.commitTurn(CALL, "GST", "    ");

    expect(result.shouldGenerate).toBe(false);
    expect(result.reason).toBe("empty");
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("blocks an exact consecutive duplicate turn", () => {
    const { gate, onGenerate } = makeGate();

    const first = gate.commitTurn(CALL, "GST", "what time are you open today");
    const second = gate.commitTurn(CALL, "GST", "what time are you open today");

    expect(first.shouldGenerate).toBe(true);
    expect(second.shouldGenerate).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("treats duplicates case- and whitespace-insensitively", () => {
    const { gate, onGenerate } = makeGate();

    gate.commitTurn(CALL, "GST", "Can I book for Monday");
    const dup = gate.commitTurn(CALL, "GST", "can i   book for monday");

    expect(dup.shouldGenerate).toBe(false);
    expect(dup.reason).toBe("duplicate");
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("allows the same text again once a different turn breaks the streak", () => {
    const { gate, onGenerate } = makeGate();

    const a = gate.commitTurn(CALL, "GST", "do you have any availability");
    const b = gate.commitTurn(CALL, "GST", "what about the afternoon slot");
    const c = gate.commitTurn(CALL, "GST", "do you have any availability");

    expect(a.shouldGenerate).toBe(true);
    expect(b.shouldGenerate).toBe(true);
    expect(c.shouldGenerate).toBe(true);
    expect(onGenerate).toHaveBeenCalledTimes(3);
  });

  it("keeps independent counters and dedup state per speaker", () => {
    const { gate, onGenerate } = makeGate();

    const g = gate.commitTurn(CALL, "GST", "the booking is for two people");
    const h = gate.commitTurn(CALL, "HON", "the booking is for two people");

    // Same text on the other speaker is NOT a duplicate (cross-track echo is
    // handled separately in the websocket layer, not here).
    expect(g.shouldGenerate).toBe(true);
    expect(h.shouldGenerate).toBe(true);
    expect(g.utteranceId).toBe(1);
    expect(h.utteranceId).toBe(1);
    expect(onGenerate).toHaveBeenCalledTimes(2);
  });

  it("increments utteranceId across successive turns for one speaker", () => {
    const { gate } = makeGate();

    const r1 = gate.commitTurn(CALL, "GST", "first complete sentence here");
    const r2 = gate.commitTurn(CALL, "GST", "second complete sentence here");
    const r3 = gate.commitTurn(CALL, "GST", "third complete sentence here");

    expect([r1.utteranceId, r2.utteranceId, r3.utteranceId]).toEqual([1, 2, 3]);
  });

  it("forgets dedup state after cleanup for the call", () => {
    const { gate, onGenerate } = makeGate();

    gate.commitTurn(CALL, "GST", "please confirm my reservation");
    gate.cleanup(CALL);
    const after = gate.commitTurn(CALL, "GST", "please confirm my reservation");

    expect(after.shouldGenerate).toBe(true);
    expect(after.utteranceId).toBe(1); // counter reset by cleanup
    expect(onGenerate).toHaveBeenCalledTimes(2);
  });
});
