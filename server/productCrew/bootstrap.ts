import type { Express } from "express";
import { registerProductCrew } from "./routes";
import { PgModelRepository } from "../projectModel/repository";
import { integrationStore } from "../chatgpt/store";
import { dbReady, pool, isDevDatabase } from "../db";
import { isBenchmarkAdmin, requireBenchmarkAdmin } from "../benchmark/adminGate";
import { storage } from "../storage";
export function registerDevProductCrew(app: Express) {
  // No publication, production endpoints, phone client or Secretary OAuth changes.
  if (process.env.NODE_ENV !== "development" || !isDevDatabase || !process.env.REPLIT_DEV_DOMAIN) return;
  const repo = new PgModelRepository(async () => { await dbReady; if (!pool) throw Error("Database unavailable"); return pool; });
  registerProductCrew(app, {
    origin: `https://${process.env.REPLIT_DEV_DOMAIN}`,
    key: () => process.env.SESSION_SECRET ?? "", repo, store: integrationStore, admin: requireBenchmarkAdmin,
    authorizedOwner: async id => { const user = await storage.getUser(id); return !!user && isBenchmarkAdmin(user.email); },
  });
}
