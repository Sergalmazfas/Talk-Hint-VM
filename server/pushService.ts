import webpush from 'web-push';
import { db } from './db';
import { pushSubscriptions } from '@shared/schema';
import { eq } from 'drizzle-orm';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@talkhint.me';

let pushConfigured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    // Remove any trailing = signs, newlines, literal \n, and clean up the key
    const cleanPrivateKey = VAPID_PRIVATE_KEY
      .replace(/\\n/g, '')  // Remove literal \n
      .replace(/[\r\n=]+/g, '')  // Remove actual newlines and =
      .trim();
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, cleanPrivateKey);
    pushConfigured = true;
    console.log('[Push] Web Push configured');
  } catch (error: any) {
    console.error('[Push] Failed to configure VAPID:', error.message);
  }
} else {
  console.warn('[Push] VAPID keys not configured - push notifications disabled');
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, any>;
  tag?: string;
  requireInteraction?: boolean;
}

export async function saveSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<void> {
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  }).onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: {
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      updatedAt: new Date(),
    },
  });
  console.log(`[Push] Subscription saved for user ${userId}`);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  console.log(`[Push] Subscription removed: ${endpoint.substring(0, 50)}...`);
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured) {
    console.warn('[Push] Cannot send push - VAPID keys not configured');
    return 0;
  }

  const subscriptions = await db.select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  if (subscriptions.length === 0) {
    console.log(`[Push] No subscriptions found for user ${userId}`);
    return 0;
  }

  let successCount = 0;
  const payloadString = JSON.stringify(payload);

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        payloadString
      );
      successCount++;
      console.log(`[Push] Notification sent to ${sub.endpoint.substring(0, 50)}...`);
    } catch (error: any) {
      console.error(`[Push] Failed to send to ${sub.endpoint.substring(0, 50)}:`, error.message);
      if (error.statusCode === 410 || error.statusCode === 404) {
        await removeSubscription(sub.endpoint);
      }
    }
  }

  console.log(`[Push] Sent ${successCount}/${subscriptions.length} notifications to user ${userId}`);
  return successCount;
}

export async function sendIncomingCallPush(
  userId: string,
  fromNumber: string,
  callSid: string
): Promise<number> {
  return sendPushToUser(userId, {
    title: '📞 Incoming Call',
    body: `From ${fromNumber}`,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: `call-${callSid}`,
    requireInteraction: true,
    data: {
      type: 'incoming_call',
      callSid,
      fromNumber,
      url: `/app?incoming=1&callSid=${callSid}`,
    },
  });
}

export function getVapidPublicKey(): string | undefined {
  return VAPID_PUBLIC_KEY;
}
