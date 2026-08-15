// Task #201 — unified comparable EARS scoring.
// Per-turn alignment must be PROVABLE from explicit audio-timeline evidence
// on BOTH sides: reference turn boundaries (tEndMs) AND provider-reported
// audio offsets on every candidate final. Candidate text, final counts,
// receipt order and receipt wall-clock time are never proof — when the
// evidence is missing, per-turn metrics are unavailable, never inferred.

import { describe, it, expect } from "vitest";
import { alignProvably } from "../benchmark/earsHarness";
import { buildScorecardRow } from "../benchmark/earsMetrics";
import { generateEarsReport } from "../benchmark/report";
import type { ReferenceTurn } from "../benchmark/types";

const turn = (idx: number, text: string, tEndMs?: number): ReferenceTurn =>
  ({ idx, role: "owner", text, ...(tEndMs !== undefined ? { tEndMs } : {}) } as ReferenceTurn);

const fin = (text: string, audioEndMs: number | null, atMs = 1000, eot = true) =>
  ({ text, atMs, isEndOfTurn: eot, audioEndMs });

describe("alignProvably: refuses everything that is not audio-timeline proof", () => {
  it("count mismatch + no metadata => unavailable, empty hyp slots", () => {
    const refs = [turn(0, "a"), turn(1, "b"), turn(2, "c")];
    const { basis, aligned } = alignProvably([fin("whatever", null)], refs);
    expect(basis).toBe("unavailable");
    expect(aligned).toHaveLength(3);
    expect(aligned.every((a) => a.hypText === "")).toBe(true);
  });

  it("EQUAL COUNT is NOT proof: same number of finals as turns is refused without audio offsets", () => {
    // Counterexample the rule exists for: an STT that merges turn 0+1 into
    // one final and splits turn 2 into two keeps the count at 3 — positional
    // 1:1 would score every turn against the wrong text.
    const refs = [turn(0, "alpha"), turn(1, "bravo"), turn(2, "charlie")];
    const { basis } = alignProvably(
      [fin("alpha bravo", null), fin("char", null), fin("lie", null)],
      refs
    );
    expect(basis).toBe("unavailable");
  });

  it("never uses candidate text: identical texts do not rescue an unprovable mapping", () => {
    const refs = [turn(0, "alpha"), turn(1, "bravo"), turn(2, "charlie delta")];
    const { basis } = alignProvably([fin("charlie delta", null)], refs);
    expect(basis).toBe("unavailable");
  });

  it("reference boundaries alone are not enough — every final needs an audio offset", () => {
    const refs = [turn(0, "a", 4000), turn(1, "b", 9000)];
    const { basis } = alignProvably([fin("x", 4100), fin("y", null)], refs);
    expect(basis).toBe("unavailable");
  });

  it("audio offsets alone are not enough — every reference turn needs tEndMs (monotonic)", () => {
    expect(alignProvably([fin("x", 100)], [turn(0, "a", 5000), turn(1, "b")]).basis).toBe("unavailable");
    expect(alignProvably([fin("x", 100)], [turn(0, "a", 5000), turn(1, "b", 3000)]).basis).toBe("unavailable");
  });

  it("empty reference => unavailable", () => {
    expect(alignProvably([fin("x", 1)], []).basis).toBe("unavailable");
  });
});

describe("alignProvably: audio-timeline basis (tEndMs × provider audio offsets)", () => {
  it("assigns each final to the unique turn whose boundary interval contains its audio end", () => {
    const refs = [turn(0, "first", 4000), turn(1, "second", 9000)];
    const { basis, aligned } = alignProvably(
      [fin("hello", 3800), fin("world", 8700)],
      refs
    );
    expect(basis).toBe("timestamps");
    expect(aligned[0].hypText).toBe("hello");
    expect(aligned[1].hypText).toBe("world");
  });

  it("receipt time is irrelevant — a final delivered very late still maps by its audio offset", () => {
    const refs = [turn(0, "first", 4000), turn(1, "second", 9000)];
    // Delivered at harness time 999999 (long after everything) but the audio
    // segment ended at 3.5s → turn 0.
    const { aligned } = alignProvably([fin("late delivery", 3500, 999999)], refs);
    expect(aligned[0].hypText).toBe("late delivery");
    expect(aligned[1].hypText).toBe("");
  });

  it("merged segmentation lands where the audio says, not 1:1 by order", () => {
    // One final covering both turns' audio (ends inside turn 1's interval)
    // maps to turn 1; turn 0 stays a miss. No positional guessing.
    const refs = [turn(0, "first", 4000), turn(1, "second", 9000)];
    const { aligned } = alignProvably([fin("first second", 8800)], refs);
    expect(aligned[0].hypText).toBe("");
    expect(aligned[1].hypText).toBe("first second");
  });

  it("concatenates multiple finals whose audio ends inside the same turn", () => {
    const refs = [turn(0, "only", 60000)];
    const { aligned } = alignProvably(
      [fin("part one", 10000), fin("part two", 20000)],
      refs
    );
    expect(aligned[0].hypText).toBe("part one part two");
  });

  it("audio ending after the last boundary belongs to the last turn (no later turn exists)", () => {
    const refs = [turn(0, "only", 6000)];
    const { basis, aligned } = alignProvably([fin("tail", 12000)], refs);
    expect(basis).toBe("timestamps");
    expect(aligned[0].hypText).toBe("tail");
  });
});

