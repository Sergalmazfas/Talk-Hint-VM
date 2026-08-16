import { describe, it, expect } from "vitest";
import {
  computeHintUsage,
  usageScore,
  normalizeTokens,
  USAGE_MATCH_WINDOW_MS,
  type UsageHint,
  type OwnerTurn,
} from "../hintUsage";
import { LiveLatencyRecorder } from "../candidatePipeline";

const T0 = 1_700_000_000_000;

function hint(id: number, text: string | undefined, sentAt: number): UsageHint {
  return { utteranceId: id, text, sentAt, outcome: "sent" };
}
function turn(text: string, ts: number): OwnerTurn {
  return { text, ts };
}

describe("normalizeTokens / usageScore", () => {
  it("normalizes case, punctuation, and drops single-char tokens", () => {
    expect(normalizeTokens("Sure, I'll wait!")).toEqual(["sure", "i'll", "wait"]);
  });

  it("verbatim owner speech scores 1.0 even inside a longer utterance", () => {
    expect(usageScore("Yes, that works for me", "well um yes that works for me thanks")).toBe(1);
  });

  it("unrelated owner speech scores near zero", () => {
    expect(usageScore("Could you send me the invoice?", "the weather is nice today")).toBeLessThan(0.2);
  });

  it("partial reuse of the hint scores in between", () => {
    const s = usageScore(
      "I can offer you a discount if you sign today",
      "I can offer you something better",
    );
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThan(0.75);
  });

  it("empty hint text scores 0", () => {
    expect(usageScore("", "anything")).toBe(0);
  });
});

describe("computeHintUsage", () => {
  it("classifies full, partial, and ignored hints per call", () => {
    const hints = [
      hint(1, "Yes, that works for me", T0),
      hint(2, "I can offer you a discount if you sign the contract today", T0 + 30_000),
      hint(3, "Could you please send me the invoice by email", T0 + 60_000),
    ];
    const turns = [
      turn("yes that works for me", T0 + 3_000), // full for hint 1
      turn("I can offer you a discount maybe", T0 + 35_000), // partial for hint 2
      turn("okay bye now", T0 + 65_000), // ignored for hint 3
    ];
    const r = computeHintUsage(hints, turns);
    expect(r.delivered).toBe(3);
    expect(r.usedFull).toBe(1);
    expect(r.usedPartial).toBe(1);
    expect(r.ignored).toBe(1);
    expect(r.unknown).toBe(0);
    expect(r.usageRatePct).toBe(67);
    expect(r.entries.map((e) => e.verdict)).toEqual(["full", "partial", "ignored"]);
    expect(r.entries[0].matchedOwnerText).toBe("yes that works for me");
    expect(r.entries[2].matchedOwnerText).toBeUndefined();
  });

  it("never attributes owner speech BEFORE the hint was sent", () => {
    const hints = [hint(1, "Yes, that works for me", T0)];
    const turns = [turn("yes that works for me", T0 - 1)];
    const r = computeHintUsage(hints, turns);
    expect(r.entries[0].verdict).toBe("ignored");
  });

  it("attributes an owner turn to the newest hint sent before it, not an older one", () => {
    const hints = [
      hint(1, "yes that works for me", T0),
      hint(2, "no thank you goodbye", T0 + 10_000),
    ];
    // Spoken after hint 2 — window of hint 1 ends at hint 2's sentAt.
    const turns = [turn("yes that works for me", T0 + 15_000)];
    const r = computeHintUsage(hints, turns);
    expect(r.entries[0].verdict).toBe("ignored");
    expect(r.entries[1].verdict).toBe("ignored");
  });

  it("ignores owner speech outside the bounded match window", () => {
    const hints = [hint(1, "yes that works for me", T0)];
    const turns = [turn("yes that works for me", T0 + USAGE_MATCH_WINDOW_MS + 1)];
    const r = computeHintUsage(hints, turns);
    expect(r.entries[0].verdict).toBe("ignored");
  });

  it("counts hints without text as unknown and excludes them from the rate", () => {
    const hints = [
      hint(1, undefined, T0), // pre-text telemetry
      hint(2, "yes that works for me", T0 + 10_000),
    ];
    const turns = [turn("yes that works for me", T0 + 12_000)];
    const r = computeHintUsage(hints, turns);
    expect(r.unknown).toBe(1);
    expect(r.usedFull).toBe(1);
    expect(r.usageRatePct).toBe(100); // 1 used of 1 measurable
  });

  it("dropped hints never count as delivered", () => {
    const r = computeHintUsage(
      [{ utteranceId: 1, text: "hello there friend", outcome: "dropped" }],
      [turn("hello there friend", T0)],
    );
    expect(r.delivered).toBe(0);
    expect(r.usageRatePct).toBeNull();
    expect(r.entries).toHaveLength(0);
  });

  it("all-unknown call reports null usage rate, never a fabricated number", () => {
    const r = computeHintUsage([hint(1, undefined, T0)], []);
    expect(r.usageRatePct).toBeNull();
    expect(r.unknown).toBe(1);
  });
});

describe("LiveLatencyRecorder hint text + hintUsage in metadata", () => {
  it("records the sent hint text and emits hintUsage in toMetadata", () => {
    const rec = new LiveLatencyRecorder();
    rec.start(1, Date.now());
    rec.trigger(1);
    rec.ready(1, "gpt");
    rec.sent(1, "Yes, that works for me");
    const meta = rec.toMetadata({ enabled: false, stt: null, brainModel: null } as any, undefined, [
      { text: "yes that works for me", ts: Date.now() + 1 },
    ]);
    const usage = (meta as any).hintUsage;
    expect(usage.delivered).toBe(1);
    expect(usage.usedFull).toBe(1);
    expect(usage.usageRatePct).toBe(100);
    const entries = (meta as any).hintLatency.entries;
    expect(entries[0].text).toBe("Yes, that works for me");
  });

  it("truncates oversized hint text to keep metadata bounded", () => {
    const rec = new LiveLatencyRecorder();
    rec.start(1, Date.now());
    rec.sent(1, "x".repeat(2000));
    const meta = rec.toMetadata({ enabled: false, stt: null, brainModel: null } as any);
    expect((meta as any).hintLatency.entries[0].text.length).toBe(500);
  });
});
