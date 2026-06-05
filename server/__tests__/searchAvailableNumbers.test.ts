import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct coverage for searchAvailableNumbers — the helper the UI uses to show
// purchasable Twilio numbers for a country/area code. It queries
// client.availablePhoneNumbers(country).local.list(...) and maps + caps the
// result at 10. A regression here (wrong search params, a broken mapping, or a
// swallowed empty result) could let number-search appear to work while
// returning garbage or nothing, so we pin the success, empty, and thrown-error
// paths.
//
// We swap the underlying `twilio` SDK for a fake whose
// availablePhoneNumbers(country) exposes a .local.list(opts) we control per
// case. This exercises the real helper hermetically — no Twilio / network.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    // (country, opts) => Promise<AvailablePhoneNumberInstance[]>
    list: vi.fn(),
  };
});

vi.mock("twilio", () => {
  const twilioFn = vi.fn(() => ({
    availablePhoneNumbers: (country: string) => ({
      local: {
        list: (opts: any) => h.list(country, opts),
      },
    }),
  }));
  return { default: twilioFn };
});

// getTwilioClient reads these module-level consts at import time; set them
// before importing the module under test.
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = "test_token";

const { searchAvailableNumbers } = await import("../twilioService");

beforeEach(() => {
  h.list.mockReset();
});

function makeNumber(phoneNumber: string, overrides: Record<string, any> = {}) {
  return {
    phoneNumber,
    friendlyName: phoneNumber,
    locality: "Springfield",
    region: "IL",
    ...overrides,
  };
}

describe("searchAvailableNumbers", () => {
  it("maps the SDK result and passes voice/sms + area code search params", async () => {
    h.list.mockResolvedValue([
      makeNumber("+15550001111", { locality: "Chicago", region: "IL" }),
    ]);

    const result = await searchAvailableNumbers("312", "US");

    expect(result).toEqual([
      {
        phoneNumber: "+15550001111",
        friendlyName: "+15550001111",
        locality: "Chicago",
        region: "IL",
        country: "US",
      },
    ]);

    // Queried the right country with voice + sms enabled and the area code.
    expect(h.list).toHaveBeenCalledTimes(1);
    const [country, opts] = h.list.mock.calls[0];
    expect(country).toBe("US");
    expect(opts).toMatchObject({
      voiceEnabled: true,
      smsEnabled: true,
      areaCode: "312",
    });
  });

  it("defaults the country to US and omits areaCode when none is given", async () => {
    h.list.mockResolvedValue([]);

    await searchAvailableNumbers();

    const [country, opts] = h.list.mock.calls[0];
    expect(country).toBe("US");
    expect("areaCode" in opts).toBe(false);
  });

  it("returns an empty array when Twilio has no matching numbers", async () => {
    h.list.mockResolvedValue([]);

    const result = await searchAvailableNumbers("999");

    expect(result).toEqual([]);
  });

  it("caps the result at 10 numbers even when Twilio returns more", async () => {
    h.list.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) =>
        makeNumber(`+1555000${String(i).padStart(4, "0")}`),
      ),
    );

    const result = await searchAvailableNumbers();

    expect(result).toHaveLength(10);
  });

  it("coalesces missing locality/region to empty strings", async () => {
    h.list.mockResolvedValue([
      makeNumber("+15550002222", { locality: null, region: undefined }),
    ]);

    const result = await searchAvailableNumbers();

    expect(result[0]).toMatchObject({ locality: "", region: "" });
  });

  it("propagates a thrown SDK error instead of swallowing it", async () => {
    h.list.mockRejectedValue(new Error("rate limited"));

    await expect(searchAvailableNumbers("312")).rejects.toThrow("rate limited");
  });
});
