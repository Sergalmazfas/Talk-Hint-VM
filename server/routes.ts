import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupWebSocket } from "./websocket";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

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

  // Twilio inbound webhook - returns TwiML to start Media Stream
  app.post("/twilio/inbound", (req, res) => {
    const host = req.headers.host || req.hostname;
    const protocol = host.includes("localhost") ? "ws" : "wss";
    const wsUrl = `${protocol}://${host}/media`;
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="both_tracks" />
  </Start>
  <Pause length="60"/>
</Response>`;

    res.type("text/xml").send(twiml);
  });

  // Also support GET for testing
  app.get("/twilio/inbound", (req, res) => {
    const host = req.headers.host || req.hostname;
    const protocol = host.includes("localhost") ? "ws" : "wss";
    const wsUrl = `${protocol}://${host}/media`;
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="both_tracks" />
  </Start>
  <Pause length="60"/>
</Response>`;

    res.type("text/xml").send(twiml);
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
