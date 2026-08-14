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
  // Diagnostic call recording capability (Task #173): OFF for everyone by
  // default; enabled explicitly per-user (admin/test accounts only). NOT tied
  // to admin role — it is a separate backend policy flag.
  diagnosticRecordingEnabled: boolean("diagnostic_recording_enabled").notNull().default(false),
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

// ---------------------------------------------------------------------------
// AI Tutor (external Tutor Engine) — practice sessions and Call Memory.
//
// TalkHint is a CLIENT of the external Tutor Engine: sessions are created by
// our backend against the engine's /v1/sessions, and after practice the engine
// returns a structured Call Memory. The memory must be reviewed and CONFIRMED
// by the user before it can ever reach a real call's live hints (approved
// lifecycle: PREPARE → PRACTICE → MEMORY_CONFIRMATION → REAL_CALL_READY →
// COMPLETED). Practice history rows are never deleted — "use in a call" only
// stamps used_at and moves the lifecycle to COMPLETED.
// ---------------------------------------------------------------------------

export const TUTOR_MEMORY_STATUSES = [
  "MEMORY_CONFIRMATION", // engine returned the memory; awaiting user review
  "REAL_CALL_READY",     // user confirmed — eligible for injection into a call
  "COMPLETED",           // consumed by a real call (used_at set)
] as const;
export type TutorMemoryStatus = (typeof TUTOR_MEMORY_STATUSES)[number];

export const tutorSessions = pgTable("tutor_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  engineSessionId: text("engine_session_id").notNull(),
  tutorId: text("tutor_id").notNull(),
  scenarioId: text("scenario_id").notNull(),
  mode: text("mode").notNull().default("practice"),
  status: text("status").notNull().default("PRACTICE"), // PRACTICE | ENDED
  createdAt: timestamp("created_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (t) => ({
  userIdx: index("tutor_sessions_user_idx").on(t.userId),
}));

export type TutorSession = typeof tutorSessions.$inferSelect;

// Structured Call Memory returned by the Tutor Engine after practice.
// Shape mirrors the engine contract:
// { objective, facts[], questions[], rehearsed_answers[], vocabulary[], uncertain_facts[] }
export const tutorCallMemories = pgTable("tutor_call_memories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  engineSessionId: text("engine_session_id").notNull(),
  objective: text("objective").notNull().default(""),
  facts: jsonb("facts").notNull().default(sql`'[]'::jsonb`),
  questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
  rehearsedAnswers: jsonb("rehearsed_answers").notNull().default(sql`'[]'::jsonb`),
  vocabulary: jsonb("vocabulary").notNull().default(sql`'[]'::jsonb`),
  uncertainFacts: jsonb("uncertain_facts").notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("MEMORY_CONFIRMATION"),
  // Engine-side reference for simulation sessions (contract v1): the memory
  // group id + version echoed by the engine's call-memory endpoint. Sent BY
  // REFERENCE ONLY when starting a goal-driven simulation — inline facts are
  // rejected by the engine by design. Nullable: memories saved before this
  // column existed have no reference and cannot seed a simulation.
  engineGroupId: text("engine_group_id"),
  engineVersion: integer("engine_version"),
  confirmedAt: timestamp("confirmed_at"),
  usedAt: timestamp("used_at"),
  usedCallSid: text("used_call_sid"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userStatusIdx: index("tutor_call_memories_user_status_idx").on(t.userId, t.status),
  // One memory per practice session per user — makes /end idempotent.
  userSessionUniq: uniqueIndex("tutor_call_memories_user_session_uniq").on(t.userId, t.engineSessionId),
}));

export type TutorCallMemory = typeof tutorCallMemories.$inferSelect;

// ---------------------------------------------------------------------------
// LIVE Ears & Brain Benchmark (admin-only measurement bench, NOT production
// call path). Fixtures = the benchmark corpus (frozen reference transcripts,
// optionally audio for EARS). Runs = every benchmark execution with its full
// config, availability results and scorecards, kept for before/after history.
// ---------------------------------------------------------------------------

export const benchmarkFixtures = pgTable("benchmark_fixtures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  // e.g. bank_dispute, doctor, insurance, ivr_heavy, accent, overlap...
  kind: text("kind").notNull().default("other"),
  // Original user goal for BRAIN runs (natural language).
  goal: text("goal").notNull().default(""),
  // Frozen reference transcript: array of turns
  // { idx, role: "owner"|"guest", text, tStartMs?, tEndMs? }
  referenceTurns: jsonb("reference_turns").notNull().default(sql`'[]'::jsonb`),
  // Critical entities weighted above generic WER for banking calls:
  // { money: string[], dates: string[], digits: string[], names: string[], decisions: string[] }
  criticalEntities: jsonb("critical_entities").notNull().default(sql`'{}'::jsonb`),
  // Confirmed facts / context handed to BRAIN in the frozen envelope.
  confirmedFacts: jsonb("confirmed_facts").notNull().default(sql`'[]'::jsonb`),
  // EARS audio fixture (base64 payload kept in DB so it survives redeploys).
  // null => no real audio exists for this call (EARS impossible, BRAIN fine).
  audioBase64: text("audio_base64"),
  audioFormat: text("audio_format"), // e.g. "mulaw8k" | "wav" | "mp3"
  audioChannels: text("audio_channels"), // "mono" | "dual"
  sourceCallSid: text("source_call_sid"),
  tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const benchmarkRuns = pgTable("benchmark_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // "ears" | "brain" | "replay" | "availability"
  runType: text("run_type").notNull(),
  status: text("status").notNull().default("running"), // running|completed|failed
  // Hash over the fixture corpus used, for before/after comparability.
  corpusHash: text("corpus_hash").notNull().default(""),
  fixtureIds: jsonb("fixture_ids").notNull().default(sql`'[]'::jsonb`),
  // Full candidate/provider/model/prompt config incl. reasoning.effort.
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  promptVersion: text("prompt_version").notNull().default("v1"),
  // Availability-check outcomes per candidate: AVAILABLE | UNAVAILABLE + detail.
  availability: jsonb("availability").notNull().default(sql`'{}'::jsonb`),
  // Per-turn, per-candidate raw results + computed metrics.
  results: jsonb("results").notNull().default(sql`'{}'::jsonb`),
  // Aggregated scorecards (EARS/BRAIN tables, latency distributions, cost).
  scorecard: jsonb("scorecard").notNull().default(sql`'{}'::jsonb`),
  // Human-readable final report (markdown) — winners/bottleneck/recommendation.
  report: text("report"),
  error: text("error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export type BenchmarkFixture = typeof benchmarkFixtures.$inferSelect;
export type InsertBenchmarkFixture = typeof benchmarkFixtures.$inferInsert;
export type BenchmarkRun = typeof benchmarkRuns.$inferSelect;
export type InsertBenchmarkRun = typeof benchmarkRuns.$inferInsert;
