import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
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

function initStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log("[Stripe] STRIPE_SECRET_KEY not set - Stripe disabled");
    return;
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.log("[Stripe] STRIPE_WEBHOOK_SECRET not set - webhook signature verification will fail");
  }
  console.log("[Stripe] Manual mode (no Replit connector). Configure webhook in Stripe Dashboard.");
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
    limit: '10mb', // Increased for audio data in training STT
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    console.warn(`[Server] JSON Parse Error on ${req.method} ${req.path} - client may have disconnected`);
    return res.status(400).json({ error: "Invalid JSON" });
  }
  next(err);
});

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
    initStripe();
    
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

  // Graceful shutdown handlers - log when process is being terminated
  // This helps debug unexpected restarts (Replit autoscale, VM restarts, etc.)
  const gracefulShutdown = (signal: string) => {
    console.log(`\n[Server] Received ${signal} at ${new Date().toISOString()}`);
    console.log("[Server] Starting graceful shutdown...");
    
    // Close HTTP server (stop accepting new connections)
    httpServer.close((err) => {
      if (err) {
        console.error("[Server] Error closing HTTP server:", err.message);
      } else {
        console.log("[Server] HTTP server closed successfully");
      }
      
      // Exit after cleanup
      console.log("[Server] Exiting process...");
      process.exit(err ? 1 : 0);
    });
    
    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
      console.error("[Server] Forced exit after 10s timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  
  // Log uncaught errors that might cause restarts
  process.on("uncaughtException", (err) => {
    console.error("[Server] UNCAUGHT EXCEPTION at", new Date().toISOString());
    console.error("[Server] Error:", err.message);
    console.error("[Server] Stack:", err.stack);
    process.exit(1);
  });
  
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[Server] UNHANDLED REJECTION at", new Date().toISOString());
    console.error("[Server] Reason:", reason);
  });
})();