describe("scorecard: word-weighted channel WER + per-turn basis surfaced", () => {
  it("weights overall WER by reference word count, keeps per-role split", () => {
    const row = buildScorecardRow({
      candidateId: "x", label: "X",
      // owner channel: WER 0.9 over 100 words; guest channel: WER 0.1 over 900 words
      wer: [0.9, 0.1],
      werWeights: [100, 900],
      roles: ["owner", "guest"],
      semantic: [0.5, 0.9],
      moneyAcc: [null, null],
      digitsAcc: [null, null],
      termsAcc: [null, null],
      prematureEotFlags: [],
      falseWaitFlags: [],
      eotLatencies: [],
      finalLatencies: [],
      perTurnBases: ["unavailable", "timestamps"],
      perTurnScored: 35,
    });
    expect(row.wer).toBeCloseTo(0.18); // weighted, not the plain mean of 0.5
    expect(row.ownerWer).toBeCloseTo(0.9);
    expect(row.guestWer).toBeCloseTo(0.1);
    expect(row.turnsScored).toBe(35);
    expect(row.channelsScored).toBe(2);
    expect(row.perTurnBasis).toBe("mixed");
  });

  it("uniform basis is reported as-is; legacy inputs keep old behavior", () => {
    const base = {
      candidateId: "x", label: "X",
      wer: [0.2, 0.4] as Array<number | null>,
      semantic: [1, 1] as Array<number | null>,
      moneyAcc: [null, null] as Array<number | null>,
      digitsAcc: [null, null] as Array<number | null>,
      prematureEotFlags: [] as Array<boolean | null>,
      falseWaitFlags: [] as Array<boolean | null>,
      eotLatencies: [] as Array<number | null>,
      finalLatencies: [] as Array<number | null>,
    };
    const uniform = buildScorecardRow({ ...base, perTurnBases: ["timestamps", "timestamps"] });
    expect(uniform.perTurnBasis).toBe("timestamps");
    // Legacy shape (no weights, no bases): plain mean, turnsScored = samples.
    const legacy = buildScorecardRow(base);
    expect(legacy.wer).toBeCloseTo(0.3);
    expect(legacy.turnsScored).toBe(2);
    expect(legacy.perTurnBasis).toBeNull();
  });
});

describe("EARS report states the unified comparability rule", () => {
  it("mentions channel-level scoring and the provable-mapping restriction", () => {
    const report = generateEarsReport({
      availability: [],
      scorecard: [{
        candidateId: "dg-flux-general-en", label: "flux", semantic: 0.5, semanticIsProxy: true,
        wer: 0.4, ownerWer: 0.5, guestWer: 0.3, numbersMoney: null, terms: null,
        referenceOnly: false, roleSplit: null, prematureEot: null, falseWait: null,
        eotP50: null, finalP50: null, costEstimate: null, turnsScored: 0,
        channelsScored: 2, perTurnBasis: "unavailable",
      }],
      notes: [],
      fixtureTitles: ["Fixture #2"],
    });
    expect(report).toContain("CHANNEL-LEVEL");
    expect(report).toContain("provable WITHOUT the candidate's own text");
    expect(report).toContain("| unavailable |");
    // Generated artifacts must NEVER claim count/positional alignment — the
    // only accepted basis is audio-timeline evidence.
    expect(report.toLowerCase()).not.toContain("exact count");
    expect(report.toLowerCase()).not.toContain("positional");
  });
});
