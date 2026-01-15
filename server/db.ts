import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import dns from "dns";

// In production, prefer PROD_DATABASE_URL over DATABASE_URL
// This allows dev (helium) and prod (Neon/external) to use different databases
const isProduction = process.env.NODE_ENV === "production";
const dbUrl = (isProduction && process.env.PROD_DATABASE_URL) 
  ? process.env.PROD_DATABASE_URL 
  : (process.env.DATABASE_URL || "");
export const isDevDatabase = dbUrl.includes("helium") || dbUrl.includes("lithium");

// Note: Reserved VM has access to internal DATABASE_URL (helium/lithium)
// Only Autoscale requires external database (Neon)
// We warn but don't block - Reserved VM deployment should work fine
if (isProduction && isDevDatabase) {
  console.log("[Database] Using internal host (helium) in production");
  console.log("[Database] This works for Reserved VM but NOT for Autoscale");
  console.log("[Database] For Autoscale: set PROD_DATABASE_URL to external DB (e.g., Neon)");
}

// SQL to create all tables if they don't exist
const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password TEXT,
  language TEXT NOT NULL DEFAULT 'ru',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',
  auth_provider TEXT DEFAULT 'email',
  twilio_subaccount_sid TEXT,
  twilio_subaccount_token TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS phone_numbers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  twilio_number TEXT NOT NULL UNIQUE,
  twilio_number_sid TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'personal',
  active_prompt_id VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_prompts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  phone_number_id VARCHAR REFERENCES phone_numbers(id),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  content_ru TEXT NOT NULL,
  content_en TEXT NOT NULL,
  content_es TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id),
  phone_number_id VARCHAR REFERENCES phone_numbers(id),
  call_sid TEXT NOT NULL UNIQUE,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP,
  transcript TEXT,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS available_numbers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_number TEXT NOT NULL UNIQUE,
  twilio_sid TEXT NOT NULL,
  subaccount_sid TEXT,
  subaccount_token TEXT,
  subaccount_name TEXT,
  is_assigned BOOLEAN NOT NULL DEFAULT false,
  country TEXT NOT NULL DEFAULT 'US'
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire);
`;

let pool: Pool | null = null;
let dbAvailable = false;

async function checkHostAvailable(hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    dns.lookup(hostname, (err) => {
      resolve(!err);
    });
  });
}

async function initializeDatabase() {
  console.log('[Database] Starting initialization...');
  console.log('[Database] DATABASE_URL present:', !!dbUrl);
  console.log('[Database] NODE_ENV:', process.env.NODE_ENV);
  console.log('[Database] Is dev database:', isDevDatabase);
  
  // Log hostname for debugging
  try {
    const url = new URL(dbUrl);
    console.log('[Database] Host:', url.hostname);
    console.log('[Database] Port:', url.port || '5432');
  } catch (e) {
    console.log('[Database] Could not parse URL');
  }
  
  if (!dbUrl) {
    console.log('[Database] No DATABASE_URL, running without database');
    return;
  }

  if (isDevDatabase) {
    const hostAvailable = await checkHostAvailable("helium");
    if (!hostAvailable) {
      console.log('[Database] Helium host not reachable, running without database');
      return;
    }
  }

  // Production Neon databases require SSL
  const poolConfig: any = {
    connectionString: dbUrl,
    connectionTimeoutMillis: isDevDatabase ? 5000 : 30000,
  };
  
  // Add SSL for production (Neon requires it)
  if (!isDevDatabase) {
    poolConfig.ssl = { rejectUnauthorized: false };
    console.log('[Database] SSL enabled for production');
  }

  pool = new Pool(poolConfig);
  
  pool.on('error', (err) => {
    console.error('[Database] Pool error:', err.message);
  });

  try {
    const client = await pool.connect();
    client.release();
    dbAvailable = true;
    console.log('[Database] Connection successful');
    
    // Create tables if they don't exist (important for production!)
    try {
      await pool.query(CREATE_TABLES_SQL);
      console.log('[Database] Schema ensured');
    } catch (schemaError: any) {
      console.error('[Database] Schema creation error:', schemaError.message);
    }
  } catch (error: any) {
    console.error('[Database] Connection failed:', error.message);
    pool = null;
  }
}

export const dbReady = initializeDatabase().catch(console.error);

export { pool };

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(target, prop) {
    if (!pool) {
      throw new Error('Database not available');
    }
    const realDb = drizzle(pool, { schema });
    return (realDb as any)[prop];
  }
});

export function isDatabaseAvailable(): boolean {
  return dbAvailable && pool !== null;
}

export async function testDatabaseConnection(): Promise<boolean> {
  return dbAvailable;
}
