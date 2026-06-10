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
  sendCallToAirAtoma,
  AIRATOMA_TIMEOUT_MS,
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

// ---------------------------------------------------------------------------
// The real network sender. Mocks global fetch so no socket is opened, and proves
// the "never block / never throw call teardown" guarantee: it builds the exact
// contract body, attaches the secret only when configured, no-ops on an
// unset/invalid URL, aborts on a hang, and swallows every failure (non-2xx,
// network error, timeout) without throwing.
// ---------------------------------------------------------------------------
describe("sendCallToAirAtoma (network sender)", () => {
  const ENV_URL = "https://trusted-airatoma.example.com/hook";
  const INPUT = {
    callId: "CA999",
    transcript: [
      { speaker: "Owner", text: "Hi there" },
      { speaker: "Guest", text: "Hello" },
    ],
    callerName: "Jane Doe",
    durationSecs: 42,
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.AIRATOMA_WEBHOOK_URL;
    delete process.env.TALKHINT_WEBHOOK_SECRET;
  });

  function stubFetchOk() {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("POSTs the exact contract body to the configured URL", async () => {
    process.env.AIRATOMA_WEBHOOK_URL = ENV_URL;
    const fetchMock = stubFetchOk();

    await sendCallToAirAtoma(INPUT, () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe(ENV_URL);
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    // Body is exactly what buildAirAtomaPayload produces for this input.
    expect(opts.body).toBe(JSON.stringify(buildAirAtomaPayload(INPUT)));
    expect(JSON.parse(opts.body)).toEqual({
      callId: "CA999",
      transcript: "Owner: Hi there\nGuest: Hello",
      callerName: "Jane Doe",
      durationSecs: 42,
    });
  });

  it("attaches x-talkhint-secret only when TALKHINT_WEBHOOK_SECRET is set", async () => {
    process.env.AIRATOMA_WEBHOOK_URL = ENV_URL;
    process.env.TALKHINT_WEBHOOK_SECRET = "topsecret";
    const withSecret = stubFetchOk();
    await sendCallToAirAtoma(INPUT, () => {});
    const [, optsWith] = withSecret.mock.calls[0] as [string, any];
    expect((optsWith.headers as Record<string, string>)["x-talkhint-secret"]).toBe("topsecret");

    // Same send, no secret configured -> header omitted.
    vi.unstubAllGlobals();
    delete process.env.TALKHINT_WEBHOOK_SECRET;
    const noSecret = stubFetchOk();
    await sendCallToAirAtoma(INPUT, () => {});
    const [, optsNo] = noSecret.mock.calls[0] as [string, any];
    expect((optsNo.headers as Record<string, string>)["x-talkhint-secret"]).toBeUndefined();
  });

  it("does not call fetch when the URL is unset (feature off)", async () => {
    delete process.env.AIRATOMA_WEBHOOK_URL;
    const fetchMock = stubFetchOk();

    await expect(sendCallToAirAtoma(INPUT, () => {})).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call fetch and warns when the URL is invalid", async () => {
    process.env.AIRATOMA_WEBHOOK_URL = "example.com/webhook"; // no http(s) scheme
    const fetchMock = stubFetchOk();
    const logs: string[] = [];

    await expect(sendCallToAirAtoma(INPUT, (m) => logs.push(m))).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("Invalid"))).toBe(true);
  });

  it("aborts and swallows the error when the server hangs past the timeout", async () => {
    process.env.AIRATOMA_WEBHOOK_URL = ENV_URL;
    vi.useFakeTimers();
    // A fetch that never resolves on its own — it only settles when aborted.
    const fetchMock = vi.fn(
      (_url: string, opts: any) =>
        new Promise((_resolve, reject) => {
          (opts.signal as AbortSignal).addEventListener("abort", () => {
            const err: any = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const logs: string[] = [];

    const pending = sendCallToAirAtoma(INPUT, (m) => logs.push(m));
    // Fire the abort timer; the hung fetch rejects with AbortError.
    await vi.advanceTimersByTimeAsync(AIRATOMA_TIMEOUT_MS);

    await expect(pending).resolves.toBeUndefined(); // never throws
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes("timed out"))).toBe(true);
  });

  it("swallows a non-2xx response without throwing", async () => {
    process.env.AIRATOMA_WEBHOOK_URL = ENV_URL;
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as any);
    vi.stubGlobal("fetch", fetchMock);
    const logs: string[] = [];

    await expect(sendCallToAirAtoma(INPUT, (m) => logs.push(m))).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("500"))).toBe(true);
  });

  it("swallows a network error without throwing", async () => {
    process.env.AIRATOMA_WEBHOOK_URL = ENV_URL;
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);
    const logs: string[] = [];

    await expect(sendCallToAirAtoma(INPUT, (m) => logs.push(m))).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("failed"))).toBe(true);
  });
});
