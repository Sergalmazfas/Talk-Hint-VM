import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the pure AirAtoma webhook helpers (server/airatomaWebhook.ts):
//   - renderTranscriptText: flatten turns into "Speaker: text" lines, uncapped.
//   - buildAirAtomaPayload: shape the exact contract body; normalize duration;
//     include recordingUrl only when present.
//   - airAtomaConfigError: classify the configured URL (unset/invalid/ok).
// These are dependency-free, so no DB / Deepgram / server bootstrap is needed.
// ---------------------------------------------------------------------------

import { afterEach, vi } from "vitest";

const {
  renderTranscriptText,
  buildAirAtomaPayload,
  airAtomaConfigError,
  airAtomaBackoffMs,
  decideAirAtomaOutcome,
  MAX_AIRATOMA_ATTEMPTS,
  validateUserWebhookUrl,
  attemptAirAtomaPost,
} = await import("../airatomaWebhook");

describe("renderTranscriptText", () => {
  it("joins turns as 'Speaker: text' lines", () => {
    expect(
      renderTranscriptText([
        { speaker: "Owner", text: "Hi there" },
        { speaker: "Guest", text: "Hello" },
      ]),
    ).toBe("Owner: Hi there\nGuest: Hello");
  });

  it("returns an empty string for no turns", () => {
    expect(renderTranscriptText([])).toBe("");
  });
});

describe("buildAirAtomaPayload", () => {
  it("builds the contract body and rounds duration to a whole number", () => {
    const payload = buildAirAtomaPayload({
      callId: "CA123",
      transcript: [{ speaker: "Guest", text: "Hello" }],
      callerName: "Jane",
      durationSecs: 12.7,
    });
    expect(payload).toEqual({
      callId: "CA123",
      transcript: "Guest: Hello",
      callerName: "Jane",
      durationSecs: 13,
    });
  });

  it("never emits a negative duration", () => {
    const payload = buildAirAtomaPayload({
      callId: "CA1",
      transcript: [],
      callerName: "x",
      durationSecs: -5,
    });
    expect(payload.durationSecs).toBe(0);
  });

  it("includes recordingUrl only when present and non-empty", () => {
    expect(
      buildAirAtomaPayload({
        callId: "CA1",
        transcript: [],
        callerName: "x",
        durationSecs: 0,
        recordingUrl: "  https://rec/1.mp3  ",
      }).recordingUrl,
    ).toBe("https://rec/1.mp3");

    expect(
      "recordingUrl" in
        buildAirAtomaPayload({
          callId: "CA1",
          transcript: [],
          callerName: "x",
          durationSecs: 0,
          recordingUrl: "   ",
        }),
    ).toBe(false);

    expect(
      "recordingUrl" in
        buildAirAtomaPayload({
          callId: "CA1",
          transcript: [],
          callerName: "x",
          durationSecs: 0,
        }),
    ).toBe(false);
  });
});

describe("airAtomaConfigError", () => {
  it("reports 'unset' when no URL is configured", () => {
    expect(airAtomaConfigError(undefined)).toBe("unset");
    expect(airAtomaConfigError("")).toBe("unset");
  });

  it("reports 'invalid' for a non-http(s) value", () => {
    expect(airAtomaConfigError("example.com/webhook")).toBe("invalid");
    expect(airAtomaConfigError("ftp://example.com")).toBe("invalid");
    expect(airAtomaConfigError("httpx://example.com")).toBe("invalid");
  });

  it("accepts http and https URLs", () => {
    expect(airAtomaConfigError("http://localhost:3000/api/talkhint/webhook")).toBeNull();
    expect(airAtomaConfigError("https://airatoma.example/api/talkhint/webhook")).toBeNull();
  });
});

describe("airAtomaBackoffMs", () => {
  it("doubles each attempt starting at 30s", () => {
    expect(airAtomaBackoffMs(1)).toBe(30_000);
    expect(airAtomaBackoffMs(2)).toBe(60_000);
    expect(airAtomaBackoffMs(3)).toBe(120_000);
    expect(airAtomaBackoffMs(4)).toBe(240_000);
  });

  it("caps the delay at 30 minutes", () => {
    expect(airAtomaBackoffMs(7)).toBe(30 * 60_000);
    expect(airAtomaBackoffMs(50)).toBe(30 * 60_000);
  });

  it("treats attempt counts below 1 as the first attempt", () => {
    expect(airAtomaBackoffMs(0)).toBe(30_000);
    expect(airAtomaBackoffMs(-3)).toBe(30_000);
  });
});

