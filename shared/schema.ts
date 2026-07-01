import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, boolean, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password"),
  language: text("language").notNull().default("ru"),
  forwardingPhone: text("forwarding_phone"),
  userContext: text("user_context"),
  callMode: text("call_mode").notNull().default("live"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").default("free"),
  authProvider: text("auth_provider").default("email"),
  twilioSubaccountSid: text("twilio_subaccount_sid"),
  twilioSubaccountToken: text("twilio_subaccount_token"),
  airatomaWebhookUrl: text("airatoma_webhook_url"),
  liveHintsEnabled: boolean("live_hints_enabled").notNull().default(true),
  translationEnabled: boolean("translation_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  userContext: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  plan: true,
  authProvider: true,
  twilioSubaccountSid: true,
  twilioSubaccountToken: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const phoneNumbers = pgTable("phone_numbers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  twilioNumber: text("twilio_number").notNull().unique(),
  twilioNumberSid: text("twilio_number_sid"),
  name: text("name").notNull(),
  type: text("type").notNull().default("personal"),
  activePromptId: varchar("active_prompt_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPhoneNumberSchema = createInsertSchema(phoneNumbers).omit({
  id: true,
  createdAt: true,
});

export type InsertPhoneNumber = z.infer<typeof insertPhoneNumberSchema>;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;

export const userPrompts = pgTable("user_prompts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  phoneNumberId: varchar("phone_number_id").references(() => phoneNumbers.id),
  name: text("name").notNull(),
  content: text("content").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserPromptSchema = createInsertSchema(userPrompts).omit({
  id: true,
  createdAt: true,
});

export type InsertUserPrompt = z.infer<typeof insertUserPromptSchema>;
export type UserPrompt = typeof userPrompts.$inferSelect;

export const promptTemplates = pgTable("prompt_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  category: text("category").notNull(),
  contentRu: text("content_ru").notNull(),
  contentEn: text("content_en").notNull(),
  contentEs: text("content_es").notNull(),
});

export type PromptTemplate = typeof promptTemplates.$inferSelect;

export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  phoneNumberId: varchar("phone_number_id").references(() => phoneNumbers.id),
  callSid: text("call_sid").notNull().unique(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  direction: text("direction").notNull().default("incoming"),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  transcript: text("transcript"),
  metadata: jsonb("metadata"),
});

export const insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  startedAt: true,
});

export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

// Per-user, per-phone contact memory. Keyed by BOTH user_id and phone_number so
// the same number can hold different history for different TalkHint users.
// Upserted after each call with an AI summary; loaded once per call as
// CONTACT_CONTEXT for continuity.
export const contactMemory = pgTable("contact_memory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  phoneNumber: text("phone_number").notNull(),
  name: text("name"),
  summary: text("summary"),
  notes: text("notes"),
  importance: text("importance"),
  lastCallAt: timestamp("last_call_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userPhoneUnique: uniqueIndex("contact_memory_user_phone_unique").on(table.userId, table.phoneNumber),
}));

export const insertContactMemorySchema = createInsertSchema(contactMemory).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertContactMemory = z.infer<typeof insertContactMemorySchema>;
export type ContactMemory = typeof contactMemory.$inferSelect;

// Static Context: per-user "knowledge cards" (Level 3 of the Personal Context
// System). Small, always-on title + body facts injected into every live hint.
// `cardType` is "project" (portfolio item) or "company" (own business/service
// facts). `sortOrder` is importance (lower = higher priority); ties broken by
// most-recently-updated when truncating to the prompt size cap.
export const knowledgeCards = pgTable("knowledge_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  cardType: text("card_type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userTypeIdx: index("knowledge_cards_user_type_idx").on(table.userId, table.cardType),
}));

export const insertKnowledgeCardSchema = createInsertSchema(knowledgeCards).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertKnowledgeCard = z.infer<typeof insertKnowledgeCardSchema>;
export type KnowledgeCard = typeof knowledgeCards.$inferSelect;
export const KNOWLEDGE_CARD_TYPES = ["project", "company"] as const;
export type KnowledgeCardType = (typeof KNOWLEDGE_CARD_TYPES)[number];

