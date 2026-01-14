/**
 * Script to configure Twilio voice webhooks for all numbers in the pool
 * 
 * Usage: 
 *   npx tsx scripts/configure-twilio-webhooks.ts
 *   npx tsx scripts/configure-twilio-webhooks.ts --production
 * 
 * This script updates the voiceUrl for all phone numbers to point to the correct webhook endpoint
 */

import { Pool } from 'pg';
import twilio from 'twilio';

const PRODUCTION_URL = 'https://talkhint.app';
const DEV_URL = process.env.REPLIT_DEV_DOMAIN 
  ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
  : 'https://talkhint.app';

async function configureWebhooks() {
  const isProduction = process.argv.includes('--production');
  const baseUrl = isProduction ? PRODUCTION_URL : DEV_URL;
  const webhookUrl = `${baseUrl}/twilio/voice`;
  const statusUrl = `${baseUrl}/twilio/status`;
  
  console.log(`\n=== Twilio Webhook Configuration ===`);
  console.log(`Mode: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`Webhook URL: ${webhookUrl}`);
  console.log(`Status URL: ${statusUrl}\n`);

  const dbUrl = isProduction 
    ? process.env.PROD_DATABASE_URL 
    : process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('Error: Database URL not found');
    process.exit(1);
  }

  const pool = new Pool({ 
    connectionString: dbUrl,
    ssl: isProduction ? { rejectUnauthorized: false } : undefined
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
