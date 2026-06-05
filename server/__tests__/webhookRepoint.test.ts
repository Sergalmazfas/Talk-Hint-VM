import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Guards the auto-repoint behavior that runs on every Publish (production
// startup): every Twilio pool number must be pointed at the live production
// URL so inbound calls reach the freshly deployed app. We mock storage and the
// Twilio management call so the test is hermetic — no DB / Twilio required.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    getAllAvailableNumbers: vi.fn(),
    configureAllPoolWebhooks: vi.fn(),
  };
});

vi.mock("../storage", () => ({
  storage: {
    getAllAvailableNumbers: h.getAllAvailableNumbers,
  },
}));

vi.mock("../twilioService", () => ({
  configureAllPoolWebhooks: h.configureAllPoolWebhooks,
}));

const { resolveProductionBaseUrl, repointWebhooksOnStartup } = await import(
  "../webhookRepoint"
);

// Snapshot/restore the env vars these functions read so cases don't leak.
const ENV_KEYS = [
  "PRODUCTION_URL",
  "REPLIT_DEPLOYMENT_URL",
  "REPLIT_DOMAINS",
  "DISABLE_AUTO_WEBHOOK_REPOINT",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  h.getAllAvailableNumbers.mockReset();
  h.configureAllPoolWebhooks.mockReset();
  h.configureAllPoolWebhooks.mockResolvedValue({
    configured: 0,
    failed: 0,
    errors: [],
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("resolveProductionBaseUrl precedence", () => {
  it("prefers PRODUCTION_URL over everything else", () => {
    process.env.PRODUCTION_URL = "https://explicit.example.com";
    process.env.REPLIT_DEPLOYMENT_URL = "https://deploy.example.com";
    process.env.REPLIT_DOMAINS = "domains.example.com";
    expect(resolveProductionBaseUrl()).toBe("https://explicit.example.com");
  });

  it("falls back to REPLIT_DEPLOYMENT_URL when PRODUCTION_URL is unset", () => {
    process.env.REPLIT_DEPLOYMENT_URL = "https://deploy.example.com";
    process.env.REPLIT_DOMAINS = "domains.example.com";
    expect(resolveProductionBaseUrl()).toBe("https://deploy.example.com");
  });

  it("falls back to the first host in REPLIT_DOMAINS", () => {
    process.env.REPLIT_DOMAINS = "first.example.com,second.example.com";
    expect(resolveProductionBaseUrl()).toBe("https://first.example.com");
  });

  it("falls back to the planned custom domain when nothing is set", () => {
    expect(resolveProductionBaseUrl()).toBe("https://talkhint.app");
  });

  it("normalizes an http:// scheme to https://", () => {
    process.env.PRODUCTION_URL = "http://insecure.example.com";
    expect(resolveProductionBaseUrl()).toBe("https://insecure.example.com");
  });

  it("strips an existing https:// scheme to avoid doubling it", () => {
    process.env.PRODUCTION_URL = "https://already.example.com";
    expect(resolveProductionBaseUrl()).toBe("https://already.example.com");
  });

  it("strips trailing slashes from the host", () => {
    process.env.PRODUCTION_URL = "https://trailing.example.com///";
    expect(resolveProductionBaseUrl()).toBe("https://trailing.example.com");
  });

  it("trims whitespace around the first REPLIT_DOMAINS host", () => {
    process.env.REPLIT_DOMAINS = "  spaced.example.com  , other.example.com";
    expect(resolveProductionBaseUrl()).toBe("https://spaced.example.com");
  });
});

describe("repointWebhooksOnStartup", () => {
  function setTwilioCreds() {
    process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
  }

  it("maps every pool number into configureAllPoolWebhooks with the resolved base URL", async () => {
    setTwilioCreds();
    process.env.PRODUCTION_URL = "https://live.example.com/";

    h.getAllAvailableNumbers.mockResolvedValue([
      {
        twilioSid: "PN1",
        subaccountSid: "ACsub1",
        subaccountToken: "tok1",
        twilioNumber: "+15550001111",
      },
      {
        twilioSid: "PN2",
        subaccountSid: null,
        subaccountToken: null,
        twilioNumber: "+15550002222",
      },
    ]);

    await repointWebhooksOnStartup();

    expect(h.configureAllPoolWebhooks).toHaveBeenCalledTimes(1);
    const [numbersArg, baseUrlArg] = h.configureAllPoolWebhooks.mock.calls[0];

    expect(baseUrlArg).toBe("https://live.example.com");
    expect(numbersArg).toEqual([
      {
        twilioSid: "PN1",
        subaccountSid: "ACsub1",
        subaccountToken: "tok1",
        twilioNumber: "+15550001111",
      },
      {
        twilioSid: "PN2",
        subaccountSid: undefined,
        subaccountToken: undefined,
        twilioNumber: "+15550002222",
      },
    ]);
  });

  it("is skipped when DISABLE_AUTO_WEBHOOK_REPOINT=true", async () => {
    setTwilioCreds();
    process.env.DISABLE_AUTO_WEBHOOK_REPOINT = "true";

    await repointWebhooksOnStartup();

    expect(h.getAllAvailableNumbers).not.toHaveBeenCalled();
    expect(h.configureAllPoolWebhooks).not.toHaveBeenCalled();
  });

  it("is skipped when TWILIO_ACCOUNT_SID is missing", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test_token";

    await repointWebhooksOnStartup();

    expect(h.getAllAvailableNumbers).not.toHaveBeenCalled();
    expect(h.configureAllPoolWebhooks).not.toHaveBeenCalled();
  });

  it("is skipped when TWILIO_AUTH_TOKEN is missing", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";

    await repointWebhooksOnStartup();

    expect(h.getAllAvailableNumbers).not.toHaveBeenCalled();
    expect(h.configureAllPoolWebhooks).not.toHaveBeenCalled();
  });

  it("does not call configureAllPoolWebhooks when the pool is empty", async () => {
    setTwilioCreds();
    h.getAllAvailableNumbers.mockResolvedValue([]);

    await repointWebhooksOnStartup();

    expect(h.getAllAvailableNumbers).toHaveBeenCalledTimes(1);
    expect(h.configureAllPoolWebhooks).not.toHaveBeenCalled();
  });

  it("swallows storage errors so a failed repoint never crashes startup", async () => {
    setTwilioCreds();
    h.getAllAvailableNumbers.mockRejectedValue(new Error("db down"));

    await expect(repointWebhooksOnStartup()).resolves.toBeUndefined();
    expect(h.configureAllPoolWebhooks).not.toHaveBeenCalled();
  });
});
