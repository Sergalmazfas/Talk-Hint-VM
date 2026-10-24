import { readFile } from "node:fs/promises";
import { dbReady, pool } from "../server/db";

// Post-merge development setup only. No startup DDL or production changes.
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
  throw new Error("Secretary comparison setup is development-only.");
await dbReady;
if (!pool) throw new Error("Development database unavailable");
try {
  await pool.query(await readFile(new URL("../server/secretaryLab/comparison-schema.sql", import.meta.url), "utf8"));
  console.log("[secretary-comparisons] Development table ready.");
} finally { await pool.end(); }
