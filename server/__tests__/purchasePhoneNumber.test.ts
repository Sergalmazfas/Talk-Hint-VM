import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct coverage for purchasePhoneNumber — the helper that actually buys a
// Twilio number and wires its voice webhook in one shot via
// client.incomingPhoneNumbers.create(...). A regression here (wrong create
// params, dropping the webhook URL, or mishandling subaccount creds) could
// charge for a number that never receives calls, so we pin the success path,
// the subaccount-credential path, and the thrown-error path.
//
// We swap the underlying `twilio` SDK for a fake whose incomingPhoneNumbers
// carries a .create(opts) we control per case, and capture the args twilio()
// itself was constructed with so we can assert credential routing.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    // (opts) => Promise<IncomingPhoneNumberInstance>
    create: vi.fn(),
    // records the (sid, token) every twilio() construction was called with.
    ctorArgs: [] as Array<[string, string]>,
  };
});

vi.mock("twilio", () => {
  const twilioFn = vi.fn((sid: string, token: string) => {
    h.ctorArgs.push([sid, token]);
    const incomingPhoneNumbers: any = {
      create: (opts: any) => h.create(opts),
    };
    return { incomingPhoneNumbers };
  });
  return { default: twilioFn };
});

// getTwilioClient reads these module-level consts at import time when no
// subaccount creds are passed; set them before importing the module under test.
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = "test_token";

const { purchasePhoneNumber } = await import("../twilioService");

const PHONE = "+15550001111";
const WEBHOOK_URL = "https://live.example.com/twilio/voice";

beforeEach(() => {
  h.create.mockReset();
  h.ctorArgs.length = 0;
});

describe("purchasePhoneNumber", () => {
  it("creates the number with the voice webhook and returns its identity", async () => {
    h.create.mockResolvedValue({
      sid: "PN_new",
      phoneNumber: PHONE,
      friendlyName: "TalkHint User Number",
    });

    const result = await purchasePhoneNumber(PHONE, WEBHOOK_URL);

    expect(result).toEqual({
      sid: "PN_new",
      phoneNumber: PHONE,
      friendlyName: "TalkHint User Number",
    });

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledWith({
      phoneNumber: PHONE,
      voiceUrl: WEBHOOK_URL,
      voiceMethod: "POST",
      friendlyName: "TalkHint User Number",
    });

    // No subaccount creds -> used the master account credentials.
    expect(h.ctorArgs).toEqual([["AC_test_sid", "test_token"]]);
  });

  it("uses subaccount credentials when they are supplied", async () => {
    h.create.mockResolvedValue({
      sid: "PN_sub",
      phoneNumber: PHONE,
      friendlyName: "TalkHint User Number",
    });

    await purchasePhoneNumber(PHONE, WEBHOOK_URL, "ACsub", "subtok");

    expect(h.ctorArgs).toEqual([["ACsub", "subtok"]]);
  });

  it("propagates a thrown SDK error instead of reporting a fake success", async () => {
    h.create.mockRejectedValue(new Error("number unavailable"));

    await expect(purchasePhoneNumber(PHONE, WEBHOOK_URL)).rejects.toThrow(
      "number unavailable",
    );
  });
});
