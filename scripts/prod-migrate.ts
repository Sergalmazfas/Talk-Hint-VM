import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

async function runProductionMigration() {
  const prodUrl = process.env.PROD_DATABASE_URL;
  
  if (!prodUrl) {
    console.error('PROD_DATABASE_URL not set');
    process.exit(1);
  }
  
  console.log('[Migration] Connecting to production database...');
  
  const client = new Client({ connectionString: prodUrl });
  await client.connect();
  
  try {
    // Add forwarding_phone column if it doesn't exist
    console.log('[Migration] Adding forwarding_phone column...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS forwarding_phone TEXT
    `);
    
    // Add call_mode column if it doesn't exist
    console.log('[Migration] Adding call_mode column...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS call_mode TEXT NOT NULL DEFAULT 'forwarding'
    `);
    
    console.log('[Migration] ✓ Migration completed successfully!');
    
    // Verify columns exist
    const result = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name IN ('forwarding_phone', 'call_mode')
    `);
    console.log('[Migration] Verified columns:', result.rows.map(r => r.column_name).join(', '));
    
  } catch (error: any) {
    console.error('[Migration] Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runProductionMigration();
