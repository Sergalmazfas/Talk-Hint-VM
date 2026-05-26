import Stripe from 'stripe';

function getCredentials() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

  if (secretKey && publishableKey) {
    return { secretKey, publishableKey };
  }

  console.log("[Stripe] STRIPE_SECRET_KEY or STRIPE_PUBLISHABLE_KEY not set - Stripe features disabled");
  return null;
}

export async function getUncachableStripeClient() {
  const creds = getCredentials();
  if (!creds) return null;
  return new Stripe(creds.secretKey);
}

export async function getStripePublishableKey() {
  const creds = getCredentials();
  return creds?.publishableKey || null;
}

export async function getStripeSecretKey() {
  const creds = getCredentials();
  return creds?.secretKey || null;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const secretKey = await getStripeSecretKey();
    if (!secretKey) {
      console.log("[Stripe] No secret key available - Stripe sync disabled");
      return null;
    }

    const { StripeSync } = await import('stripe-replit-sync');

    // In production, prefer PROD_DATABASE_URL over DATABASE_URL
    const isProduction = process.env.NODE_ENV === "production";
    const dbUrl = (isProduction && process.env.PROD_DATABASE_URL)
      ? process.env.PROD_DATABASE_URL
      : process.env.DATABASE_URL!;

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: dbUrl,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
