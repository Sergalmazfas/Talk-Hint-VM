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
