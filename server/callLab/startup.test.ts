import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  profile: vi.fn(), runtime: vi.fn(), scratch: vi.fn(), run: vi.fn(),
  register: vi.fn(), watchdog: vi.fn(), allowedAdmin: vi.fn(),
}));
vi.mock("../benchmark/adminGate", () => ({ isBenchmarkAdmin: f.allowedAdmin }));
vi.mock("./mail", () => ({ GmailLabMail: class { profile = f.profile; } }));
vi.mock("./process", () => ({ checkHintLabRuntime: f.runtime, cleanupLabScratch: f.scratch, runHintLab: f.run }));
vi.mock("./source", () => ({ registerLabSourceOwner: f.register, authorizedHintSource: vi.fn() }));
vi.mock("./watchdog", () => ({ startHintWatchdog: f.watchdog }));
import { bootstrapLab, startHintLab, stopHintLab } from "./service";
import { labStartupStatus, safeLabError, labStartsPaused, resetLabStartup } from "./startup";
function database() {
  return {
    query: vi.fn(async (sql: string) => ({ rows: sql.startsWith("SELECT id") ? [{ id: "fixture-owner" }] : [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [{ ok: false }] })), release: vi.fn() })),
  } as any;
}
beforeEach(() => {
  vi.clearAllMocks(); resetLabStartup();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("LAB_ENABLED", "false");
  vi.stubEnv("LAB_TARGET_ENVIRONMENT", "production"); vi.stubEnv("LAB_GMAIL_CONNECTION_ID", "fixture-pin");
  vi.stubEnv("LAB_OWNER_ID", ""); vi.stubEnv("OPENAI_API_KEY", "fixture-not-a-key");
  vi.stubEnv("LAB_START_PAUSED", "false");
  f.profile.mockResolvedValue("owner@example.invalid"); f.runtime.mockResolvedValue({ version: "1.15.30" });
  f.scratch.mockResolvedValue(undefined); f.watchdog.mockReturnValue(vi.fn()); f.allowedAdmin.mockReturnValue(true);
});
afterEach(() => { stopHintLab(); vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("fail-closed recoverable lab initialization", () => {
  it("checks prerequisites without running agents/mail; production always starts paused", async () => {
    const db = database(); await bootstrapLab(db);
    expect(labStartupStatus().status).toBe("ready");
    expect(f.runtime).toHaveBeenCalledOnce(); expect(f.run).not.toHaveBeenCalled();
    const insert = db.query.mock.calls.find((c: any) => c[0].startsWith("INSERT"));
    expect(insert[0]).toContain("VALUES($1,$2,$3,$4,$5,false)");
    expect(insert[1][5]).toBe(true); // even when LAB_START_PAUSED=false
    expect(labStartsPaused()).toBe(true);
    expect(f.register).toHaveBeenCalledWith("fixture-owner");
  });
  it("owner-requested readiness never resets an already active switch", async () => {
    const db = database(); await bootstrapLab(db, { expectedOwnerId: "fixture-owner", startup: false });
    const insert = db.query.mock.calls.find((c: any) => c[0].startsWith("INSERT"));
    expect(insert[1][5]).toBe(false);
    expect(insert[0]).toContain("ELSE call_lab_controls.enabled");
  });
  it("refuses another Gmail/admin/owner and does not insert a control", async () => {
    const db = database();
    await expect(bootstrapLab(db, { expectedOwnerId: "other" })).rejects.toThrow("LAB_OWNER_MISMATCH");
    expect(labStartupStatus()).toMatchObject({ status: "blocked", stage: "owner", code: "LAB_OWNER_MISMATCH" });
    expect(db.query.mock.calls.some((c: any) => c[0].startsWith("INSERT"))).toBe(false);
    expect(f.register).not.toHaveBeenCalled();
    f.allowedAdmin.mockReturnValue(false);
    await expect(bootstrapLab(db)).rejects.toThrow("LAB_OWNER_NOT_ADMIN");
  });
  it("reports worker and SQL failures precisely, without binding source capture", async () => {
    const db = database();
    f.runtime.mockRejectedValueOnce(new Error("LAB_PYTHON_VERSION_MISMATCH"));
    await expect(bootstrapLab(db)).rejects.toThrow();
    expect(labStartupStatus()).toMatchObject({ stage: "worker", code: "LAB_PYTHON_VERSION_MISMATCH" });
    db.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("INSERT")) throw Object.assign(new Error("private database URL"), { code: "42703" });
      return { rows: [{ id: "fixture-owner" }] };
    });
    await expect(bootstrapLab(db)).rejects.toThrow();
    expect(labStartupStatus()).toMatchObject({ stage: "control", code: "LAB_DATABASE_42703" });
    expect(JSON.stringify(labStartupStatus())).not.toContain("private database");
    expect(f.register).not.toHaveBeenCalled();
  });
  it("retries transient startup failure after 30 seconds, without activation or model work", async () => {
    vi.useFakeTimers();
    f.profile.mockRejectedValueOnce(new Error("LAB_GMAIL_PROFILE_503"));
    const db = database();
    await startHintLab(db);
    expect(labStartupStatus()).toMatchObject({ status: "blocked", stage: "gmail", code: "LAB_GMAIL_PROFILE_503" });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.profile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.profile).toHaveBeenCalledTimes(2);
    expect(labStartupStatus().status).toBe("ready");
    expect(f.run).not.toHaveBeenCalled();
    const insert = db.query.mock.calls.find((c: any) => c[0].startsWith("INSERT"));
    expect(insert[1][5]).toBe(true);
  });
  it("does not leak arbitrary SDK text, URLs, or fabricated LAB_ tokens", () => {
    for (const text of ["Bearer secret-value", "https://user:password@example.invalid", "LAB_SECRET_TOKEN"])
      expect(safeLabError(new Error(text))).toBe("LAB_DEPENDENCY_UNAVAILABLE");
    expect(safeLabError(new Error("Could not mint an audience-scoped deployment identity. private-data")))
      .toBe("LAB_CONNECTOR_IDENTITY_UNAVAILABLE");
  });
});
