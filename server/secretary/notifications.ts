import apn from "@parse/node-apn";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { deviceTokens } from "@shared/schema";
import { normalizePem } from "../pushChannels/iosPushChannel";
import { sendPushToUser } from "../pushService";

// A VoIP Services certificate cannot send an ordinary alert push, and a
// secretary report must never be disguised as an incoming call. Provision a
// separate Apple Push Notification Service certificate for the app topic.
let providers: Partial<Record<"sandbox" | "production", apn.Provider>> = {};

function providerFor(environment: string): apn.Provider | null {
  const cert = normalizePem(process.env.APNS_ALERT_CERT_PEM);
  const key = normalizePem(process.env.APNS_ALERT_KEY_PEM);
  if (!cert || !key) return null;
  const sandbox = ["sandbox", "dev", "development"].includes(environment.toLowerCase());
  const name = sandbox ? "sandbox" : "production";
  return providers[name] ??= new apn.Provider({
    cert: Buffer.from(cert),
    key: Buffer.from(key),
    production: !sandbox,
  });
}

export async function notifySecretaryResult(userId: string, taskId: string): Promise<void> {
  const tokens = await db.select().from(deviceTokens).where(and(
    eq(deviceTokens.userId, userId),
    eq(deviceTokens.platform, "ios_alert"),
    eq(deviceTokens.isActive, true),
  ));
  const errors: string[] = [];
  let sent = 0;
  for (const token of tokens) {
    const provider = providerFor(token.environment ?? "production");
    if (!provider) {
      errors.push("Ordinary APNs alert certificate not configured");
      continue;
    }
    const notification = new apn.Notification();
    notification.topic = token.bundleId || process.env.APNS_BUNDLE_ID || "app.talkhint";
    notification.pushType = "alert";
    notification.priority = 10;
    notification.expiry = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    notification.alert = {
      title: "TalkHint Secretary",
      body: "Your call report is ready. Open TalkHint to read it.",
    };
    notification.payload = { type: "secretary_result", taskId };
    try {
      const result = await provider.send(notification, token.token);
      if (result.failed.length) {
        const reason = result.failed[0].response?.reason ?? result.failed[0].error?.message ?? "APNs rejected alert";
        if (["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"].includes(reason)) {
          await db.update(deviceTokens).set({ isActive: false }).where(eq(deviceTokens.id, token.id));
        }
        errors.push(reason);
      } else {
        sent++;
      }
    } catch (e: any) {
      errors.push(e?.message ?? "APNs request failed");
    }
  }
  const webSent = await sendPushToUser(userId, {
    title: "TalkHint Secretary",
    body: "Your call report is ready. Open TalkHint to read it.",
    tag: `secretary-${taskId}`,
    data: { type: "secretary_result", taskId, url: `/app?secretaryTask=${encodeURIComponent(taskId)}` },
  });
  // The report is already persisted and remains visible in the app. A missing
  // standard APNs setup is surfaced to the worker as a retryable failure rather
  // than reporting a push as delivered when no device was reached.
  if (sent + webSent === 0) {
    throw new Error(errors.length ? errors.join("; ") : "No registered alert device or web subscription for this owner");
  }
}