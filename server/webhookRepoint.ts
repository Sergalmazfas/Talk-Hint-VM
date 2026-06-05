import { storage } from "./storage";
import { configureAllPoolWebhooks } from "./twilioService";

/**
 * Resolve the live production base URL the deployed app is reachable at.
 * Precedence:
 *   1. PRODUCTION_URL  (explicit override, matches scripts/configure-twilio-webhooks.ts)
 *   2. REPLIT_DEPLOYMENT_URL
 *   3. first host in REPLIT_DOMAINS (set to the production domain inside the deployed VM)
 *
 * Returns a normalized `https://host` string with no trailing slash, or `null`
 * when none of the env vars are set. We intentionally do NOT fall back to a
 * hardcoded guess: silently pointing every Twilio webhook at the wrong host
 * breaks all inbound calls with no obvious error. Callers must handle `null`.
 */
export function resolveProductionBaseUrl(): string | null {
  const raw =
    process.env.PRODUCTION_URL ||
    process.env.REPLIT_DEPLOYMENT_URL ||
    (process.env.REPLIT_DOMAINS || '').split(',')[0].trim();

  if (!raw) return null;

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
  if (!baseUrl) {
    console.warn(
      '\n' +
        '************************************************************************\n' +
        '[Webhook Repoint] ⚠️  SKIPPED: could not resolve a live production URL.\n' +
        '  Twilio pool webhooks were NOT repointed, so inbound calls may reach a\n' +
        '  stale or wrong host. Set PRODUCTION_URL to the live deployed app URL\n' +
        '  (e.g. https://your-app.replit.app), or ensure REPLIT_DEPLOYMENT_URL /\n' +
        '  REPLIT_DOMAINS are present, then re-publish.\n' +
        '************************************************************************\n',
    );
    return;
  }
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
