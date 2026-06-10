import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, getContactMemoryHealth, getWriteHealth, checkSchemaDrift } from "./storage";
import { setupWebSocket, TALKHINT_GOLDEN_PROMPT, PREP_PROMPT, LANGUAGE_NAMES, setCallOwner, clearCallOwner, getHintFallbackStats } from "./websocket";
import { getAlertChannelStatus, getWriteHealthAlertState } from "./writeHealthAlerter";
import { HEALTH_STATUS_PAGE_HTML, HEALTH_TOKEN_PROMPT_HTML } from "./healthStatusPage";
import { LIVE_ANTI_LOOP_RULES } from "@shared/prompts";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import fs from "fs";
import twilio from "twilio";
import crypto from "crypto";
import { registerUser, loginUser, createSession, authMiddleware, deleteSession, getSessionUserId } from "./auth";
import { stripeService } from "./stripeService";
import { getStripePublishableKey } from "./stripeClient";
import { searchAvailableNumbers, purchasePhoneNumber, configureVoiceWebhook, configureAllPoolWebhooks, configureWebhookByPhone } from "./twilioService";
import { saveSubscription, sendIncomingCallPush, getVapidPublicKey } from "./pushService";
import { startTrainingSession, processTrainingTurn, resetTrainingSession, generateTTS } from "./training";
import { deriveOtherPartyPhone } from "./contactMemory";
import { pendingCalls, users, phoneNumbers, deviceTokens } from "@shared/schema";
import { validateUserWebhookUrl } from "./airatomaWebhook";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID;
const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
const TWILIO_API_SECRET = process.env.TWILIO_API_SECRET;
// Security: the /twilio/voice conference-join trust boundary relies on Twilio
// setting From=client:user-{id} on the signed request. That trust collapses if
// signature verification is off, so we NEVER honor the disable flag in production
// — it can only relax the check in non-production (local dev) environments.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SIGNATURE_CHECK_DISABLE_REQUESTED = process.env.DISABLE_TWILIO_SIGNATURE_CHECK === "true";
const DISABLE_TWILIO_SIGNATURE_CHECK = SIGNATURE_CHECK_DISABLE_REQUESTED && !IS_PRODUCTION;
if (SIGNATURE_CHECK_DISABLE_REQUESTED && IS_PRODUCTION) {
  console.warn(
    "[Twilio Sig] DISABLE_TWILIO_SIGNATURE_CHECK is set but IGNORED in production — " +
    "signature verification stays ENABLED to protect the conference-join trust boundary."
  );
}

// Call timeout in seconds - prevents early disconnect during silence/pauses
const CALL_TIMEOUT = parseInt(process.env.TALKHINT_CALL_TIMEOUT || "90", 10);
// Maximum call duration in seconds - safety limit to prevent runaway charges
// Default: 10 minutes (600 seconds) - can be overridden with env var
const CALL_TIME_LIMIT = parseInt(process.env.TALKHINT_CALL_TIME_LIMIT || "600", 10);

// Log Twilio config at startup for debugging
console.log("[Twilio Config] Startup diagnostics:");
console.log("  ACCOUNT_SID:", TWILIO_ACCOUNT_SID ? TWILIO_ACCOUNT_SID.substring(0, 10) + "..." : "NOT SET");
console.log("  AUTH_TOKEN:", TWILIO_AUTH_TOKEN ? "SET (hidden)" : "NOT SET");
console.log("  API_KEY:", TWILIO_API_KEY ? TWILIO_API_KEY.substring(0, 10) + "..." : "NOT SET");
console.log("  API_SECRET:", TWILIO_API_SECRET ? "SET (hidden)" : "NOT SET");
console.log("  TWIML_APP_SID:", TWILIO_TWIML_APP_SID ? TWILIO_TWIML_APP_SID.substring(0, 10) + "..." : "NOT SET");
console.log("  CALLER_ID:", TWILIO_PHONE_NUMBER || "NOT SET");
console.log("  Signature check:", DISABLE_TWILIO_SIGNATURE_CHECK ? "DISABLED" : "ENABLED");
console.log("  CALL_TIMEOUT:", CALL_TIMEOUT + "s");
console.log("  CALL_TIME_LIMIT:", CALL_TIME_LIMIT + "s (max duration)");

// Line token mapping: TH_NUM_X_TOKEN → lineId → phone number
// Maps environment variable tokens to line numbers (1-7)
const LINE_TOKENS: Record<string, number> = {};
for (let i = 1; i <= 7; i++) {
  const token = process.env[`TH_NUM_${i}_TOKEN`];
  if (token) {
    LINE_TOKENS[token] = i;
  }
}

// Line sessions: lineId → session token (simple in-memory for now)
const lineSessions: Map<string, { lineId: number; expiresAt: number }> = new Map();

// Validate Twilio signature middleware
function validateTwilioSignature(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (DISABLE_TWILIO_SIGNATURE_CHECK) {
    console.log("[Twilio Sig] Signature check DISABLED");
    return next();
  }
  
  if (!TWILIO_AUTH_TOKEN) {
    console.error("[Twilio Sig] No AUTH_TOKEN configured!");
    return res.status(500).send("Server misconfigured");
  }
  
  const signature = req.headers["x-twilio-signature"] as string;
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  
  const isValid = twilio.validateRequest(
    TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body
  );
  
  if (!isValid) {
    console.error("[Twilio Sig] INVALID signature for:", url);
    return res.status(403).send("Forbidden");
  }
  
  console.log("[Twilio Sig] Valid signature for:", url);
  next();
}

// ---------------------------------------------------------------------------
// Save-health status access gate.
//
// /health (the human page) and /api/health (its JSON data source) expose
// operational internals — table names, save-failure counts, schema-drift
// errors. They contain no secrets or user data, but they should not be public
// in production. The gate is *secure by default in production*: access is
// DENIED unless the requester proves they belong, via either
//   (1) a valid shared on-call token (HEALTH_STATUS_TOKEN), supplied as
//       ?token=, an x-health-token header, or a Bearer header (constant-time
//       compared), or
//   (2) a valid authenticated app session (the same Bearer session token the
//       /app UI uses).
// Outside production the page stays fully open so local/dev is frictionless.
// Env is read live (not at module load) so it can be toggled per request/test.
// ---------------------------------------------------------------------------
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function healthAccessAllowed(req: express.Request): Promise<boolean> {
  // Frictionless outside production.
  if (process.env.NODE_ENV !== "production") return true;

  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : "";

  // (1) Shared on-call token.
  const expected = process.env.HEALTH_STATUS_TOKEN;
  if (expected) {
    const provided =
      (typeof req.query.token === "string" ? req.query.token : "") ||
      (typeof req.headers["x-health-token"] === "string" ? (req.headers["x-health-token"] as string) : "") ||
      bearer;
    if (provided && timingSafeEqualStr(provided, expected)) return true;
  }

  // (2) Authenticated app session (same Bearer session token the /app UI uses).
  if (bearer) {
    try {
      const userId = await getSessionUserId(bearer);
      if (userId) return true;
    } catch {
      // Treat a session-lookup failure as no access; never throw from the gate.
    }
  }

  // Secure by default: deny in production when neither check passes.
  return false;
}

