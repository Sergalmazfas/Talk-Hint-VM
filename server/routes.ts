import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupWebSocket } from "./websocket";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupWebSocket(httpServer);

  // In production, TalkHint UI is at dist/talkhint/ui (same level as bundled code)
  // In development, it's at ../talkhint/ui relative to server/
  const talkhintUiPath = process.env.NODE_ENV === "production" 
    ? path.join(__dirname, "talkhint/ui")
    : path.join(__dirname, "../talkhint/ui");
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

  // Twilio webhook - returns TwiML to start Media Stream and optionally dial target
  app.post("/twilio/inbound", (req, res) => {
    const host = req.headers.host || req.hostname;
    const wsUrl = `wss://${host}/twilio-stream`;
    
    // Get target number from query params (passed from /start-call)
    const targetNumber = req.query.target as string | undefined;
    
    console.log("[TwiML] Generating TwiML, stream URL:", wsUrl);
    console.log("[TwiML] Target number:", targetNumber || "none (direct call)");
    
    let twiml: string;
    
    if (targetNumber) {
      // This is a bridge call: HON's phone answered, now dial TARGET
      // Audio from both parties streams to TalkHint
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="both_tracks" />
  </Start>
  <Say>Connecting your call.</Say>
  <Dial callerId="${TWILIO_PHONE_NUMBER}">
    <Number>${targetNumber}</Number>
  </Dial>
</Response>`;
    } else {
      // Direct outbound call to target - just stream and keep open
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="both_tracks" />
  </Start>
  <Say>Connected to TalkHint. Your call is being monitored.</Say>
  <Pause length="300"/>
</Response>`;
    }

    console.log("[TwiML] Sending TwiML");
    res.type("text/xml").send(twiml);
  });

  // Also support GET for testing
  app.get("/twilio/inbound", (req, res) => {
    const host = req.headers.host || req.hostname;
    const wsUrl = `wss://${host}/twilio-stream`;
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="both_tracks" />
  </Start>
  <Say>TalkHint streaming active.</Say>
  <Pause length="300"/>
</Response>`;

    res.type("text/xml").send(twiml);
  });

  // Start outbound call via Twilio REST API
  // Two modes:
  // 1. Direct: Calls TARGET directly, streams audio (one-party call for testing)
  // 2. Bridge: Calls HON first, then dials TARGET when HON answers (two-party call)
  app.post("/start-call", async (req, res) => {
    try {
      const { target, hon, mode = 'direct' } = req.body;
      
      if (!target) {
        return res.status(400).json({ error: "Target phone number is required" });
      }
      
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
        return res.status(500).json({ error: "Twilio credentials not configured" });
      }
      
      const host = req.headers.host || req.hostname;
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      
      let toNumber: string;
      let webhookUrl: string;
      
      if (mode === 'bridge' && hon) {
        // Bridge mode: Call HON first, TwiML will dial TARGET
        toNumber = hon;
        webhookUrl = `https://${host}/twilio/inbound?target=${encodeURIComponent(target)}`;
        console.log(`[start-call] Bridge mode: calling HON ${hon}, will connect to TARGET ${target}`);
      } else {
        // Direct mode: Call TARGET directly, just stream audio
        toNumber = target;
        webhookUrl = `https://${host}/twilio/inbound`;
        console.log(`[start-call] Direct mode: calling TARGET ${target}`);
      }
      
      console.log(`[start-call] To: ${toNumber}, From: ${TWILIO_PHONE_NUMBER}`);
      console.log(`[start-call] Webhook: ${webhookUrl}`);
      
      const twilioResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: toNumber,
            From: TWILIO_PHONE_NUMBER!,
            Url: webhookUrl,
          }),
        }
      );
      
      if (!twilioResponse.ok) {
        const errorText = await twilioResponse.text();
        console.error('[start-call] Twilio API error:', errorText);
        return res.status(twilioResponse.status).json({ error: 'Failed to initiate call', details: errorText });
      }
      
      const callData = await twilioResponse.json();
      console.log(`[start-call] Call initiated: ${callData.sid}`);
      
      res.json({ 
        success: true, 
        callSid: callData.sid,
        status: callData.status,
        target,
        mode 
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

  return httpServer;
}
