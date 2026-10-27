import { describe, expect, it } from "vitest";
import { processReport, renderProcessLetter } from "./processReport";
import { savedMintDiagnostic } from "./manualDiagnostic";
import { recordUiVisibility, registerLatencyRecorder, unregisterLatencyRecorder, uiVisibilitySnapshot } from "../latencyAck";
import { LiveLatencyRecorder } from "../candidatePipeline";

describe("v3 process plan/fact", () => {
  it("preserves the exact saved Mint scope and distinguishes ACK from UI claims", () => {
    const source = { call_id: "CA0d57ac3746143478fd70c1c624d14412",
      hints: [
        { id: "1", outcome: "sent", text: "Thank you.", delivered_at: 100, stt_final_at: 0 },
        { id: "2", outcome: "sent", text: "Yes.", delivered_at: 200, stt_final_at: 100 },
        { id: "4", outcome: "dropped", drop_reason: "cooldown" },
        { id: "16", outcome: "sent", text: 'If found: "the reset menu now."', delivered_at: 300, stt_final_at: 200 },
      ], ui_visibility: { events: [{ kind: "hint", utteranceId: 2 },
        { kind: "translation_ru", utteranceId: 2 }] },
      latency_summary: { brainP50Ms: 2017, brainP95Ms: 3491, deliveryP50Ms: 121, deliveryP95Ms: 129 } };
    const diagnostic = savedMintDiagnostic(source);
    expect(diagnostic.acknowledged_without_ui_ids).toEqual(["1", "16"]);
    expect(diagnostic.answers.map(a => a.id)).toEqual(["D1", "D2", "D3", "D4", "D5"]);
    expect(diagnostic.answers[2].answer).toContain("Рост не доказан");
    expect(diagnostic.answers[3].answer).toContain("серверном тексте");
    expect(diagnostic.answers[4].answer).toContain("причина");
    expect(() => savedMintDiagnostic({ ...source, call_id: "other" })).toThrow("DIAGNOSTIC_CALL_SCOPE_REQUIRED");
  });
  it("renders a short manual-only letter from code numbers and preserves QA refusal", () => {
    const manual_diagnostic = { version: 1, acknowledged_without_ui_ids: ["1"],
      answers: [{ id: "D1", question: "Почему?", answer: "Причина по коду; правомерность неизвестна." }] };
    const mail = renderProcessLetter({
      manual_trigger: true, manual_diagnostic, environment: "development",
      qa_status: "QA: расхождения не устранены",
      qa_issues: ["#16: категория ошибочная не подтверждена контекстом"],
      analysis: { summary_ru: "Предварительный разбор.", findings: [
        { category: "ошибочная", event_id: "16" },
      ] }, deterministic: { recorded_attempts: 24, with_recorded_text: 14,
        sent: 14, acknowledged: 14, hints_ui_claimed: 11,
        translations_ui_claimed: 11, dropped: 10, drop_reasons: { cooldown: 3 },
        stt_final_to_ack_ms: { p50: 2154, p95: 3617, samples: 14 } },
    });
    expect(mail.body).toContain("создано с сохранённым текстом 14");
    expect(mail.body).toContain("ACK 14; отметок показа на iPhone 11");
    expect(mail.body).toContain("STT final→ACK: p50 2154 / p95 3617");
    expect(mail.body).toContain("ошибочная: #16");
    expect(mail.body).toContain("#16: категория ошибочная не подтверждена");
    expect(mail.body).toContain("Причина по коду; правомерность неизвестна");
    expect(mail.body).not.toContain("100%");
    expect(renderProcessLetter({ synthetic: true }).body).not.toContain("ПЯТЬ ВОПРОСОВ");
  });
  it("has eight stages, no fabricated denominator, and goal outside conversion", () => {
    const p = processReport({ metrics: { assessed_events: 4 }, analysis: { findings: [] } });
    expect(p.version).toBe(3);
    expect(p.rows).toHaveLength(8);
    expect(p.percent).toBeNull();
    expect(p.goalSeparate).toBe(true);
    expect(p.rows.every(r => r.fact === "?")).toBe(true);
  });
  it("calculates used/needed only with verified rubric and evidence", () => {
    const process_rubric = { verification: "independently_verified", evidence: "synthetic rubric fixture",
      rubric_version: "fixture-only", used_hints: 2, needed_moments: 4 };
    expect(processReport({ process_rubric }).percent).toBe(50);
    expect(processReport({ process_rubric: { ...process_rubric, verification: "AI_suggestion" } }).percent).toBeNull();
    for (const patch of [{ used_hints: 5 }, { used_hints: -1 }, { needed_moments: 0 }, { needed_moments: null }, { evidence: "" }]) {
      expect(processReport({ process_rubric: { ...process_rubric, ...patch } }).percent).toBeNull();
    }
  });
  it("renders a compact synthetic warning, eight stages and unknown measurements", () => {
    const mail = renderProcessLetter({ synthetic: true, duration_ms: 120000, qa_status: "НЕ ПРОВЕРЕНО QA" });
    expect(mail.subject).toContain("процесс ?");
    expect(mail.body).toContain("СИНТЕТИЧЕСКИЙ ПРИМЕР v3");
    expect(mail.body).toContain("План — 100% применимых случаев");
    expect(mail.body).toContain("Первая фраза: ?");
    expect(mail.body).toContain("Измерения: нет сохранённого снимка");
    expect(mail.body).not.toContain("94%");
  });
  it("does not turn telemetry receipt into timely visibility or a successful goal", () => {
    const p = processReport({ ui_visibility: { events: [{ kind: "hint" }] } });
    expect(p.rows.find(r => r.id === "hint_before_reply")?.fact).toBe("?");
    expect(p.rows.find(r => r.id === "goal_achieved")?.fact).toBe("?");
  });
  it("links only the private report route on a known environment origin", () => {
    const mail = renderProcessLetter({ environment: "production", private_report_path: "/api/admin/call-lab/reports/abc123" });
    expect(mail.body).toContain("https://talkhint.app/api/admin/call-lab/reports/abc123");
    expect(renderProcessLetter({ private_report_path: "https://evil.invalid" }).body).not.toContain("evil.invalid");
  });
});

