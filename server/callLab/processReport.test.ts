import { describe, expect, it } from "vitest";
import { processReport, renderProcessLetter } from "./processReport";
import { recordUiVisibility, registerLatencyRecorder, unregisterLatencyRecorder, uiVisibilitySnapshot } from "../latencyAck";
import { LiveLatencyRecorder } from "../candidatePipeline";

describe("v3 process plan/fact", () => {
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
  it("renders synthetic warning, eight lines and missing phone telemetry", () => {
    const mail = renderProcessLetter({ synthetic: true, duration_ms: 120000, qa_status: "НЕ ПРОВЕРЕНО QA" });
    expect(mail.subject).toContain("процесс ?");
    expect(mail.body).toContain("СИНТЕТИЧЕСКИЙ ПРИМЕР v3");
    expect(mail.body.match(/План:/g)).toHaveLength(8);
    expect(mail.body).toContain("нет подтверждённой телеметрии");
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
