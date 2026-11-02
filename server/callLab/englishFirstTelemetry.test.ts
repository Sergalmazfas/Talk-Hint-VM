import { describe, expect, it, vi } from "vitest";
import { LiveLatencyRecorder } from "../candidatePipeline";
import { authorizedHintSource } from "./source";
import { hintMeasurements } from "./measurements";
import { completeLabReport } from "./processReport";

describe("English-first saved call → lab telemetry", () => {
  it("preserves Hint identity, English/native stages, ACK and usage through the lab report", () => {
    vi.useFakeTimers();
    try {
      const r = new LiveLatencyRecorder();
      vi.setSystemTime(1000);
      r.start(1, 1000); r.responseMode(1, "english-first"); r.trigger(1);
      vi.setSystemTime(1400); r.ready(1, "gpt"); r.sent(1, "What is the price?");
      vi.setSystemTime(1500); r.delivered(1);
      vi.setSystemTime(1900); r.translationReady(1); r.translationSent(1);
      const metadata = r.toMetadata({ enabled: false, stt: null, brainModel: null }, undefined,
        [{ text: "What is the price?", ts: 1600 }]);
      expect(metadata.hintResponseMode).toBe("english-first");
      const call = { user_id: "owner", call_sid: "synthetic", lab_mode: "hint",
        started_at: "2026-11-02T10:00:00Z", ended_at: "2026-11-02T10:01:00Z",
        transcript: "Guest: Hello. Owner: What is the price?", metadata: {
          ...metadata, mode: "hint", hintTelemetry: { state: "ready" },
          labHintSource: { mode: "hint", environment: "development" },
        } };
      const source = authorizedHintSource(call, { owner_id: "owner", enabled: true,
        activated_at: "2026-11-02T09:00:00Z", environment: "development" }, "development")!;
      expect(source.mode).toBe("hint");
      expect(source.response_modes).toEqual(["english-first"]);
      expect(source.hints[0]).toMatchObject({ english_ready_at: 1400, translation_ready_at: 1900,
        translation_sent_at: 1900, delivered_at: 1500 });
      const report = completeLabReport({ execution: "mocked_synthetic_analysis" }, source, "a".repeat(64));
      expect(report.deterministic).toMatchObject({ sent: 1, acknowledged: 1,
        stt_final_to_english_ready_ms: { samples: 1, p50: 400 },
        stt_final_to_translation_ready_ms: { samples: 1, p50: 900 },
        hint_usage: { delivered: 1, usedFull: 1 } });
      expect(source.hints[0]).not.toHaveProperty("speech_end_at");
    } finally { vi.useRealTimers(); }
  });
  it("does not invent a variant, speech end or translation timestamp for historical calls", () => {
    const m = hintMeasurements({ hints: [{ outcome: "sent", stt_final_at: 1000, english_ready_at: 1200 }] });
    expect(m.stt_final_to_translation_ready_ms).toMatchObject({ samples: 0, p50: null });
    expect(m.hint_usage).toBeNull();
  });
  it("records mixed rollback turns instead of falsely labelling the whole call English-first", () => {
    const r = new LiveLatencyRecorder();
    r.start(1, 1000); r.responseMode(1, "english-first");
    r.start(2, 2000); r.responseMode(2, "legacy");
    expect(r.toMetadata({ enabled: false, stt: null, brainModel: null }).hintResponseMode).toBe("mixed");
  });
});