describe("visibility receiver", () => {
  it("records Prepare separately from generated hints and never calls it spoken", () => {
    const recorder = new LiveLatencyRecorder();
    registerLatencyRecorder("opening-fixture", "owner", recorder);
    const event = { callSid: "opening-fixture", origin: "prepare", kind: "opening",
      presentationId: "01234567-89ab-cdef-0123-456789abcdef",
      visibleAt: new Date().toISOString(), build: "fixture" };
    expect(recordUiVisibility("other", event)).toBe(false);
    expect(recordUiVisibility("owner", { ...event, presentationId: "invalid" })).toBe(false);
    expect(recordUiVisibility("owner", event)).toBe(true);
    expect(recordUiVisibility("owner", event)).toBe(false);
    expect(uiVisibilitySnapshot(event.callSid)[0].basis).toContain("not proof spoken");
    unregisterLatencyRecorder(event.callSid);
  });
  it("is owner/call scoped, deduplicated, bounded and cleaned with the existing recorder", () => {
    const recorder = new LiveLatencyRecorder();
    recorder.start(1, Date.now()); recorder.sent(1);
    registerLatencyRecorder("visibility-fixture", "owner", recorder);
    const event = { callSid: "visibility-fixture", kind: "hint", utteranceId: 1,
      visibleAt: new Date().toISOString(), build: "fixture" };
    expect(recordUiVisibility("other", event)).toBe(false);
    expect(recordUiVisibility("owner", { ...event, utteranceId: 999 })).toBe(false);
    expect(recordUiVisibility("owner", { ...event, visibleAt: "invalid" })).toBe(false);
    expect(recordUiVisibility("owner", { ...event, kind: "read" })).toBe(false);
    expect(recordUiVisibility("owner", event)).toBe(true);
    expect(recordUiVisibility("owner", event)).toBe(false);
    expect(uiVisibilitySnapshot(event.callSid)).toHaveLength(1);
    expect(JSON.stringify(uiVisibilitySnapshot(event.callSid))).not.toContain("transcript");
    unregisterLatencyRecorder(event.callSid);
    expect(recordUiVisibility("owner", event)).toBe(false);
  });
});
