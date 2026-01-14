import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

// Map product IDs to plan names
const PRODUCT_PLAN_MAP: Record<string, string> = {
  'prod_Tgad5uBrVNcJVS': 'personal', // Personal Plan - $9/month
  'prod_TgadUzTlkj4eT9': 'pro',      // Pro Plan - $19/month
};

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
    
    // Parse event to handle plan updates
    const stripe = await getUncachableStripeClient();
    const endpointSecret = await sync.getWebhookSecret();
    
    try {
      const event = stripe.webhooks.constructEvent(payload, signature, endpointSecret);
      await this.handleSubscriptionEvents(event);
    } catch (err: any) {
      console.error('[Webhook] Error parsing event:', err.message);
    }
  }
  
  static async handleSubscriptionEvents(event: any): Promise<void> {
    const stripe = await getUncachableStripeClient();
    
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;
        const status = subscription.status;
        
        console.log('[Webhook] Subscription event:', event.type, status);
        
        // Find user by Stripe customer ID
        const user = await storage.getUserByStripeCustomerId(customerId);
        if (!user) {
          console.log('[Webhook] No user found for customer:', customerId);
          return;
        }
        
        // Determine plan from product
        let newPlan = 'free';
        if (status === 'active' || status === 'trialing') {
          const priceId = subscription.items?.data?.[0]?.price?.id;
          const price = await stripe.prices.retrieve(priceId);
          const productId = price.product as string;
          
          // Use product map or check metadata
          if (PRODUCT_PLAN_MAP[productId]) {
            newPlan = PRODUCT_PLAN_MAP[productId];
          } else {
            const product = await stripe.products.retrieve(productId);
            if (product.metadata?.tier === 'personal') {
              newPlan = 'personal';
            } else if (product.metadata?.tier === 'pro') {
              newPlan = 'pro';
            }
          }
        }
        
        console.log('[Webhook] Updating user', user.id, 'plan to:', newPlan);
        await storage.updateUser(user.id, { 
          plan: newPlan,
          stripeSubscriptionId: subscription.id 
        });
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;
        
        const user = await storage.getUserByStripeCustomerId(customerId);
        if (!user) return;
        
        console.log('[Webhook] Subscription canceled for user:', user.id);
        await storage.updateUser(user.id, { 
          plan: 'free',
          stripeSubscriptionId: null 
        });
        break;
      }
    }
  }
}
