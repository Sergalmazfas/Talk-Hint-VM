import { describe, it, expect } from "vitest";
import { withTeamRuntime, emptyMember } from "./runtime";
import { withExternalPartners, proposeExternalPartners } from "./external";
import { secretaryActionReport, labActionReports, reportDelivery } from "./actionReports";
import { renderProcessLetter } from "../callLab/processReport";
import { detectHintIncident } from "../callLab/watchdog";
import { portraitManifest, teamPortraitManifest } from "./portraits";

const at = "2026-10-30T03:24:53.058Z";
const member = (code: string) => ({ ...emptyMember(code), code, name: code, id: code });
const view = (): any => ({ source: { revision: 918 }, owner: { name: "Сергей", code: "C-01" },
  members: [member("P.LAB"), member("P.LG.QA"), member("P.OPS")], feed: [], apply: { completed: 4 } });
const context = (): any => ({ owner: "owner", jobs: [], secretaryTasks: [], controls: [] });
const call = { call_sid: "call", user_id: "owner", ended_at: at, metadata: {} };
const task = { id: "task", call_sid: "call", user_id: "owner", instruction: "Ремонт шины",
  dial_started_at: at, updated_at: at, voice_provider: "retell" };

describe("package two factual team runtime", () => {
  it("does not turn enabled controls or report_ready mode notices into autonomous staff", () => {
    const c = context();
    c.controls = [{ enabled: true }];
    c.jobs = [{ updated_at: at, report: { mode: "secretary", execution: "mode_analysis_not_connected" } }];
    const result = withTeamRuntime(view(), c, { now: Date.parse(at) });
    expect(result.members.find(m => m.code === "P.LAB")?.status).toBe("unresolved");
    expect(result.members.find(m => m.code === "P.LG.QA")?.lastActionAt).toBeNull();
    expect(result.members.find(m => m.code === "P.OPS")?.status).toBe("unresolved");
  });
  it("shows failed analysis as execution but never invents a QA run", () => {
    const c = context();
    c.jobs = [{ updated_at: at, report: { mode: "hint", call_id: "call", execution: "analysis_not_completed",
      analysis: { limitations: ["model unavailable"] }, qa_status: "НЕ ПРОВЕРЕНО QA" } }];
    const result = withTeamRuntime(view(), c);
    expect(result.members[0].status).toBe("autonomous");
    expect(result.members[0].actionReports?.[0].outcome).toBe("not_completed");
    expect(result.members[1].status).toBe("unresolved");
    expect(result.members[1].actionReports).toEqual([]);
  });
  it("uses the QA verdict and dated evidence, not a generic ready flag", () => {
    const c = context();
    c.jobs = [{ updated_at: at, report: { mode: "hint", call_id: "call",
      analysis: {}, qa_status: "QA: расхождения не устранены" } }];
    const result = withTeamRuntime(view(), c);
    expect(result.members[1].status).toBe("autonomous");
    expect(result.members[1].lastActionAt).toBe(at);
    expect(result.members[1].actionReports?.[0].succeeded.join(" ")).toContain("не приёмка владельца");
  });
  it("requires a fresh real watchdog cycle and does not hide attention", () => {
    const c = context();
    const fresh = withTeamRuntime(view(), c, { now: Date.parse(at) + 1000,
      watchdog: { state: "attention", checkedAt: at, activeIncidents: 2 } });
    expect(fresh.members[2].status).toBe("autonomous");
    expect(fresh.members[2].statusEvidence).toContain("2");
    const stale = withTeamRuntime(view(), c, { now: Date.parse(at) + 61_000,
      watchdog: { state: "checked", checkedAt: at } });
    expect(stale.members[2].status).toBe("unresolved");
  });
  it("does not create an active Katya without an actual saved attempt", () => {
    expect(withTeamRuntime(view(), context()).members.some(m => m.id === "employee-katya")).toBe(false);
  });
  it("keeps unknown personality facts empty and requires the current provider", () => {
    const c = context(); c.secretaryTasks = [task];
    c.secretaryDefault = "retell";
    const prompt = { text: "actual policy", version: "sha", source: "engine", model: "test",
      traits: [null, null, null], motto: null, name: null };
    const katya = withTeamRuntime(view(), c, { secretaryPrompt: prompt }).members.find(m => m.id === "employee-katya")!;
    expect(katya.prompt).toMatchObject({ text: "actual policy", status: "включён" });
    expect(katya.traits).toEqual([null, null, null]);
    expect(katya.motto).toBeNull();
    c.secretaryDefault = "gpt";
    expect(withTeamRuntime(view(), c, { secretaryPrompt: prompt }).members.find(m => m.id === "employee-katya")?.status).toBe("unresolved");
  });
  it("keeps external partners outside the operating hierarchy and does not invent their work", () => {
    const input = view(); const before = JSON.stringify(input);
    const result = proposeExternalPartners(input);
    expect(JSON.stringify(input)).toBe(before);
    const klavdiy = result.members.find(m => m.id === "external-klavdiy")!;
    expect(klavdiy).toMatchObject({ kind: "external", status: "owner_chat", color: "indigo", lastWork: null });
    const studio = result.members.find(m => m.id === "external-efim")!;
    expect(studio.hats).toHaveLength(5);
    expect(studio.prompt.text).toBeNull();
    expect(result.members.filter(m => m.code === "REPLIT-HAT")).toHaveLength(5);
  });
  it("does not substitute draft/code records for missing production company data", () => {
    const input = view();
    expect(withExternalPartners(input)).toBe(input);
    expect(() => withExternalPartners(input, "{}")).toThrow("External partner document unavailable");
    const proposed = proposeExternalPartners(input);
    const text = JSON.stringify({ schema: 1, members: proposed.members.filter(m =>
      m.id.startsWith("external-") || m.id.startsWith("studio-") || m.id === "head-engineering") });
    expect(withExternalPartners(input, text).members.some(m => m.id === "external-klavdiy")).toBe(true);
  });
  it("preserves the first portrait manifest and exposes new immutable private portraits separately", () => {
    expect(Object.keys(portraitManifest)).toHaveLength(5);
    expect(teamPortraitManifest.klavdiy.url).toContain(teamPortraitManifest.klavdiy.sha256);
    expect(teamPortraitManifest.efim.object).toMatch(/^team\/efim\/[a-f0-9]{64}\.png$/);
  });
});

