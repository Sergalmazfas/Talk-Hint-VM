import { storage } from "./storage";
import { configureAllPoolWebhooks } from "./twilioService";

/**
 * Resolve the live production base URL the deployed app is reachable at.
 * Precedence:
 *   1. PRODUCTION_URL  (explicit override, matches scripts/configure-twilio-webhooks.ts)
 *   2. REPLIT_DEPLOYMENT_URL
 *   3. first host in REPLIT_DOMAINS (set to the production domain inside the deployed VM)
 *   4. fallback to the planned custom domain
 * Returns a normalized `https://host` string with no trailing slash.
 */
export function resolveProductionBaseUrl(): string {
  const raw =
    process.env.PRODUCTION_URL ||
    process.env.REPLIT_DEPLOYMENT_URL ||
    (process.env.REPLIT_DOMAINS || '').split(',')[0].trim() ||
    'talkhint.app';

  const host = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${host}`;
}

/**
 * Automatically repoint every Twilio number in the pool at the live production
 * URL. Runs on production server startup (i.e. after each Publish), so inbound
 * calls always reach the freshly deployed app without anyone having to run
 * scripts/configure-twilio-webhooks.ts by hand.
 *
 * Safe to run repeatedly: configuring a number with the same webhook URL is a
 * no-op on Twilio's side. Set DISABLE_AUTO_WEBHOOK_REPOINT=true to opt out.
 */
export async function repointWebhooksOnStartup() {
  if (process.env.DISABLE_AUTO_WEBHOOK_REPOINT === 'true') {
    console.log('[Webhook Repoint] Skipped (DISABLE_AUTO_WEBHOOK_REPOINT=true)');
    return;
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.log('[Webhook Repoint] Skipped (Twilio credentials not configured)');
    return;
  }

  const baseUrl = resolveProductionBaseUrl();
  console.log(`[Webhook Repoint] Repointing pool webhooks at ${baseUrl}/twilio/voice`);

  try {
    const allNumbers = await storage.getAllAvailableNumbers();
    if (allNumbers.length === 0) {
      console.log('[Webhook Repoint] No numbers in pool, nothing to repoint');
      return;
    }

    const { configured, failed, errors } = await configureAllPoolWebhooks(
      allNumbers.map((n) => ({
        twilioSid: n.twilioSid,
        subaccountSid: n.subaccountSid || undefined,
        subaccountToken: n.subaccountToken || undefined,
        twilioNumber: n.twilioNumber,
      })),
      baseUrl,
    );

    console.log(`[Webhook Repoint] Done: ${configured} updated, ${failed} failed (of ${allNumbers.length})`);
    if (errors.length > 0) {
      errors.forEach((e) => console.error(`[Webhook Repoint] - ${e}`));
    }
  } catch (error: any) {
    console.error('[Webhook Repoint] Error:', error.message);
  }
}
