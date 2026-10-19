import type { Express, RequestHandler } from "express";
import { authMiddleware } from "../auth";

/** Retired permanently: no credentials, providers or dialing code here. */
export function registerLegacyTestCallRoute(app: Express, ownerAuth: RequestHandler = authMiddleware) {
  app.post("/start-call", ownerAuth, (_req, res) => {
    res.status(410).json({ error: "Legacy test calling is disabled. Use confirmed Secretary tasks." });
  });
}
