import webpush from "web-push";
import { PushChannel, IncomingCallPushPayload, GenericPushPayload } from "./types";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

export class WebPushChannel implements PushChannel {
  platform = "web";

  isConfigured(): boolean {
    return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  }

  async sendIncomingCall(token: string, payload: IncomingCallPushPayload): Promise<void> {
    // Note: web push requires endpoint + p256dh + auth keys, which are stored in
    // the legacy pushSubscriptions table. The existing sendIncomingCallPush() in
    // pushService.ts already handles web subscriptions directly. This method
    // exists to satisfy the interface; web dispatch is intentionally NOT routed
    // through device_tokens (which only stores a single token string).
    const notificationPayload = {
      title: "📞 Incoming Call",
      body: `From ${payload.fromNumber}`,
      icon: "/icon-192.png",
      badge: "/badge-72.png",
      tag: `call-${payload.callSid}`,
      requireInteraction: true,
      data: {
        type: "incoming_call",
        callSid: payload.callSid,
        fromNumber: payload.fromNumber,
        url: `/app?incoming=1&callSid=${payload.callSid}`,
      },
    };
    await webpush.sendNotification(
      { endpoint: token, keys: { p256dh: "", auth: "" } } as any,
      JSON.stringify(notificationPayload)
    );
  }

  async sendGeneric(token: string, payload: GenericPushPayload): Promise<void> {
    await webpush.sendNotification(
      { endpoint: token, keys: { p256dh: "", auth: "" } } as any,
      JSON.stringify(payload)
    );
  }
}
