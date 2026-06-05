import apn from "@parse/node-apn";
import { PushChannel, IncomingCallPushPayload, PushSendOptions } from "./types";

// Certificate-based VoIP push (PushKit). The Engine sends the VoIP push
// directly via APNs — Twilio is NOT used for push routing.
//
// Required secrets:
//   APNS_CERT_PEM  — VoIP Services certificate in PEM format (public cert)
//   APNS_KEY_PEM   — matching private key in PEM format
// Optional config:
//   APNS_BUNDLE_ID — app bundle id (default "app.talkhint").
//                    The VoIP push topic is always `${bundleId}.voip`.
// Secret stores frequently strip the newlines out of PEM blobs, leaving the
// whole certificate/key on a single line — which OpenSSL refuses to parse
// ("no start line"). Rebuild a well-formed PEM: keep each BEGIN/END marker on
// its own line and rewrap the base64 body at 64 chars. Handles multi-block
// blobs (e.g. a cert chain) and is a no-op for already-valid PEMs.
export function normalizePem(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  // Some secret stores escape newlines as the literal two-character sequence
  // "\n" (backslash + n). Convert those to real newlines first — otherwise the
  // stray "n" survives the base64 cleanup below and corrupts the body.
  const s = raw.trim().replace(/\\r\\n|\\n|\\r/g, "\n");
  const blocks = Array.from(
    s.matchAll(/-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/g),
  );
  if (blocks.length === 0) return s;
  return (
    blocks
      .map((b) => {
        const label = b[1].trim();
        const body = (
          b[2].replace(/[^A-Za-z0-9+/=]/g, "").match(/.{1,64}/g) || []
        ).join("\n");
        return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
      })
      .join("\n") + "\n"
  );
}

const APNS_CERT_PEM = normalizePem(process.env.APNS_CERT_PEM);
const APNS_KEY_PEM = normalizePem(process.env.APNS_KEY_PEM);
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || "app.talkhint";
const VOIP_TOPIC = `${APNS_BUNDLE_ID}.voip`;

// Calls are time-sensitive — drop the push quickly if it can't be delivered.
const CALL_PUSH_TTL_SECONDS = 30;

// APNs hosts: dev/sandbox builds (run from Xcode) get sandbox tokens, while
// TestFlight/App Store builds get production tokens. Anything not explicitly a
// dev/sandbox variant is treated as production.
const SANDBOX_ENVIRONMENTS = new Set(["sandbox", "development", "dev"]);

// APNs rejection reasons that mean the token is permanently dead — the caller
// should stop sending to it rather than retrying forever.
const TERMINAL_APNS_REASONS = new Set([
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
]);

// Error thrown when APNs reports a token that will never accept pushes again.
export class TerminalTokenError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`APNs terminal token error: ${reason}`);
    this.name = "TerminalTokenError";
    this.reason = reason;
  }
}

export class IOSPushChannel implements PushChannel {
  platform = "ios";

  // One provider per APNs host (sandbox / production). Created lazily and
  // reused — node-apn keeps a persistent HTTP/2 connection per provider.
  private providers: Record<string, apn.Provider> = {};

  isConfigured(): boolean {
    return Boolean(APNS_CERT_PEM && APNS_KEY_PEM);
  }

  private getProvider(production: boolean): apn.Provider {
    const key = production ? "production" : "sandbox";
    if (!this.providers[key]) {
      this.providers[key] = new apn.Provider({
        cert: Buffer.from(APNS_CERT_PEM as string),
        key: Buffer.from(APNS_KEY_PEM as string),
        production,
      });
    }
    return this.providers[key];
  }

  async sendIncomingCall(
    token: string,
    payload: IncomingCallPushPayload,
    options?: PushSendOptions
  ): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("iOS push channel is not configured (missing APNS_CERT_PEM / APNS_KEY_PEM)");
    }

    const env = (options?.environment ?? "production").toLowerCase();
    const production = !SANDBOX_ENVIRONMENTS.has(env);
    const provider = this.getProvider(production);

    const notification = new apn.Notification();
    notification.topic = VOIP_TOPIC;
    notification.pushType = "voip";
    notification.priority = 10;
    notification.expiry = Math.floor(Date.now() / 1000) + CALL_PUSH_TTL_SECONDS;
    // VoIP pushes carry a fully custom payload (no `aps.alert`). PushKit
    // delivers this whole object to the app so it can report the call to
    // CallKit and then connect via the Twilio Voice SDK.
    notification.payload = {
      type: "incoming_call",
      callSid: payload.callSid,
      fromNumber: payload.fromNumber,
      userId: payload.userId,
    };

    const result = await provider.send(notification, token);

    if (result.failed && result.failed.length > 0) {
      const f = result.failed[0];
      const reason = f.response?.reason;
      if (reason && TERMINAL_APNS_REASONS.has(reason)) {
        throw new TerminalTokenError(reason);
      }
      const message =
        reason || f.error?.message || `status ${f.status ?? "unknown"}`;
      throw new Error(`APNs rejected push: ${message}`);
    }
  }
}
