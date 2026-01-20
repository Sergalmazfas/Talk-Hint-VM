import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

// SIMPLIFIED: All subscriptions = Basic plan
// Product map kept for backwards compatibility but all map to 'basic'
const PRODUCT_PLAN_MAP: Record<string, string> = {
  'prod_Tgad5uBrVNcJVS': 'basic',   // Old Personal Plan
  'prod_TgadUzTlkj4eT9': 'basic',   // Old Pro Plan
  'prod_Tp6Udj1pR1DWmW': 'basic',   // TalkHint Basic $15/month
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
    if (!stripe) {
      console.error('[Webhook] Stripe client not available');
      return;
    }
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
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer as string;
        const userId = session.metadata?.userId;
        
        console.log('[Webhook] Checkout completed - customerId:', customerId, 'userId:', userId);
        
        if (userId && customerId) {
          // Link Stripe customer to user
          await storage.updateUser(userId, { stripeCustomerId: customerId });
          console.log('[Webhook] Linked customer', customerId, 'to user', userId);
        }
        break;
      }
      
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
        
        // SIMPLIFIED: Only active subscription (not trialing) = Basic plan
        let newPlan = 'free';
        let shouldAssignNumber = false;
        
        if (status === 'active') {
          newPlan = 'basic';
          shouldAssignNumber = true;  // Only assign number after actual payment
        } else if (status === 'trialing') {
          newPlan = 'basic';  // Allow training, but no number yet
          shouldAssignNumber = false;
        }
        
        console.log('[Webhook] Updating user', user.id, 'plan to:', newPlan, 'assignNumber:', shouldAssignNumber);
        await storage.updateUser(user.id, { 
          plan: newPlan,
          stripeSubscriptionId: subscription.id 
        });
        
        // Task 4: Create phone number ONLY after successful payment (not during trial)
        if (shouldAssignNumber) {
          await this.ensureUserHasPhoneNumber(user.id);
        }
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
  
  // Task 4: Assign phone number after successful subscription
  static async ensureUserHasPhoneNumber(userId: string): Promise<void> {
    try {
      // Check if user already has a number
      const existingNumbers = await storage.getUserPhoneNumbers(userId);
      if (existingNumbers.length > 0) {
        console.log('[Webhook] User', userId, 'already has phone number');
        return;
      }
      
      // Find an available number from the pool
      const availableNumbers = await storage.getAvailableNumbers();
      if (availableNumbers.length === 0) {
        console.error('[Webhook] No available phone numbers in pool!');
        return;
      }
      
      // Assign the first available number
      const number = availableNumbers[0];
      const user = await storage.getUser(userId);
      const userName = user?.email?.split('@')[0] || 'My Number';
      
      await storage.assignNumber(number.id, userId, userName, 'personal');
      console.log('[Webhook] Assigned phone number', number.twilioNumber, 'to user', userId);
    } catch (error: any) {
      console.error('[Webhook] Error assigning phone number:', error.message);
    }
  }
}
