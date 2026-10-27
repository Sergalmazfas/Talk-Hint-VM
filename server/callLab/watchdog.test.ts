import { describe, expect, it } from "vitest";
import { detectHintIncident, renderWatchdogNotice, watchdogPolicy } from "./watchdog";

const now = Date.parse("2026-10-27T10:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const healthy = {
  call_sid: "private-fixture", ended_at: ago(300_000), closed_at: ago(300_000),
  job_key: "job-fixture", job_status: "report_ready", job_created: ago(290_000), job_updated: ago(250_000),
  execution: "crewai", qa_status: "QA: принято", mail_status: "sent_confirmed", mail_updated: ago(240_000),
};
describe("Hint on-call checks (no AI, no external mail)", () => {
  it("does not invent a missing event before its technical grace period", () => {
    expect(detectHintIncident({ ...healthy, ended_at: null, closed_at: ago(500) }, now)).toBeNull();
    expect(detectHintIncident({ ...healthy, job_key: null, ended_at: ago(500) }, now)).toBeNull();
    expect(detectHintIncident({ ...healthy, ended_at: null, closed_at: null }, now)).toBeNull();
    expect(detectHintIncident({ ...healthy, job_key: null, ended_at: "invalid" }, now)).toBeNull();
  });
  it.each([
    [{ ended_at: null }, "CALL_END_MISSING"],
    [{ job_key: null }, "JOB_MISSING"],
    [{ job_status: "failed" }, "ANALYSIS_FAILED"],
    [{ job_status: "pending" }, "QUEUE_DELAY"],
    [{ job_status: "running", job_updated: ago(watchdogPolicy.analysisMs + 1) }, "ANALYSIS_DELAY"],
    [{ execution: "analysis_not_completed" }, "ANALYSIS_UNAVAILABLE"],
    [{ qa_status: "НЕ ПРОВЕРЕНО QA" }, "QA_UNACCEPTED"],
    [{ qa_status: "QA: возврат" }, "QA_UNACCEPTED"],
    [{ mail_status: null }, "OUTBOX_MISSING"],
    [{ mail_status: "unknown" }, "MAIL_UNCONFIRMED"],
    [{ mail_status: "needs_review" }, "MAIL_UNCONFIRMED"],
    [{ mail_status: "prepared" }, "MAIL_DELAY"],
    [{ mail_status: "sending" }, "MAIL_DELAY"],
  ])("detects a saved failure or delayed transition: %s", (patch, code) => {
    expect(detectHintIncident({ ...healthy, ...patch }, now)?.code).toBe(code);
  });
  it("does not call a fresh running job or acknowledged mail a failure", () => {
    expect(detectHintIncident(healthy, now)).toBeNull();
    expect(detectHintIncident({ ...healthy, job_status: "running", job_updated: ago(1000) }, now)).toBeNull();
    expect(detectHintIncident({ ...healthy, mail_status: "gmail_accepted", mail_updated: ago(1000) }, now)).toBeNull();
  });
  it("reports observed facts and an opaque reference, not transcript/false QA", () => {
    const issue = detectHintIncident({ ...healthy, job_key: null }, now)!;
    const text = renderWatchdogNotice(issue, "abcdef123456", ago(0), "development");
    expect(text.subject).toContain("JOB_MISSING");
    expect(text.body).toContain("Последний подтверждённый шаг");
    expect(text.body).toContain("Задание лаборатории");
    expect(text.body).toContain("не приёмка владельцем");
    expect(text.body).not.toContain(healthy.call_sid);
  });
});
