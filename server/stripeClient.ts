import Stripe from 'stripe';

export async function getUncachableStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.log("[Stripe] STRIPE_SECRET_KEY not set - Stripe backend disabled");
    return null;
  }
  return new Stripe(secretKey);
}

export async function getStripePublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
}

export async function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || null;
}