describe("factual action reports and consolidated delivery", () => {
  it("rejects another owner or call and unknown timestamps", () => {
    expect(secretaryActionReport(call, { ...task, user_id: "other" })).toBeNull();
    expect(secretaryActionReport(call, { ...task, call_sid: "other" })).toBeNull();
    expect(secretaryActionReport({ ...call, ended_at: null }, { ...task, updated_at: null })).toBeNull();
  });
  it("never treats a generated summary, completed status or a DTMF dispatch as goal success", () => {
    const c = { ...call, metadata: { secretaryIvr: { events: [{ kind: "press", digits: "2", heard: "Tires press 2",
      result: "command_sent_destination_acceptance_unknown" }] } } };
    const r = secretaryActionReport(c, { ...task, outcome: "completed", summary: "Booked", provider_status: "completed" })!;
    expect(r.outcome).toBe("partial");
    expect(r.succeeded.join(" ")).toContain("не доказывает принятие");
    expect(r.failed.join(" ")).toContain("не установлена");
  });
  it("accepts explicit independently owner-confirmed goal evidence, not an unsupported assertion", () => {
    const r = secretaryActionReport(call, { ...task,
      verified_facts: [{ kind: "goal_achieved", verification: "owner_confirmed", evidence: "Owner verified" }] })!;
    expect(r.outcome).toBe("completed");
    expect(secretaryActionReport(call, task)?.outcome).toBe("not_completed");
  });
  it("uses stable action IDs and creates a single consolidated letter with multiple participants", () => {
    const r = secretaryActionReport(call, task)!;
    expect(secretaryActionReport(call, task)?.id).toBe(r.id);
    const analysis = labActionReports({ mode: "hint", call_id: "call", analysis: {}, qa_status: "QA: принято" }, at);
    const letter = renderProcessLetter({ mode: "secretary", action_reports: [r, ...analysis] });
    expect(letter.body).toContain("SECRETARY");
    expect(letter.body).toContain("P.LAB");
    expect(letter.body).toContain("P.LG.QA");
    expect(letter.subject).not.toContain("разбор не подключён");
  });
  it("routes ordinary failures to morning, owner decisions and urgent breakages immediately", () => {
    const r = secretaryActionReport(call, task)!;
    expect(reportDelivery([r])).toBe("daily");
    expect(reportDelivery([{ ...r, needsOwner: ["да/нет"] }])).toBe("immediate");
    expect(reportDelivery([r], true)).toBe("immediate");
    expect(reportDelivery([{ ...r, outcome: "completed", failed: [] }])).toBe("per_call");
  });
  it("does not create a missing-mail alert for an intentionally deferred ordinary failure", () => {
    expect(detectHintIncident({ ...call, job_status: "report_ready", job_key: "key",
      execution: "mode_analysis_not_connected", action_delivery: "daily", job_updated: at,
      mail_status: null } as any, Date.parse(at) + 1_000_000)).toBeNull();
    expect(detectHintIncident({ ...call, job_status: "running", job_key: "key",
      action_delivery: "daily", job_updated: at } as any, Date.parse(at) + 1_000_000)?.code).toBe("ANALYSIS_DELAY");
  });
});
