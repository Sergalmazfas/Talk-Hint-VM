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
