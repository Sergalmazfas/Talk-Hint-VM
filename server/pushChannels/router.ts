import { db } from "../db";
import { deviceTokens } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { PushChannel, IncomingCallPushPayload } from "./types";
import { IOSPushChannel, TerminalTokenError } from "./iosPushChannel";

// Web push is intentionally NOT registered here — it requires p256dh/auth keys
// that are not stored in device_tokens. Web dispatch is handled by the legacy
// sendPushToUser() in pushService.ts using the pushSubscriptions table.
const channels: Record<string, PushChannel> = {
  ios: new IOSPushChannel(),
};

export async function routeIncomingCallPush(
  payload: IncomingCallPushPayload
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  // 1. Web subscriptions are handled by the legacy sendIncomingCallPush() in
  //    pushService.ts (uses pushSubscriptions table with p256dh/auth keys).
  //    The router does not duplicate that dispatch.

  // 2. Send to all device_tokens for this user (iOS now, Android future).
  const tokens = await db
    .select()
    .from(deviceTokens)
    .where(
      and(
        eq(deviceTokens.userId, payload.userId),
        eq(deviceTokens.isActive, true)
      )
    );

  for (const t of tokens) {
    const channel = channels[t.platform];
    if (!channel) {
      console.warn(`[Push Router] Unknown platform: ${t.platform}`);
      continue;
    }
    if (!channel.isConfigured()) {
      console.warn(`[Push Router] Channel ${t.platform} not configured, skipping`);
      continue;
    }
    try {
      await channel.sendIncomingCall(t.token, payload, {
        environment: t.environment ?? "production",
      });
      sent++;
    } catch (e: any) {
      if (e instanceof TerminalTokenError) {
        console.warn(
          `[Push Router] Deactivating dead ${t.platform} token (reason=${e.reason})`
        );
        await db
          .update(deviceTokens)
          .set({ isActive: false })
          .where(eq(deviceTokens.id, t.id));
      } else {
        console.error(`[Push Router] Failed to send via ${t.platform}:`, e.message);
      }
      failed++;
    }
  }

  return { sent, failed };
}
