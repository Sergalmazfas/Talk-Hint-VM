import { Pool } from "pg";

const PROD_DATABASE_URL = process.env.PROD_DATABASE_URL;
const DEV_DATABASE_URL = process.env.DATABASE_URL;

if (!PROD_DATABASE_URL) {
  console.error("PROD_DATABASE_URL is not set!");
  process.exit(1);
}

if (!DEV_DATABASE_URL) {
  console.error("DATABASE_URL (dev) is not set!");
  process.exit(1);
}

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

async function seedProduction() {
  console.log("[Seed] Connecting to development database...");
  
  const devPool = new Pool({
    connectionString: DEV_DATABASE_URL,
  });

  console.log("[Seed] Connecting to production database...");
  
  const prodPool = new Pool({
    connectionString: PROD_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const devClient = await devPool.connect();
    console.log("[Seed] Dev database connected!");
    devClient.release();

    const prodClient = await prodPool.connect();
    console.log("[Seed] Prod database connected!");
    prodClient.release();

    console.log("[Seed] Creating tables in production...");
    await prodPool.query(CREATE_TABLES_SQL);
    console.log("[Seed] Tables created!");

    console.log("[Seed] Fetching users from dev...");
    const usersResult = await devPool.query(`SELECT id, email, language, plan, auth_provider FROM users WHERE auth_provider = 'replit'`);
    console.log(`[Seed] Found ${usersResult.rows.length} users to sync`);

    for (const user of usersResult.rows) {
      try {
        await prodPool.query(`
          INSERT INTO users (id, email, language, plan, auth_provider)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            language = EXCLUDED.language,
            plan = EXCLUDED.plan,
            auth_provider = EXCLUDED.auth_provider
        `, [user.id, user.email, user.language, user.plan, user.auth_provider]);
        console.log(`[Seed] Synced user: ${user.email}`);
      } catch (err: any) {
        console.error(`[Seed] Error with user ${user.email}:`, err.message);
      }
    }

    console.log("[Seed] Fetching phone numbers from dev...");
    const phonesResult = await devPool.query(`SELECT id, user_id, twilio_number, name, type FROM phone_numbers`);
    console.log(`[Seed] Found ${phonesResult.rows.length} phone numbers to sync`);

    for (const phone of phonesResult.rows) {
      try {
        await prodPool.query(`
          INSERT INTO phone_numbers (id, user_id, twilio_number, name, type)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (twilio_number) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            name = EXCLUDED.name,
            type = EXCLUDED.type
        `, [phone.id, phone.user_id, phone.twilio_number, phone.name, phone.type]);
        console.log(`[Seed] Synced phone: ${phone.twilio_number}`);
      } catch (err: any) {
        console.error(`[Seed] Error with phone ${phone.twilio_number}:`, err.message);
      }
    }

    console.log("[Seed] Fetching user prompts from dev...");
    const promptsResult = await devPool.query(`SELECT id, user_id, phone_number_id, name, content, is_active FROM user_prompts`);
    console.log(`[Seed] Found ${promptsResult.rows.length} prompts to sync`);

    for (const prompt of promptsResult.rows) {
      try {
        await prodPool.query(`
          INSERT INTO user_prompts (id, user_id, phone_number_id, name, content, is_active)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            content = EXCLUDED.content,
            is_active = EXCLUDED.is_active
        `, [prompt.id, prompt.user_id, prompt.phone_number_id, prompt.name, prompt.content, prompt.is_active]);
        console.log(`[Seed] Synced prompt: ${prompt.name}`);
      } catch (err: any) {
        console.error(`[Seed] Error with prompt ${prompt.name}:`, err.message);
      }
    }

    console.log("[Seed] Fetching available numbers from dev...");
    const numbersResult = await devPool.query(`SELECT * FROM available_numbers`);
    console.log(`[Seed] Found ${numbersResult.rows.length} available numbers to sync`);

    for (const num of numbersResult.rows) {
      try {
        await prodPool.query(`
          INSERT INTO available_numbers (id, twilio_number, twilio_sid, is_assigned, country, subaccount_sid, subaccount_token, subaccount_name)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (twilio_number) DO UPDATE SET
            twilio_sid = EXCLUDED.twilio_sid,
            is_assigned = EXCLUDED.is_assigned,
            subaccount_sid = EXCLUDED.subaccount_sid,
            subaccount_token = EXCLUDED.subaccount_token,
            subaccount_name = EXCLUDED.subaccount_name
        `, [num.id, num.twilio_number, num.twilio_sid, num.is_assigned, num.country, num.subaccount_sid, num.subaccount_token, num.subaccount_name]);
        console.log(`[Seed] Synced number: ${num.twilio_number}`);
      } catch (err: any) {
        console.error(`[Seed] Error with number ${num.twilio_number}:`, err.message);
      }
    }

    const result = await prodPool.query('SELECT COUNT(*) FROM available_numbers');
    console.log(`[Seed] Total numbers in production: ${result.rows[0].count}`);

    console.log("[Seed] Production database synced successfully!");
  } catch (error: any) {
    console.error("[Seed] Error:", error.message);
    process.exit(1);
  } finally {
    await devPool.end();
    await prodPool.end();
  }
}

seedProduction();
