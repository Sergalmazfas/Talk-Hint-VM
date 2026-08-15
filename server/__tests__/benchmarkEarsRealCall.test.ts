// Task: LIVE EARS Benchmark on the first REAL recorded call.
// Covers: dual-channel WAV splitting at original telephone quality,
// per-role (Owner/Guest) WER, domain-term accuracy, and the EARS report's
// Best-for-Owner / Best-for-Guest conclusions with the batch accuracy
// ceiling excluded from LIVE winners.

import { describe, it, expect } from "vitest";
import { parseWav, splitWavChannels, pcm16ToMulawSample } from "../benchmark/audioChannels";
import { termsAccuracy, buildScorecardRow } from "../benchmark/earsMetrics";
import { generateEarsReport } from "../benchmark/report";

function buildStereoPcmWav(samplesL: number[], samplesR: number[], sampleRate = 8000): Buffer {
  const frames = Math.min(samplesL.length, samplesR.length);
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(samplesL[i], i * 4);
    data.writeInt16LE(samplesR[i], i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii"); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("audioChannels: dual-channel WAV split (original telephone quality)", () => {
  it("de-interleaves channels without touching sample values", () => {
    const left = [100, -200, 300, -400];
    const right = [-1000, 2000, -3000, 4000];
    const wav = buildStereoPcmWav(left, right);
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(8000);
    expect(parsed.channels).toBe(2);

    const { channels } = splitWavChannels(wav);
    expect(channels).toHaveLength(2);
    // Per-channel WAV keeps the ORIGINAL samples (no enhancement/resampling).
    const ch0 = parseWav(channels[0].wav);
    for (let i = 0; i < left.length; i++) expect(ch0.data.readInt16LE(i * 2)).toBe(left[i]);
    // μ-law stream is the standard G.711 transcode of those same samples.
    expect(channels[0].mulaw8k[0]).toBe(pcm16ToMulawSample(100));
    expect(channels[1].mulaw8k[1]).toBe(pcm16ToMulawSample(2000));
    expect(channels[0].mulaw8k.length).toBe(left.length);
  });

  it("rejects non-8kHz audio honestly instead of silently resampling", () => {
    const wav = buildStereoPcmWav([1, 2], [3, 4], 16000);
    expect(() => splitWavChannels(wav)).toThrow(/8kHz/);
  });
});

describe("termsAccuracy: domain terms (eSIM, SMS code, ...)", () => {
  it("scores only terms that appear in the reference turn", () => {
    // "esim" present in ref and hyp; "sms code" present in ref, lost in hyp.
    const acc = termsAccuracy(["eSIM", "SMS code", "port-in"], "I need an eSIM and the SMS code", "I need an eSIM and the message");
    expect(acc).toBe(0.5);
    // Term not in the reference turn => nothing applicable => null.
    expect(termsAccuracy(["port-in"], "hello there", "hello there")).toBeNull();
    expect(termsAccuracy([], "eSIM", "eSIM")).toBeNull();
  });
});

describe("per-role scorecard: Owner WER vs Guest WER", () => {
  it("splits WER by the role of each scored turn", () => {
    const row = buildScorecardRow({
      candidateId: "x", label: "X",
      wer: [0.5, 0.1, 0.3, 0.1],
      roles: ["owner", "guest", "owner", "guest"],
      semantic: [1, 1, 1, 1],
      moneyAcc: [null, null, null, null],
      digitsAcc: [null, null, null, null],
      termsAcc: [1, null, 0, null],
      prematureEotFlags: [null, null, null, null],
      falseWaitFlags: [null, null, null, null],
      eotLatencies: [null, null, null, null],
      finalLatencies: [null, null, null, null],
      referenceOnly: false,
    });
    expect(row.ownerWer).toBeCloseTo(0.4);
    expect(row.guestWer).toBeCloseTo(0.1);
    expect(row.terms).toBeCloseTo(0.5);
    expect(row.referenceOnly).toBe(false);
  });
});

describe("missed reference turns are full deletions, never free", () => {
  it("a candidate that drops half the turns gets WER 1.0 for each missed turn", () => {
    // Two owner turns transcribed perfectly, two missed entirely.
    const row = buildScorecardRow({
      candidateId: "x", label: "X",
      wer: [0, 0, 1, 1], // harness pushes 1.0 for empty-hypothesis turns
      roles: ["owner", "owner", "owner", "owner"],
      semantic: [1, 1, 0, 0],
      moneyAcc: [null, null, null, null],
      digitsAcc: [null, null, null, null],
      termsAcc: [null, null, null, null],
      prematureEotFlags: [null, null, null, null],
      falseWaitFlags: [null, null, null, null],
      eotLatencies: [null, null, null, null],
      finalLatencies: [null, null, null, null],
      referenceOnly: false,
    });
    expect(row.ownerWer).toBeCloseTo(0.5);
    expect(row.wer).toBeCloseTo(0.5);
    expect(row.turnsScored).toBe(4);
  });
});

describe("EARS report: Owner-first conclusions, batch is a ceiling not a winner", () => {
  const mkRow = (candidateId: string, wer: number, ownerWer: number, guestWer: number, referenceOnly = false) => ({
    candidateId, label: candidateId, semantic: 0.9, semanticIsProxy: true as const,
    wer, ownerWer, guestWer, numbersMoney: null, terms: null, referenceOnly,
    roleSplit: null, prematureEot: null, falseWait: null, eotP50: null, finalP50: 400, costEstimate: null, turnsScored: 10,
  });

  it("declares Best-for-Owner and Best-for-Guest among LIVE only; batch shown as ceiling", () => {
    const report = generateEarsReport({
      availability: [{ candidateId: "dg-flux-general-en", status: "AVAILABLE", checkedAt: "", detail: "ok" }],
      scorecard: [
        mkRow("dg-flux-general-en", 0.30, 0.40, 0.20),
        mkRow("dg-nova-3-multi", 0.28, 0.25, 0.31),
        // Batch is the most accurate overall — but must never be a LIVE winner.
        mkRow("oai-batch-gpt-4o-transcribe", 0.10, 0.12, 0.08, true),
      ],
      notes: ["note-1"],
      fixtureTitles: ["Real Call Fixture #1 — Mint Mobile / eSIM support"],
    });
    const ownerSection = report.split("## Best STT for Guest")[0];
    expect(ownerSection).toContain("Best STT for Owner speech");
    expect(ownerSection).toContain("**dg-nova-3-multi**"); // lowest Owner WER among LIVE
    expect(ownerSection).not.toContain("oai-batch");
    const guestSection = report.split("## Best STT for Guest")[1].split("## Accuracy ceiling")[0];
    expect(guestSection).toContain("**dg-flux-general-en**"); // lowest Guest WER among LIVE
    expect(report).toContain("Accuracy ceiling");
    expect(report).toContain("oai-batch-gpt-4o-transcribe");
    expect(report).toContain("No candidate is auto-assigned as production winner");
  });

  it("draws no conclusion when no LIVE candidate scored Owner turns", () => {
    const report = generateEarsReport({
      availability: [],
      scorecard: [mkRow("oai-batch-gpt-4o-transcribe", 0.1, 0.1, 0.1, true)],
      notes: [],
      fixtureTitles: ["f"],
    });
    expect(report).toContain("no conclusion can be drawn");
  });
});
