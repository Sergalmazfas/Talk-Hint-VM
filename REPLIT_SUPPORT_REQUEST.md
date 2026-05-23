# Replit Support Request — Stripe Claim Sandbox Blocking Deployment

**To:** support@replit.com (or via in-app support widget)
**Subject:** Cannot deploy — Stripe "Claim sandbox" returns "Invalid claim token" across all browsers

---

## Issue Summary

The Publishing panel requires completing the Stripe "Claim sandbox" step before the Publish button activates. The claim flow consistently fails with the error:

> **"Invalid claim token. It may have expired, or is malformed."**

This blocks production deployment entirely.

## Reproduction Steps

1. Open project Publishing panel
2. Click "Claim sandbox" button under Stripe connection
3. Stripe redirects to dashboard.stripe.com/.../claim
4. Select existing Stripe account (Culture B LLC)
5. Click Continue → error: "Invalid claim token"

## Environments Tested (all fail with same error)

- ✅ Replit iOS app (Safari WebView)
- ✅ Safari on iPhone (direct replit.com)
- ✅ Safari on macOS desktop (replit.com)
- ✅ Chrome incognito on desktop (replit.com)
- Token fails immediately even when claim flow completed within 10 seconds

## Project Details

- **Project:** TalkHint v2 (real-time AI voice assistant)
- **Account email:** sergalmazfas@gmail.com
- **Stripe account selected:** Culture B LLC
- **Stripe production connector ID:** `ccfg_stripe_01K611P4YQR0SZM11XFRQJC44Y` (status: `not_setup`)
- **Stripe dev connection ID:** `conn_stripe_01KFCAV106V91ZJN7KP0Q0SPCB` (status: `added`, working fine)

## What's Working

- Dev environment Stripe connector — healthy ✅
- `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` set as project secrets ✅
- Production build (`npm run build`) completes without errors ✅
- App has env-var fallback in `server/stripeClient.ts` — does NOT require Replit connector at runtime ✅
- Deployment target configured: VM (Reserved VM, correct for WebSocket app) ✅
- All other secrets in place (Twilio, OpenAI, Deepgram, ElevenLabs, VAPID) ✅

## What's Blocked

- The Publish button stays disabled (transparent/grey) because Publishing UI enforces Stripe Claim sandbox completion
- Cannot deploy to production despite app being fully ready

## Request

Please either:
1. **Fix the Stripe Claim sandbox token issue** for our production connector, OR
2. **Remove the Stripe blueprint requirement** from our Publishing checklist (our code has env-var fallback, we don't need Replit-managed Stripe credentials in production), OR
3. **Manually trigger our deployment** since all underlying configuration is ready

## Technical Evidence

Code path that bypasses Replit Stripe connector (works without it):

```typescript
// server/stripeClient.ts
async function getCredentials() {
  // First try Replit connector
  try { ... } catch { }
  
  // Fallback to environment variables
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (secretKey && publishableKey) {
    console.log("[Stripe] Using environment variable credentials");
    return { publishableKey, secretKey };
  }
  return null;
}
```

Thank you for your help.
