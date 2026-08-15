// Task: EARS Fixture #2 owner-turn human verification.
import { describe, it, expect } from "vitest";
import { sliceMonoWav } from "../benchmark/audioChannels";
import { generateEarsReport } from "../benchmark/report";

function monoWav(samples: number, sampleRate = 8000): Buffer {
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE((i % 100) - 50, i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii"); h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("sliceMonoWav (per-turn playback clips)", () => {
  it("slices the requested window with clamped bounds", () => {
    const wav = monoWav(8000); // 1s @ 8kHz
    const clip = sliceMonoWav(wav, 250, 500); // 0.25s = 2000 samples
    expect(clip.length).toBe(44 + 2000 * 2);
    // Way-out-of-range end is clamped to file end, not an error.
    const tail = sliceMonoWav(wav, 900, 99999);
    expect(tail.length).toBe(44 + 800 * 2);
  });

  it("rejects an empty window (honest failure, no silent zero-length audio)", () => {
    const wav = monoWav(8000);
    expect(() => sliceMonoWav(wav, 500, 500)).toThrow(/empty slice/);
  });
});

describe("EARS report realtime shortlist + verification status", () => {
  const scorecard: any[] = [
    { candidateId: "dg-flux-general-en", wer: 0.30, ownerWer: 0.40, guestWer: 0.20, turnsScored: 5, channelsScored: 2 },
    { candidateId: "oai-realtime-semantic-vad", wer: 0.25, ownerWer: 0.28, guestWer: 0.22, turnsScored: 5, channelsScored: 2 },
    { candidateId: "dg-nova-3-multi", wer: 0.35, ownerWer: 0.33, guestWer: 0.37, turnsScored: 5, channelsScored: 2 },
    { candidateId: "oai-batch-gpt-4o-transcribe", referenceOnly: true, wer: 0.10, ownerWer: 0.12, guestWer: 0.08, turnsScored: 5, channelsScored: 2 },
  ];

  it("ranks realtime candidates by Owner WER, caps the shortlist at 2, and includes honest caveats", () => {
    const report = generateEarsReport({
      availability: [], notes: [], fixtureTitles: ["Fixture #2"],
      scorecard,
      realtimeIds: ["dg-flux-general-en", "oai-realtime-semantic-vad", "dg-nova-3-multi"],
      humanVerification: ["Fixture #2: 12/18 owner turns human-verified"],
    });
    expect(report).toContain("Realtime shortlist");
    const shortlist = report.slice(report.indexOf("Realtime shortlist"));
    expect(shortlist.indexOf("oai-realtime-semantic-vad")).toBeLessThan(shortlist.indexOf("dg-nova-3-multi"));
    expect(shortlist).toContain("1. **oai-realtime-semantic-vad**");
    expect(shortlist).toContain("2. **dg-nova-3-multi**"); // owner WER 0.33 < flux 0.40
    // Batch ceiling must NEVER enter the shortlist.
    expect(shortlist.slice(0, shortlist.indexOf("## Best STT for Guest"))).not.toContain("oai-batch");
    expect(report).toContain("12/18 owner turns human-verified");
    expect(report).toContain("production Flux");
  });

  it("omits the shortlist section when no realtime ids are passed", () => {
    const report = generateEarsReport({ availability: [], notes: [], fixtureTitles: [], scorecard });
    expect(report).not.toContain("Realtime shortlist");
  });
});

// ---------------------------------------------------------------------------
// Bulk-save metadata preservation: timings & verified flags must never be
// silently destroyed by a full-transcript PUT (mergeReferenceTurns is the
// route's gatekeeper).
// ---------------------------------------------------------------------------

import { mergeReferenceTurns, type IncomingTurn } from "../benchmark/referenceTurns";

describe("mergeReferenceTurns (bulk-save reference integrity)", () => {
  const existing: IncomingTurn[] = [
    { idx: 0, role: "owner", text: "hello there", tStartMs: 0, tEndMs: 2000, verified: true },
    { idx: 1, role: "guest", text: "hi", tStartMs: 500, tEndMs: 1500 },
  ];

  it("same structure: inherits timings positionally and keeps verified for unchanged text", () => {
    const incoming: IncomingTurn[] = [
      { idx: 0, role: "owner", text: "hello there" },
      { idx: 1, role: "guest", text: "hi corrected" },
    ];
    const r = mergeReferenceTurns(existing, incoming, false);
    if (!r.ok) throw new Error(r.error);
    expect(r.turns[0]).toMatchObject({ tStartMs: 0, tEndMs: 2000, verified: true });
    expect(r.turns[1]).toMatchObject({ tStartMs: 500, tEndMs: 1500 });
  });

  it("edited text drops verified (needs re-verification), but never the timings", () => {
    const incoming: IncomingTurn[] = [
      { idx: 0, role: "owner", text: "hello there, friend" },
      { idx: 1, role: "guest", text: "hi" },
    ];
    const r = mergeReferenceTurns(existing, incoming, false);
    if (!r.ok) throw new Error(r.error);
    expect(r.turns[0].verified).toBeUndefined();
    expect(r.turns[0].tEndMs).toBe(2000);
  });

  it("structural change WITHOUT confirmation is rejected — no silent metadata loss", () => {
    const incoming: IncomingTurn[] = [{ idx: 0, role: "owner", text: "only one turn now" }];
    const r = mergeReferenceTurns(existing, incoming, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("confirmDestructive");
  });

  it("structural change WITH explicit confirmation is allowed (intentional reset)", () => {
    const incoming: IncomingTurn[] = [{ idx: 0, role: "owner", text: "only one turn now" }];
    const r = mergeReferenceTurns(existing, incoming, true);
    expect(r.ok).toBe(true);
  });

  it("no existing metadata: incoming passes through untouched", () => {
    const bare: IncomingTurn[] = [{ idx: 0, role: "owner", text: "a" }];
    const r = mergeReferenceTurns(bare, [{ idx: 0, role: "guest", text: "b" }], false);
    expect(r.ok).toBe(true);
  });
});
