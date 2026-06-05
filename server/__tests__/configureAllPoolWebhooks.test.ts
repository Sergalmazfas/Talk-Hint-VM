import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct coverage for configureAllPoolWebhooks — the routine the startup
// repoint relies on to push the live production URL onto every Twilio pool
// number and report how many succeeded vs failed. The startup hook that *calls*
// it is covered in webhookRepoint.test.ts; here we verify the per-number loop,
// the success/failure tally, and the per-number error aggregation.
//
// configureAllPoolWebhooks calls configureVoiceWebhook through a same-module
// local binding, so module-level mocking can't intercept that internal call.
// Instead we swap the underlying `twilio` SDK for a fake whose
// incomingPhoneNumbers(sid).update() resolves (success) or rejects (failure)
// per SID. This exercises the real configureAllPoolWebhooks ->
// configureVoiceWebhook path hermetically — no Twilio / network required.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    // (sid, opts) => Promise; the test sets the implementation per case.
    update: vi.fn(),
  };
});

vi.mock("twilio", () => {
  const twilioFn = vi.fn(() => ({
    incomingPhoneNumbers: (sid: string) => ({
      update: (opts: any) => h.update(sid, opts),
    }),
  }));
  return { default: twilioFn };
});

// getTwilioClient reads these module-level consts at import time when a number
// has no subaccount creds; set them before importing the module under test.
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = "test_token";

const { configureAllPoolWebhooks } = await import("../twilioService");

const BASE_URL = "https://live.example.com";

beforeEach(() => {
  h.update.mockReset();
});

describe("configureAllPoolWebhooks", () => {
  it("configures every number and tallies all-success with no errors", async () => {
    h.update.mockImplementation((_sid: string, opts: any) =>
      Promise.resolve({ phoneNumber: opts.voiceUrl }),
    );

    const numbers = [
      { twilioSid: "PN1", twilioNumber: "+15550001111" },
      {
        twilioSid: "PN2",
        twilioNumber: "+15550002222",
        subaccountSid: "ACsub2",
        subaccountToken: "tok2",
      },
      { twilioSid: "PN3", twilioNumber: "+15550003333" },
    ];

    const result = await configureAllPoolWebhooks(numbers, BASE_URL);

    expect(result).toEqual({ configured: 3, failed: 0, errors: [] });

    // Every number got the correct ${baseUrl}/twilio/voice URL...
    expect(h.update).toHaveBeenCalledTimes(3);
    for (const call of h.update.mock.calls) {
      const opts = call[1];
      expect(opts.voiceUrl).toBe(`${BASE_URL}/twilio/voice`);
      expect(opts.voiceMethod).toBe("POST");
      // ...and the derived status callback URL.
      expect(opts.statusCallback).toBe(`${BASE_URL}/twilio/status`);
    }

    // The loop visited each number's SID exactly once.
    expect(h.update.mock.calls.map((c) => c[0])).toEqual(["PN1", "PN2", "PN3"]);
  });

  it("tallies mixed results and aggregates per-number error strings", async () => {
    // PN2 and PN4 fail; PN1 and PN3 succeed.
    h.update.mockImplementation((sid: string, opts: any) => {
      if (sid === "PN2") {
        return Promise.reject(new Error("auth failed"));
      }
      if (sid === "PN4") {
        return Promise.reject(new Error("number not found"));
      }
      return Promise.resolve({ phoneNumber: opts.voiceUrl });
    });

    const numbers = [
      { twilioSid: "PN1", twilioNumber: "+15550001111" },
      { twilioSid: "PN2", twilioNumber: "+15550002222" },
      { twilioSid: "PN3", twilioNumber: "+15550003333" },
      { twilioSid: "PN4", twilioNumber: "+15550004444" },
    ];

    const result = await configureAllPoolWebhooks(numbers, BASE_URL);

    expect(result.configured).toBe(2);
    expect(result.failed).toBe(2);
    // Errors are formatted as `number: error` and collected in loop order.
    expect(result.errors).toEqual([
      "+15550002222: auth failed",
      "+15550004444: number not found",
    ]);

    expect(h.update).toHaveBeenCalledTimes(4);
  });
});