describe("decideAirAtomaOutcome", () => {
  it("marks a successful attempt delivered", () => {
    expect(decideAirAtomaOutcome(1, true)).toBe("delivered");
    expect(decideAirAtomaOutcome(MAX_AIRATOMA_ATTEMPTS, true)).toBe("delivered");
  });

  it("retries a failure while attempts remain", () => {
    expect(decideAirAtomaOutcome(1, false)).toBe("retry");
    expect(decideAirAtomaOutcome(MAX_AIRATOMA_ATTEMPTS - 1, false)).toBe("retry");
  });

  it("gives up once the attempt budget is exhausted", () => {
    expect(decideAirAtomaOutcome(MAX_AIRATOMA_ATTEMPTS, false)).toBe("failed");
    expect(decideAirAtomaOutcome(MAX_AIRATOMA_ATTEMPTS + 1, false)).toBe("failed");
  });
});

describe("validateUserWebhookUrl (SSRF guard)", () => {
  it("accepts a normal public https URL", () => {
    expect(validateUserWebhookUrl("https://crm.example.com/api/talkhint/webhook")).toBeNull();
    expect(validateUserWebhookUrl("http://crm.example.com/hook")).toBeNull();
  });

  it("rejects non-http(s) schemes and malformed URLs", () => {
    expect(validateUserWebhookUrl("ftp://example.com")).toBe("invalid_scheme");
    expect(validateUserWebhookUrl("file:///etc/passwd")).toBe("invalid_scheme");
    expect(validateUserWebhookUrl("not a url")).toBe("invalid_url");
  });

  it("rejects embedded credentials", () => {
    expect(validateUserWebhookUrl("https://user:pass@example.com/hook")).toBe("has_credentials");
  });

  it("blocks loopback, private, link-local and metadata hosts", () => {
    expect(validateUserWebhookUrl("http://localhost/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://127.0.0.1/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://10.0.0.5/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://172.16.0.1/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://192.168.1.1/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://169.254.169.254/latest/meta-data")).toBe("private_host");
    expect(validateUserWebhookUrl("http://svc.internal/hook")).toBe("private_host");
  });

  it("blocks IPv6 literals (loopback, link-local, ULA, IPv4-mapped)", () => {
    expect(validateUserWebhookUrl("http://[::1]/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://[::]/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://[fe80::1]/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://[fc00::1]/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://[fd00::1]/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://[::ffff:127.0.0.1]/hook")).toBe("private_host");
    expect(validateUserWebhookUrl("http://[2606:4700::1]/hook")).toBe("private_host");
  });
});

describe("attemptAirAtomaPost secret handling", () => {
  const ENV_URL = "https://trusted-airatoma.example.com/hook";
  const USER_URL = "https://user-controlled.example.com/hook";
  const payload = { callId: "CA1", transcript: "x", callerName: "Y", durationSecs: 1 };

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AIRATOMA_WEBHOOK_URL;
    delete process.env.TALKHINT_WEBHOOK_SECRET;
  });

  function stubFetch() {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("does NOT send x-talkhint-secret to a user-supplied URL", async () => {
    process.env.AIRATOMA_WEBHOOK_URL = ENV_URL;
    process.env.TALKHINT_WEBHOOK_SECRET = "shhh";
    const fetchMock = stubFetch();

    await attemptAirAtomaPost(payload as any, () => {}, USER_URL);

    const [calledUrl, opts] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(USER_URL);
    expect((opts.headers as Record<string, string>)["x-talkhint-secret"]).toBeUndefined();
  });

  it("DOES send x-talkhint-secret to the operator-configured env URL", async () => {
    process.env.AIRATOMA_WEBHOOK_URL = ENV_URL;
    process.env.TALKHINT_WEBHOOK_SECRET = "shhh";
    const fetchMock = stubFetch();

    await attemptAirAtomaPost(payload as any, () => {}, ENV_URL);

    const [calledUrl, opts] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(ENV_URL);
    expect((opts.headers as Record<string, string>)["x-talkhint-secret"]).toBe("shhh");
  });
});
