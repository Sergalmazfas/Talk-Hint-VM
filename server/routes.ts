import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupWebSocket, TALKHINT_GOLDEN_PROMPT, PREP_PROMPT, LANGUAGE_NAMES } from "./websocket";
import { LIVE_ANTI_LOOP_RULES } from "@shared/prompts";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import twilio from "twilio";
import crypto from "crypto";
import { registerUser, loginUser, createSession, authMiddleware, deleteSession } from "./auth";
import { stripeService } from "./stripeService";
import { getStripePublishableKey } from "./stripeClient";
import { searchAvailableNumbers, purchasePhoneNumber, configureVoiceWebhook, configureAllPoolWebhooks, configureWebhookByPhone } from "./twilioService";
import { saveSubscription, sendIncomingCallPush, getVapidPublicKey } from "./pushService";
import { startTrainingSession, processTrainingTurn, resetTrainingSession, generateTTS } from "./training";
import { pendingCalls, users, phoneNumbers } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID;
const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
const TWILIO_API_SECRET = process.env.TWILIO_API_SECRET;
const DISABLE_TWILIO_SIGNATURE_CHECK = process.env.DISABLE_TWILIO_SIGNATURE_CHECK === "true";

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

  app.get("/api/calls", async (_req, res) => {
    try {
      const calls = await storage.getAllCalls();
      res.json(calls);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch calls" });
    }
  });

  app.get("/api/calls/:id", async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        return res.status(404).json({ message: "Call not found" });
      }
      res.json(call);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch call" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      websocket: "ready",
    });
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

  // Call accept/reject endpoints for push notification flow
  app.post("/api/call/accept", authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const { callSid } = req.body;

      if (!callSid) {
        return res.status(400).json({ error: "callSid required" });
      }

      // Update the status - the hold loop will detect this and put caller in conference
      await db.update(pendingCalls)
        .set({ status: "accepted" })
        .where(eq(pendingCalls.callSid, callSid));

      const timestamp = new Date().toISOString();
      console.log(`[Call] ${callSid} @ ${timestamp} - Accept received, status changed to 'accepted'`);
      
      // Return conference name so browser can join
      const conferenceRoom = `call-${callSid}`;
      res.json({ success: true, status: "accepted", conference: conferenceRoom });
    } catch (error: any) {
      console.error("[Call] Accept error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/call/reject", authMiddleware, async (req, res) => {
    try {
      const { callSid } = req.body;

      if (!callSid) {
        return res.status(400).json({ error: "callSid required" });
      }

      // Update pending call status
      await db.update(pendingCalls)
        .set({ status: "rejected" })
        .where(eq(pendingCalls.callSid, callSid));

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
        // User accepted - connect caller to user's browser client
        const callUserId = pendingCall.userId || userId;
        const clientIdentity = `user-${callUserId}`;
        console.log(`[Hold] ${callSid} ACCEPTED - route=BROWSER, connecting to client:${clientIdentity}`);
        
        const host = req.get("host") || "talkhint.app";
        const streamUrl = `wss://${host}/twilio-stream`;
        
        // Start media stream for transcription
        const start = twimlResponse.start();
        start.stream({
          url: streamUrl,
          track: "both_tracks"
        }).parameter({ name: "callType", value: "incoming_answered" });
        
        twimlResponse.say({ voice: "alice" }, "Connecting you now.");
        
        // Dial user's browser client (not PSTN forwarding)
        const dial = twimlResponse.dial({
          callerId: pendingCall.fromNumber || "",
          answerOnBridge: true,
          timeout: CALL_TIMEOUT,
          timeLimit: CALL_TIME_LIMIT
        });
        dial.client(clientIdentity);
        
        console.log(`[Hold] ${callSid} DIALING browser client: ${clientIdentity} | streamUrl: ${streamUrl}`);
        
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
    let lineId: number | null = null;
    let lineName: string | null = null;
    
    if (isIncomingToTwilioNumber) {
      try {
        // First try: user-assigned phone numbers
        const phoneNumber = await storage.getPhoneNumberByTwilio(toNumber);
        if (phoneNumber) {
          ownerUserId = phoneNumber.userId;
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

    if (ownerUserId) {
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
      
      // Start media stream for transcription
      const start = twimlResponse.start();
      start.stream({
        url: streamUrl,
        track: "both_tracks"
      });
      
      const dial = twimlResponse.dial({ 
        callerId: userCallerId,
        answerOnBridge: true,
        timeout: CALL_TIMEOUT,
        timeLimit: CALL_TIME_LIMIT
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
  app.post("/twilio/status", validateTwilioSignature, (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    const timestamp = new Date().toISOString();
    
    console.log(`[Twilio Status] ${callSid} @ ${timestamp} - Status: ${callStatus}`);
    console.log(`[Twilio Status] Full body:`, JSON.stringify(req.body));
    
    // Just acknowledge - we can add more logic here later if needed
    res.status(200).send("OK");
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
      
      // Call Deepgram prerecorded API
      const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true", {
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
