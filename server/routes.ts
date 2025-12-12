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

  // Twilio webhook - returns TwiML for outbound calls
  // Starts media stream and dials target number
  app.post("/twilio/inbound", (req, res) => {
    const host = req.headers.host || req.hostname;
    const wsUrl = `wss://${host}/twilio-stream`;
    
    // Get target number from query params (passed from /start-call)
    const targetNumber = req.query.target as string | undefined;
    
    console.log("[TwiML] Generating TwiML");
    console.log("[TwiML] Stream URL:", wsUrl);
    console.log("[TwiML] Target:", targetNumber || "none");
    
    let twiml: string;
    
    if (targetNumber) {
      // Outbound call: start stream and dial target
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="both_tracks" />
  </Start>
  <Dial callerId="${TWILIO_PHONE_NUMBER}">
    <Number>${targetNumber}</Number>
  </Dial>
</Response>`;
    } else {
      // Inbound call: just stream and keep open
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="both_tracks" />
  </Start>
  <Say>Connected to TalkHint.</Say>
  <Pause length="3600"/>
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
  <Pause length="3600"/>
</Response>`;

    res.type("text/xml").send(twiml);
  });

  // Start outbound call via Twilio REST API
  // Calls TARGET directly, webhook returns TwiML with Stream (no Dial needed - already connected)
  app.post("/start-call", async (req, res) => {
    try {
      const { target } = req.body;
      
      if (!target) {
        return res.status(400).json({ error: "Target phone number is required" });
      }
      
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
        return res.status(500).json({ error: "Twilio credentials not configured" });
      }
      
      const host = req.headers.host || req.hostname;
      // Webhook URL - when target answers, this TwiML starts the stream
      const webhookUrl = `https://${host}/twilio/inbound`;
      
      console.log(`[start-call] ===== INITIATING OUTBOUND CALL =====`);
      console.log(`[start-call] Target: ${target}`);
      console.log(`[start-call] From: ${TWILIO_PHONE_NUMBER}`);
      console.log(`[start-call] Webhook: ${webhookUrl}`);
      
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      
      // Call TARGET directly - TwiML will start stream when they answer
      const twilioResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: target, // Call target directly
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
      console.log(`[start-call] Call initiated successfully: ${callData.sid}`);
      console.log(`[start-call] Status: ${callData.status}`);
      
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

  return httpServer;
}
