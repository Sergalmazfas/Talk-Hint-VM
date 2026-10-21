import { describe, expect, it } from "vitest";
import { pcm24kToMulaw8k } from "../secretary/agent";
import { ulawToPcm } from "../../client/src/lib/secretary-lab";

describe("Actual clone PCM → native Secretary → browser audio decoder", () => {
  it.each([12_000, 12_001, 12_002])("keeps pitch, duration and clarity with %i source samples", sampleCount => {
    const pcm = Buffer.alloc(sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / 24_000) * 10_000), i * 2);
    const wire = pcm24kToMulaw8k(pcm);
    expect(wire.length).toBe(4000);
    let crossings = 0, signal = 0, error = 0, previous = 0;
    for (let i = 0; i < wire.length; i++) {
      const expected = pcm.readInt16LE(i * 6), decoded = ulawToPcm(wire[i]);
      if (decoded > 0 && previous <= 0) crossings++;
      previous = decoded;
      signal += expected ** 2; error += (decoded - expected) ** 2;
    }
    expect(crossings).toBe(220);
    expect(10 * Math.log10(signal / error)).toBeGreaterThan(30);
  });
});
