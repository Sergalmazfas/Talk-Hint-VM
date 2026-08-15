// Unit tests for EOT (End-of-Turn) boundary scoring in the EARS harness.
//
// These tests prove that prematureEot / falseContinuation / speechEndToEotMs
// are filled in (not null) when the reference turn carries tEndMs ground truth,
// and that the formula correctly converts accelerated harness-clock time back
// to real audio time.

import { describe, it, expect } from "vitest";
import { scoreTurn, REALTIME_ACCEL, PREMATURE_THRESHOLD_MS } from "../benchmark/earsHarness";
import type { Aligned } from "../benchmark/earsHarness";
import { buildScorecardRow } from "../benchmark/earsMetrics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAligned(overrides: Partial<Aligned>): Aligned {
  return {
    refTurn: { idx: 0, role: "owner", text: "hello world" },
    hypText: "hello world",
    hypAtMs: null,
    hypEndOfTurn: null,
    ...overrides,
  };
}

const EMPTY_CRITICAL = { money: [], dates: [], digits: [], names: [], decisions: [] };
// lastFrameSentAtMs > 0 marks this as a realtime stream (batch uses 0)
const REALTIME_LAST_FRAME = 500; // arbitrary non-zero value

// ---------------------------------------------------------------------------
// Formula constants
// ---------------------------------------------------------------------------

