/**
 * Script to configure Twilio voice webhooks for all numbers in the pool
 *
 * Usage:
 *   npx tsx scripts/configure-twilio-webhooks.ts
 *   npx tsx scripts/configure-twilio-webhooks.ts --production
 *
 * This script updates the voiceUrl/statusCallback for every phone number in the
 * pool to point at the correct webhook endpoint.
 *
 * Webhook target URL (where Twilio sends calls) is decoupled from the database
 * the number pool is read from:
 *   - With --production, webhooks point at PRODUCTION_URL (the live deployed app).
 *   - Without it, webhooks point at the current dev domain (REPLIT_DEV_DOMAIN).
 *
 * The number pool is ALWAYS read from the active database connection:
 *   - PROD_DATABASE_URL if it is set (external DB setups, e.g. Neon on Autoscale).
 *   - Otherwise DATABASE_URL (Reserved VM on Replit-managed PostgreSQL, where the
 *     production pool lives in the managed prod DB and PROD_DATABASE_URL is unset).
 *
 * NOTE: Repointing now happens AUTOMATICALLY on production server startup (see
 * repointWebhooksOnStartup in server/index.ts), so every Publish re-claims the
 * pool's inbound webhooks for the live build without any manual step. This
 * script remains as a manual fallback (e.g. to repoint at a custom domain, or
 * when running from outside the deployed VM).
 *
 * To repoint all numbers manually (Reserved VM + managed PG):
 *   PRODUCTION_URL=https://your-app.replit.app npx tsx scripts/configure-twilio-webhooks.ts --production
 *   (run from the deployed environment, or with the prod DATABASE_URL exported)
 */

import { Pool } from 'pg';
import twilio from 'twilio';

// The production URL becomes known only after the first Publish. It must be
// supplied explicitly via PRODUCTION_URL (e.g. the generated *.replit.app domain
// or a verified custom domain) so we never silently point numbers at the wrong
// place. In dev we fall back to the current Replit dev domain.
const DEV_URL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'https://talkhint.app';

async function configureWebhooks() {
  const isProduction = process.argv.includes('--production');

  // Fail loudly in production when the live URL is unknown. Silently falling
  // back to a hardcoded domain would point every number at the wrong place and
  // break inbound calls with no obvious error.
  if (isProduction && !process.env.PRODUCTION_URL) {
    console.error(
      'Error: --production was used but PRODUCTION_URL is not set.\n' +
        'Set PRODUCTION_URL to the live deployed app URL so webhooks point at the right place.\n' +
        'Example:\n' +
        '  PRODUCTION_URL=https://your-app.replit.app npx tsx scripts/configure-twilio-webhooks.ts --production'
    );
    process.exit(1);
  }

  // Webhook target URL is independent of which DB we read the pool from.
  const baseUrl = isProduction ? process.env.PRODUCTION_URL! : DEV_URL;
  const webhookUrl = `${baseUrl}/twilio/voice`;
  const statusUrl = `${baseUrl}/twilio/status`;

  // Read the number pool from the active database. Prefer PROD_DATABASE_URL when
  // it is explicitly set (external DB), otherwise use DATABASE_URL (Reserved VM
  // on Replit-managed PostgreSQL, where PROD_DATABASE_URL is not set).
  const dbUrl = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;

  // Internal Replit-managed hosts (helium/lithium) do not use external SSL;
  // external databases (e.g. Neon) require it.
  const isInternalDb = !!dbUrl && (dbUrl.includes('helium') || dbUrl.includes('lithium'));
  const dbSource = process.env.PROD_DATABASE_URL ? 'PROD_DATABASE_URL' : 'DATABASE_URL';

  console.log(`\n=== Twilio Webhook Configuration ===`);
  console.log(`Mode: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`Webhook URL: ${webhookUrl}`);
  console.log(`Status URL: ${statusUrl}`);
  console.log(`DB source: ${dbSource}${isInternalDb ? ' (internal)' : ' (external)'}\n`);

  if (!dbUrl) {
    console.error('Error: Database URL not found (set DATABASE_URL or PROD_DATABASE_URL)');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isInternalDb ? undefined : { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query(`
      SELECT 
        twilio_number, 
        twilio_sid, 
        subaccount_sid, 
        subaccount_token,
        subaccount_name,
        is_assigned
      FROM available_numbers
    `);

    console.log(`Found ${result.rows.length} numbers in pool\n`);

    let configured = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of result.rows) {
      const { twilio_number, twilio_sid, subaccount_sid, subaccount_token, subaccount_name } = row;
      
      try {
        let client;
        if (subaccount_sid && subaccount_token) {
          client = twilio(subaccount_sid, subaccount_token);
        } else {
          client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        }

        await client.incomingPhoneNumbers(twilio_sid).update({
          voiceUrl: webhookUrl,
          voiceMethod: 'POST',
          statusCallback: statusUrl,
          statusCallbackMethod: 'POST',
        });

        console.log(`✓ ${twilio_number} (${subaccount_name || 'master'}) - configured`);
        configured++;
      } catch (err: any) {
        console.log(`✗ ${twilio_number} - FAILED: ${err.message}`);
        failed++;
        errors.push(`${twilio_number}: ${err.message}`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Configured: ${configured}`);
    console.log(`Failed: ${failed}`);
    
    if (errors.length > 0) {
      console.log(`\nErrors:`);
      errors.forEach(e => console.log(`  - ${e}`));
    }

  } catch (error: any) {
    console.error('Database error:', error.message);
  } finally {
    await pool.end();
  }
}

configureWebhooks();
