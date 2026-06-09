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
  "WRITE_HEALTH_ALERT_EMAIL",
  "WRITE_HEALTH_ALERT_EMAIL_FROM",
  "WRITE_HEALTH_ALERT_EMAIL_SUBJECT",
  "SENDGRID_API_KEY",
] as const;

let savedEnv: Record<string, string | undefined>;
let fetchMock: ReturnType<typeof vi.fn>;

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
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 202,
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
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
  vi.unstubAllGlobals();
});

function configureSms() {
  process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
  process.env.TWILIO_AUTH_TOKEN = "test_token";
  process.env.TWILIO_PHONE_NUMBER = "+15550000000";
  process.env.WRITE_HEALTH_ALERT_PHONE = "+15551111111";
}

function configureEmail() {
  process.env.WRITE_HEALTH_ALERT_EMAIL = "oncall@example.com";
  process.env.WRITE_HEALTH_ALERT_EMAIL_FROM = "alerts@talkhint.app";
  process.env.SENDGRID_API_KEY = "SG.test_key";
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

describe("recovery notifications", () => {
  it("sends a single 'recovered' message once a previously-alerting table is healthy with new writes", async () => {
    configureSms();
    process.env.WRITE_HEALTH_ALERT_COOLDOWN_MS = "0"; // recovery window defaults to cooldown

    // Table starts failing → alert.
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 2, driftError("2026-06-09T00:00:00.000Z")),
    );
    expect(await checkWriteHealthOnce()).toBe(1);

    // Failures stop rising and new successful writes land → recovery.
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 7, driftError("2026-06-09T00:00:00.000Z")),
    );
    expect(await checkWriteHealthOnce()).toBe(0); // recovery isn't counted as an alert

    expect(h.messagesCreate).toHaveBeenCalledTimes(2);
    const recoveryBody = h.messagesCreate.mock.calls[1][0].body as string;
    expect(recoveryBody).toContain("RECOVERED");
    expect(recoveryBody).toContain("table=contact_memory");

    // A subsequent healthy check does NOT send another recovery.
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 9, driftError("2026-06-09T00:00:00.000Z")),
    );
    await checkWriteHealthOnce();
    expect(h.messagesCreate).toHaveBeenCalledTimes(2);
  });

  it("does not recover without new successful writes after the alert", async () => {
    configureSms();
    process.env.WRITE_HEALTH_ALERT_COOLDOWN_MS = "0";

    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 2, driftError("2026-06-09T00:00:00.000Z")),
    );
    await checkWriteHealthOnce();

    // Failures stop rising but successes are unchanged → not proven healthy.
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 2, driftError("2026-06-09T00:00:00.000Z")),
    );
    expect(await checkWriteHealthOnce()).toBe(0);
    expect(h.messagesCreate).toHaveBeenCalledTimes(1); // only the original alert
  });

  it("debounces recovery so a flapping table doesn't spam alert/recover/alert", async () => {
    configureSms();
    // Long window: recovery requires a sustained healthy period.
    process.env.WRITE_HEALTH_ALERT_COOLDOWN_MS = String(60 * 60 * 1000);

    // Initial failure → alert.
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 2, driftError("2026-06-09T00:00:00.000Z")),
    );
    await checkWriteHealthOnce();
    expect(h.messagesCreate).toHaveBeenCalledTimes(1);

    // Brief healthy blip with new writes — but the long window hasn't elapsed.
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 1, 5, driftError("2026-06-09T00:00:00.000Z")),
    );
    expect(await checkWriteHealthOnce()).toBe(0);
    expect(h.messagesCreate).toHaveBeenCalledTimes(1); // no premature recovery

    // Fails again before the window elapsed: no recovery was sent, and the new
    // failure is throttled (still in cooldown), so no alert spam either.
    h.getWriteHealth.mockReturnValue(
      emptyHealth("contact_memory", 6, 5, driftError("2026-06-09T00:10:00.000Z")),
    );
    expect(await checkWriteHealthOnce()).toBe(0);
    expect(h.messagesCreate).toHaveBeenCalledTimes(1);
  });

  it("does not send a recovery for a table that never alerted", async () => {
    configureSms();
    process.env.WRITE_HEALTH_ALERT_COOLDOWN_MS = "0";

    // Healthy from the start, accumulating successes — should never notify.
    h.getWriteHealth.mockReturnValue(emptyHealth("calls", 0, 3));
    await checkWriteHealthOnce();
    h.getWriteHealth.mockReturnValue(emptyHealth("calls", 0, 10));
    await checkWriteHealthOnce();

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

  it("logs only (no channel) when neither SMS nor email is configured", async () => {
    const warn = vi.spyOn(console, "warn");

    await sendWriteHealthAlert("boom");

    expect(h.messagesCreate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("No alert channel configured"),
      ),
    ).toBe(true);
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

  it("sends an email via SendGrid when email is configured", async () => {
    configureEmail();

    await sendWriteHealthAlert("boom");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer SG.test_key");
    const payload = JSON.parse(init.body);
    expect(payload.from).toEqual({ email: "alerts@talkhint.app" });
    expect(payload.personalizations[0].to).toEqual([
      { email: "oncall@example.com" },
    ]);
    expect(payload.content[0].value).toBe("boom");
  });

  it("emails every recipient in a comma-separated list", async () => {
    configureEmail();
    process.env.WRITE_HEALTH_ALERT_EMAIL =
      "a@example.com, b@example.com;c@example.com";

    await sendWriteHealthAlert("boom");

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.personalizations[0].to).toEqual([
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "c@example.com" },
    ]);
  });

  it("sends both SMS and email when both channels are configured", async () => {
    configureSms();
    configureEmail();

    await sendWriteHealthAlert("boom");

    expect(h.messagesCreate).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not email when recipient is set but provider/sender is missing", async () => {
    process.env.WRITE_HEALTH_ALERT_EMAIL = "oncall@example.com";
    // No WRITE_HEALTH_ALERT_EMAIL_FROM / SENDGRID_API_KEY.

    await sendWriteHealthAlert("boom");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the email provider errors out", async () => {
    configureEmail();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "sendgrid down",
    });

    await expect(sendWriteHealthAlert("boom")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when the email fetch rejects", async () => {
    configureEmail();
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(sendWriteHealthAlert("boom")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
