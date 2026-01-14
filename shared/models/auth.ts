import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

// OAuth session storage table for Replit Auth (connect-pg-simple format)
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const oauthSessions = pgTable(
  "oauth_sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_oauth_session_expire").on(table.expire)]
);

// Replit Auth user data is upserted into main users table via storage.ts
