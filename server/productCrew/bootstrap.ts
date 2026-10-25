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
    // Owner explicitly approved public read/write on this Dev MCP only.
    // Resolve the existing single workspace, never an owner supplied by a caller.
    publicDevOwner: async () => {
      await dbReady;
      if (!pool) throw Error("Database unavailable");
      const { rows } = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
        (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
      if (rows.length !== 1) throw Object.assign(Error("Public Dev workspace is ambiguous or unavailable"), { status: 503 });
      return rows[0].owner_key;
    },
  });
}
