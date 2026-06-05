import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct coverage for configureWebhookByPhone — the manual fallback used to
// point a single Twilio number at the live app (e.g. via
// scripts/configure-twilio-webhooks.ts). Unlike configureAllPoolWebhooks it is
// invoked by-phone-number rather than by-SID: it lists the number to resolve
// its SID, then updates the voice + status webhooks. A regression in the
// "not found" branch, the error handling, or the derived /twilio/status URL
// could let a manual fix-up report success while leaving a number misconfigured.
//
// We swap the underlying `twilio` SDK for a fake. incomingPhoneNumbers must be
// both callable — incomingPhoneNumbers(sid).update() — and carry a .list()
// method, mirroring the real client. The test drives both per case.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    list: vi.fn(),
    update: vi.fn(),
  };
});

vi.mock("twilio", () => {
  const incomingPhoneNumbers: any = (sid: string) => ({
    update: (opts: any) => h.update(sid, opts),
  });
  incomingPhoneNumbers.list = (opts: any) => h.list(opts);

  const twilioFn = vi.fn(() => ({ incomingPhoneNumbers }));
  return { default: twilioFn };
});

// getTwilioClient reads these module-level consts at import time; set them
// before importing the module under test.
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = "test_token";

const { configureWebhookByPhone } = await import("../twilioService");

const PHONE = "+15550001111";
const WEBHOOK_URL = "https://live.example.com/twilio/voice";

beforeEach(() => {
  h.list.mockReset();
  h.update.mockReset();
});

describe("configureWebhookByPhone", () => {
  it("resolves the SID and sends the voice + derived status webhooks on success", async () => {
    h.list.mockResolvedValue([{ sid: "PN_resolved" }]);
    h.update.mockImplementation((_sid: string, opts: any) =>
      Promise.resolve({ phoneNumber: PHONE, voiceUrl: opts.voiceUrl }),
    );

    const result = await configureWebhookByPhone(PHONE, WEBHOOK_URL);

    expect(result).toEqual({ success: true, sid: "PN_resolved" });

    // Looked the number up by phone to resolve its SID.
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.list).toHaveBeenCalledWith({ phoneNumber: PHONE });

    // Updated the resolved SID with the voice URL and the status callback
    // derived by swapping /twilio/voice -> /twilio/status.
    expect(h.update).toHaveBeenCalledTimes(1);
    const [sid, opts] = h.update.mock.calls[0];
    expect(sid).toBe("PN_resolved");
    expect(opts).toMatchObject({
      voiceUrl: WEBHOOK_URL,
      voiceMethod: "POST",
      statusCallback: "https://live.example.com/twilio/status",
      statusCallbackMethod: "POST",
    });
  });

  it("returns a not-found failure without calling update when the number is missing", async () => {
    h.list.mockResolvedValue([]);

    const result = await configureWebhookByPhone(PHONE, WEBHOOK_URL);

    expect(result).toEqual({
      success: false,
      error: "Phone number not found in Twilio account",
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("surfaces a thrown SDK error as a failure result", async () => {
    h.list.mockResolvedValue([{ sid: "PN_resolved" }]);
    h.update.mockRejectedValue(new Error("auth failed"));

    const result = await configureWebhookByPhone(PHONE, WEBHOOK_URL);

    expect(result).toEqual({ success: false, error: "auth failed" });
  });
});