describe("REALTIME_ACCEL constant", () => {
  it("is 4 (harness streams at 4x real time)", () => {
    expect(REALTIME_ACCEL).toBe(4);
  });
  it("PREMATURE_THRESHOLD_MS is negative (guards against annotation jitter)", () => {
    expect(PREMATURE_THRESHOLD_MS).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Normal EOT (candidate fires after turn ends)
// ---------------------------------------------------------------------------

describe("scoreTurn: EOT after turn boundary → not premature, not false-wait", () => {
  it("computes speechEndToEotMs in real audio time when candidate fires EOT after tEndMs", () => {
    // Reference turn ended at 3 000 ms in the real audio.
    // Harness (4x speed) → frame for t=3000ms was sent at wall 750ms.
    // Candidate fires EOT at harness wall 900ms (150ms after that frame).
    // Candidate EOT in audio time: 900 * 4 = 3600ms.
    // speechEndToEotMs = 3600 - 3000 = 600ms (candidate took 600ms after turn ended).
    const a = makeAligned({
      refTurn: { idx: 0, role: "owner", text: "hello world", tEndMs: 3000 },
      hypText: "hello world",
      hypAtMs: 900,
      hypEndOfTurn: true,
    });
    const tr = scoreTurn("dg-flux", a, EMPTY_CRITICAL, REALTIME_LAST_FRAME);
    expect(tr.speechEndToEotMs).toBe(600);
    expect(tr.prematureEot).toBe(false);
    expect(tr.falseContinuation).toBe(false);
  });

  it("eotP50 in scorecard is non-null when eotLatencies are populated", () => {
    const row = buildScorecardRow({
      candidateId: "dg-flux", label: "DG Flux",
      wer: [0, 0, 0],
      roles: ["owner", "owner", "owner"],
      semantic: [1, 1, 1],
      moneyAcc: [null, null, null],
      digitsAcc: [null, null, null],
      prematureEotFlags: [false, false, false],
      falseWaitFlags: [false, false, false],
      eotLatencies: [600, 800, 700],
      finalLatencies: [null, null, null],
    });
    expect(row.eotP50).toBe(700);         // median of [600, 700, 800]
    expect(row.prematureEot).toBe(0);     // 0/3 premature
    expect(row.falseWait).toBe(0);        // 0/3 false wait
  });
});

// ---------------------------------------------------------------------------
// Premature EOT (candidate fires BEFORE the reference turn boundary)
// ---------------------------------------------------------------------------

describe("scoreTurn: EOT before turn boundary → premature=true", () => {
  it("flags prematureEot when candidate fires well before tEndMs", () => {
    // Reference turn ends at 5 000 ms.
    // Candidate fires EOT at harness wall 500ms → audio time 500 * 4 = 2000ms.
    // speechEndToEotMs = 2000 - 5000 = -3000ms (massively premature).
    const a = makeAligned({
      refTurn: { idx: 1, role: "owner", text: "please proceed with the transfer", tEndMs: 5000 },
      hypText: "please proceed",
      hypAtMs: 500,
      hypEndOfTurn: true,
    });
    const tr = scoreTurn("dg-flux", a, EMPTY_CRITICAL, REALTIME_LAST_FRAME);
    expect(tr.speechEndToEotMs).toBe(-3000);
    expect(tr.prematureEot).toBe(true);
    expect(tr.falseContinuation).toBe(false);
  });

  it("does NOT flag premature for a small over-annotation jitter within threshold", () => {
    // Candidate EOT at 1ms before boundary → within 200ms tolerance.
    // hypAtMs * 4 - tEndMs = just inside threshold.
    const tEndMs = 4000;
    // We want speechEndToEotMs = PREMATURE_THRESHOLD_MS + 1 = -199 (not premature)
    // hypAtMs * 4 = tEndMs + (-199) = 3801 → hypAtMs = 950.25 ≈ 950
    const hypAtMs = Math.round((tEndMs + PREMATURE_THRESHOLD_MS + 1) / REALTIME_ACCEL);
    const a = makeAligned({
      refTurn: { idx: 0, role: "owner", text: "ok", tEndMs },
      hypText: "ok",
      hypAtMs,
      hypEndOfTurn: true,
    });
    const tr = scoreTurn("dg-flux", a, EMPTY_CRITICAL, REALTIME_LAST_FRAME);
    expect(tr.speechEndToEotMs).not.toBeNull();
    expect(tr.prematureEot).toBe(false); // inside the -200ms tolerance window
  });

  it("the threshold is exclusive: exactly at -200ms is NOT premature (within tolerance)", () => {
    // speechEndToEotMs = PREMATURE_THRESHOLD_MS exactly → premature = false (uses strict <)
    // This ensures -200ms of annotation imprecision does not cause false positives.
    const tEndMs = 4000;
    // hypAtMs * 4 = tEndMs + PREMATURE_THRESHOLD_MS → hypAtMs = (4000 - 200) / 4 = 950
    const hypAtMs = (tEndMs + PREMATURE_THRESHOLD_MS) / REALTIME_ACCEL;
    const a = makeAligned({
      refTurn: { idx: 0, role: "owner", text: "ok", tEndMs },
      hypText: "ok",
      hypAtMs,
      hypEndOfTurn: true,
    });
    const tr = scoreTurn("dg-flux", a, EMPTY_CRITICAL, REALTIME_LAST_FRAME);
    expect(tr.speechEndToEotMs).toBe(PREMATURE_THRESHOLD_MS);
    expect(tr.prematureEot).toBe(false); // exactly at threshold → within tolerance
  });

  it("flags premature one ms beyond the threshold", () => {
    // speechEndToEotMs = PREMATURE_THRESHOLD_MS - 1 → premature = true
    const tEndMs = 4000;
    // We want speech end = PREMATURE_THRESHOLD_MS - 1 = -201ms
    // hypAtMs * 4 - 4000 = -201 → hypAtMs = (4000 - 201) / 4 = 949.75 ≈ 950
    // Use exact integer: hypAtMs=949 → 949*4=3796, 3796-4000=-204 < -200 → premature
    const a = makeAligned({
      refTurn: { idx: 0, role: "owner", text: "ok", tEndMs },
      hypText: "ok",
      hypAtMs: 949,
      hypEndOfTurn: true,
    });
    const tr = scoreTurn("dg-flux", a, EMPTY_CRITICAL, REALTIME_LAST_FRAME);
    expect(tr.speechEndToEotMs).toBe(949 * REALTIME_ACCEL - tEndMs); // -204
    expect(tr.prematureEot).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// False continuation / false wait
// ---------------------------------------------------------------------------

describe("scoreTurn: no EOT signal → falseContinuation when tEndMs known", () => {
  it("sets falseContinuation=true when candidate produced text but no EOT signal", () => {
    const a = makeAligned({
      refTurn: { idx: 0, role: "owner", text: "ok transfer done", tEndMs: 4000 },
      hypText: "ok transfer done",
      hypAtMs: 1100,
      hypEndOfTurn: false, // no EOT event fired
    });
    const tr = scoreTurn("dg-flux", a, EMPTY_CRITICAL, REALTIME_LAST_FRAME);
    expect(tr.falseContinuation).toBe(true);
    expect(tr.prematureEot).toBe(false);
    expect(tr.speechEndToEotMs).toBeNull(); // no EOT fired → no latency to measure
  });

  it("sets falseContinuation=true when candidate produced no output at all (missed turn)", () => {
    const a = makeAligned({
      refTurn: { idx: 0, role: "owner", text: "hello world", tEndMs: 3000 },
      hypText: "",
      hypAtMs: null,
      hypEndOfTurn: null,
    });
    const tr = scoreTurn("dg-flux", a, EMPTY_CRITICAL, REALTIME_LAST_FRAME);
    expect(tr.falseContinuation).toBe(true);
    expect(tr.prematureEot).toBeNull(); // can't tell — no output at all
    expect(tr.speechEndToEotMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No ground truth → all EOT metrics remain null
// ---------------------------------------------------------------------------

describe("scoreTurn: no tEndMs → EOT metrics stay null", () => {
  it("leaves EOT fields null when reference turn has no tEndMs annotation", () => {
    const a = makeAligned({
      refTurn: { idx: 0, role: "owner", text: "hello world" }, // no tEndMs
      hypText: "hello world",
      hypAtMs: 900,
      hypEndOfTurn: true,
    });
    const tr = scoreTurn("dg-flux", a, EMPTY_CRITICAL, REALTIME_LAST_FRAME);
    expect(tr.prematureEot).toBeNull();
    expect(tr.falseContinuation).toBeNull();
    expect(tr.speechEndToEotMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Batch candidates (lastFrameSentAtMs = 0) → EOT metrics always null
// ---------------------------------------------------------------------------

describe("scoreTurn: batch candidate (lastFrameSentAtMs=0) → no EOT metrics", () => {
  it("returns null EOT metrics for batch even when tEndMs is annotated", () => {
    const a = makeAligned({
      refTurn: { idx: 0, role: "owner", text: "hello", tEndMs: 2000 },
      hypText: "hello",
      hypAtMs: 0,       // batch sets hypAtMs=0
      hypEndOfTurn: true,
    });
    const BATCH_LAST_FRAME = 0; // batch: no streaming → lastFrameSentAtMs=0
    const tr = scoreTurn("oai-batch", a, EMPTY_CRITICAL, BATCH_LAST_FRAME);
    // Batch is not realtime → no EOT concept applies.
    expect(tr.prematureEot).toBeNull();
    expect(tr.falseContinuation).toBeNull();
    expect(tr.speechEndToEotMs).toBeNull();
    // speechEndToFinalMs should also be null (non-realtime).
    expect(tr.speechEndToFinalMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scorecard aggregation: mixed premature + false-wait flags
// ---------------------------------------------------------------------------

describe("buildScorecardRow: EOT flag aggregation", () => {
  it("computes correct prematureEot fraction from mixed flags", () => {
    const row = buildScorecardRow({
      candidateId: "x", label: "X",
      wer: [0, 0, 0, 0],
      semantic: [1, 1, 1, 1],
      moneyAcc: [null, null, null, null],
      digitsAcc: [null, null, null, null],
      // 2 premature out of 3 non-null flags
      prematureEotFlags: [false, true, true, null],
      falseWaitFlags: [false, false, true, null],
      eotLatencies: [600, null, null, null],
      finalLatencies: [null, null, null, null],
    });
    expect(row.prematureEot).toBeCloseTo(2 / 3);
    expect(row.falseWait).toBeCloseTo(1 / 3);
    // eotP50: only one non-null → 600
    expect(row.eotP50).toBe(600);
  });

  it("all null flags yield null in the scorecard", () => {
    const row = buildScorecardRow({
      candidateId: "x", label: "X",
      wer: [0],
      semantic: [1],
      moneyAcc: [null],
      digitsAcc: [null],
      prematureEotFlags: [null],
      falseWaitFlags: [null],
      eotLatencies: [null],
      finalLatencies: [null],
    });
    expect(row.prematureEot).toBeNull();
    expect(row.falseWait).toBeNull();
    expect(row.eotP50).toBeNull();
  });
});
