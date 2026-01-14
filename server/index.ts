import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { storage } from "./storage";

const app = express();
app.set('trust proxy', true);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function loadSeedConfig() {
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(process.cwd(), 'seed-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.log("[Seed] No seed-config.json found, skipping seed");
  }
  return null;
}

async function seedAvailableNumbers() {
  console.log("[Seed] Starting seed check...");
  console.log("[Seed] NODE_ENV:", process.env.NODE_ENV);
  console.log("[Seed] DATABASE_URL prefix:", process.env.DATABASE_URL?.substring(0, 50) + "...");
  
  try {
    const existing = await storage.getAllAvailableNumbers();
    console.log("[Seed] Found", existing.length, "existing numbers in database");
    
    if (existing.length > 0) {
      console.log("[Seed] Phone numbers pool already has", existing.length, "total");
      return;
    }

    const config = loadSeedConfig();
    if (!config || !config.numbers) {
      console.log("[Seed] WARNING: No seed-config.json found. Copy seed-config.template.json to seed-config.json and fill in your Twilio data.");
      return;
    }

    console.log("[Seed] Empty database detected, seeding phone numbers...");
    
    const numbersToSeed = config.numbers.map((num: any) => ({
      id: num.id,
      twilioNumber: num.twilioNumber,
      twilioSid: num.twilioSid,
      country: num.country,
      subaccountSid: num.subaccountSid,
      subaccountToken: process.env[num.tokenEnvVar] || '',
      subaccountName: num.subaccountName,
    }));

    for (const num of numbersToSeed) {
      console.log("[Seed] Inserting number:", num.twilioNumber);
      await storage.seedAvailableNumber(num);
    }
    
    console.log("[Seed] All numbers inserted, now assigning user number...");
    
    await seedUserAssignedNumber();
    
    console.log("[Seed] Successfully seeded", numbersToSeed.length, "phone numbers");
  } catch (error: any) {
    console.error("[Seed] Error:", error.message);
    console.error("[Seed] Stack:", error.stack);
  }
}

async function seedUserAssignedNumber() {
  try {
    const config = loadSeedConfig();
    if (!config || !config.defaultUser) {
      console.log("[Seed] No default user in config, skipping");
      return;
    }
    
    const { pool } = await import("./db");
    if (!pool) return;
    
    const user = config.defaultUser;
    
    await pool.query(`
      INSERT INTO users (id, email, language, plan, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [user.id, user.email, user.language, user.plan]);
    
    const userNumbers = await storage.getUserPhoneNumbers(user.id);
    if (userNumbers.length > 0) {
      console.log("[Seed] User already has", userNumbers.length, "numbers");
      return;
    }
    
    await pool.query(`UPDATE available_numbers SET is_assigned = true WHERE twilio_number = $1`, [user.assignedNumber]);
    await pool.query(`
      INSERT INTO phone_numbers (id, user_id, twilio_number, name, type, created_at)
      VALUES ($1, $2, $3, $4, 'work', NOW())
      ON CONFLICT (id) DO NOTHING
    `, [user.phoneNumberId, user.id, user.assignedNumber, user.phoneNumberName]);
    console.log("[Seed] Assigned number to user", user.id);
  } catch (error: any) {
    console.error("[Seed] Error assigning number:", error.message);
  }
}

async function initStripe() {
  // In production, prefer PROD_DATABASE_URL over DATABASE_URL
  const isProduction = process.env.NODE_ENV === "production";
  const databaseUrl = (isProduction && process.env.PROD_DATABASE_URL)
    ? process.env.PROD_DATABASE_URL
    : process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[Stripe] DATABASE_URL not set, skipping Stripe init");
    return;
  }

  try {
    console.log("[Stripe] Initializing schema...");
    await runMigrations({ databaseUrl });
    console.log("[Stripe] Schema ready");

    const stripeSync = await getStripeSync();

    const replitDomains = process.env.REPLIT_DOMAINS;
    if (replitDomains) {
      console.log("[Stripe] Setting up managed webhook...");
      const webhookBaseUrl = `https://${replitDomains.split(",")[0]}`;
      await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);
      console.log("[Stripe] Webhook configured");
    } else {
      console.log("[Stripe] REPLIT_DOMAINS not set, skipping webhook setup (local dev)");
    }

    stripeSync.syncBackfill()
      .then(() => console.log("[Stripe] Data synced"))
      .catch((err: any) => console.error("[Stripe] Sync error:", err));
  } catch (error) {
    console.error("[Stripe] Init error:", error);
  }
}

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("[Stripe] Webhook error:", error.message);
      res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Log ALL incoming requests for debugging
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  
  // Log every request immediately for debugging Twilio webhooks
  if (reqPath.includes("twilio") || reqPath.includes("media")) {
    log(`>>> INCOMING: ${req.method} ${reqPath} from ${req.ip}`, "request");
    log(`>>> Headers: ${JSON.stringify(req.headers)}`, "request");
  }
  
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    // Log all non-static requests
    if (reqPath.startsWith("/api") || reqPath.includes("twilio") || reqPath.includes("media")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Try to connect to database, but don't block server startup
  let dbConnected = false;
  try {
    const { dbReady } = await import("./db");
    await dbReady;
    dbConnected = true;
    console.log("[Server] Database connected successfully");
  } catch (error: any) {
    console.error("[Server] Database connection failed:", error.message);
    console.log("[Server] Continuing with limited functionality...");
  }
  
  if (dbConnected) {
    try {
      await initStripe();
    } catch (e: any) {
      console.error("[Server] Stripe init failed:", e.message);
    }
    
    // Only run seed in development mode OR when explicitly requested via RUN_SEED=true
    // NEVER run seed automatically in production - it causes deployment failures
    const shouldSeed = process.env.NODE_ENV === 'development' || process.env.RUN_SEED === 'true';
    if (shouldSeed) {
      try {
        await seedAvailableNumbers();
      } catch (e: any) {
        console.error("[Server] Seed failed:", e.message);
        // Don't throw - seed failure should not crash the server
      }
    } else {
      console.log("[Seed] Skipping seed in production (use RUN_SEED=true to force)");
    }
  }
  
  // Setup Replit Auth (Google, GitHub, etc.) BEFORE other routes
  try {
    await setupAuth(app);
    registerAuthRoutes(app);
  } catch (e: any) {
    console.error("[Server] Auth setup failed:", e.message);
  }
  
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
