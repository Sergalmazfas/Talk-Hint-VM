import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct coverage for releasePhoneNumber — the helper that de-provisions a
// Twilio number via client.incomingPhoneNumbers(sid).remove(). A regression
// here could leave a number un-released (still billed) or throw unexpectedly
// during de-provisioning, so we pin the success path, master vs subaccount
// credential routing, and the thrown-error path (the helper has no try/catch).
//
// We swap the underlying `twilio` SDK for a fake whose incomingPhoneNumbers is
// itself a callable that records the sid it was given and returns an object
// with a .remove() we control per case. We also capture the args twilio()
// itself was constructed with so we can assert credential routing.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    // () => Promise<void> — the remove() call under test.
    remove: vi.fn(),
    // records the sid every incomingPhoneNumbers(sid) was called with.
    sidArgs: [] as string[],
    // records the (sid, token) every twilio() construction was called with.
    ctorArgs: [] as Array<[string, string]>,
  };
});

vi.mock("twilio", () => {
  const twilioFn = vi.fn((sid: string, token: string) => {
    h.ctorArgs.push([sid, token]);
    const incomingPhoneNumbers: any = (numberSid: string) => {
      h.sidArgs.push(numberSid);
      return { remove: () => h.remove() };
    };
    return { incomingPhoneNumbers };
  });
  return { default: twilioFn };
});

// getTwilioClient reads these module-level consts at import time when no
// subaccount creds are passed; set them before importing the module under test.
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = "test_token";

const { releasePhoneNumber } = await import("../twilioService");

const SID = "PN_release_me";

beforeEach(() => {
  h.remove.mockReset();
  h.sidArgs.length = 0;
  h.ctorArgs.length = 0;
});

describe("releasePhoneNumber", () => {
  it("removes the number by SID and returns true on success", async () => {
    h.remove.mockResolvedValue(undefined);

    const result = await releasePhoneNumber(SID);

    expect(result).toBe(true);
    expect(h.sidArgs).toEqual([SID]);
    expect(h.remove).toHaveBeenCalledTimes(1);

    // No subaccount creds -> used the master account credentials.
    expect(h.ctorArgs).toEqual([["AC_test_sid", "test_token"]]);
  });

  it("uses subaccount credentials when they are supplied", async () => {
    h.remove.mockResolvedValue(undefined);

    await releasePhoneNumber(SID, "ACsub", "subtok");

    expect(h.ctorArgs).toEqual([["ACsub", "subtok"]]);
    expect(h.sidArgs).toEqual([SID]);
  });

  it("propagates a thrown SDK error instead of reporting a fake success", async () => {
    h.remove.mockRejectedValue(new Error("number not found"));

    await expect(releasePhoneNumber(SID)).rejects.toThrow("number not found");
  });
});
