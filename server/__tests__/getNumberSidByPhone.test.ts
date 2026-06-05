import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct coverage for getNumberSidByPhone — the by-phone lookup that resolves a
// number's Twilio SID (used wherever we only have the dialable number and need
// its SID, e.g. before reconfiguring a webhook). It queries
// client.incomingPhoneNumbers.list({ phoneNumber }) and, unlike the search/
// purchase helpers, swallows errors by returning null. A regression in the
// "not found" branch or the error branch could make callers treat a failed
// lookup as "no such number", so we pin success, not-found, and thrown-error.
//
// We swap the underlying `twilio` SDK for a fake whose
// incomingPhoneNumbers.list(opts) we control per case.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    // (opts) => Promise<IncomingPhoneNumberInstance[]>
    list: vi.fn(),
  };
});

vi.mock("twilio", () => {
  const twilioFn = vi.fn(() => {
    const incomingPhoneNumbers: any = {
      list: (opts: any) => h.list(opts),
    };
    return { incomingPhoneNumbers };
  });
  return { default: twilioFn };
});

// getTwilioClient reads these module-level consts at import time; set them
// before importing the module under test.
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = "test_token";

const { getNumberSidByPhone } = await import("../twilioService");

const PHONE = "+15550001111";

beforeEach(() => {
  h.list.mockReset();
});

describe("getNumberSidByPhone", () => {
  it("returns the SID of the first matching number", async () => {
    h.list.mockResolvedValue([{ sid: "PN_found" }, { sid: "PN_other" }]);

    const result = await getNumberSidByPhone(PHONE);

    expect(result).toBe("PN_found");
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.list).toHaveBeenCalledWith({ phoneNumber: PHONE });
  });

  it("returns null when no number matches", async () => {
    h.list.mockResolvedValue([]);

    const result = await getNumberSidByPhone(PHONE);

    expect(result).toBeNull();
  });

  it("returns null (does not throw) when the SDK call fails", async () => {
    h.list.mockRejectedValue(new Error("network down"));

    const result = await getNumberSidByPhone(PHONE);

    expect(result).toBeNull();
  });
});
