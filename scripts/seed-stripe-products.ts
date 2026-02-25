import { getUncachableStripeClient } from "../server/stripeClient";

async function createProducts() {
  console.log("Creating Stripe products...");
  
  const stripe = await getUncachableStripeClient();
  
  const existingProducts = await stripe.products.list({ limit: 10 });
  if (existingProducts.data.length > 0) {
    console.log("Products already exist:");
    existingProducts.data.forEach(p => console.log(`  - ${p.name} (${p.id})`));
    return;
  }
  
  const personalPlan = await stripe.products.create({
    name: "Personal Plan",
    description: "1 personal phone number, 100 minutes/month",
    metadata: {
      type: "subscription",
      tier: "personal",
    },
  });
  
  await stripe.prices.create({
    product: personalPlan.id,
    unit_amount: 900,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { tier: "personal" },
  });
  
  console.log(`Created: ${personalPlan.name} - $9/month`);
  
  const proPlan = await stripe.products.create({
    name: "Pro Plan",
    description: "2 phone numbers (personal + work), unlimited minutes",
    metadata: {
      type: "subscription",
      tier: "pro",
    },
  });
  
  await stripe.prices.create({
    product: proPlan.id,
    unit_amount: 1900,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { tier: "pro" },
  });
  
  console.log(`Created: ${proPlan.name} - $19/month`);
  
  const workNumber = await stripe.products.create({
    name: "Additional Work Number",
    description: "Add an extra work phone number to your plan",
    metadata: {
      type: "addon",
      tier: "work_number",
    },
  });
  
  await stripe.prices.create({
    product: workNumber.id,
    unit_amount: 1000,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { tier: "work_number" },
  });
  
  console.log(`Created: ${workNumber.name} - $10/month`);
  
  console.log("\nAll products created successfully!");
}

createProducts().catch(console.error);
