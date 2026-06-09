import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Guards the background write-health alerter: when any table's writeFailures
// rises or a schema-drift error appears in getWriteHealth(), the alerter must
// push exactly one (throttled) notification naming the table, operation and
// pg-code. We mock storage's getWriteHealth and the Twilio SMS client so the
// test is hermetic — no DB / Twilio / network required.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    getWriteHealth: vi.fn(),
    messagesCreate: vi.fn(),
  };
});

vi.mock("../storage", () => ({
  getWriteHealth: h.getWriteHealth,
}));

vi.mock("twilio", () => ({
  default: vi.fn(() => ({
    messages: { create: h.messagesCreate },
  })),
}));

const {
  checkWriteHealthOnce,
  sendWriteHealthAlert,
  __resetWriteHealthAlerterState,
} = await import("../writeHealthAlerter");

const ENV_KEYS = [
  "DISABLE_WRITE_HEALTH_ALERTS",
  "WRITE_HEALTH_ALERT_COOLDOWN_MS",
  "WRITE_HEALTH_ALERT_INTERVAL_MS",
  "WRITE_HEALTH_ALERT_PHONE",
  "WRITE_HEALTH_ALERT_FROM",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
] as const;

let savedEnv: Record<string, string | undefined>;

function emptyHealth(table: string, writeFailures: number, writeSuccesses = 0, lastError: any = null) {
  return { [table]: { writeSuccesses, writeFailures, lastError } };
}

function driftError(at: string, column = "name") {
  return {
    at,
    operation: "upsertContactMemory",
    code: "42703",
    message: `column "${column}" does not exist`,
    table: "contact_memory",
    column,
    isSchemaDrift: true,
  };
}

function genericError(at: string) {
  return {
    at,
    operation: "createCall",
    code: "23505",
    message: "duplicate key value violates unique constraint",
    table: "calls",
    isSchemaDrift: false,
  };
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  h.getWriteHealth.mockReset();
  h.messagesCreate.mockReset();
  h.messagesCreate.mockResolvedValue({ sid: "SM_test" });
  __resetWriteHealthAlerterState();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

function configureSms() {
  process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
  process.env.TWILIO_AUTH_TOKEN = "test_token";
  process.env.TWILIO_PHONE_NUMBER = "+15550000000";
  process.env.WRITE_HEALTH_ALERT_PHONE = "+15551111111";
}

describe("checkWriteHealthOnce", () => {
  it("does not alert when no table has failures", async () => {
    configureSms();
    h.getWriteHealth.mockReturnValue(emptyHealth("contact_memory", 0, 5));

    const sent = await checkWriteHealthOnce();

    expect(sent).toBe(0);
    expect(h.messagesCreate).not.toHaveBeenCalled();
  });

  it("alerts and sends SMS when a table's failures rise", async () => {
    configureSms();
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 3, driftError("2026-06-09T00:00:00.000Z")),
    );

    const sent = await checkWriteHealthOnce();

    expect(sent).toBe(1);
    expect(h.messagesCreate).toHaveBeenCalledTimes(1);
    const body = h.messagesCreate.mock.calls[0][0].body as string;
    expect(body).toContain("table=contact_memory");
    expect(body).toContain("op=upsertContactMemory");
    expect(body).toContain("pgCode=42703");
    expect(body).toContain("SCHEMA DRIFT");
  });

  it("includes table, operation and pg-code for a generic (non-drift) failure", async () => {
    configureSms();
    h.getWriteHealth.mockReturnValue(
      emptyHealth("calls", 1, 0, genericError("2026-06-09T01:00:00.000Z")),
    );

    await checkWriteHealthOnce();

    const body = h.messagesCreate.mock.calls[0][0].body as string;
    expect(body).toContain("table=calls");
    expect(body).toContain("op=createCall");
    expect(body).toContain("pgCode=23505");
    expect(body).not.toContain("SCHEMA DRIFT");
  });

  it("does not re-alert when failures are unchanged across checks", async () => {
    configureSms();
    process.env.WRITE_HEALTH_ALERT_COOLDOWN_MS = "0";
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 0, driftError("2026-06-09T00:00:00.000Z")),
    );

    await checkWriteHealthOnce();
    const after = await checkWriteHealthOnce();

    expect(after).toBe(0);
    expect(h.messagesCreate).toHaveBeenCalledTimes(1);
  });

  it("throttles repeated rising failures within the cooldown window", async () => {
    configureSms();
    process.env.WRITE_HEALTH_ALERT_COOLDOWN_MS = String(60 * 60 * 1000);

    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 0, driftError("2026-06-09T00:00:00.000Z")),
    );
    await checkWriteHealthOnce();

    // Failures keep rising, but we're still inside the cooldown window.
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 5, 0, driftError("2026-06-09T00:05:00.000Z")),
    );
    const sent = await checkWriteHealthOnce();

    expect(sent).toBe(0);
    expect(h.messagesCreate).toHaveBeenCalledTimes(1);
  });

  it("re-alerts once the cooldown has elapsed (cooldown=0)", async () => {
    configureSms();
    process.env.WRITE_HEALTH_ALERT_COOLDOWN_MS = "0";

    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 0, driftError("2026-06-09T00:00:00.000Z")),
    );
    await checkWriteHealthOnce();

    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 2, 0, driftError("2026-06-09T00:05:00.000Z")),
    );
    const sent = await checkWriteHealthOnce();

    expect(sent).toBe(1);
    expect(h.messagesCreate).toHaveBeenCalledTimes(2);
  });

  it("alerts per-table independently", async () => {
    configureSms();
    h.getWriteHealth.mockReturnValue({
      contact_memory: { writeSuccesses: 0, writeFailures: 1, lastError: driftError("2026-06-09T00:00:00.000Z") },
      calls: { writeSuccesses: 0, writeFailures: 2, lastError: genericError("2026-06-09T00:01:00.000Z") },
    });

    const sent = await checkWriteHealthOnce();

    expect(sent).toBe(2);
    expect(h.messagesCreate).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when DISABLE_WRITE_HEALTH_ALERTS=true", async () => {
    configureSms();
    process.env.DISABLE_WRITE_HEALTH_ALERTS = "true";
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 3, 0, driftError("2026-06-09T00:00:00.000Z")),
    );

    const sent = await checkWriteHealthOnce();

    expect(sent).toBe(0);
    expect(h.getWriteHealth).not.toHaveBeenCalled();
    expect(h.messagesCreate).not.toHaveBeenCalled();
  });
});

describe("sendWriteHealthAlert", () => {
  it("logs only (no SMS) when no recipient is configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.TWILIO_PHONE_NUMBER = "+15550000000";
    // No WRITE_HEALTH_ALERT_PHONE.

    await sendWriteHealthAlert("boom");

    expect(h.messagesCreate).not.toHaveBeenCalled();
  });

  it("logs only (no SMS) when Twilio credentials are missing", async () => {
    process.env.WRITE_HEALTH_ALERT_PHONE = "+15551111111";
    // No Twilio creds / sender.

    await sendWriteHealthAlert("boom");

    expect(h.messagesCreate).not.toHaveBeenCalled();
  });

  it("sends an SMS when fully configured and never throws on Twilio errors", async () => {
    configureSms();
    h.messagesCreate.mockRejectedValueOnce(new Error("twilio down"));

    await expect(sendWriteHealthAlert("boom")).resolves.toBeUndefined();
    expect(h.messagesCreate).toHaveBeenCalledTimes(1);
    expect(h.messagesCreate.mock.calls[0][0]).toEqual({
      body: "boom",
      from: "+15550000000",
      to: "+15551111111",
    });
  });
});
