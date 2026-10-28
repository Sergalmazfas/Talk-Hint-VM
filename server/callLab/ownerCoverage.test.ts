import { afterEach, describe, expect, it, vi } from "vitest";
import { labRelease, modeNotice, ownerCallsSql } from "./policy";
import { labStartsPaused } from "./startup";
import { completeLabReport, renderProcessLetter } from "./processReport";
import { detectHintIncident } from "./watchdog";
import { ownerMonitoringConfiguration } from "./service";

afterEach(() => vi.unstubAllEnvs());
describe("owner standing authorization 2026-10-28", () => {
  it("production no longer pauses on publish; Dev remains opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAB_START_PAUSED", "true");
    expect(labStartsPaused()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(labStartsPaused()).toBe(true);
  });
  it("monitoring remains configured when analysis kill switch is off", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("LAB_OWNER_ID", "fixture-owner");
    vi.stubEnv("LAB_TARGET_ENVIRONMENT", "production"); vi.stubEnv("LAB_ENABLED", "false");
    expect(ownerMonitoringConfiguration()).toMatchObject({ allowed: true, owner: "fixture-owner" });
    vi.stubEnv("LAB_TARGET_ENVIRONMENT", "development");
    expect(ownerMonitoringConfiguration().allowed).toBe(false);
  });
  it.each(["copilot", "translator", "secretary", "prepare", "unknown"])("%s sends honest versioned notice, never fake QA", mode => {
    const report = modeNotice({ call_sid: "fixture", lab_mode: mode, ended_at: "2026-10-28T06:00:00Z" }, "development");
    const letter = renderProcessLetter(report);
    expect(letter.subject).toContain("разбор не подключён");
    expect(letter.body).toContain(labRelease.version);
    expect(report.analysis).toBeNull();
    expect(report.qa_status).not.toBe("QA: принято");
  });
  it("versions full analyses, including unavailable AI outcomes", () => {
    const report = completeLabReport({ execution: "analysis_not_completed" }, null, "a".repeat(64));
    expect(report.lab_release).toEqual(labRelease);
    expect(renderProcessLetter(report).body).toContain(labRelease.version);
  });
  it("duty checks a missing non-Hint notice without requiring inapplicable QA", () => {
    const row: any = { ended_at: new Date(0), job_key: "fixture", job_status: "report_ready",
      execution: "mode_analysis_not_connected", job_updated: new Date(0), mail_status: "prepared" };
    expect(detectHintIncident(row, 200_000)?.code).toBe("MODE_NOTICE_MISSING");
    expect(detectHintIncident({ ...row, mail_status: "sent_confirmed" }, 200_000)).toBeNull();
  });
  it("uses existing history and secretary links; no second call catalogue", () => {
    expect(ownerCallsSql).toContain("FROM calls c");
    expect(ownerCallsSql).toContain("t.user_id=c.user_id");
    expect(ownerCallsSql).toContain("t.call_id=c.id OR t.call_sid=c.call_sid");
  });
});
