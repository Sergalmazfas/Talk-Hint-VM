import Stripe from 'stripe';

let connectionSettings: any;

async function getCredentials() {
  // First try Replit connector
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? 'repl ' + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? 'depl ' + process.env.WEB_REPL_RENEWAL
        : null;

    if (xReplitToken && hostname) {
      const connectorName = 'stripe';
      const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
      const targetEnvironment = isProduction ? 'production' : 'development';

      const url = new URL(`https://${hostname}/api/v2/connection`);
      url.searchParams.set('include_secrets', 'true');
      url.searchParams.set('connector_names', connectorName);
      url.searchParams.set('environment', targetEnvironment);

      const response = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken
        }
      });

      const data = await response.json();
      
      connectionSettings = data.items?.[0];

      if (connectionSettings?.settings?.publishable && connectionSettings?.settings?.secret) {
        console.log(`[Stripe] Using connector credentials for ${targetEnvironment}`);
        return {
          publishableKey: connectionSettings.settings.publishable,
          secretKey: connectionSettings.settings.secret,
        };
      }
    }
  } catch (err) {
    console.log("[Stripe] Connector error, falling back to env vars:", (err as Error).message);
  }

  // Fallback to environment variables
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  
  if (secretKey && publishableKey) {
    console.log("[Stripe] Using environment variable credentials");
    return { publishableKey, secretKey };
  }
  
  console.log("[Stripe] No credentials available - Stripe features disabled");
  return null;
}

export async function getUncachableStripeClient() {
  const creds = await getCredentials();
  if (!creds) return null;

  return new Stripe(creds.secretKey);
}

export async function getStripePublishableKey() {
  const creds = await getCredentials();
  return creds?.publishableKey || null;
}

export async function getStripeSecretKey() {
  const creds = await getCredentials();
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