// Auto-built call dialogue library: per-user, per-goal collection of ready-made
// question→answer lines served as the PRIMARY hint source during a call (falls
// through to the live LLM hint path on a miss — no UI change). The whole library
// is one row with a jsonb `entries` array so regeneration/editing replaces the
// array in one write instead of doing ~100 per-row inserts. Saved separately
// per user and per GOAL: each row is one goal (its own `id` is the identity),
// with `goalText` the goal description and `goalType` the domain that drives
// generation guidance + runtime selection. A user can have several goals of the
// same type (e.g. two different booking goals), each with its own library.
export const dialogueLibraries = pgTable("dialogue_libraries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  goalType: text("goal_type").notNull(),
  goalText: text("goal_text").notNull().default(""),
  entries: jsonb("entries").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("dialogue_libraries_user_idx").on(t.userId),
}));

export const DIALOGUE_ENTRY_TYPES = [
  "opening", "discovery", "typical", "objection", "clarifying", "closing",
] as const;
export type DialogueEntryType = (typeof DIALOGUE_ENTRY_TYPES)[number];

// One ready-made line in a dialogue library. `trigger` is the guest
// question/objection this line answers; `variants` are paraphrases that widen
// the runtime match; `answer`/`translation` are the ready-to-read reply and its
// translation; `slot` is the targeted slot (a SlotMap key) or null.
export interface DialogueEntry {
  id: string;
  type: DialogueEntryType;
  trigger: string;
  variants: string[];
  answer: string;
  translation: string;
  slot: string | null;
  sortOrder: number;
}

export const insertDialogueLibrarySchema = createInsertSchema(dialogueLibraries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDialogueLibrary = z.infer<typeof insertDialogueLibrarySchema>;
export type DialogueLibrary = typeof dialogueLibraries.$inferSelect;

export const availableNumbers = pgTable("available_numbers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  twilioNumber: text("twilio_number").notNull().unique(),
  twilioSid: text("twilio_sid").notNull(),
  subaccountSid: text("subaccount_sid"),
  subaccountToken: text("subaccount_token"),
  subaccountName: text("subaccount_name"),
  isAssigned: boolean("is_assigned").notNull().default(false),
  country: text("country").notNull().default("US"),
});

export type AvailableNumber = typeof availableNumbers.$inferSelect;

export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const pendingCalls = pgTable("pending_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  callSid: text("call_sid").notNull().unique(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  status: text("status").notNull().default("ringing"),
  clientType: text("client_type").notNull().default("browser"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type PendingCall = typeof pendingCalls.$inferSelect;

export const deviceTokens = pgTable("device_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  token: text("token").notNull(),
  bundleId: text("bundle_id"),
  appVersion: text("app_version"),
  deviceModel: text("device_model"),
  environment: text("environment").default("production"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("device_tokens_user_idx").on(t.userId),
  tokenUnique: uniqueIndex("device_tokens_token_unique").on(t.token, t.platform),
}));

export const insertDeviceTokenSchema = createInsertSchema(deviceTokens).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;
export type DeviceToken = typeof deviceTokens.$inferSelect;

// Persistent retry queue for outbound AirAtoma webhook deliveries. After a call
// ends its transcript is POSTed to the AirAtoma CRM; if AirAtoma is briefly
// unreachable (timeout, 5xx, network blip) the payload is buffered here and
// retried with backoff so no call summary is lost. AirAtoma dedupes on callId
// (Twilio CallSid), so re-sends are always safe. `status` is "pending" (still to
// deliver / retry), "delivered" (succeeded) or "failed" (retries exhausted).
export const airatomaDeliveries = pgTable("airatoma_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: text("call_id").notNull().unique(),
  payload: jsonb("payload").notNull(),
  targetUrl: text("target_url"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  dueIdx: index("airatoma_deliveries_status_next_idx").on(t.status, t.nextAttemptAt),
}));

export const insertAiratomaDeliverySchema = createInsertSchema(airatomaDeliveries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAiratomaDelivery = z.infer<typeof insertAiratomaDeliverySchema>;
export type AiratomaDelivery = typeof airatomaDeliveries.$inferSelect;
