// Analyze-endpoint payload preparation (Run #2 forensic review): over-cap
// payloads and client-reported drops must mark the analysis truncated so the
// analyzer fail-closes — partial evidence can never yield PROVEN/DISPROVEN
// verdicts or a claimed first 1→1 break.
import { describe, it, expect } from "vitest";
import { prepareForensicEntries, FORENSIC_ENTRY_CAP } from "../translation/spike";
import { analyzeForensicLog } from "../translation/forensics";

const entry = (seq: number, type = "mic_audio") => ({ seq, ts: 1000 + seq, type });

describe("prepareForensicEntries (endpoint cap honesty)", () => {
  it("under the cap with no client drops: complete, not truncated", () => {
    const { entries, truncated, droppedEntries } = prepareForensicEntries([entry(0), entry(1)], 0);
    expect(entries).toHaveLength(2);
    expect(truncated).toBe(false);
    expect(droppedEntries).toBe(0);
  });

  it("over the cap: overflow is COUNTED and marks the analysis truncated", () => {
    const raw = Array.from({ length: FORENSIC_ENTRY_CAP + 5 }, (_, i) => entry(i));
    const { entries, truncated, droppedEntries } = prepareForensicEntries(raw, 0);
    expect(entries).toHaveLength(FORENSIC_ENTRY_CAP);
    expect(truncated).toBe(true);
    expect(droppedEntries).toBe(5);
  });

  it("client-reported browser drops mark the analysis truncated even under the cap", () => {
    const { truncated, droppedEntries } = prepareForensicEntries([entry(0)], 7);
    expect(truncated).toBe(true);
    expect(droppedEntries).toBe(7);
  });

  it("end-to-end: an over-cap payload containing violation evidence still yields only INCONCLUSIVE and no first break", () => {
    const raw: any[] = Array.from({ length: FORENSIC_ENTRY_CAP + 1 }, (_, i) => entry(i));
    raw[10] = {
      seq: 10,
      ts: 1010,
      type: "invariant_violation",
      code: "RESPONSE_WITHOUT_SOURCE_TURN",
      detail: "x",
      responseId: "resp_1",
    };
    const { entries, truncated, droppedEntries } = prepareForensicEntries(raw, 0);
    const report = analyzeForensicLog(entries, { truncated, droppedEntries });
    expect(report.truncated).toBe(true);
    expect(report.firstOneToOneBreak).toBeNull();
    for (const s of Object.values(report.suspicions)) expect(s.verdict).toBe("INCONCLUSIVE");
  });
});
