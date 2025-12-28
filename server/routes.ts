import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupWebSocket, TALKHINT_GLOBAL_PROMPT, PREP_PROMPT, LANGUAGE_NAMES } from "./websocket";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import twilio from "twilio";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupWebSocket(httpServer);

  // TalkHint UI - serve from dist/talkhint/ui (where bundled SDK is)
  // In production, use cwd-relative path; in dev, use __dirname-relative
  const talkhintUiPath = process.env.NODE_ENV === "production"
    ? path.join(process.cwd(), "dist/talkhint/ui")
    : path.join(__dirname, "../dist/talkhint/ui");
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

  // Generate Twilio Access Token for browser-based calling
  app.get("/api/token", (req, res) => {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return res.status(500).json({ error: "Twilio credentials not configured" });
    }

    const identity = "browser-user";
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: false,
    });

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY || TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_SECRET || TWILIO_AUTH_TOKEN,
      { identity }
    );

    token.addGrant(voiceGrant);

    console.log("[Token] Generated access token for:", identity);
    res.json({ token: token.toJwt(), identity });
  });

  // TwiML webhook for browser-initiated calls
  app.post("/twilio/voice", (req, res) => {
    // The To parameter comes from device.connect({ params: { To: number } })
    const targetNumber = req.body.To || req.body.to || req.query.To || req.query.to;
    const callSid = req.body.CallSid;
    
    console.log("[TwiML Voice] ===== BROWSER CALL =====");
    console.log("[TwiML Voice] CallSid:", callSid);
    console.log("[TwiML Voice] To:", targetNumber);
    console.log("[TwiML Voice] From:", req.body.From);

    // Get the host for WebSocket URL
    const host = req.get("host") || "localhost:5000";
    const wsProtocol = req.protocol === "https" ? "wss" : "wss";
    const streamUrl = `${wsProtocol}://${host}/twilio-stream`;

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twimlResponse = new VoiceResponse();

    if (targetNumber && targetNumber.startsWith("+")) {
      // Start media stream for transcription
      const start = twimlResponse.start();
      start.stream({
        url: streamUrl,
        track: "both_tracks"
      });
      
      const dial = twimlResponse.dial({ 
        callerId: TWILIO_PHONE_NUMBER,
        answerOnBridge: true 
      });
      dial.number(targetNumber);
      console.log("[TwiML Voice] Dialing:", targetNumber, "with stream:", streamUrl);
    } else {
      twimlResponse.say("Please provide a valid phone number starting with plus.");
      console.log("[TwiML Voice] Invalid or missing target:", targetNumber);
    }

    res.type("text/xml").send(twimlResponse.toString());
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

  // PREP MODE Chat endpoint - for rehearsal before calls
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, language = "ru", isLiveCall = false, goal = "" } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }
      
      const langName = LANGUAGE_NAMES[language] || "Russian";
      
      // Use PREP_PROMPT when no live call, otherwise use GLOBAL prompt
      const systemPrompt = isLiveCall 
        ? `${TALKHINT_GLOBAL_PROMPT}

USER'S GOAL: ${goal || "Have a successful phone conversation"}
USER'S NATIVE LANGUAGE: ${langName}

The user is in a LIVE call. Give them immediate, ready-to-say phrases.`
        : `${PREP_PROMPT}

${TALKHINT_GLOBAL_PROMPT}

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

  return httpServer;
}