// Handle both ESM (development) and CommonJS (production bundle)
let __dirnameResolved: string;
try {
  __dirnameResolved = path.dirname(fileURLToPath(import.meta.url));
} catch {
  // Fallback for CommonJS production build
  __dirnameResolved = process.cwd();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupWebSocket(httpServer);

  // TalkHint UI - serve from dist/talkhint/ui (where bundled SDK is)
  // In production, use cwd-relative path; in dev, use __dirname-relative
  const talkhintUiPath = process.env.NODE_ENV === "production"
    ? path.join(process.cwd(), "dist/talkhint/ui")
    : path.join(__dirnameResolved, "../dist/talkhint/ui");
  console.log("[TalkHint] Serving UI from:", talkhintUiPath);
  app.use("/app", express.static(talkhintUiPath));

  app.get("/api/expo-url", (_req, res) => {
    let url = "";
    try { url = fs.readFileSync("/tmp/expo-tunnel-url.txt", "utf8").trim(); } catch (_) {}
    res.json({ url: url || null });
  });

  app.get("/expo", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Open TalkHint in Expo Go</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f14;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:#1a1a24;border:1px solid #2a2a3a;border-radius:20px;padding:36px 28px;max-width:360px;width:100%;text-align:center}
  .logo{font-size:48px;margin-bottom:16px}
  h1{font-size:22px;font-weight:700;margin-bottom:8px}
  .sub{color:#8888aa;font-size:14px;margin-bottom:32px;line-height:1.5}
  .btn{display:block;background:#6366f1;color:#fff;text-decoration:none;border-radius:14px;padding:16px 24px;font-size:17px;font-weight:700;margin-bottom:16px;transition:opacity .15s}
  .btn:active{opacity:.8}
  .btn.disabled{background:#333;pointer-events:none}
  .url-box{background:#0f0f18;border:1px solid #2a2a3a;border-radius:10px;padding:12px 14px;font-size:11px;color:#6666aa;word-break:break-all;font-family:monospace;text-align:left;margin-bottom:20px;min-height:36px}
  .hint{font-size:12px;color:#55556a;line-height:1.6}
  .step{display:flex;align-items:flex-start;gap:10px;text-align:left;margin-bottom:10px}
  .step-num{background:#6366f1;color:#fff;font-size:11px;font-weight:700;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
  .status{font-size:11px;color:#55aaa0;margin-bottom:8px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">📱</div>
  <h1>Open in Expo Go</h1>
  <p class="sub">TalkHint mobile app — tap button on iPhone</p>
  <div class="status" id="status">Loading tunnel URL...</div>
  <a class="btn disabled" id="btn" href="#">Open TalkHint in Expo Go</a>
  <div class="url-box" id="urlbox">Waiting for tunnel...</div>
  <div class="hint">
    <div class="step"><div class="step-num">1</div><span>Expo Go — App Store</span></div>
    <div class="step"><div class="step-num">2</div><span>Нажмите кнопку выше или введите URL вручную в Expo Go</span></div>
    <div class="step"><div class="step-num">3</div><span>Settings → введите URL вашего TalkHint сервера</span></div>
  </div>
</div>
<script>
async function load() {
  try {
    const r = await fetch('/api/expo-url');
    const { url } = await r.json();
    if (url) {
      document.getElementById('btn').href = url;
      document.getElementById('btn').classList.remove('disabled');
      document.getElementById('urlbox').textContent = url;
      document.getElementById('status').textContent = '✅ Tunnel active';
      document.getElementById('status').style.color = '#55cc88';
    } else {
      document.getElementById('status').textContent = '⏳ Tunnel starting...';
      setTimeout(load, 3000);
    }
  } catch(e) {
    document.getElementById('status').textContent = '⚠️ Could not load URL';
    setTimeout(load, 5000);
  }
}
load();
</script>
</body>
</html>`);
  });

  app.get("/api/calls", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const calls = await storage.getUserCalls(user.id);
      // Attach the saved contact name (when one exists) so call history can show
      // a recognizable caller. Build a phone -> name map from the user's saved
      // contacts once, then look up each call's other-party number, instead of
      // querying per call.
      const memories = await storage.listContactMemories(user.id);
      const nameByPhone = new Map<string, string>();
      for (const m of memories) {
        if (m.name && m.name.trim()) nameByPhone.set(m.phoneNumber, m.name.trim());
      }
      const enriched = calls.map((call) => {
        const phone = deriveOtherPartyPhone(call);
        const contactName = phone ? nameByPhone.get(phone) ?? null : null;
        return { ...call, contactName };
      });
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch calls" });
    }
  });

  app.get("/api/calls/:id", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const call = await storage.getCall(req.params.id);
      // Treat another user's call as not found: never expose it across users.
      if (!call || call.userId !== user.id) {
        return res.status(404).json({ message: "Call not found" });
      }
      const phone = deriveOtherPartyPhone(call);
      const mem = phone ? await storage.getContactMemory(user.id, phone) : undefined;
      const contactName = mem?.name && mem.name.trim() ? mem.name.trim() : null;
      res.json({ ...call, contactName });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch call" });
    }
  });

  app.get("/api/health", async (req, res) => {
    if (!(await healthAccessAllowed(req))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const schemaDrift = await checkSchemaDrift();
    const contactMemoryDrift = schemaDrift.tables.find((t) => t.table === "contact_memory");
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      websocket: "ready",
      hintFallback: getHintFallbackStats(),
      contactMemory: {
        writes: getContactMemoryHealth(),
        drift: {
          checked: schemaDrift.checked,
          ok: contactMemoryDrift?.ok ?? true,
          table: "contact_memory",
          missingColumns: contactMemoryDrift?.missingColumns ?? [],
          ...(contactMemoryDrift?.error ? { error: contactMemoryDrift.error } : {}),
        },
      },
      schemaDrift,
      writes: getWriteHealth(),
      alertChannels: getAlertChannelStatus(),
      writeHealthAlerts: getWriteHealthAlertState(),
      airatomaDeliveries: await storage.getAirAtomaDeliveryStats(),
    });
  });

  // Human-readable DB save-health status page for on-call (renders /api/health).
  // In production, an unauthenticated visitor without a valid token gets a
  // token prompt (no internals) instead of the dashboard.
  app.get("/health", async (req, res) => {
    if (!(await healthAccessAllowed(req))) {
      return res.status(401).type("html").send(HEALTH_TOKEN_PROMPT_HTML);
    }
    res.type("html").send(HEALTH_STATUS_PAGE_HTML);
  });

  // Diagnostic endpoint to help debug domain/deployment issues
  app.get("/api/build", async (req, res) => {
    const { isDatabaseAvailable } = await import("./db");
    res.json({
      host: req.hostname,
      env: process.env.NODE_ENV || "unknown",
      dbConnected: isDatabaseAvailable(),
      dbUrlPresent: !!process.env.DATABASE_URL,
      replId: process.env.REPL_ID?.substring(0, 8) || "unknown",
      timestamp: new Date().toISOString(),
      sessionType: "express-session",
      linesConfigured: Object.keys(LINE_TOKENS).length,
    });
  });

  // =============================================
  // LINE-BASED AUTHENTICATION (for contractors)
  // =============================================
  
  // Auth by line token: POST /auth/by-token
  // Input: { "token": "TH_NUM_X_TOKEN_VALUE" }
  // Output: { "ok": true, "lineId": 3, "session": "...", "twilioNumber": "+1..." }
  app.post("/auth/by-token", async (req, res) => {
    const { token } = req.body;
    
    if (!token || typeof token !== "string") {
      return res.status(400).json({ ok: false, error: "Token required" });
    }
    
    const lineId = LINE_TOKENS[token];
    if (!lineId) {
      console.log("[Auth Line] Invalid token attempt");
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
    
    // Find the phone number for this line from available_numbers
    // Lines are named TH-NUM-001, TH-NUM-002, etc
    const lineNum = String(lineId).padStart(3, "0");
    const lineName = `TH-NUM-${lineNum}`;
    
    try {
      const allNumbers = await storage.getAllAvailableNumbers();
      const lineNumber = allNumbers.find(n => n.subaccountName === lineName);
      
      if (!lineNumber) {
        console.log(`[Auth Line] No number found for line ${lineName}`);
        return res.status(404).json({ ok: false, error: "Line not configured" });
      }
      
      // Generate cryptographically secure session token
      const sessionToken = `line_${lineId}_${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      
      lineSessions.set(sessionToken, { lineId, expiresAt });
      
      console.log(`[Auth Line] Authorized line ${lineId} (${lineName}): ${lineNumber.twilioNumber}`);
      
      res.json({
        ok: true,
        lineId,
        lineName,
        twilioNumber: lineNumber.twilioNumber,
        session: sessionToken,
        expiresAt,
      });
    } catch (error: any) {
      console.error("[Auth Line] Error:", error.message);
      res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // Get Twilio Access Token for line-based auth
  // Requires: Authorization: Bearer <session_token>
  app.get("/twilio/access-token", async (req, res) => {
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.replace("Bearer ", "");
    
    if (!sessionToken) {
      return res.status(401).json({ error: "Session token required" });
    }
    
    const session = lineSessions.get(sessionToken);
    if (!session || session.expiresAt < Date.now()) {
      lineSessions.delete(sessionToken);
      return res.status(401).json({ error: "Session expired or invalid" });
    }
    
    if (!TWILIO_ACCOUNT_SID || !process.env.TWILIO_API_KEY || !process.env.TWILIO_API_SECRET) {
      return res.status(500).json({ error: "Twilio credentials not configured" });
    }
    
    const { lineId } = session;
    const identity = `line_${lineId}`;
    
    // Find the phone number for this line
    const lineNum = String(lineId).padStart(3, "0");
    const lineName = `TH-NUM-${lineNum}`;
    const allNumbers = await storage.getAllAvailableNumbers();
    const lineNumber = allNumbers.find(n => n.subaccountName === lineName);
    
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity }
    );

    token.addGrant(voiceGrant);

    console.log(`[Token] Generated access token for line: ${lineId}, identity: ${identity}`);
    res.json({
      token: token.toJwt(),
      identity,
      lineId,
      twilioNumber: lineNumber?.twilioNumber,
    });
  });

  // Admin endpoint: Configure webhooks for all numbers in the pool
  app.post("/api/admin/configure-webhooks", async (req, res) => {
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const allNumbers = await storage.getAllAvailableNumbers();
      const baseUrl = req.body.baseUrl || `https://${req.hostname}`;
      
      const result = await configureAllPoolWebhooks(
        allNumbers.map(n => ({
          twilioSid: n.twilioSid,
          subaccountSid: n.subaccountSid || undefined,
          subaccountToken: n.subaccountToken || undefined,
          twilioNumber: n.twilioNumber,
        })),
        baseUrl
      );
      
      res.json({
        message: "Webhook configuration complete",
        baseUrl,
        ...result,
      });
    } catch (error: any) {
      console.error("[Admin] Configure webhooks error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Configure webhook for a single number
  app.post("/api/admin/configure-webhook/:numberSid", async (req, res) => {
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { numberSid } = req.params;
      const { subaccountSid, subaccountToken } = req.body;
      const baseUrl = req.body.baseUrl || `https://${req.hostname}`;
      const webhookUrl = `${baseUrl}/twilio/voice`;
      
      const result = await configureVoiceWebhook(
        numberSid,
        webhookUrl,
        subaccountSid,
        subaccountToken
      );
      
      res.json(result);
    } catch (error: any) {
      console.error("[Admin] Configure single webhook error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Configure webhook by phone number (not SID) 
  app.post("/api/admin/configure-webhook-by-phone", async (req, res) => {
    try {
      const { phoneNumber, baseUrl } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({ error: "phoneNumber required" });
      }
      
      const webhookBaseUrl = baseUrl || `https://${req.hostname}`;
      const webhookUrl = `${webhookBaseUrl}/twilio/voice`;
      
      console.log(`[Admin] Configuring webhook for ${phoneNumber} -> ${webhookUrl}`);
      
      const result = await configureWebhookByPhone(phoneNumber, webhookUrl);
      
      // If successful, update the database with the SID
      if (result.success && result.sid) {
        try {
          await db.execute(
            `UPDATE phone_numbers SET twilio_number_sid = '${result.sid}' WHERE twilio_number = '${phoneNumber}'`
          );
          console.log(`[Admin] Updated phone_numbers with SID: ${result.sid}`);
        } catch (dbError: any) {
          console.error("[Admin] Failed to update DB:", dbError.message);
        }
      }
      
      res.json({
        ...result,
        webhookUrl,
      });
    } catch (error: any) {
      console.error("[Admin] Configure webhook by phone error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ElevenLabs Text-to-Speech endpoint
  app.post("/api/speak", async (req, res) => {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    
    if (!ELEVENLABS_API_KEY) {
      console.log("[TTS] ElevenLabs not configured, using fallback");
      return res.status(503).json({ error: "TTS not configured" });
    }

    try {
      const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel - default voice
      
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": ELEVENLABS_API_KEY,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_monolingual_v1",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status}`);
      }

      const audioBuffer = await response.arrayBuffer();
      res.set("Content-Type", "audio/mpeg");
      res.send(Buffer.from(audioBuffer));
      
    } catch (error: any) {
      console.error("[TTS] Error:", error.message);
      res.status(500).json({ error: "TTS generation failed" });
    }
  });

  // Generate initial hint based on goal (LIVE mode)
  app.post("/api/generate-initial-hint", async (req, res) => {
    const { goal, language } = req.body;
    
    if (!goal) {
      return res.status(400).json({ error: "Goal is required" });
    }
    
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI not configured" });
    }
    
    const langName = LANGUAGE_NAMES[language] || "Russian";
    
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are TalkHint. Generate the FIRST phrase user should say when they call to achieve their goal.

IMPORTANT: The phrase MUST be in ENGLISH because user is calling an English-speaking person.

${LIVE_ANTI_LOOP_RULES}

Return JSON: {"en": "phrase IN ENGLISH 5-10 words", "translation": "same phrase translated to ${langName}"}`
            },
            {
              role: "user",
              content: `Goal: ${goal}\n\nWhat should user say FIRST when they call?`
            }
          ],
          temperature: 0.5,
          max_tokens: 100
        })
      });
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return res.json({ en: parsed.en, translation: parsed.translation });
      }
      
      return res.json({ en: "Hello, I am calling about...", translation: "Здравствуйте, я звоню по поводу..." });
    } catch (error: any) {
      console.error("[InitialHint] Error:", error.message);
      return res.json({ en: "Hello, I am calling about...", translation: "Здравствуйте, я звоню по поводу..." });
    }
  });

  // Push notification endpoints
  app.get("/api/push/vapid-key", (req, res) => {
    const publicKey = getVapidPublicKey();
    if (!publicKey) {
      return res.status(500).json({ error: "Push notifications not configured" });
    }
    res.json({ publicKey });
  });

  app.post("/api/push/subscribe", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { subscription } = req.body;
      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: "Invalid subscription data" });
      }

      await saveSubscription(user.id, subscription);
      res.json({ success: true, message: "Subscription saved" });
    } catch (error: any) {
      console.error("[Push] Subscribe error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generic device token registration (platform-agnostic)
  // Used by iOS app, future Android app, etc.
  app.post("/api/devices/register", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { platform, token, bundleId, appVersion, deviceModel, environment } = req.body;

      if (!platform || !token) {
        return res.status(400).json({ error: "platform and token required" });
      }

      const allowedPlatforms = ["ios", "android"];
      if (!allowedPlatforms.includes(platform)) {
        return res.status(400).json({ error: `platform must be one of: ${allowedPlatforms.join(", ")}` });
      }

      await db.insert(deviceTokens).values({
        userId: user.id,
        platform,
        token,
        bundleId: bundleId || null,
        appVersion: appVersion || null,
        deviceModel: deviceModel || null,
        environment: environment || "production",
        isActive: true,
      }).onConflictDoUpdate({
        target: [deviceTokens.token, deviceTokens.platform],
        set: {
          userId: user.id,
          bundleId: bundleId || null,
          appVersion: appVersion || null,
          deviceModel: deviceModel || null,
          environment: environment || "production",
          isActive: true,
          lastUsedAt: new Date(),
        },
      });

      console.log(`[Devices] Registered ${platform} device for user ${user.id}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Devices] Register error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/devices/unregister", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { token, platform } = req.body;
      if (!token || !platform) {
        return res.status(400).json({ error: "token and platform required" });
      }

      await db.delete(deviceTokens).where(
        and(
          eq(deviceTokens.userId, user.id),
          eq(deviceTokens.token, token),
          eq(deviceTokens.platform, platform)
        )
      );

      console.log(`[Devices] Unregistered ${platform} device for user ${user.id}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Devices] Unregister error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Call accept/reject endpoints for push notification flow
  app.post("/api/call/accept", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { callSid } = req.body;
      // clientType tells the hold loop how to bridge: "browser" (default) -> <Dial><Client>,
      // "ios" -> caller joins a conference that the iOS app connects into outbound.
      const clientType = req.body.clientType === "ios" ? "ios" : "browser";

      if (!callSid) {
        return res.status(400).json({ error: "callSid required" });
      }

      // Ownership check: only the user who owns this pending call may accept it.
      const updated = await db.update(pendingCalls)
        .set({ status: "accepted", clientType })
        .where(and(eq(pendingCalls.callSid, callSid), eq(pendingCalls.userId, user.id)))
        .returning({ id: pendingCalls.id });

      if (updated.length === 0) {
        console.warn(`[Call] Accept denied - no pending call ${callSid} owned by user ${user.id}`);
        return res.status(404).json({ error: "Pending call not found" });
      }

      // Bind this call to its owner so the Twilio media stream routes live
      // transcripts/hints only to this user's UI clients.
      setCallOwner(callSid, user.id);

      const timestamp = new Date().toISOString();
      console.log(`[Call] ${callSid} @ ${timestamp} - Accept received (clientType=${clientType}), status changed to 'accepted'`);
      
      // Return conference name so the client can join (iOS uses it for outbound connect)
      const conferenceRoom = `call-${callSid}`;
      res.json({ success: true, status: "accepted", clientType, conference: conferenceRoom });
    } catch (error: any) {
      console.error("[Call] Accept error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/call/reject", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { callSid } = req.body;

      if (!callSid) {
        return res.status(400).json({ error: "callSid required" });
      }

      // Ownership check: only the user who owns this pending call may reject it.
      const updated = await db.update(pendingCalls)
        .set({ status: "rejected" })
        .where(and(eq(pendingCalls.callSid, callSid), eq(pendingCalls.userId, user.id)))
        .returning({ id: pendingCalls.id });

      if (updated.length === 0) {
        console.warn(`[Call] Reject denied - no pending call ${callSid} owned by user ${user.id}`);
        return res.status(404).json({ error: "Pending call not found" });
      }

      // Call is over before it began — drop any owner binding.
      clearCallOwner(callSid);

      // Hangup the call
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await client.calls(callSid).update({ status: "completed" });

      const timestamp = new Date().toISOString();
      console.log(`[Call] ${callSid} @ ${timestamp} - Rejected, call terminated`);
      res.json({ success: true, status: "rejected" });
    } catch (error: any) {
      console.error("[Call] Reject error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Twilio HOLD loop endpoint - keeps caller on hold until accept/reject/timeout
  app.post("/api/twilio/hold", async (req, res) => {
    const callSid = req.query.callSid as string;
    const userId = req.query.userId as string;
    
    const timestamp = new Date().toISOString();
    console.log(`[Hold] ${callSid} @ ${timestamp} - checking status`);
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twimlResponse = new VoiceResponse();
    
    try {
      // Get pending call status from database
      const [pendingCall] = await db.select()
        .from(pendingCalls)
        .where(eq(pendingCalls.callSid, callSid));
      
      if (!pendingCall) {
        console.log(`[Hold] Call ${callSid} not found, hanging up`);
        twimlResponse.say("Sorry, this call could not be connected. Goodbye.");
        twimlResponse.hangup();
        return res.type("text/xml").send(twimlResponse.toString());
      }
      
      const now = new Date();
      const isExpired = pendingCall.expiresAt && new Date(pendingCall.expiresAt) < now;
      
      console.log(`[Hold] Call ${callSid} status: ${pendingCall.status}, expired: ${isExpired}`);
      
      if (pendingCall.status === "accepted") {
        const host = req.get("host") || "talkhint.app";
        const streamUrl = `wss://${host}/twilio-stream`;
        
        // Start media stream for transcription. The caller leg with both_tracks
        // captures the caller's audio plus whatever is played to the caller (the
        // bridged agent), so transcription works for both client and conference paths.
        const start = twimlResponse.start();
        start.stream({
          url: streamUrl,
          track: "both_tracks"
        }).parameter({ name: "callType", value: "incoming_answered" });
        
        twimlResponse.say({ voice: "alice" }, "Connecting you now.");
        
        if (pendingCall.clientType === "ios") {
          // iOS path: caller joins a per-call conference and waits. The iOS app
          // connects into the same conference via an outbound Twilio connect()
          // (handled in /twilio/voice), bridging the two legs.
          const conferenceRoom = `call-${callSid}`;
          console.log(`[Hold] ${callSid} ACCEPTED - route=IOS, caller joining conference: ${conferenceRoom}`);
          
          const dial = twimlResponse.dial({
            callerId: pendingCall.fromNumber || "",
            timeLimit: CALL_TIME_LIMIT
          });
          dial.conference({
            startConferenceOnEnter: false, // caller waits until the iOS agent joins
            endConferenceOnExit: true,     // end the call when the caller hangs up
            beep: "false",
          }, conferenceRoom);
          
          console.log(`[Hold] ${callSid} CONFERENCE bridge ready: ${conferenceRoom} | streamUrl: ${streamUrl}`);
          
        } else {
          // Browser path (unchanged): dial the user's browser client directly.
          const callUserId = pendingCall.userId || userId;
          const clientIdentity = `user-${callUserId}`;
          console.log(`[Hold] ${callSid} ACCEPTED - route=BROWSER, connecting to client:${clientIdentity}`);
          
          const dial = twimlResponse.dial({
            callerId: pendingCall.fromNumber || "",
            answerOnBridge: true,
            timeout: CALL_TIMEOUT,
            timeLimit: CALL_TIME_LIMIT
          });
          dial.client(clientIdentity);
          
          console.log(`[Hold] ${callSid} DIALING browser client: ${clientIdentity} | streamUrl: ${streamUrl}`);
        }
        
      } else if (pendingCall.status === "rejected" || isExpired) {
        // User rejected or timeout
        console.log(`[Hold] Call ${callSid} ${pendingCall.status === "rejected" ? "REJECTED" : "EXPIRED"} - hanging up`);
        twimlResponse.say("The person you are calling is unavailable. Please try again later. Goodbye.");
        twimlResponse.hangup();
        
        // Update status to rejected if expired
        if (isExpired && pendingCall.status === "ringing") {
          await db.update(pendingCalls)
            .set({ status: "expired" })
            .where(eq(pendingCalls.callSid, callSid));
        }
        
      } else {
        // Still ringing - continue hold loop (silent, no annoying sounds)
        console.log(`[Hold] Call ${callSid} still RINGING - continuing hold`);
        
        const host = req.get("host") || "talkhint.app";
        const protocol = req.get("x-forwarded-proto") || "https";
        const holdUrl = `${protocol}://${host}/api/twilio/hold?callSid=${callSid}&userId=${userId}`;
        
        // Silent pause and loop back
        twimlResponse.pause({ length: 8 });
        twimlResponse.redirect({ method: "POST" }, holdUrl);
      }
      
    } catch (error: any) {
      console.error(`[Hold] Error for call ${callSid}:`, error.message);
      twimlResponse.say("An error occurred. Please try again later.");
      twimlResponse.hangup();
    }
    
    res.type("text/xml").send(twimlResponse.toString());
  });

  // Get pending call status (for PWA to check on open)
  app.get("/api/call/pending", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const [call] = await db.select()
        .from(pendingCalls)
        .where(eq(pendingCalls.userId, user.id))
        .orderBy(pendingCalls.createdAt);

      if (call && call.status === "ringing") {
        res.json({ hasPendingCall: true, call });
      } else {
        res.json({ hasPendingCall: false });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate Twilio Access Token for browser-based calling (user-based auth)
  app.get("/api/token", authMiddleware, async (req, res) => {
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;
    
    if (!TWILIO_ACCOUNT_SID || !apiKey || !apiSecret) {
      console.error("[Token] Missing credentials:", {
        hasAccountSid: !!TWILIO_ACCOUNT_SID,
        hasApiKey: !!apiKey,
        hasApiSecret: !!apiSecret,
      });
      return res.status(500).json({ error: "Twilio API credentials not configured" });
    }

    // Use user-specific identity for incoming calls
    const user = (req as any).user;
    const identity = user ? `user-${user.id}` : "browser-user";
    
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      apiKey,
      apiSecret,
      { identity }
    );

    token.addGrant(voiceGrant);

    console.log("[Token] Generated access token:");
    console.log("  identity:", identity);
    console.log("  accountSid:", TWILIO_ACCOUNT_SID?.substring(0, 10) + "...");
    console.log("  apiKey:", apiKey?.substring(0, 10) + "...");
    console.log("  twimlApp:", TWILIO_TWIML_APP_SID?.substring(0, 10) + "...");
    console.log("  callerId:", TWILIO_PHONE_NUMBER || "NOT SET");

    // Fire-and-forget pre-warm: kills 500-1500ms OpenAI cold-start tax on the
    // first hint. Runs during the 3-10s PSTN ringing window so it's free latency.
    if (process.env.OPENAI_API_KEY) {
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => console.log(r.ok ? "[prewarm] OpenAI warmed" : `[prewarm] OpenAI warm-up non-2xx: ${r.status}`))
        .catch((e: any) => console.warn("[prewarm] OpenAI warm-up failed (non-critical):", e.message));
    }

    res.json({ token: token.toJwt(), identity });
  });

  // TwiML webhook for browser-initiated calls AND incoming calls
  // Note: validateTwilioSignature middleware can be enabled in production
  app.post("/twilio/voice", validateTwilioSignature, async (req, res) => {
    const toNumber = req.body.To || req.body.to || req.query.To || req.query.to;
    const fromNumber = req.body.From || req.body.from;
    // Custom CallerId param from browser device.connect() (From is overwritten by Twilio with client identity)
    const customCallerId = req.body.CallerId;
    const callSid = req.body.CallSid;
    const direction = req.body.Direction || "unknown";
    // Custom param from a client outbound connect() to join a call conference (iOS path)
    const joinConferenceRoom = req.body.conferenceRoom as string | undefined;
    
    const timestamp = new Date().toISOString();
    console.log(`[TwiML Voice] ===== CALL ${callSid} @ ${timestamp} =====`);
    console.log(`[TwiML Voice] Direction: ${direction} | To: ${toNumber} | From: ${fromNumber} | CallerId: ${customCallerId}`);
    console.log(`[TwiML Voice] Body params:`, JSON.stringify(req.body));

    const host = req.get("host") || "talkhint.app";
    const streamUrl = `wss://${host}/twilio-stream`;

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twimlResponse = new VoiceResponse();

    // Check if this is an INCOMING call (someone calling our Twilio number)
    // When incoming: To = our Twilio number, From = external caller (NOT a client: identity)
    // Browser outbound calls have From = "client:user-{userId}"
    const isFromBrowser = fromNumber && fromNumber.startsWith("client:");
    const isIncomingToTwilioNumber = !isFromBrowser && toNumber && toNumber.startsWith("+");
    
    console.log(`[TwiML Voice] isFromBrowser: ${isFromBrowser}, isIncomingToTwilioNumber: ${isIncomingToTwilioNumber}`);
    
    // Look up if toNumber is one of our phone numbers
    // Try phoneNumbers table first (user-assigned), then available_numbers (line pool)
    let ownerUserId: string | null = null;
    let ownerPhoneNumberId: string | null = null;
    let lineId: number | null = null;
    let lineName: string | null = null;
    
    if (isIncomingToTwilioNumber) {
      try {
        // First try: user-assigned phone numbers
        const phoneNumber = await storage.getPhoneNumberByTwilio(toNumber);
        if (phoneNumber) {
          ownerUserId = phoneNumber.userId;
          ownerPhoneNumberId = phoneNumber.id;
          console.log("[TwiML Voice] INCOMING: Found owner userId:", ownerUserId);
        } else {
          // Second try: available_numbers pool (line-based)
          const allNumbers = await storage.getAllAvailableNumbers();
          const lineNumber = allNumbers.find(n => n.twilioNumber === toNumber);
          if (lineNumber && lineNumber.subaccountName) {
            // Extract lineId from name like "TH-NUM-001"
            const match = lineNumber.subaccountName.match(/TH-NUM-(\d+)/);
            if (match) {
              lineId = parseInt(match[1], 10);
              lineName = lineNumber.subaccountName;
              console.log(`[TwiML Voice] INCOMING: Found line ${lineId} (${lineName})`);
            }
          }
        }
      } catch (e) {
        console.error("[TwiML Voice] Error looking up phone owner:", e);
      }
    }

    if (isFromBrowser && joinConferenceRoom) {
      // CLIENT CONFERENCE JOIN (iOS path): the app's outbound connect() joins the
      // per-call conference. The held PSTN caller is placed into the same conference
      // by the hold loop, bridging the two legs without dialing the client directly.
      //
      // Authorization: `fromNumber` is the Twilio client identity ("client:user-{id}"),
      // which Twilio derives from the signed access token and cannot be spoofed by the
      // client. We verify the conference's owning pending call belongs to that same user,
      // is accepted, and is an iOS call before allowing the join — this blocks a user
      // from joining (eavesdropping/hijacking) another user's call by guessing a callSid.
      let joinAuthorized = false;
      const identity = fromNumber.replace(/^client:/, ""); // e.g. "user-123"
      const roomCallSid = joinConferenceRoom.startsWith("call-")
        ? joinConferenceRoom.slice("call-".length)
        : null;

      if (roomCallSid && identity.startsWith("user-")) {
        const joiningUserId = identity.slice("user-".length);
        try {
          const [pending] = await db.select()
            .from(pendingCalls)
            .where(eq(pendingCalls.callSid, roomCallSid))
            .limit(1);
          joinAuthorized = !!pending
            && pending.userId === joiningUserId
            && pending.status === "accepted"
            && pending.clientType === "ios";
          if (!joinAuthorized) {
            console.warn(`[TwiML Voice] CONFERENCE JOIN denied for ${fromNumber} -> ${joinConferenceRoom} (pending owner/status/type mismatch)`);
          }
        } catch (e) {
          console.error("[TwiML Voice] Error validating conference join:", e);
        }
      } else {
        console.warn(`[TwiML Voice] CONFERENCE JOIN denied - malformed identity/room: ${fromNumber} / ${joinConferenceRoom}`);
      }

      if (joinAuthorized) {
        console.log(`[TwiML Voice] CONFERENCE JOIN from ${fromNumber} -> ${joinConferenceRoom}`);
        const dial = twimlResponse.dial({});
        dial.conference({
          startConferenceOnEnter: true, // the agent joining starts the conference
          endConferenceOnExit: true,    // end the call when the agent hangs up
          beep: "false",
        }, joinConferenceRoom);
        console.log("[TwiML Voice] Returning CONFERENCE JOIN TwiML for", joinConferenceRoom);
      } else {
        twimlResponse.say({ voice: "alice" }, "This call is no longer available. Goodbye.");
        twimlResponse.hangup();
      }
    } else if (ownerUserId) {
      // INCOMING CALL: Send push notification and HOLD the call
      console.log("[TwiML Voice] INCOMING CALL from", fromNumber, "to", toNumber);
      
      // Save pending call to database with 120 second expiry
      try {
        const expiresAt = new Date(Date.now() + 120000); // 120 seconds
        await db.insert(pendingCalls).values({
          userId: ownerUserId,
          callSid,
          fromNumber,
          toNumber,
          status: "ringing",
          expiresAt,
        }).onConflictDoUpdate({
          target: pendingCalls.callSid,
          set: { status: "ringing", expiresAt },
        });
        console.log("[TwiML Voice] Saved pending call:", callSid);
      } catch (e: any) {
        console.error("[TwiML Voice] Failed to save pending call:", e.message);
      }

      // Record this incoming call in history (scoped to the number's owner).
      // Final status/endedAt are filled in later by the /twilio/status callback.
      try {
        const existing = await storage.getCallByCallSid(callSid);
        if (!existing) {
          await storage.createCall({
            userId: ownerUserId,
            phoneNumberId: ownerPhoneNumberId,
            callSid,
            fromNumber,
            toNumber,
            direction: "incoming",
            status: "ringing",
          });
          console.log("[TwiML Voice] Created incoming call record:", callSid);
        }
      } catch (e: any) {
        console.error("[TwiML Voice] Failed to create incoming call record:", e.message);
      }
      
      // Send push notification (async, don't wait)
      sendIncomingCallPush(ownerUserId, fromNumber, callSid).catch(err => {
        console.error("[TwiML Voice] Push notification failed:", err.message);
      });
      
      // Send SMS notification to user's forwarding phone (async, don't wait)
      (async () => {
        try {
          const [user] = await db.select().from(users).where(eq(users.id, ownerUserId));
          if (user?.forwardingPhone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
            const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
            const protocol = req.get("x-forwarded-proto") || "https";
            const appUrl = `${protocol}://${host}/app`;
            await twilioClient.messages.create({
              body: `📞 Incoming call from ${fromNumber}. Answer in app: ${appUrl}`,
              from: toNumber, // Use the Twilio number that received the call
              to: user.forwardingPhone
            });
            console.log(`[TwiML Voice] SMS sent to ${user.forwardingPhone}`);
          } else {
            console.log("[TwiML Voice] No forwarding phone for SMS notification");
          }
        } catch (smsErr: any) {
          console.error("[TwiML Voice] SMS notification failed:", smsErr.message);
        }
      })();
      
      // Return HOLD TwiML - caller hears message while we wait for accept (no annoying sounds)
      const protocol = req.get("x-forwarded-proto") || "https";
      const holdUrl = `${protocol}://${host}/api/twilio/hold?callSid=${callSid}&userId=${ownerUserId}`;
      
      twimlResponse.say({ voice: "alice", language: "en-US" }, "Please hold while we connect your call.");
      twimlResponse.pause({ length: 8 });
      twimlResponse.redirect({ method: "POST" }, holdUrl);
      
      console.log("[TwiML Voice] Returning HOLD TwiML, redirect to:", holdUrl);
    } else if (lineId) {
      // INCOMING CALL to a LINE (not assigned to a user, but in the pool)
      // For now, just answer with a message - line owner should connect via web
      console.log(`[TwiML Voice] INCOMING CALL to line ${lineId} (${lineName}) from ${fromNumber}`);
      
      // TODO: Could broadcast to line's web clients via WebSocket
      // For now, just play a message
      twimlResponse.say({ voice: "alice", language: "en-US" }, 
        `Thank you for calling. This line is currently not attended. Please try again later.`
      );
      twimlResponse.hangup();
      
      console.log("[TwiML Voice] Line incoming call - not attended, hanging up");
    } else if (toNumber && toNumber.startsWith("+")) {
      // OUTBOUND CALL: Browser calling an external number
      // Try to get caller ID based on client identity
      let userCallerId = TWILIO_PHONE_NUMBER;
      let outboundLineId: number | null = null;
      
      // Support both formats:
      // - Line-based: "client:line_X" (from /twilio/access-token with line auth)
      // - User-based: "client:user-{userId}" (from /api/token with user auth)
      if (fromNumber && fromNumber.startsWith("client:line_")) {
        // Line-based identity: lookup from available_numbers
        const lineIdStr = fromNumber.replace("client:line_", "");
        outboundLineId = parseInt(lineIdStr, 10);
        const outboundLineNum = String(outboundLineId).padStart(3, "0");
        const outboundLineName = `TH-NUM-${outboundLineNum}`;
        console.log(`[TwiML Voice] Looking up number for line: ${outboundLineId} (${outboundLineName})`);
        
        try {
          const allNumbers = await storage.getAllAvailableNumbers();
          const lineNumber = allNumbers.find(n => n.subaccountName === outboundLineName);
          if (lineNumber) {
            userCallerId = lineNumber.twilioNumber;
            console.log(`[TwiML Voice] Found line number: ${userCallerId}`);
          } else {
            console.log(`[TwiML Voice] No number found for line ${lineName}, using default`);
          }
        } catch (e: any) {
          console.error(`[TwiML Voice] Line lookup failed, using default:`, e.message);
        }
      } else if (fromNumber && fromNumber.startsWith("client:user-")) {
        // User-based identity: lookup from phoneNumbers
        const userId = fromNumber.replace("client:user-", "");
        // Register this outbound call's owner so its live transcripts/hints are
        // routed to that user's /ui socket. Without this the media stream has no
        // owner and sendToUser drops everything fail-closed (no hints on screen).
        setCallOwner(callSid, userId);
        console.log(`[TwiML Voice] Registered call owner ${userId} for ${callSid}`);
        console.log(`[TwiML Voice] Looking up number for user: ${userId}`);
        try {
          const userNumbers = await db.select().from(phoneNumbers).where(eq(phoneNumbers.userId, userId)).limit(1);
          if (userNumbers.length > 0) {
            userCallerId = userNumbers[0].twilioNumber;
            console.log(`[TwiML Voice] Found user number: ${userCallerId}`);
          } else {
            console.log(`[TwiML Voice] No numbers found for user ${userId}, using default`);
          }
        } catch (e: any) {
          console.error(`[TwiML Voice] DB lookup failed, using default:`, e.message);
        }
      } else {
        console.log(`[TwiML Voice] No client identity, using default callerId`);
      }
      
      console.log(`[TwiML Voice] OUTBOUND CALL to ${toNumber} from ${userCallerId}`);

      // Record this outbound call in history, scoped to the placing user. Only
      // user-based outbound calls have a known owner; line-based calls don't, so
      // we skip those. Final status/endedAt come later via /twilio/status.
      if (fromNumber && fromNumber.startsWith("client:user-")) {
        const placingUserId = fromNumber.replace("client:user-", "");
        try {
          const existing = await storage.getCallByCallSid(callSid);
          if (!existing) {
            await storage.createCall({
              userId: placingUserId,
              callSid,
              fromNumber: String(userCallerId ?? ""),
              toNumber: String(toNumber),
              direction: "outgoing",
              status: "active",
            });
            console.log("[TwiML Voice] Created outgoing call record:", callSid);
          }
        } catch (e: any) {
          console.error("[TwiML Voice] Failed to create outgoing call record:", e.message);
        }
      }
      
      // Start media stream for transcription
      const start = twimlResponse.start();
      start.stream({
        url: streamUrl,
        track: "both_tracks"
      });
      
      // action fires when the <Dial> completes, on the PARENT (client) leg, so its
      // CallSid matches the record created above and DialCallStatus gives the final
      // outcome. The phone-number-level statusCallback does NOT fire for these
      // TwiML-app-originated outbound legs, so this is how we capture call end.
      const dialStatusUrl = `https://${host}/twilio/dial-status`;
      const dial = twimlResponse.dial({ 
        callerId: userCallerId,
        answerOnBridge: true,
        timeout: CALL_TIMEOUT,
        timeLimit: CALL_TIME_LIMIT,
        action: dialStatusUrl,
        method: "POST"
      });
      dial.number(toNumber);
      console.log("[TwiML Voice] Dialing:", toNumber, "with stream:", streamUrl);
    } else {
      twimlResponse.say("Sorry, this call cannot be connected.");
      console.log("[TwiML Voice] Could not route call - To:", toNumber, "From:", fromNumber);
    }

    const twimlXml = twimlResponse.toString();
    console.log("[TwiML Voice] Generated TwiML:", twimlXml);
    res.type("text/xml").send(twimlXml);
  });

  // Twilio status callback endpoint - receives call status updates
  app.post("/twilio/status", validateTwilioSignature, async (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    const timestamp = new Date().toISOString();
    
    console.log(`[Twilio Status] ${callSid} @ ${timestamp} - Status: ${callStatus}`);
    console.log(`[Twilio Status] Full body:`, JSON.stringify(req.body));

    // Reflect the call's latest status in history. Terminal statuses also stamp
    // endedAt so the History tab shows when the call finished.
    if (callSid && callStatus) {
      const terminal = ["completed", "busy", "failed", "no-answer", "canceled"];
      try {
        const call = await storage.getCallByCallSid(callSid);
        if (call) {
          const updates: Partial<typeof call> = { status: callStatus };
          if (terminal.includes(callStatus)) {
            updates.endedAt = new Date();
          }
          await storage.updateCall(call.id, updates);
        }
      } catch (e: any) {
        console.error(`[Twilio Status] Failed to update call record for ${callSid}:`, e.message);
      }
    }
    
    res.status(200).send("OK");
  });

  // Dial action callback - fires when an outbound <Dial> completes.
  // Unlike the phone-number-level statusCallback (which only fires reliably for
  // INBOUND calls), this is requested on the PARENT/client leg of a browser- or
  // iOS-originated outbound call, so req.body.CallSid matches the record created
  // in /twilio/voice. DialCallStatus carries the final outcome of the dialed leg
  // (completed/busy/no-answer/failed/canceled). We stamp the record's final
  // status and endedAt here so outbound calls don't stay stuck "active".
  app.post("/twilio/dial-status", validateTwilioSignature, async (req, res) => {
    const callSid = req.body.CallSid;
    const dialCallStatus = req.body.DialCallStatus;
    const timestamp = new Date().toISOString();

    console.log(`[Twilio DialStatus] ${callSid} @ ${timestamp} - DialCallStatus: ${dialCallStatus}`);
    console.log(`[Twilio DialStatus] Full body:`, JSON.stringify(req.body));

    if (callSid && dialCallStatus) {
      // DialCallStatus is always terminal for the dialed leg. Map "answered" (the
      // call connected and later ended normally) to our "completed" status; the
      // rest already match our terminal vocabulary.
      const terminal = ["completed", "answered", "busy", "failed", "no-answer", "canceled"];
      try {
        const call = await storage.getCallByCallSid(callSid);
        if (call) {
          // Don't clobber a terminal status already set by /twilio/status.
          const alreadyEnded = !!call.endedAt;
          if (!alreadyEnded) {
            const mappedStatus = dialCallStatus === "answered" ? "completed" : dialCallStatus;
            const updates: Partial<typeof call> = { status: mappedStatus };
            if (terminal.includes(dialCallStatus)) {
              updates.endedAt = new Date();
            }
            await storage.updateCall(call.id, updates);
            console.log(`[Twilio DialStatus] Updated call ${callSid} -> status=${mappedStatus}`);
          }
        } else {
          console.log(`[Twilio DialStatus] No call record found for ${callSid}`);
        }
      } catch (e: any) {
        console.error(`[Twilio DialStatus] Failed to update call record for ${callSid}:`, e.message);
      }
    }

    // Empty TwiML: the dial is over, so let the parent leg hang up (same behavior
    // as before, when the TwiML document simply ended after <Dial>).
    res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  // Twilio outbound webhook - returns TwiML for basic voice call
  // Simple <Dial> only - no streaming for now
  app.post("/twilio/outbound", (req, res) => {
    // Target number passed via query param from /start-call
    const targetNumber = req.query.target as string;
    
    console.log("[TwiML] ===== OUTBOUND CALL =====");
    console.log("[TwiML] Target:", targetNumber);
    console.log("[TwiML] Body:", JSON.stringify(req.body));
    
    if (!targetNumber) {
      console.error("[TwiML] No target number provided!");
      return res.status(400).send("Missing target number");
    }
    
    // Simple TwiML: Say greeting, then Dial the target
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting your call.</Say>
  <Dial answerOnBridge="true" callerId="${TWILIO_PHONE_NUMBER}" timeout="${CALL_TIMEOUT}" timeLimit="${CALL_TIME_LIMIT}">
    <Number timeout="${CALL_TIMEOUT}">${targetNumber}</Number>
  </Dial>
</Response>`;

    console.log("[TwiML] Returning simple Dial TwiML");
    res.type("text/xml").send(twiml);
  });

  // GET for testing
  app.get("/twilio/outbound", (req, res) => {
    const targetNumber = req.query.target as string || "+15551234567";
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Test call.</Say>
  <Dial answerOnBridge="true" timeout="${CALL_TIMEOUT}" timeLimit="${CALL_TIME_LIMIT}">
    <Number timeout="${CALL_TIMEOUT}">${targetNumber}</Number>
  </Dial>
</Response>`;

    res.type("text/xml").send(twiml);
  });

  // Start outbound call via Twilio REST API
  // Direct call to target with inline TwiML
  app.post("/start-call", async (req, res) => {
    try {
      const { target } = req.body;
      
      if (!target) {
        return res.status(400).json({ error: "Target phone number is required" });
      }
      
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
        return res.status(500).json({ error: "Twilio credentials not configured" });
      }
      
      console.log(`[start-call] ===== DIRECT OUTBOUND CALL =====`);
      console.log(`[start-call] Target: ${target}`);
      console.log(`[start-call] From: ${TWILIO_PHONE_NUMBER}`);
      
      // Simple TwiML - just say a message
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! This is a test call from TalkHint.</Say>
  <Pause length="2"/>
  <Say>The connection is working. Goodbye!</Say>
</Response>`;
      
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      
      const twilioResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: target,
            From: TWILIO_PHONE_NUMBER!,
            Twiml: twiml,
          }),
        }
      );
      
      if (!twilioResponse.ok) {
        const errorText = await twilioResponse.text();
        console.error('[start-call] Twilio API error:', errorText);
        return res.status(twilioResponse.status).json({ error: 'Failed to initiate call', details: errorText });
      }
      
      const callData = await twilioResponse.json();
      console.log(`[start-call] Call initiated: ${callData.sid}, status: ${callData.status}`);
      
      res.json({ 
        success: true, 
        callSid: callData.sid,
        status: callData.status,
        target
      });
    } catch (error: any) {
      console.error('[start-call] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to start call' });
    }
  });

  const clients: Set<any> = new Set();

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    clients.add(res);
    
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    req.on("close", () => {
      clients.delete(res);
    });
  });

  // PREP MODE Chat endpoint - for rehearsal before calls
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, language = "ru", isLiveCall = false, goal = "" } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }
      
      const langName = LANGUAGE_NAMES[language] || "Russian";
      
      // FROZEN: Always use base prompt (TALKHINT_GOLDEN_PROMPT)
      // Custom prompts (activePromptId from phone_numbers) are NOT used for Basic plan
      // This is intentional - all users get the same base AI assistant behavior
      const systemPrompt = isLiveCall 
        ? `${TALKHINT_GOLDEN_PROMPT}

USER'S GOAL: ${goal || "Have a successful phone conversation"}
USER'S NATIVE LANGUAGE: ${langName}

The user is in a LIVE call. Give them immediate, ready-to-say phrases.`
        : `${PREP_PROMPT}

${TALKHINT_GOLDEN_PROMPT}

USER'S GOAL: ${goal || "Unknown - ask what they want to accomplish"}
USER'S NATIVE LANGUAGE: ${langName}`;

      console.log("[Chat] Mode:", isLiveCall ? "LIVE" : "PREP", "Language:", language);
      
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Chat] OpenAI error:", errorText);
        return res.status(500).json({ error: "AI service error" });
      }
      
      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || "";
      
      console.log("[Chat] Response:", reply.substring(0, 100) + "...");
      
      res.json({ 
        reply,
        mode: isLiveCall ? "live" : "prep"
      });
      
    } catch (error: any) {
      console.error("[Chat] Error:", error.message);
      res.status(500).json({ error: "Failed to process chat" });
    }
  });

  // ==================== V2 API ENDPOINTS ====================

  // Auth endpoints
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, language } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }
      
      const user = await registerUser(email, password, language);
      const token = await createSession(user.id);
      
      res.json({ 
        user: { id: user.id, email: user.email, language: user.language, plan: user.plan },
        token 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }
      
      const user = await loginUser(email, password);
      const token = await createSession(user.id);
      
      res.json({ 
        user: { id: user.id, email: user.email, language: user.language, plan: user.plan },
        token 
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      await deleteSession(authHeader.substring(7));
    }
    res.json({ success: true });
  });

  app.get("/api/auth/me", authMiddleware, (req, res) => {
    res.json({ user: req.user });
  });

  // Forwarding settings endpoints
  app.get("/api/settings/forwarding", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
      res.json({ forwardingPhone: dbUser?.forwardingPhone || null });
    } catch (error: any) {
      console.error("[Settings] Forwarding get error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/forwarding", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { forwardingPhone } = req.body;
      
      // Validate E.164 format (optional, allow empty to clear)
      if (forwardingPhone && !/^\+?[1-9]\d{6,14}$/.test(forwardingPhone.replace(/[\s\-\(\)]/g, ""))) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }
      
      // Normalize to E.164
      const normalized = forwardingPhone ? forwardingPhone.replace(/[\s\-\(\)]/g, "") : null;
      
      await db.update(users)
        .set({ forwardingPhone: normalized })
        .where(eq(users.id, user.id));
      
      console.log(`[Settings] User ${user.id} updated forwarding phone to: ${normalized}`);
      res.json({ success: true, forwardingPhone: normalized });
    } catch (error: any) {
      console.error("[Settings] Forwarding update error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Per-user AirAtoma webhook URL. Each user can point their finished-call
  // transcripts at their own AirAtoma CRM endpoint. Empty value clears it (and
  // the server then falls back to the AIRATOMA_WEBHOOK_URL env var, if set).
  app.get("/api/settings/airatoma", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
      res.json({ airatomaWebhookUrl: dbUser?.airatomaWebhookUrl || null });
    } catch (error: any) {
      console.error("[Settings] AirAtoma get error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/airatoma", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { airatomaWebhookUrl } = req.body;

      const trimmed = typeof airatomaWebhookUrl === "string" ? airatomaWebhookUrl.trim() : "";
      // Allow empty to clear; otherwise require a safe public http(s) URL (blocks
      // SSRF-prone destinations: loopback/private/link-local/metadata, credentials).
      if (trimmed) {
        const err = validateUserWebhookUrl(trimmed);
        if (err === "private_host") {
          return res.status(400).json({ error: "Этот адрес недоступен. Укажите публичный URL вашего AirAtoma." });
        }
        if (err) {
          return res.status(400).json({ error: "Введите корректный URL, начинающийся с http:// или https://" });
        }
      }

      const normalized = trimmed || null;
      await db.update(users)
        .set({ airatomaWebhookUrl: normalized })
        .where(eq(users.id, user.id));

      console.log(`[Settings] User ${user.id} updated AirAtoma webhook URL (${normalized ? "set" : "cleared"})`);
      res.json({ success: true, airatomaWebhookUrl: normalized });
    } catch (error: any) {
      console.error("[Settings] AirAtoma update error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Personal Context ("My Context") — free-text injected into every live hint.
  app.get("/api/user/context", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const context = await storage.getUserContext(user.id);
      res.json({ context });
    } catch (error: any) {
      console.error("[Context] Get error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/user/context", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { context } = req.body;
      if (context !== undefined && context !== null && typeof context !== "string") {
        return res.status(400).json({ error: "context must be a string" });
      }
      const saved = await storage.setUserContext(user.id, context ?? "");
      console.log(`[Context] User ${user.id} updated context (${saved.length} chars)`);
      res.json({ success: true, context: saved });
    } catch (error: any) {
      console.error("[Context] Update error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Contact Memory ("Contacts") — per-caller AI memory the user can view/edit/delete.
  app.get("/api/contacts", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const contacts = await storage.listContactMemories(user.id);
      res.json({ contacts });
    } catch (error: any) {
      console.error("[Contacts] List error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/contacts/:id", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;
      const { name, summary, notes, importance } = req.body ?? {};
      for (const [key, value] of Object.entries({ name, summary, notes, importance })) {
        if (value !== undefined && value !== null && typeof value !== "string") {
          return res.status(400).json({ error: `${key} must be a string` });
        }
      }
      // Empty/whitespace name clears it back to null.
      const normalizedName =
        name === undefined ? undefined : (typeof name === "string" && name.trim() ? name.trim() : null);
      const updated = await storage.updateContactMemoryById(user.id, id, {
        ...(normalizedName !== undefined ? { name: normalizedName } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(importance !== undefined ? { importance } : {}),
      });
      if (!updated) {
        return res.status(404).json({ error: "Contact not found" });
      }
      console.log(`[Contacts] User ${user.id} updated contact ${id}`);
      res.json({ success: true, contact: updated });
    } catch (error: any) {
      console.error("[Contacts] Update error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/contacts/:id", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;
      const deleted = await storage.deleteContactMemoryById(user.id, id);
      if (!deleted) {
        return res.status(404).json({ error: "Contact not found" });
      }
      console.log(`[Contacts] User ${user.id} deleted contact ${id}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Contacts] Delete error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Knowledge Cards ("Static Context") — per-user reusable project & company/
  // services facts injected into every live hint. Scoped to the owning user.
  const CARD_TYPES = ["project", "company"];
  const MAX_CARD_TITLE = 120;
  const MAX_CARD_BODY = 600;

  app.get("/api/cards", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const cards = await storage.listKnowledgeCards(user.id);
      res.json({ cards });
    } catch (error: any) {
      console.error("[Cards] List error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cards", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { cardType, title, body, sortOrder } = req.body ?? {};
      if (!CARD_TYPES.includes(cardType)) {
        return res.status(400).json({ error: "cardType must be 'project' or 'company'" });
      }
      if (typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "title is required" });
      }
      if (typeof body !== "string" || !body.trim()) {
        return res.status(400).json({ error: "body is required" });
      }
      if (sortOrder !== undefined && !Number.isInteger(sortOrder)) {
        return res.status(400).json({ error: "sortOrder must be an integer" });
      }
      const created = await storage.createKnowledgeCard({
        userId: user.id,
        cardType,
        title: title.trim().slice(0, MAX_CARD_TITLE),
        body: body.trim().slice(0, MAX_CARD_BODY),
        sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
      });
      if (!created) {
        return res.status(500).json({ error: "Failed to create card" });
      }
      console.log(`[Cards] User ${user.id} created ${cardType} card ${created.id}`);
      res.json({ success: true, card: created });
    } catch (error: any) {
      console.error("[Cards] Create error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/cards/:id", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;
      const { cardType, title, body, sortOrder } = req.body ?? {};
      if (cardType !== undefined && !CARD_TYPES.includes(cardType)) {
        return res.status(400).json({ error: "cardType must be 'project' or 'company'" });
      }
      if (title !== undefined && (typeof title !== "string" || !title.trim())) {
        return res.status(400).json({ error: "title must be a non-empty string" });
      }
      if (body !== undefined && (typeof body !== "string" || !body.trim())) {
        return res.status(400).json({ error: "body must be a non-empty string" });
      }
      if (sortOrder !== undefined && !Number.isInteger(sortOrder)) {
        return res.status(400).json({ error: "sortOrder must be an integer" });
      }
      const updated = await storage.updateKnowledgeCardById(user.id, id, {
        ...(cardType !== undefined ? { cardType } : {}),
        ...(title !== undefined ? { title: title.trim().slice(0, MAX_CARD_TITLE) } : {}),
        ...(body !== undefined ? { body: body.trim().slice(0, MAX_CARD_BODY) } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      });
      if (!updated) {
        return res.status(404).json({ error: "Card not found" });
      }
      console.log(`[Cards] User ${user.id} updated card ${id}`);
      res.json({ success: true, card: updated });
    } catch (error: any) {
      console.error("[Cards] Update error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/cards/:id", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;
      const deleted = await storage.deleteKnowledgeCardById(user.id, id);
      if (!deleted) {
        return res.status(404).json({ error: "Card not found" });
      }
      console.log(`[Cards] User ${user.id} deleted card ${id}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Cards] Delete error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Stripe endpoints
  app.get("/api/stripe/config", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error: any) {
      res.status(500).json({ error: "Stripe not configured" });
    }
  });

  app.get("/api/products", async (req, res) => {
    try {
      const products = await storage.listProductsWithPrices();
      
      const productsMap = new Map();
      for (const row of products) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            metadata: row.product_metadata,
            prices: []
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
          });
        }
      }
      
      res.json({ products: Array.from(productsMap.values()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Bootstrap Stripe products - creates TalkHint Basic if it doesn't exist
  app.all("/api/stripe/bootstrap", async (req, res) => {
    try {
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      if (!stripe) {
        return res.status(500).json({ error: "Stripe not configured" });
      }
      
      // Check existing products
      const existingProducts = await stripe.products.list({ active: true, limit: 100 });
      console.log("[Bootstrap] Found", existingProducts.data.length, "existing products");
      
      const basicProduct = existingProducts.data.find(p => 
        p.name === "TalkHint Basic" || p.metadata?.plan_type === "basic"
      );
      
      if (basicProduct) {
        // Check if has price
        const prices = await stripe.prices.list({ product: basicProduct.id, active: true });
        console.log("[Bootstrap] TalkHint Basic exists with", prices.data.length, "prices");
        return res.json({ 
          status: "exists", 
          product: basicProduct,
          prices: prices.data 
        });
      }
      
      // Create TalkHint Basic product
      console.log("[Bootstrap] Creating TalkHint Basic product...");
      const product = await stripe.products.create({
        name: "TalkHint Basic",
        description: "AI-powered voice assistant for phone calls",
        metadata: {
          plan_type: "basic",
          features: "1 personal phone number, live calls, training calls, learning/flashcards, notifications"
        }
      });
      
      // Create $15/month price
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 1500,
        currency: "usd",
        recurring: { interval: "month" }
      });
      
      console.log("[Bootstrap] Created product:", product.id, "with price:", price.id);
      
      res.json({ 
        status: "created", 
        product,
        price 
      });
    } catch (error: any) {
      console.error("[Bootstrap] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fix subscription - find Stripe customer by email and sync to user
  app.all("/api/stripe/fix-subscription", async (req, res) => {
    try {
      const email = req.query.email as string;
      if (!email) {
        return res.status(400).json({ error: "Email required as query param" });
      }
      
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      if (!stripe) {
        return res.status(500).json({ error: "Stripe not configured" });
      }
      
      // Find user in DB
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ error: "User not found in database" });
      }
      
      // Search for customer in Stripe by email
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (customers.data.length === 0) {
        return res.status(404).json({ error: "No Stripe customer found for this email" });
      }
      
      const customer = customers.data[0];
      console.log("[Fix] Found Stripe customer:", customer.id);
      
      // Get active subscriptions
      const subscriptions = await stripe.subscriptions.list({ 
        customer: customer.id, 
        status: 'active',
        limit: 1 
      });
      
      let plan = 'free';
      let subscriptionId = null;
      
      if (subscriptions.data.length > 0) {
        plan = 'basic';
        subscriptionId = subscriptions.data[0].id;
        console.log("[Fix] Found active subscription:", subscriptionId);
      }
      
      // Update user
      await storage.updateUser(user.id, {
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscriptionId,
        plan: plan
      });
      
      console.log("[Fix] Updated user", user.id, "- plan:", plan, "customerId:", customer.id);
      
      res.json({
        status: "fixed",
        userId: user.id,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscriptionId,
        plan: plan
      });
    } catch (error: any) {
      console.error("[Fix] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/checkout", authMiddleware, async (req, res) => {
    try {
      const { priceId } = req.body;
      if (!priceId) {
        return res.status(400).json({ error: "Price ID required" });
      }
      
      const user = await storage.getUser(req.user!.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(user.email, user.id);
        await storage.updateUser(user.id, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }
      
      const host = req.get("host");
      const protocol = req.protocol;
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${protocol}://${host}/app?success=true`,
        `${protocol}://${host}/app?canceled=true`,
        { userId: user.id }
      );
      
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("[Checkout] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get current subscription info
  app.get("/api/subscription", authMiddleware, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json({
        plan: user.plan || "free",
        stripeCustomerId: user.stripeCustomerId || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Billing portal for managing subscription
  app.post("/api/billing-portal", authMiddleware, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      if (!user.stripeCustomerId) {
        return res.status(400).json({ error: "No subscription found" });
      }
      
      const host = req.get("host");
      const protocol = req.protocol;
      const session = await stripeService.createCustomerPortalSession(
        user.stripeCustomerId,
        `${protocol}://${host}/app`
      );
      
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("[BillingPortal] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Phone numbers endpoints - with graceful degradation
  app.get("/api/numbers", authMiddleware, async (req, res) => {
    try {
      const { isDatabaseAvailable } = await import("./db");
      console.log("[Numbers] Fetching for user:", req.user?.id, "dbAvailable:", isDatabaseAvailable());
      if (!isDatabaseAvailable()) {
        return res.json({ numbers: [], warning: "Database temporarily unavailable" });
      }
      const numbers = await storage.getUserPhoneNumbers(req.user!.id);
      console.log("[Numbers] Found:", numbers.length, "numbers for user", req.user!.id);
      res.json({ numbers });
    } catch (error: any) {
      if (error.message.includes("Database not available")) {
        return res.json({ numbers: [], warning: "Database temporarily unavailable" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/numbers/available", authMiddleware, async (req, res) => {
    try {
      const { isDatabaseAvailable } = await import("./db");
      if (!isDatabaseAvailable()) {
        console.log("[Numbers] Database unavailable, returning empty list");
        return res.json({ numbers: [], warning: "Database temporarily unavailable" });
      }
      console.log("[Numbers] Fetching available numbers for user:", req.user?.id);
      const numbers = await storage.getAvailableNumbers();
      console.log("[Numbers] Found:", numbers.length, "available numbers");
      // Don't expose sensitive subaccount tokens to frontend
      const safeNumbers = numbers.map(n => ({
        id: n.id,
        twilioNumber: n.twilioNumber,
        country: n.country,
      }));
      res.json({ numbers: safeNumbers });
    } catch (error: any) {
      console.error("[Numbers] Error fetching available:", error);
      if (error.message.includes("Database not available")) {
        return res.json({ numbers: [], warning: "Database temporarily unavailable" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Debug endpoint for database status - always returns 200
  app.get("/api/admin/db-status", async (_req, res) => {
    const { isDatabaseAvailable, pool } = await import("./db");
    
    const dbAvailable = isDatabaseAvailable();
    let numbersCount = 0;
    let usersCount = 0;
    let userNumbersCount = 0;
    let error = null;
    
    if (dbAvailable && pool) {
      try {
        const usersResult = await pool.query('SELECT COUNT(*) FROM users');
        usersCount = parseInt(usersResult.rows[0].count);
        
        const userNumbersResult = await pool.query('SELECT COUNT(*) FROM user_numbers');
        userNumbersCount = parseInt(userNumbersResult.rows[0].count);
        
        const numbersResult = await pool.query('SELECT COUNT(*) FROM available_numbers');
        numbersCount = parseInt(numbersResult.rows[0].count);
      } catch (e: any) {
        error = e.message;
      }
    } else {
      error = "Database not connected";
    }
    
    // In production, prefer PROD_DATABASE_URL over DATABASE_URL
    const isProduction = process.env.NODE_ENV === "production";
    const dbUrlForDisplay = (isProduction && process.env.PROD_DATABASE_URL)
      ? process.env.PROD_DATABASE_URL
      : process.env.DATABASE_URL;
    
    res.json({
      nodeEnv: process.env.NODE_ENV,
      databaseUrlPrefix: dbUrlForDisplay?.substring(0, 50) + "...",
      isDatabaseAvailable: dbAvailable,
      poolExists: !!pool,
      numbersInPool: numbersCount,
      usersCount,
      userNumbersCount,
      error,
    });
  });

  app.post("/api/admin/seed-numbers", async (req, res) => {
    try {
      console.log("[Admin] Force seeding phone numbers...");
      
      const { isDatabaseAvailable } = await import("./db");
      if (!isDatabaseAvailable()) {
        return res.status(503).json({ error: "Database not connected." });
      }
      
      const existing = await storage.getAllAvailableNumbers();
      if (existing.length > 0) {
        return res.json({ message: `Already have ${existing.length} numbers`, seeded: false });
      }
      
      // Seed data should be provided via TWILIO_NUMBER_POOL environment variable
      const poolData = process.env.TWILIO_NUMBER_POOL;
      if (!poolData) {
        return res.status(400).json({ error: "TWILIO_NUMBER_POOL env var not set" });
      }
      
      const numbersToSeed = JSON.parse(poolData);
      for (const num of numbersToSeed) {
        await storage.seedAvailableNumber(num);
      }
      
      console.log("[Admin] Force seeded", numbersToSeed.length, "numbers");
      res.json({ message: `Seeded ${numbersToSeed.length} numbers`, seeded: true });
    } catch (error: any) {
      console.error("[Admin] Seed error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/numbers", authMiddleware, async (req, res) => {
    try {
      const { numberId, name, type } = req.body;
      if (!numberId || !name) {
        return res.status(400).json({ error: "Number ID and name required" });
      }
      
      const existingNumbers = await storage.getUserPhoneNumbers(req.user!.id);
      const user = await storage.getUser(req.user!.id);
      
      // SIMPLIFIED: Only subscribers can have phone numbers
      const hasSubscription = user?.plan && user.plan !== "free" && user.plan !== "none";
      if (!hasSubscription) {
        return res.status(400).json({ error: "Please subscribe to get a phone number." });
      }
      // Basic plan: 1 number only
      if (existingNumbers.length >= 1) {
        return res.status(400).json({ error: "Basic plan allows only 1 number." });
      }
      
      const phoneNumber = await storage.assignNumber(numberId, req.user!.id, name, type || "personal");
      res.json({ phoneNumber });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/numbers/:id", authMiddleware, async (req, res) => {
    try {
      const { name, activePromptId } = req.body;
      const updated = await storage.updatePhoneNumber(req.params.id, { name, activePromptId });
      if (!updated) {
        return res.status(404).json({ error: "Number not found" });
      }
      res.json({ phoneNumber: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // User prompts endpoints
  app.get("/api/prompts", authMiddleware, async (req, res) => {
    try {
      const prompts = await storage.getUserPrompts(req.user!.id);
      res.json({ prompts });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/prompts/number/:numberId", authMiddleware, async (req, res) => {
    try {
      const prompts = await storage.getPromptsForNumber(req.params.numberId);
      res.json({ prompts });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/prompts", authMiddleware, async (req, res) => {
    try {
      const { name, content, phoneNumberId } = req.body;
      if (!name || !content) {
        return res.status(400).json({ error: "Name and content required" });
      }
      
      const prompt = await storage.createUserPrompt({
        userId: req.user!.id,
        phoneNumberId: phoneNumberId || null,
        name,
        content,
        isActive: false,
      });
      res.json({ prompt });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/prompts/:id", authMiddleware, async (req, res) => {
    try {
      const { name, content, isActive } = req.body;
      const updated = await storage.updateUserPrompt(req.params.id, { name, content, isActive });
      if (!updated) {
        return res.status(404).json({ error: "Prompt not found" });
      }
      res.json({ prompt: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/prompts/:id", authMiddleware, async (req, res) => {
    try {
      await storage.deleteUserPrompt(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Prompt templates (public)
  app.get("/api/templates", async (req, res) => {
    try {
      const templates = await storage.getPromptTemplates();
      res.json({ templates });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Training Mode API - with Zod validation
  const trainingStartSchema = z.object({
    goal: z.string().min(1, "Goal is required"),
    conversationLanguage: z.string().optional().default("en"), // GST speaks this (always EN for now)
    hintLanguage: z.enum(["ru", "es"]).optional().default("ru") // User's native language for translations
  });

  const trainingTurnSchema = z.object({
    sessionId: z.string().uuid("Invalid session ID"),
    hon_text: z.string().min(1, "hon_text is required"),
    goal_override: z.string().optional()
  });

  const trainingResetSchema = z.object({
    sessionId: z.string().uuid("Invalid session ID")
  });

  const callModeSchema = z.object({
    callMode: z.enum(["live", "training", "forwarding"])
  });

  app.post("/training/start", authMiddleware, async (req, res) => {
    try {
      const parsed = trainingStartSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      
      const { goal, conversationLanguage, hintLanguage } = parsed.data;
      const result = await startTrainingSession(goal, conversationLanguage, hintLanguage);
      
      res.json(result);
    } catch (error: any) {
      console.error("[Training] Start error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/training/turn", authMiddleware, async (req, res) => {
    try {
      const parsed = trainingTurnSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      
      const { sessionId, hon_text, goal_override } = parsed.data;
      const result = await processTrainingTurn(sessionId, hon_text, goal_override);
      
      if (result.error && result.error === "Session not found") {
        return res.status(404).json({ error: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("[Training] Turn error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/training/reset", authMiddleware, async (req, res) => {
    try {
      const parsed = trainingResetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      
      const { sessionId } = parsed.data;
      const success = resetTrainingSession(sessionId);
      res.json({ success });
    } catch (error: any) {
      console.error("[Training] Reset error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // STT endpoint for training mode - accepts audio and returns transcribed text
  app.post("/training/stt", authMiddleware, async (req, res) => {
    try {
      const { audio, mimeType } = req.body;
      
      if (!audio) {
        return res.status(400).json({ error: "No audio data provided" });
      }
      
      const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
      if (!DEEPGRAM_API_KEY) {
        return res.status(500).json({ error: "Deepgram API key not configured" });
      }
      
      // Decode base64 audio
      const audioBuffer = Buffer.from(audio, "base64");
      
      // Determine content type
      const contentType = mimeType || "audio/webm";
      
      // Call Deepgram prerecorded API — nova-3 is Deepgram's fastest model for English
      const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&language=en&punctuate=true", {
        method: "POST",
        headers: {
          "Authorization": `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": contentType
        },
        body: audioBuffer
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[STT] Deepgram error:", response.status, errorText);
        return res.status(500).json({ error: "Transcription failed" });
      }
      
      const result = await response.json();
      const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
      
      console.log("[STT] Transcribed:", transcript.substring(0, 50) + (transcript.length > 50 ? "..." : ""));
      
      res.json({ text: transcript });
    } catch (error: any) {
      console.error("[STT] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // TTS endpoint for training mode - generates audio from text via ElevenLabs
  app.post("/training/tts", authMiddleware, async (req, res) => {
    try {
      const { text, voiceType } = req.body;
      
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "No text provided" });
      }
      
      if (text.length > 500) {
        return res.status(400).json({ error: "Text too long (max 500 chars)" });
      }
      
      const voice = voiceType === "hint" ? "hint" : "gst";
      const audioBuffer = await generateTTS(text, voice as "gst" | "hint");
      
      if (!audioBuffer) {
        return res.status(500).json({ error: "TTS generation failed" });
      }
      
      // Return audio as base64
      const audioBase64 = audioBuffer.toString("base64");
      res.json({ 
        audio: audioBase64,
        mimeType: "audio/mpeg"
      });
    } catch (error: any) {
      console.error("[TTS] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // User call mode setting
  app.post("/api/user/call-mode", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const parsed = callModeSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "callMode must be 'live', 'training', or 'forwarding'" });
      }
      
      await db.update(users)
        .set({ callMode: parsed.data.callMode })
        .where(eq(users.id, user.id));
      
      res.json({ success: true, callMode: parsed.data.callMode });
    } catch (error: any) {
      console.error("[User] Call mode update error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
