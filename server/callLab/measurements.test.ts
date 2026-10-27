import { describe, expect, it } from "vitest";
import { hintMeasurements } from "./measurements";
import { completeLabReport, processReport, renderProcessLetter } from "./processReport";
import { labAnalysisFailure } from "./process";

const source = { full_hint_history: false, hints: [
  { id: "1", text: "One", outcome: "sent", stt_final_at: 1000, delivered_at: 1500 },
  { id: "2", text: "Two", outcome: "sent", stt_final_at: 2000, delivered_at: 3000 },
  { id: "3", outcome: "dropped", drop_reason: "cooldown" },
], ui_visibility: { events: [
  { kind: "opening", presentationId: "fixture" },
  { kind: "opening", presentationId: "fixture" },
  { kind: "hint", utteranceId: 1 }, { kind: "hint", utteranceId: 1 },
  { kind: "translation_ru", utteranceId: 1 },
  { kind: "translation_ru", presentationId: "fixture" },
] } };
describe("saved Hint measurements survive AI failure", () => {
  it("distinguishes recorded text, send, ACK, deduplicated UI and translation", () => {
    const m = hintMeasurements(source);
    expect(m).toMatchObject({ recorded_attempts: 3, with_recorded_text: 2, sent: 2,
      acknowledged: 2, dropped: 1, drop_reasons: { cooldown: 1 }, opening_ui_claims: 1,
      hints_ui_claimed: 1, translations_ui_claimed: 1, before_owner_reply_count: null,
      guest_translation_count: null, complete_hint_history: false });
    expect(m.stt_final_to_ack_ms).toMatchObject({ samples: 2, p50: 500, p95: 1000 });
    expect(m.translation_among_ui_claims).toEqual({ numerator: 1, denominator: 1, percent: 100 });
  });
  it("retains measurements and a scoped report link in an unavailable report", () => {
    const report = completeLabReport({ execution: "analysis_not_completed", environment: "production",
      analysis_failure: { code: "MODEL_TIMEOUT" } }, source, "a".repeat(64));
    const p = processReport(report);
    expect(p.percent).toBeNull();
    expect(p.weakLink).toBe("AI-разбор не завершён");
    expect(p.rows.find(r => r.id === "opening_visible")?.fact).toContain("1 отметка");
    expect(p.rows.find(r => r.id === "hint_before_reply")?.fact).toBe("?");
    const letter = renderProcessLetter(report);
    expect(letter.body).toContain("Отправлено 2 · ACK 2 · iPhone 1");
    expect(letter.body).toContain("MODEL_TIMEOUT");
    expect(letter.body).toContain(`https://talkhint.app/api/admin/call-lab/reports/${"a".repeat(64)}`);
  });
  it("does not convert absent data to zero or timestamps to verified timely display", () => {
    const m = hintMeasurements(null);
    expect(m.sent).toBeNull();
    expect(m.opening_ui_claims).toBeNull();
    expect(m.stt_final_to_ack_ms.p50).toBeNull();
    expect(processReport({ deterministic: m }).rows.every(r => r.fact === "?")).toBe(true);
    expect(hintMeasurements({ hints: [{ outcome: "sent", stt_final_at: 5000, delivered_at: 1000 }] })
      .stt_final_to_ack_ms.samples).toBe(0);
  });
  it("retains only allowed structured error codes, never raw exception strings", () => {
    const details = labAnalysisFailure({ diagnostic: { code: "MODEL_TIMEOUT", stage: "analysis",
      http_status: 504, model: "gpt-5.2", prompt: "PRIVATE", api_key: "PRIVATE" } });
    expect(details).toEqual({ code: "MODEL_TIMEOUT", stage: "analysis", http_status: 504, model: "gpt-5.2" });
    expect(JSON.stringify(labAnalysisFailure(new Error("PRIVATE")))).not.toContain("PRIVATE");
    expect(JSON.stringify(labAnalysisFailure({ diagnostic: { code: "PRIVATE", stage: "PRIVATE" } })))
      .not.toContain("PRIVATE");
  });
  it("preserves bounded schema diagnostics without echoing invalid category values", () => {
    const details = labAnalysisFailure({ diagnostic: {
      code: "OUTPUT_SCHEMA_INVALID", stage: "analysis", schema: "Analysis",
      output_shape: "object", output_chars: 10626,
      schema_issues: [{ type: "literal_error", fields: ["findings", 3, "category"], input: "PRIVATE" }],
    } });
    expect(details.output_shape).toBe("object");
    expect(details.output_chars).toBe(10626);
    expect(details.schema_issues).toEqual([{ type: "literal_error", fields: ["findings", 3, "category"] }]);
    expect(JSON.stringify(details)).not.toContain("PRIVATE");
    const unsafe = labAnalysisFailure({ diagnostic: { output_shape: "PRIVATE", output_chars: -1 } });
    expect(unsafe).not.toHaveProperty("output_shape");
    expect(unsafe).not.toHaveProperty("output_chars");
    expect(labAnalysisFailure({ diagnostic: {
      code: "NATIVE_OUTPUT_REQUIRED", stage: "analysis", schema: "Analysis",
    } })).toEqual({ code: "NATIVE_OUTPUT_REQUIRED", stage: "analysis", schema: "Analysis" });
  });
});
