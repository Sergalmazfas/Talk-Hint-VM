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
  <Dial answerOnBridge="true" callerId="${TWILIO_PHONE_NUMBER}">
    <Number>${targetNumber}</Number>
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
  <Dial answerOnBridge="true">
    <Number>${targetNumber}</Number>
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

  return httpServer;
}
