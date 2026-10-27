import { pgTable, text, jsonb, timestamp, integer, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

// Private execution state, never the public Product Crew catalogue.
export const callLabControls = pgTable("call_lab_controls", {
  key: text("key").primaryKey(), // environment:owner UUID
  environment: text("environment").notNull(),
  ownerId: text("owner_id").notNull(),
  recipient: text("recipient").notNull(),
  connectionId: text("connection_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
  watchdog: jsonb("watchdog").notNull().default({}),
});
export const callLabJobs = pgTable("call_lab_jobs", {
  key: text("key").primaryKey(), // sha256(environment, owner, call, report version)
  environment: text("environment").notNull(),
  ownerId: text("owner_id").notNull(),
  callSid: text("call_sid").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  source: jsonb("source"),
  report: jsonb("report"),
  journal: jsonb("journal").notNull().default([]),
}, table => [index("call_lab_jobs_scope").on(table.environment, table.ownerId, table.status)]);
export const callLabOutbox = pgTable("call_lab_outbox", {
  key: text("key").primaryKey().references(() => callLabJobs.key, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  ownerId: text("owner_id").notNull(),
  messageId: text("message_id").notNull(),
  status: text("status").notNull().default("prepared"),
  gmailId: text("gmail_id"),
  reconcileCount: integer("reconcile_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("call_lab_message_id_unique").on(table.messageId)]);
