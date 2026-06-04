import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hermetic coverage for the iOS VoIP push send path. The real end-to-end ring
// (PSTN -> Engine push -> CallKit -> conference audio) can only be exercised on
// a physical iPhone, but the parts that are pure code logic ARE verified here:
//
//   - Sandbox vs production APNs host selection driven by the device token's
//     build environment ("sandbox"/"development"/"dev" -> sandbox host,
//     everything else -> production host).
//   - One cached node-apn Provider per host (persistent HTTP/2 connection).
//   - The VoIP notification shape (topic `${bundleId}.voip`, pushType "voip",
//     priority 10, custom incoming_call payload).
//   - Terminal APNs rejections surface as TerminalTokenError so the router can
//     deactivate dead tokens instead of retrying forever.
//
// @parse/node-apn is swapped for a fake that records the `production` flag each
// Provider is constructed with and the notifications it is asked to send.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const providerCalls: { production: boolean }[] = [];
  const sends: { topic: string; pushType: string; priority: number; payload: any; token: string }[] = [];
  // Per-host queued send result; defaults to success.
  let nextResult: any = { sent: [{}], failed: [] };

  class FakeNotification {
    topic = "";
    pushType = "";
    priority = 0;
    expiry = 0;
    payload: any = {};
  }

  class FakeProvider {
    production: boolean;
    constructor(opts: { production: boolean }) {
      this.production = opts.production;
      providerCalls.push({ production: opts.production });
    }
    async send(notification: FakeNotification, token: string) {
      sends.push({
        topic: notification.topic,
        pushType: notification.pushType,
        priority: notification.priority,
        payload: notification.payload,
        token,
      });
      return nextResult;
    }
  }

  return {
    providerCalls,
    sends,
    setNextResult: (r: any) => {
      nextResult = r;
    },
    reset: () => {
      providerCalls.length = 0;
      sends.length = 0;
      nextResult = { sent: [{}], failed: [] };
    },
    FakeNotification,
    FakeProvider,
  };
});

vi.mock("@parse/node-apn", () => ({
  default: {
    Provider: h.FakeProvider,
    Notification: h.FakeNotification,
  },
}));

// The channel reads APNS_* at module load, so set them before importing.
process.env.APNS_CERT_PEM = "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----";
process.env.APNS_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----";
process.env.APNS_BUNDLE_ID = "app.talkhint";

const { IOSPushChannel, TerminalTokenError } = await import("../pushChannels/iosPushChannel");

const payload = { callSid: "CA-1", fromNumber: "+15550001111", userId: "user-1" };

let channel: InstanceType<typeof IOSPushChannel>;

beforeEach(() => {
  h.reset();
  channel = new IOSPushChannel();
});

describe("IOSPushChannel host selection (build type)", () => {
  it("uses the SANDBOX host for debug-build (sandbox) tokens", async () => {
    await channel.sendIncomingCall("tok-sandbox", payload, { environment: "sandbox" });
    expect(h.providerCalls).toEqual([{ production: false }]);
  });

  it("treats 'development' and 'dev' as sandbox too", async () => {
    await channel.sendIncomingCall("tok-a", payload, { environment: "development" });
    await channel.sendIncomingCall("tok-b", payload, { environment: "dev" });
    expect(h.providerCalls.every((c) => c.production === false)).toBe(true);
  });

  it("uses the PRODUCTION host for release-build (production) tokens", async () => {
    await channel.sendIncomingCall("tok-prod", payload, { environment: "production" });
    expect(h.providerCalls).toEqual([{ production: true }]);
  });

  it("defaults unknown/missing environment to the production host", async () => {
    await channel.sendIncomingCall("tok-default", payload);
    expect(h.providerCalls).toEqual([{ production: true }]);
  });

  it("is case-insensitive on the environment string", async () => {
    await channel.sendIncomingCall("tok-upper", payload, { environment: "SANDBOX" });
    expect(h.providerCalls).toEqual([{ production: false }]);
  });

  it("caches one Provider per host and reuses it across sends", async () => {
    await channel.sendIncomingCall("tok-1", payload, { environment: "sandbox" });
    await channel.sendIncomingCall("tok-2", payload, { environment: "sandbox" });
    await channel.sendIncomingCall("tok-3", payload, { environment: "production" });
    // 2 sandbox sends -> 1 sandbox provider; 1 production send -> 1 production provider.
    expect(h.providerCalls).toEqual([{ production: false }, { production: true }]);
  });
});

describe("IOSPushChannel notification shape", () => {
  it("sends a VoIP push with the correct topic, type, priority and payload", async () => {
    await channel.sendIncomingCall("tok-1", payload, { environment: "production" });
    expect(h.sends).toHaveLength(1);
    const sent = h.sends[0];
    expect(sent.topic).toBe("app.talkhint.voip");
    expect(sent.pushType).toBe("voip");
    expect(sent.priority).toBe(10);
    expect(sent.token).toBe("tok-1");
    expect(sent.payload).toEqual({
      type: "incoming_call",
      callSid: "CA-1",
      fromNumber: "+15550001111",
      userId: "user-1",
    });
  });
});

describe("IOSPushChannel failure handling", () => {
  it("throws TerminalTokenError for permanently-dead tokens", async () => {
    h.setNextResult({ sent: [], failed: [{ status: 410, response: { reason: "Unregistered" } }] });
    await expect(
      channel.sendIncomingCall("dead-token", payload, { environment: "production" })
    ).rejects.toBeInstanceOf(TerminalTokenError);
  });

  it("throws a generic error for transient APNs failures", async () => {
    h.setNextResult({ sent: [], failed: [{ status: 503, response: { reason: "ServiceUnavailable" } }] });
    await expect(
      channel.sendIncomingCall("tok-1", payload, { environment: "production" })
    ).rejects.toThrow(/ServiceUnavailable/);
    await expect(
      channel.sendIncomingCall("tok-1", payload, { environment: "production" })
    ).rejects.not.toBeInstanceOf(TerminalTokenError);
  });
});
