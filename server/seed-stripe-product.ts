// Seed script to create Basic $15/month product in Stripe
// Run with: npx tsx server/seed-stripe-product.ts

import { getUncachableStripeClient } from './stripeClient';

async function createBasicProduct() {
  console.log('[Stripe Seed] Starting product creation...');
  
  const stripe = await getUncachableStripeClient();
  if (!stripe) {
    console.error('[Stripe Seed] Stripe client not available');
    process.exit(1);
  }

  // Check if Basic product already exists
  const existingProducts = await stripe.products.search({ 
    query: "name:'TalkHint Basic'" 
  });
  
  if (existingProducts.data.length > 0) {
    console.log('[Stripe Seed] Basic product already exists:', existingProducts.data[0].id);
    
    // Check for existing price
    const prices = await stripe.prices.list({ 
      product: existingProducts.data[0].id,
      active: true 
    });
    
    if (prices.data.length > 0) {
      console.log('[Stripe Seed] Price already exists:', prices.data[0].id);
      console.log('[Stripe Seed] Amount:', prices.data[0].unit_amount! / 100, prices.data[0].currency);
    }
    
    return;
  }

  // Create Basic product
  console.log('[Stripe Seed] Creating Basic product...');
  const product = await stripe.products.create({
    name: 'TalkHint Basic',
    description: 'AI-powered voice assistant for phone calls',
    metadata: {
      plan_type: 'basic',
      features: '1 personal phone number, live calls, training calls, learning/flashcards, notifications'
    }
  });
  
  console.log('[Stripe Seed] Product created:', product.id);

  // Create $15/month price
  console.log('[Stripe Seed] Creating $15/month price...');
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 1500, // $15.00 in cents
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: {
      plan_type: 'basic'
    }
  });
  
  console.log('[Stripe Seed] Price created:', price.id);
  console.log('[Stripe Seed] ✅ Basic $15/month product ready!');
}

createBasicProduct()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Stripe Seed] Error:', err);
    process.exit(1);
  });
