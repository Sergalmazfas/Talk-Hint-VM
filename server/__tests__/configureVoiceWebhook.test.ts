import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct coverage for configureVoiceWebhook — the by-SID counterpart of the
// already-tested by-phone configureWebhookByPhone. It is what
// configureAllPoolWebhooks calls per number to point the voice webhook (and the
// derived /twilio/status callback) at the live app. A regression in the
// derived status URL, the update params, or the error handling could let a
// number silently keep stale webhooks while the call reports success.
//
// We swap the underlying `twilio` SDK for a fake whose
// incomingPhoneNumbers(sid).update(opts) we control per case, and capture the
// args twilio() was constructed with so we can assert credential routing.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    // (sid, opts) => Promise<IncomingPhoneNumberInstance>
    update: vi.fn(),
    // records the (sid, token) every twilio() construction was called with.
    ctorArgs: [] as Array<[string, string]>,
  };
});

vi.mock("twilio", () => {
  const twilioFn = vi.fn((sid: string, token: string) => {
    h.ctorArgs.push([sid, token]);
    return {
      incomingPhoneNumbers: (numberSid: string) => ({
        update: (opts: any) => h.update(numberSid, opts),
      }),
    };
  });
  return { default: twilioFn };
});

// getTwilioClient reads these module-level consts at import time when no
// subaccount creds are passed; set them before importing the module under test.
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = "test_token";

const { configureVoiceWebhook } = await import("../twilioService");

const SID = "PN_target";
const WEBHOOK_URL = "https://live.example.com/twilio/voice";

beforeEach(() => {
  h.update.mockReset();
  h.ctorArgs.length = 0;
});

describe("configureVoiceWebhook", () => {
  it("updates the SID with the voice URL and the derived status callback", async () => {
    h.update.mockImplementation((_sid: string, opts: any) =>
      Promise.resolve({ phoneNumber: "+15550001111", voiceUrl: opts.voiceUrl }),
    );

    const result = await configureVoiceWebhook(SID, WEBHOOK_URL);

    expect(result).toEqual({ success: true, phoneNumber: "+15550001111" });

    expect(h.update).toHaveBeenCalledTimes(1);
    const [sid, opts] = h.update.mock.calls[0];
    expect(sid).toBe(SID);
    expect(opts).toMatchObject({
      voiceUrl: WEBHOOK_URL,
      voiceMethod: "POST",
      // /twilio/voice -> /twilio/status
      statusCallback: "https://live.example.com/twilio/status",
      statusCallbackMethod: "POST",
    });

    // No subaccount creds -> used the master account credentials.
    expect(h.ctorArgs).toEqual([["AC_test_sid", "test_token"]]);
  });

  it("uses subaccount credentials when they are supplied", async () => {
    h.update.mockResolvedValue({ phoneNumber: "+15550001111" });

    await configureVoiceWebhook(SID, WEBHOOK_URL, "ACsub", "subtok");

    expect(h.ctorArgs).toEqual([["ACsub", "subtok"]]);
  });

  it("surfaces a thrown SDK error as a failure result instead of throwing", async () => {
    h.update.mockRejectedValue(new Error("auth failed"));

    const result = await configureVoiceWebhook(SID, WEBHOOK_URL);

    expect(result).toEqual({ success: false, error: "auth failed" });
  });
});
