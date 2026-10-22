import { readFile } from "node:fs/promises";
import { dbReady, pool } from "../server/db";

// No server startup, phone webhooks, credentials or production migrations.
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
  throw new Error("Calendar setup script is development-only; use the Publish schema review in production.");
await dbReady;
if (!pool) throw new Error("Development database unavailable");
try {
  await pool.query(await readFile(new URL("../server/incomingSecretary/calendar-schema.sql", import.meta.url), "utf8"));
  console.log("[calendar-schema] Development tables ready.");
} finally { await pool.end(); }
