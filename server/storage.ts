import { 
  type Call, type InsertCall, 
  type User, type InsertUser,
  type PhoneNumber, type InsertPhoneNumber,
  type UserPrompt, type InsertUserPrompt,
  type PromptTemplate,
  type AvailableNumber,
  type Session,
  type ContactMemory,
  type KnowledgeCard, type InsertKnowledgeCard,
  type AiratomaDelivery,
  type DialogueLibrary, type DialogueEntry,
  users, phoneNumbers, userPrompts, promptTemplates, calls, availableNumbers, sessions, contactMemory, knowledgeCards, airatomaDeliveries, dialogueLibraries
} from "@shared/schema";
import { db, pool, isDatabaseAvailable } from "./db";
import { eq, and, or, sql, gt, lte, desc, asc, getTableColumns } from "drizzle-orm";
import { configureVoiceWebhook } from "./twilioService";
import { resolveProductionBaseUrl } from "./baseUrl";

export const MAX_USER_CONTEXT_LENGTH = 4000;

// ---------------------------------------------------------------------------
// Contact-memory write health + schema-drift detection
//
// The root cause behind missing caller names in production was a silent column
// drift: upsertContactMemory caught the DB error and returned undefined, so
// nothing looked broken while names were never saved. The tracker below makes
// those failures loud (counters + last error surfaced on /api/health) and lets
// us proactively report when the live DB is missing columns the schema declares.
// ---------------------------------------------------------------------------

interface WriteHealth {
  writeSuccesses: number;
  writeFailures: number;
  lastError: {
    at: string;
    operation?: string;
    code?: string;
    message: string;
    table?: string;
    column?: string;
    constraint?: string;
    detail?: string;
    isSchemaDrift: boolean;
  } | null;
}

// Per-table write-health registry. Every silent write path records success or
// failure here so DB failures and schema drift are visible (counters + last
// error surfaced on /api/health) instead of being swallowed by a catch that
// quietly returns undefined/[]/false — the exact pattern behind the missing
// caller-name bug.
const writeHealthByTable: Record<string, WriteHealth> = {};

function getWriteHealthFor(table: string): WriteHealth {
  let health = writeHealthByTable[table];
  if (!health) {
    health = { writeSuccesses: 0, writeFailures: 0, lastError: null };
    writeHealthByTable[table] = health;
  }
  return health;
}

function recordWriteSuccess(table: string): void {
  getWriteHealthFor(table).writeSuccesses += 1;
}

// Postgres SQLSTATE codes that indicate the live DB no longer matches the schema.
const SCHEMA_DRIFT_PG_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "42704", // undefined_object
]);

// Record + loudly log a failed write. Schema-drift pg codes are flagged
// distinctly so a migration gap is obvious vs. a generic DB error.
function recordWriteFailure(table: string, operation: string, error: any): void {
  const health = getWriteHealthFor(table);
  health.writeFailures += 1;
  const code: string | undefined = error?.code;
  const isSchemaDrift = !!code && SCHEMA_DRIFT_PG_CODES.has(code);
  health.lastError = {
    at: new Date().toISOString(),
    operation,
    code,
    message: error?.message ?? String(error),
    table: error?.table ?? table,
    column: error?.column,
    constraint: error?.constraint,
    detail: error?.detail,
    isSchemaDrift,
  };
  if (isSchemaDrift) {
    console.error(
      `[Storage][DRIFT] ${table} write FAILED (${operation}) due to schema drift — the live DB is missing a column/table the schema declares. ` +
        `pgCode=${code} table=${error?.table ?? table} column=${error?.column ?? "?"} ` +
        `constraint=${error?.constraint ?? "-"} detail=${error?.detail ?? "-"} message="${error?.message}". ` +
        `Data is NOT being saved. Check the /api/health drift report and apply the missing DDL.`,
    );
  } else {
    console.error(
      `[Storage] ${operation} FAILED (write to ${table} did not persist) — pgCode=${code ?? "n/a"} ` +
        `table=${error?.table ?? table} column=${error?.column ?? "-"} detail=${error?.detail ?? "-"}:`,
      error,
    );
  }
}

// Snapshot of all per-table write health, for /api/health.
export function getWriteHealth(): Record<string, WriteHealth> {
  const snapshot: Record<string, WriteHealth> = {};
  for (const [table, health] of Object.entries(writeHealthByTable)) {
    snapshot[table] = {
      writeSuccesses: health.writeSuccesses,
      writeFailures: health.writeFailures,
      lastError: health.lastError,
    };
  }
  return snapshot;
}

export function getContactMemoryHealth(): WriteHealth {
  const health = getWriteHealthFor("contact_memory");
  return {
    writeSuccesses: health.writeSuccesses,
    writeFailures: health.writeFailures,
    lastError: health.lastError,
  };
}

export interface TableDriftReport {
  table: string;
  ok: boolean;
  missingColumns: string[];
  error?: string;
}

export interface ContactMemoryDriftReport {
  checked: boolean;
  ok: boolean;
  table: string;
  missingColumns: string[];
  error?: string;
}

export interface SchemaDriftReport {
  checked: boolean;
  ok: boolean;
  tables: TableDriftReport[];
}

// Every app table the Drizzle schema declares, keyed by its live DB table name.
// Drift on any of these can silently break writes, so all of them are checked.
const APP_TABLES: Record<string, any> = {
  users,
  phone_numbers: phoneNumbers,
  user_prompts: userPrompts,
  prompt_templates: promptTemplates,
  calls,
  contact_memory: contactMemory,
  knowledge_cards: knowledgeCards,
  dialogue_libraries: dialogueLibraries,
  available_numbers: availableNumbers,
  sessions,
  airatoma_deliveries: airatomaDeliveries,
};

// Compare the columns the Drizzle schema declares against what actually exists
// in the live DB (information_schema) for every app table. Returns, per table,
// the list of declared columns missing from the live table so drift is visible
// instead of silently breaking writes.
export async function checkSchemaDrift(): Promise<SchemaDriftReport> {
  const tableNames = Object.keys(APP_TABLES);
  if (!isDatabaseAvailable() || !pool) {
    return {
      checked: false,
      ok: true,
      tables: tableNames.map((table) => ({ table, ok: true, missingColumns: [] })),
    };
  }
  try {
    const result = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_name = ANY($1)`,
      [tableNames],
    );
    const liveColumnsByTable = new Map<string, Set<string>>();
    for (const row of result.rows as any[]) {
      const t = row.table_name as string;
      if (!liveColumnsByTable.has(t)) liveColumnsByTable.set(t, new Set());
      liveColumnsByTable.get(t)!.add(row.column_name as string);
    }
    const tables: TableDriftReport[] = tableNames.map((table) => {
      const expectedColumns = Object.values(getTableColumns(APP_TABLES[table])).map(
        (col: any) => col.name as string,
      );
      const liveColumns = liveColumnsByTable.get(table) ?? new Set<string>();
      const missingColumns = expectedColumns.filter((c) => !liveColumns.has(c));
      if (missingColumns.length > 0) {
        console.error(
          `[Storage][DRIFT] ${table} is missing column(s) the schema declares: ${missingColumns.join(", ")}. ` +
            `Writes to this table will fail silently until the DB is migrated.`,
        );
      }
      return { table, ok: missingColumns.length === 0, missingColumns };
    });
    return { checked: true, ok: tables.every((t) => t.ok), tables };
  } catch (error: any) {
    console.error("[Storage][DRIFT] schema drift check failed:", error?.message ?? error);
    return {
      checked: true,
      ok: false,
      tables: tableNames.map((table) => ({
        table,
        ok: false,
        missingColumns: [],
        error: error?.message ?? String(error),
      })),
    };
  }
}

// Compare the columns the Drizzle schema declares for contact_memory against
// what actually exists in the live DB (information_schema). Returns the list of
// declared columns missing from the live table so drift is visible instead of
// silently breaking writes. Kept as a thin wrapper over checkSchemaDrift for
// the contact_memory-specific health report.
export async function checkContactMemoryDrift(): Promise<ContactMemoryDriftReport> {
  const table = "contact_memory";
  const report = await checkSchemaDrift();
  const tableReport = report.tables.find((t) => t.table === table);
  if (!tableReport) {
    return { checked: report.checked, ok: true, table, missingColumns: [] };
  }
  return {
    checked: report.checked,
    ok: tableReport.ok,
    table,
    missingColumns: tableReport.missingColumns,
    error: tableReport.error,
  };
}

export const memoryUsers = new Map<string, User>();
export const memorySessions = new Map<string, Session>();
export const memoryUsersByEmail = new Map<string, User>();

// The JSON body buffered for an AirAtoma delivery (mirrors AirAtomaPayload in
// ./airatomaWebhook; kept structural to avoid a server->shared import cycle).
export interface AirAtomaDeliveryPayload {
  callId: string;
  transcript: string;
  callerName: string;
  durationSecs: number;
  recordingUrl?: string;
}

// Operator-facing counts surfaced on GET /api/health so a backlog or a stuck
// (failed) delivery is visible without reading logs.
export interface AirAtomaDeliveryStats {
  pending: number;
  delivered: number;
  failed: number;
  total: number;
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  getUserContext(id: string): Promise<string>;
  setUserContext(id: string, context: string): Promise<string>;
  getUserCallSettings(id: string): Promise<{ liveHintsEnabled: boolean; translationEnabled: boolean }>;
  setUserCallSettings(id: string, settings: { liveHintsEnabled?: boolean; translationEnabled?: boolean }): Promise<{ liveHintsEnabled: boolean; translationEnabled: boolean }>;
  
  // Phone Numbers
  getPhoneNumber(id: string): Promise<PhoneNumber | undefined>;
  getPhoneNumberByTwilio(twilioNumber: string): Promise<PhoneNumber | undefined>;
  getUserPhoneNumbers(userId: string): Promise<PhoneNumber[]>;
  createPhoneNumber(phoneNumber: InsertPhoneNumber): Promise<PhoneNumber>;
  updatePhoneNumber(id: string, updates: Partial<PhoneNumber>): Promise<PhoneNumber | undefined>;
  
  // User Prompts
  getUserPrompts(userId: string): Promise<UserPrompt[]>;
  getPromptsForNumber(phoneNumberId: string): Promise<UserPrompt[]>;
  createUserPrompt(prompt: InsertUserPrompt): Promise<UserPrompt>;
  updateUserPrompt(id: string, updates: Partial<UserPrompt>): Promise<UserPrompt | undefined>;
  deleteUserPrompt(id: string): Promise<boolean>;
  
  // Prompt Templates
  getPromptTemplates(): Promise<PromptTemplate[]>;
  getPromptTemplate(id: string): Promise<PromptTemplate | undefined>;
  
  // Available Numbers
  getAvailableNumbers(): Promise<AvailableNumber[]>;
  getAllAvailableNumbers(): Promise<AvailableNumber[]>;
  assignNumber(numberId: string, userId: string, name: string, type: string): Promise<PhoneNumber>;
  seedAvailableNumber(data: { id: string; twilioNumber: string; twilioSid: string; country: string; subaccountSid: string; subaccountToken: string; subaccountName: string }): Promise<void>;
  
  // Calls
  getCall(id: string): Promise<Call | undefined>;
  getCallByCallSid(callSid: string): Promise<Call | undefined>;
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined>;
  updateCallTranscriptByCallSid(callSid: string, transcript: string): Promise<void>;
  getUserCalls(userId: string): Promise<Call[]>;
  getAllCalls(): Promise<Call[]>;

  // Contact Memory (per-user, per-phone)
  getContactMemory(userId: string, phoneNumber: string): Promise<ContactMemory | undefined>;
  upsertContactMemory(data: {
    userId: string;
    phoneNumber: string;
    name?: string | null;
    summary?: string | null;
    notes?: string | null;
    importance?: string | null;
    lastCallAt?: Date;
  }): Promise<ContactMemory | undefined>;
  listContactMemories(userId: string): Promise<ContactMemory[]>;
  updateContactMemoryById(userId: string, id: string, fields: {
    name?: string | null;
    summary?: string | null;
    notes?: string | null;
    importance?: string | null;
  }): Promise<ContactMemory | undefined>;
  deleteContactMemoryById(userId: string, id: string): Promise<boolean>;

  // Knowledge Cards (per-user static context: projects + company/services)
  listKnowledgeCards(userId: string): Promise<KnowledgeCard[]>;
  createKnowledgeCard(data: {
    userId: string;
    cardType: string;
    title: string;
    body: string;
    sortOrder?: number;
  }): Promise<KnowledgeCard | undefined>;
  updateKnowledgeCardById(userId: string, id: string, fields: {
    cardType?: string;
    title?: string;
    body?: string;
    sortOrder?: number;
  }): Promise<KnowledgeCard | undefined>;
  deleteKnowledgeCardById(userId: string, id: string): Promise<boolean>;

  // Dialogue libraries (per-user, per-goal auto-built call answer library).
  // Each library is one goal, identified by its own `id`.
  listDialogueLibraries(userId: string): Promise<DialogueLibrary[]>;
  listAllDialogueLibraries(): Promise<DialogueLibrary[]>;
  updateDialogueLibraryEntriesIfUnchanged(userId: string, id: string, entries: DialogueEntry[], expectedUpdatedAt: Date): Promise<DialogueLibrary | undefined>;
  getDialogueLibrary(userId: string, id: string): Promise<DialogueLibrary | undefined>;
  createDialogueLibrary(userId: string, goalType: string, goalText: string, entries: DialogueEntry[]): Promise<DialogueLibrary | undefined>;
  updateDialogueLibrary(userId: string, id: string, patch: { goalType?: string; goalText?: string; entries: DialogueEntry[] }): Promise<DialogueLibrary | undefined>;
  deleteDialogueLibrary(userId: string, id: string): Promise<boolean>;

  // AirAtoma delivery queue (durable retry of the outbound CRM webhook)
  enqueueAirAtomaDelivery(payload: AirAtomaDeliveryPayload, targetUrl?: string | null): Promise<AiratomaDelivery | undefined>;
  getAirAtomaDeliveryByCallId(callId: string): Promise<AiratomaDelivery | undefined>;
  getDueAirAtomaDeliveries(limit: number): Promise<AiratomaDelivery[]>;
  markAirAtomaDeliverySucceeded(id: string, attempts: number): Promise<void>;
  markAirAtomaDeliveryRetry(id: string, attempts: number, nextAttemptAt: Date, error: string | null): Promise<void>;
  markAirAtomaDeliveryFailed(id: string, attempts: number, error: string | null): Promise<void>;
  getAirAtomaDeliveryStats(): Promise<AirAtomaDeliveryStats>;

  // Stripe
  getProduct(productId: string): Promise<any>;
  getSubscription(subscriptionId: string): Promise<any>;
  listProducts(active?: boolean): Promise<any[]>;
  listProductsWithPrices(active?: boolean): Promise<any[]>;
  
  // Sessions
  createSession(id: string, userId: string, expiresAt: Date): Promise<Session>;
  getSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
  cleanExpiredSessions(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    if (!isDatabaseAvailable()) {
      return memoryUsers.get(id);
    }
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user;
    } catch (error) {
      console.error("[Storage] getUser error:", error);
      return memoryUsers.get(id);
    }
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    if (!isDatabaseAvailable()) {
      return memoryUsersByEmail.get(email);
    }
    try {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      return user;
    } catch (error) {
      console.error("[Storage] getUserByEmail error:", error);
      return memoryUsersByEmail.get(email);
    }
  }
  
  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
      return user;
    } catch (error) {
      console.error("[Storage] getUserByStripeCustomerId error:", error);
      return undefined;
    }
  }
  
  async createUser(user: InsertUser): Promise<User> {
    if (!isDatabaseAvailable()) {
      const newUser: User = {
        id: crypto.randomUUID(),
        email: user.email,
        password: user.password || null,
        language: user.language || "ru",
        forwardingPhone: user.forwardingPhone ?? null,
        userContext: null,
        callMode: user.callMode ?? "live",
        plan: "free",
        authProvider: (user as any).authProvider || "email",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        twilioSubaccountSid: null,
        twilioSubaccountToken: null,
        airatomaWebhookUrl: null,
        liveHintsEnabled: true,
        translationEnabled: true,
        createdAt: new Date(),
      };
      memoryUsers.set(newUser.id, newUser);
      memoryUsersByEmail.set(newUser.email, newUser);
      console.log("[Storage] Created user in memory:", newUser.id);
      return newUser;
    }
    try {
      const [newUser] = await db.insert(users).values(user).returning();
      recordWriteSuccess("users");
      return newUser;
    } catch (error) {
      recordWriteFailure("users", "createUser", error);
      const fallbackUser: User = {
        id: crypto.randomUUID(),
        email: user.email,
        password: user.password || null,
        language: user.language || "ru",
        forwardingPhone: user.forwardingPhone ?? null,
        userContext: null,
        callMode: user.callMode ?? "live",
        plan: "free",
        authProvider: (user as any).authProvider || "email",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        twilioSubaccountSid: null,
        twilioSubaccountToken: null,
        airatomaWebhookUrl: null,
        liveHintsEnabled: true,
        translationEnabled: true,
        createdAt: new Date(),
      };
      memoryUsers.set(fallbackUser.id, fallbackUser);
      memoryUsersByEmail.set(fallbackUser.email, fallbackUser);
      return fallbackUser;
    }
  }
  
  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    if (!isDatabaseAvailable()) {
      const user = memoryUsers.get(id);
      if (user) {
        const updated = { ...user, ...updates };
        memoryUsers.set(id, updated);
        memoryUsersByEmail.set(updated.email, updated);
        return updated;
      }
      return undefined;
    }
    try {
      const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
      recordWriteSuccess("users");
      return updated;
    } catch (error) {
      recordWriteFailure("users", "updateUser", error);
      return undefined;
    }
  }

  async getUserContext(id: string): Promise<string> {
    const user = await this.getUser(id);
    return user?.userContext ?? "";
  }

  async setUserContext(id: string, context: string): Promise<string> {
    const trimmed = (context ?? "").slice(0, MAX_USER_CONTEXT_LENGTH);
    const updated = await this.updateUser(id, { userContext: trimmed || null });
    return updated?.userContext ?? "";
  }

  async getUserCallSettings(id: string): Promise<{ liveHintsEnabled: boolean; translationEnabled: boolean }> {
    const user = await this.getUser(id);
    return {
      liveHintsEnabled: user?.liveHintsEnabled ?? true,
      translationEnabled: user?.translationEnabled ?? true,
    };
  }

  async setUserCallSettings(id: string, settings: { liveHintsEnabled?: boolean; translationEnabled?: boolean }): Promise<{ liveHintsEnabled: boolean; translationEnabled: boolean }> {
    const updates: Partial<User> = {};
    if (typeof settings.liveHintsEnabled === "boolean") updates.liveHintsEnabled = settings.liveHintsEnabled;
    if (typeof settings.translationEnabled === "boolean") updates.translationEnabled = settings.translationEnabled;
    const updated = await this.updateUser(id, updates);
    return {
      liveHintsEnabled: updated?.liveHintsEnabled ?? true,
      translationEnabled: updated?.translationEnabled ?? true,
    };
  }
  
  // Phone Numbers
  async getPhoneNumber(id: string): Promise<PhoneNumber | undefined> {
    const [number] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
    return number;
  }
  
  async getPhoneNumberByTwilio(twilioNumber: string): Promise<PhoneNumber | undefined> {
    const [number] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.twilioNumber, twilioNumber));
    return number;
  }
  
  async getUserPhoneNumbers(userId: string): Promise<PhoneNumber[]> {
    return db.select().from(phoneNumbers).where(eq(phoneNumbers.userId, userId));
  }
  
  async createPhoneNumber(phoneNumber: InsertPhoneNumber): Promise<PhoneNumber> {
    const [newNumber] = await db.insert(phoneNumbers).values(phoneNumber).returning();
    return newNumber;
  }
  
  async updatePhoneNumber(id: string, updates: Partial<PhoneNumber>): Promise<PhoneNumber | undefined> {
    const [updated] = await db.update(phoneNumbers).set(updates).where(eq(phoneNumbers.id, id)).returning();
    return updated;
  }
  
  // User Prompts
  async getUserPrompts(userId: string): Promise<UserPrompt[]> {
    return db.select().from(userPrompts).where(eq(userPrompts.userId, userId));
  }
  
  async getPromptsForNumber(phoneNumberId: string): Promise<UserPrompt[]> {
    return db.select().from(userPrompts).where(eq(userPrompts.phoneNumberId, phoneNumberId));
  }
  
  async createUserPrompt(prompt: InsertUserPrompt): Promise<UserPrompt> {
    const [newPrompt] = await db.insert(userPrompts).values(prompt).returning();
    return newPrompt;
  }
  
  async updateUserPrompt(id: string, updates: Partial<UserPrompt>): Promise<UserPrompt | undefined> {
    const [updated] = await db.update(userPrompts).set(updates).where(eq(userPrompts.id, id)).returning();
    return updated;
  }
  
  async deleteUserPrompt(id: string): Promise<boolean> {
    const result = await db.delete(userPrompts).where(eq(userPrompts.id, id));
    return true;
  }
  
  // Prompt Templates
  async getPromptTemplates(): Promise<PromptTemplate[]> {
    return db.select().from(promptTemplates);
  }
  
  async getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
    const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
    return template;
  }
  
  // Available Numbers - returns only 3 random numbers for user selection
  async getAvailableNumbers(): Promise<AvailableNumber[]> {
    return db.select()
      .from(availableNumbers)
      .where(eq(availableNumbers.isAssigned, false))
      .orderBy(sql`RANDOM()`)
      .limit(3);
  }
  
  // Returns ALL available numbers (for admin/debug purposes)
  async getAllAvailableNumbers(): Promise<AvailableNumber[]> {
    return db.select().from(availableNumbers);
  }
  
  async assignNumber(numberId: string, userId: string, name: string, type: string): Promise<PhoneNumber> {
    if (!pool) {
      throw new Error("Database not available");
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const lockResult = await client.query(
        'SELECT * FROM available_numbers WHERE id = $1 AND is_assigned = false FOR UPDATE NOWAIT',
        [numberId]
      );
      
      if (lockResult.rows.length === 0) {
        throw new Error("Number not available");
      }
      
      const avail = lockResult.rows[0];
      
      await client.query(
        'UPDATE available_numbers SET is_assigned = true WHERE id = $1',
        [numberId]
      );
      
      const insertResult = await client.query(
        `INSERT INTO phone_numbers (user_id, twilio_number, name, type) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`,
        [userId, avail.twilio_number, name, type]
      );
      
      const phoneNumber = insertResult.rows[0];
      
      // Create default prompt for the new number
      const defaultPromptName = type === 'work' ? 'Work Assistant' : 'Personal Assistant';
      const defaultPromptContent = type === 'work' 
        ? 'You are a professional work assistant. Help the user with business calls, take notes, and provide relevant suggestions. Be concise and professional.'
        : 'You are a helpful personal assistant. Help the user during phone calls by providing translations, suggestions, and assistance. Be friendly and supportive.';
      
      await client.query(
        `INSERT INTO user_prompts (user_id, phone_number_id, name, content, is_active) 
         VALUES ($1, $2, $3, $4, true)`,
        [userId, phoneNumber.id, defaultPromptName, defaultPromptContent]
      );
      
      await client.query('COMMIT');
      
      // Configure webhook for the assigned number (async, don't block).
      // Resolve the live production URL from env vars instead of guessing a
      // hardcoded host: silently pointing the webhook at the wrong host would
      // break inbound calls for this number with no obvious error.
      const baseUrl = resolveProductionBaseUrl();
      if (!baseUrl) {
        console.warn(
          `[Storage] ⚠️  Skipped webhook config for ${avail.twilio_number}: ` +
          `could not resolve a live production URL. Set PRODUCTION_URL to the ` +
          `live deployed app URL (e.g. https://your-app.replit.app), or ensure ` +
          `REPLIT_DEPLOYMENT_URL / REPLIT_DOMAINS are present.`
        );
      } else {
        const webhookUrl = `${baseUrl}/twilio/voice`;
        configureVoiceWebhook(
          avail.twilio_sid,
          webhookUrl,
          avail.subaccount_sid || undefined,
          avail.subaccount_token || undefined
        ).then(result => {
          if (result.success) {
            console.log(`[Storage] Webhook configured for ${avail.twilio_number}`);
          } else {
            console.error(`[Storage] Webhook config failed for ${avail.twilio_number}: ${result.error}`);
          }
        }).catch(err => {
          console.error("[Storage] Webhook config error:", err.message);
        });
      }
      
      // Check if we need to replenish pool (async, don't wait)
      this.checkAndReplenishPool().catch(err => {
        console.error("[Storage] Pool replenish error:", err.message);
      });
      
      return phoneNumber;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async seedAvailableNumber(data: { id: string; twilioNumber: string; twilioSid: string; country: string; subaccountSid: string; subaccountToken: string; subaccountName: string }): Promise<void> {
    if (!isDatabaseAvailable()) {
      console.log("[Seed] Database not available, skipping seed for", data.twilioNumber);
      return;
    }
    try {
      console.log("[Seed] Inserting number:", data.twilioNumber);
      await db.insert(availableNumbers).values({
        id: data.id,
        twilioNumber: data.twilioNumber,
        twilioSid: data.twilioSid,
        isAssigned: false,
        country: data.country,
        subaccountSid: data.subaccountSid,
        subaccountToken: data.subaccountToken,
        subaccountName: data.subaccountName,
      }).onConflictDoNothing();
      console.log("[Seed] Successfully inserted:", data.twilioNumber);
    } catch (error: any) {
      console.error("[Storage] seedAvailableNumber error:", error.message);
    }
  }
  
  private async checkAndReplenishPool(): Promise<void> {
    const freeCount = await db.select({ count: sql<number>`count(*)` })
      .from(availableNumbers)
      .where(eq(availableNumbers.isAssigned, false));
    
    const available = Number(freeCount[0]?.count || 0);
    console.log(`[Pool] Available numbers: ${available}`);
    
    if (available < 3) {
      console.log("[Pool] Low stock! Purchasing new Florida number...");
      await this.purchaseFloridaNumber();
    }
  }
  
  private async purchaseFloridaNumber(): Promise<void> {
    const twilio = require('twilio');
    const masterClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    const areaCodes = ['305', '786', '954'];
    let purchased = false;
    
    // Get next number for TH-NUM-XXX naming
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(availableNumbers);
    const nextNum = Number(countResult[0]?.count || 0) + 1;
    const subaccountName = `TH-NUM-${String(nextNum).padStart(3, '0')}`;
    
    for (const areaCode of areaCodes) {
      if (purchased) break;
      
      try {
        const numbers = await masterClient.availablePhoneNumbers('US')
          .local
          .list({ areaCode, limit: 1 });
        
        if (numbers.length > 0) {
          const host = process.env.REPLIT_DEPLOYMENT_URL || 'talkhint-v2.replit.app';
          const result = await masterClient.incomingPhoneNumbers.create({
            phoneNumber: numbers[0].phoneNumber,
            voiceUrl: `https://${host}/twilio/voice`,
            voiceMethod: 'POST',
            friendlyName: subaccountName
          });
          
          await db.insert(availableNumbers).values({
            twilioNumber: result.phoneNumber,
            twilioSid: result.sid,
            subaccountSid: null,
            subaccountToken: null,
            subaccountName: subaccountName,
            isAssigned: false,
            country: 'US'
          });
          
          console.log(`[Pool] Purchased ${result.phoneNumber} on main account (slot ${subaccountName})`);
          purchased = true;
        }
      } catch (err: any) {
        console.log(`[Pool] Failed for ${areaCode}:`, err.message);
      }
    }
    
    if (!purchased) {
      console.error("[Pool] Could not purchase any Florida numbers!");
    }
  }
  
  // Calls
  async getCall(id: string): Promise<Call | undefined> {
    const [call] = await db.select().from(calls).where(eq(calls.id, id));
    return call;
  }
  
  async getCallByCallSid(callSid: string): Promise<Call | undefined> {
    const [call] = await db.select().from(calls).where(eq(calls.callSid, callSid));
    return call;
  }
  
  async createCall(call: InsertCall): Promise<Call> {
    try {
      const [newCall] = await db.insert(calls).values(call).returning();
      recordWriteSuccess("calls");
      return newCall;
    } catch (error) {
      // Keep the loud throwing behavior (caller depends on it) but record +
      // log the failure with table/column/pg-code context for visibility.
      recordWriteFailure("calls", "createCall", error);
      throw error;
    }
  }
  
  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    try {
      const [updated] = await db.update(calls).set(updates).where(eq(calls.id, id)).returning();
      recordWriteSuccess("calls");
      return updated;
    } catch (error) {
      recordWriteFailure("calls", "updateCall", error);
      throw error;
    }
  }

  // Persist the running transcript onto the call record, keyed by Twilio CallSid.
  // Called repeatedly during a live call so the transcript survives a crash before
  // the WebSocket close handler runs (the /twilio/status backstop reads it back).
  // Non-throwing — transcript persistence must never break a live call.
  async updateCallTranscriptByCallSid(callSid: string, transcript: string): Promise<void> {
    if (!isDatabaseAvailable()) return;
    try {
      await db.update(calls).set({ transcript }).where(eq(calls.callSid, callSid));
      recordWriteSuccess("calls");
    } catch (error) {
      recordWriteFailure("calls", "updateCallTranscriptByCallSid", error);
    }
  }
  
  async getUserCalls(userId: string): Promise<Call[]> {
    return db.select().from(calls).where(eq(calls.userId, userId));
  }
  
  async getAllCalls(): Promise<Call[]> {
    return db.select().from(calls);
  }

  // Contact Memory (per-user, per-phone)
  async getContactMemory(userId: string, phoneNumber: string): Promise<ContactMemory | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const [row] = await db.select()
        .from(contactMemory)
        .where(and(eq(contactMemory.userId, userId), eq(contactMemory.phoneNumber, phoneNumber)));
      return row;
    } catch (error) {
      console.error("[Storage] getContactMemory error:", error);
      return undefined;
    }
  }

  async upsertContactMemory(data: {
    userId: string;
    phoneNumber: string;
    name?: string | null;
    summary?: string | null;
    notes?: string | null;
    importance?: string | null;
    lastCallAt?: Date;
  }): Promise<ContactMemory | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const now = new Date();
      // Don't overwrite a user-set name on conflict unless one was provided:
      // the post-call summarizer upserts without a name and must not wipe it.
      const conflictSet: Record<string, any> = {
        summary: data.summary ?? null,
        notes: data.notes ?? null,
        importance: data.importance ?? null,
        lastCallAt: data.lastCallAt ?? now,
        updatedAt: now,
      };
      // Auto-fill the name in a single atomic write: keep the existing name when
      // it is already set (non-blank), otherwise take the incoming one. Folding
      // the "only set if empty" rule into COALESCE removes the read-then-write
      // race where two near-simultaneous calls both see "no name" and both
      // write. NULLIF(TRIM(...), '') treats a blank/whitespace stored name as
      // empty so it can still be filled.
      if (data.name !== undefined) {
        conflictSet.name = sql`coalesce(nullif(trim(${contactMemory.name}), ''), ${data.name ?? null})`;
      }
      const [row] = await db.insert(contactMemory)
        .values({
          userId: data.userId,
          phoneNumber: data.phoneNumber,
          name: data.name ?? null,
          summary: data.summary ?? null,
          notes: data.notes ?? null,
          importance: data.importance ?? null,
          lastCallAt: data.lastCallAt ?? now,
        })
        .onConflictDoUpdate({
          target: [contactMemory.userId, contactMemory.phoneNumber],
          set: conflictSet,
        })
        .returning();
      recordWriteSuccess("contact_memory");
      return row;
    } catch (error) {
      recordWriteFailure("contact_memory", "upsertContactMemory", error);
      return undefined;
    }
  }

  async listContactMemories(userId: string): Promise<ContactMemory[]> {
    if (!isDatabaseAvailable()) return [];
    try {
      return await db.select()
        .from(contactMemory)
        .where(eq(contactMemory.userId, userId))
        .orderBy(desc(contactMemory.lastCallAt));
    } catch (error) {
      console.error("[Storage] listContactMemories error:", error);
      return [];
    }
  }

  async updateContactMemoryById(userId: string, id: string, fields: {
    name?: string | null;
    summary?: string | null;
    notes?: string | null;
    importance?: string | null;
  }): Promise<ContactMemory | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const set: Record<string, any> = { updatedAt: new Date() };
      if (fields.name !== undefined) set.name = fields.name;
      if (fields.summary !== undefined) set.summary = fields.summary;
      if (fields.notes !== undefined) set.notes = fields.notes;
      if (fields.importance !== undefined) set.importance = fields.importance;
      const [row] = await db.update(contactMemory)
        .set(set)
        .where(and(eq(contactMemory.id, id), eq(contactMemory.userId, userId)))
        .returning();
      recordWriteSuccess("contact_memory");
      return row;
    } catch (error) {
      recordWriteFailure("contact_memory", "updateContactMemoryById", error);
      return undefined;
    }
  }

  async deleteContactMemoryById(userId: string, id: string): Promise<boolean> {
    if (!isDatabaseAvailable()) return false;
    try {
      const rows = await db.delete(contactMemory)
        .where(and(eq(contactMemory.id, id), eq(contactMemory.userId, userId)))
        .returning();
      recordWriteSuccess("contact_memory");
      return rows.length > 0;
    } catch (error) {
      recordWriteFailure("contact_memory", "deleteContactMemoryById", error);
      return false;
    }
  }
  
  // Knowledge Cards (per-user static context: projects + company/services)
  async listKnowledgeCards(userId: string): Promise<KnowledgeCard[]> {
    if (!isDatabaseAvailable()) return [];
    try {
      return await db.select()
        .from(knowledgeCards)
        .where(eq(knowledgeCards.userId, userId))
        .orderBy(knowledgeCards.sortOrder, desc(knowledgeCards.updatedAt));
    } catch (error) {
      console.error("[Storage] listKnowledgeCards error:", error);
      return [];
    }
  }

  async createKnowledgeCard(data: {
    userId: string;
    cardType: string;
    title: string;
    body: string;
    sortOrder?: number;
  }): Promise<KnowledgeCard | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const [row] = await db.insert(knowledgeCards)
        .values({
          userId: data.userId,
          cardType: data.cardType,
          title: data.title,
          body: data.body,
          sortOrder: data.sortOrder ?? 0,
        })
        .returning();
      recordWriteSuccess("knowledge_cards");
      return row;
    } catch (error) {
      recordWriteFailure("knowledge_cards", "createKnowledgeCard", error);
      return undefined;
    }
  }

  async updateKnowledgeCardById(userId: string, id: string, fields: {
    cardType?: string;
    title?: string;
    body?: string;
    sortOrder?: number;
  }): Promise<KnowledgeCard | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const set: Record<string, any> = { updatedAt: new Date() };
      if (fields.cardType !== undefined) set.cardType = fields.cardType;
      if (fields.title !== undefined) set.title = fields.title;
      if (fields.body !== undefined) set.body = fields.body;
      if (fields.sortOrder !== undefined) set.sortOrder = fields.sortOrder;
      const [row] = await db.update(knowledgeCards)
        .set(set)
        .where(and(eq(knowledgeCards.id, id), eq(knowledgeCards.userId, userId)))
        .returning();
      recordWriteSuccess("knowledge_cards");
      return row;
    } catch (error) {
      recordWriteFailure("knowledge_cards", "updateKnowledgeCardById", error);
      return undefined;
    }
  }

  async deleteKnowledgeCardById(userId: string, id: string): Promise<boolean> {
    if (!isDatabaseAvailable()) return false;
    try {
      const rows = await db.delete(knowledgeCards)
        .where(and(eq(knowledgeCards.id, id), eq(knowledgeCards.userId, userId)))
        .returning();
      recordWriteSuccess("knowledge_cards");
      return rows.length > 0;
    } catch (error) {
      recordWriteFailure("knowledge_cards", "deleteKnowledgeCardById", error);
      return false;
    }
  }

  // Dialogue libraries (per-user, per-goal auto-built call answer library)
  async listDialogueLibraries(userId: string): Promise<DialogueLibrary[]> {
    if (!isDatabaseAvailable()) return [];
    try {
      return await db.select()
        .from(dialogueLibraries)
        .where(eq(dialogueLibraries.userId, userId))
        .orderBy(dialogueLibraries.goalType, dialogueLibraries.createdAt);
    } catch (error) {
      console.error("[Storage] listDialogueLibraries error:", error);
      return [];
    }
  }

  // All libraries across ALL users — used only by the startup grounding
  // remediation pass, never exposed through user-facing routes.
  async listAllDialogueLibraries(): Promise<DialogueLibrary[]> {
    if (!isDatabaseAvailable()) return [];
    try {
      return await db.select().from(dialogueLibraries).orderBy(dialogueLibraries.createdAt);
    } catch (error) {
      console.error("[Storage] listAllDialogueLibraries error:", error);
      return [];
    }
  }

  // Optimistic-concurrency variant used by the startup grounding remediation:
  // replaces `entries` ONLY when the row's updatedAt still matches the value
  // read at scan time. If the user edited/regenerated the library in the
  // meantime, the WHERE clause misses, we return undefined, and the caller
  // skips — the user's newer version is never overwritten by a stale snapshot.
  async updateDialogueLibraryEntriesIfUnchanged(
    userId: string,
    id: string,
    entries: DialogueEntry[],
    expectedUpdatedAt: Date,
  ): Promise<DialogueLibrary | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const [row] = await db.update(dialogueLibraries)
        .set({ entries, updatedAt: new Date() })
        .where(and(
          eq(dialogueLibraries.userId, userId),
          eq(dialogueLibraries.id, id),
          eq(dialogueLibraries.updatedAt, expectedUpdatedAt),
        ))
        .returning();
      if (row) recordWriteSuccess("dialogue_libraries");
      return row;
    } catch (error) {
      recordWriteFailure("dialogue_libraries", "updateDialogueLibraryEntriesIfUnchanged", error);
      return undefined;
    }
  }

  async getDialogueLibrary(userId: string, id: string): Promise<DialogueLibrary | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const [row] = await db.select()
        .from(dialogueLibraries)
        .where(and(eq(dialogueLibraries.userId, userId), eq(dialogueLibraries.id, id)))
        .limit(1);
      return row;
    } catch (error) {
      console.error("[Storage] getDialogueLibrary error:", error);
      return undefined;
    }
  }

  // Create a NEW library (one goal). Its own `id` is the identity, so a user can
  // have several goals of the same goalType without overwriting one another.
  async createDialogueLibrary(userId: string, goalType: string, goalText: string, entries: DialogueEntry[]): Promise<DialogueLibrary | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const [row] = await db.insert(dialogueLibraries)
        .values({ userId, goalType, goalText, entries })
        .returning();
      recordWriteSuccess("dialogue_libraries");
      return row;
    } catch (error) {
      recordWriteFailure("dialogue_libraries", "createDialogueLibrary", error);
      return undefined;
    }
  }

  // Replace the whole library for one goal (by id) — regeneration and editing
  // both swap the entire entries array in one write, so there are never stale
  // per-row leftovers. Scoped by userId so a user can only touch their own rows.
  async updateDialogueLibrary(userId: string, id: string, patch: { goalType?: string; goalText?: string; entries: DialogueEntry[] }): Promise<DialogueLibrary | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const set: Record<string, unknown> = { entries: patch.entries, updatedAt: new Date() };
      if (patch.goalType !== undefined) set.goalType = patch.goalType;
      if (patch.goalText !== undefined) set.goalText = patch.goalText;
      const [row] = await db.update(dialogueLibraries)
        .set(set)
        .where(and(eq(dialogueLibraries.userId, userId), eq(dialogueLibraries.id, id)))
        .returning();
      recordWriteSuccess("dialogue_libraries");
      return row;
    } catch (error) {
      recordWriteFailure("dialogue_libraries", "updateDialogueLibrary", error);
      return undefined;
    }
  }

  async deleteDialogueLibrary(userId: string, id: string): Promise<boolean> {
    if (!isDatabaseAvailable()) return false;
    try {
      const rows = await db.delete(dialogueLibraries)
        .where(and(eq(dialogueLibraries.userId, userId), eq(dialogueLibraries.id, id)))
        .returning();
      recordWriteSuccess("dialogue_libraries");
      return rows.length > 0;
    } catch (error) {
      recordWriteFailure("dialogue_libraries", "deleteDialogueLibrary", error);
      return false;
    }
  }

  // Stripe queries (direct Stripe API; no sync schema)
  async getProduct(productId: string): Promise<any> {
    const { getUncachableStripeClient } = await import("./stripeClient");
    const stripe = await getUncachableStripeClient();
    if (!stripe) return null;
    try {
      return await stripe.products.retrieve(productId);
    } catch (err) {
      console.error("[Storage] getProduct error:", (err as Error).message);
      return null;
    }
  }

  async getSubscription(subscriptionId: string): Promise<any> {
    const { getUncachableStripeClient } = await import("./stripeClient");
    const stripe = await getUncachableStripeClient();
    if (!stripe) return null;
    try {
      return await stripe.subscriptions.retrieve(subscriptionId);
    } catch (err) {
      console.error("[Storage] getSubscription error:", (err as Error).message);
      return null;
    }
  }

  async listProducts(active = true): Promise<any[]> {
    const { getUncachableStripeClient } = await import("./stripeClient");
    const stripe = await getUncachableStripeClient();
    if (!stripe) return [];
    try {
      const products = await stripe.products.list({ active, limit: 100 });
      return products.data;
    } catch (err) {
      console.error("[Storage] listProducts error:", (err as Error).message);
      return [];
    }
  }

  async listProductsWithPrices(active = true): Promise<any[]> {
    const { getUncachableStripeClient } = await import("./stripeClient");
    const stripe = await getUncachableStripeClient();
    if (!stripe) {
      console.log("[Storage] No Stripe client available");
      return [];
    }
    try {
      const products = await stripe.products.list({ active, limit: 20 });
      const rows: any[] = [];
      for (const p of products.data) {
        const prices = await stripe.prices.list({ product: p.id, active: true, limit: 10 });
        if (prices.data.length === 0) {
          rows.push({
            product_id: p.id,
            product_name: p.name,
            product_description: p.description,
            product_metadata: p.metadata,
            price_id: null,
            unit_amount: null,
            currency: null,
            recurring: null,
          });
        } else {
          for (const pr of prices.data) {
            rows.push({
              product_id: p.id,
              product_name: p.name,
              product_description: p.description,
              product_metadata: p.metadata,
              price_id: pr.id,
              unit_amount: pr.unit_amount,
              currency: pr.currency,
              recurring: pr.recurring,
            });
          }
        }
      }
      return rows;
    } catch (err) {
      console.error("[Storage] listProductsWithPrices error:", (err as Error).message);
      return [];
    }
  }
  
  // Sessions
  async createSession(id: string, userId: string, expiresAt: Date): Promise<Session> {
    if (!isDatabaseAvailable()) {
      const session: Session = { id, userId, expiresAt, createdAt: new Date() };
      memorySessions.set(id, session);
      console.log("[Storage] Created session in memory:", id);
      return session;
    }
    try {
      const [session] = await db.insert(sessions).values({ id, userId, expiresAt }).returning();
      recordWriteSuccess("sessions");
      return session;
    } catch (error) {
      recordWriteFailure("sessions", "createSession", error);
      const session: Session = { id, userId, expiresAt, createdAt: new Date() };
      memorySessions.set(id, session);
      return session;
    }
  }
  
  async getSession(id: string): Promise<Session | undefined> {
    if (!isDatabaseAvailable()) {
      const session = memorySessions.get(id);
      if (session && session.expiresAt > new Date()) {
        return session;
      }
      return undefined;
    }
    try {
      const [session] = await db.select().from(sessions).where(
        and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()))
      );
      return session;
    } catch (error) {
      console.error("[Storage] getSession error:", error);
      const memSession = memorySessions.get(id);
      if (memSession && memSession.expiresAt > new Date()) {
        return memSession;
      }
      return undefined;
    }
  }
  
  async deleteSession(id: string): Promise<void> {
    if (!isDatabaseAvailable()) {
      memorySessions.delete(id);
      return;
    }
    try {
      await db.delete(sessions).where(eq(sessions.id, id));
      recordWriteSuccess("sessions");
    } catch (error) {
      recordWriteFailure("sessions", "deleteSession", error);
      memorySessions.delete(id);
    }
  }
  
  async cleanExpiredSessions(): Promise<void> {
    if (!isDatabaseAvailable()) {
      const now = new Date();
      Array.from(memorySessions.entries()).forEach(([id, session]) => {
        if (session.expiresAt < now) {
          memorySessions.delete(id);
        }
      });
      return;
    }
    try {
      await db.delete(sessions).where(sql`${sessions.expiresAt} < NOW()`);
      recordWriteSuccess("sessions");
    } catch (error) {
      recordWriteFailure("sessions", "cleanExpiredSessions", error);
    }
  }

  // AirAtoma delivery queue -------------------------------------------------
  // Buffer a finished call's webhook payload so it can be retried if AirAtoma is
  // unreachable. Keyed by callId (one row per call); a re-ended call refreshes
  // the payload and re-arms the row as pending so it sends again.
  async enqueueAirAtomaDelivery(payload: AirAtomaDeliveryPayload, targetUrl?: string | null): Promise<AiratomaDelivery | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const [row] = await db.insert(airatomaDeliveries)
        .values({
          callId: payload.callId,
          payload,
          targetUrl: targetUrl ?? null,
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
        })
        .onConflictDoUpdate({
          target: airatomaDeliveries.callId,
          set: {
            payload,
            targetUrl: targetUrl ?? null,
            status: "pending",
            attempts: 0,
            lastError: null,
            nextAttemptAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();
      recordWriteSuccess("airatoma_deliveries");
      return row;
    } catch (error) {
      recordWriteFailure("airatoma_deliveries", "enqueueAirAtomaDelivery", error);
      return undefined;
    }
  }

  // Look up a delivery row by callId. Used by the /twilio/status backstop to avoid
  // double-enqueuing a call the WebSocket-close path already handled.
  async getAirAtomaDeliveryByCallId(callId: string): Promise<AiratomaDelivery | undefined> {
    if (!isDatabaseAvailable()) return undefined;
    try {
      const [row] = await db.select()
        .from(airatomaDeliveries)
        .where(eq(airatomaDeliveries.callId, callId))
        .limit(1);
      return row;
    } catch (error) {
      console.error("[Storage] getAirAtomaDeliveryByCallId error:", error);
      return undefined;
    }
  }

  // Rows that are still pending and whose backoff window has elapsed, oldest first.
  async getDueAirAtomaDeliveries(limit: number): Promise<AiratomaDelivery[]> {
    if (!isDatabaseAvailable()) return [];
    try {
      return await db.select()
        .from(airatomaDeliveries)
        .where(and(
          eq(airatomaDeliveries.status, "pending"),
          lte(airatomaDeliveries.nextAttemptAt, new Date()),
        ))
        .orderBy(asc(airatomaDeliveries.nextAttemptAt))
        .limit(limit);
    } catch (error) {
      console.error("[Storage] getDueAirAtomaDeliveries error:", error);
      return [];
    }
  }

  async markAirAtomaDeliverySucceeded(id: string, attempts: number): Promise<void> {
    if (!isDatabaseAvailable()) return;
    try {
      await db.update(airatomaDeliveries)
        .set({ status: "delivered", attempts, lastError: null, updatedAt: new Date() })
        .where(eq(airatomaDeliveries.id, id));
      recordWriteSuccess("airatoma_deliveries");
    } catch (error) {
      recordWriteFailure("airatoma_deliveries", "markAirAtomaDeliverySucceeded", error);
    }
  }

  async markAirAtomaDeliveryRetry(id: string, attempts: number, nextAttemptAt: Date, error: string | null): Promise<void> {
    if (!isDatabaseAvailable()) return;
    try {
      await db.update(airatomaDeliveries)
        .set({ status: "pending", attempts, lastError: error, nextAttemptAt, updatedAt: new Date() })
        .where(eq(airatomaDeliveries.id, id));
      recordWriteSuccess("airatoma_deliveries");
    } catch (err) {
      recordWriteFailure("airatoma_deliveries", "markAirAtomaDeliveryRetry", err);
    }
  }

  async markAirAtomaDeliveryFailed(id: string, attempts: number, error: string | null): Promise<void> {
    if (!isDatabaseAvailable()) return;
    try {
      await db.update(airatomaDeliveries)
        .set({ status: "failed", attempts, lastError: error, updatedAt: new Date() })
        .where(eq(airatomaDeliveries.id, id));
      recordWriteSuccess("airatoma_deliveries");
    } catch (err) {
      recordWriteFailure("airatoma_deliveries", "markAirAtomaDeliveryFailed", err);
    }
  }

  async getAirAtomaDeliveryStats(): Promise<AirAtomaDeliveryStats> {
    const empty: AirAtomaDeliveryStats = { pending: 0, delivered: 0, failed: 0, total: 0 };
    if (!isDatabaseAvailable()) return empty;
    try {
      const rows = await db.select({
        status: airatomaDeliveries.status,
        count: sql<number>`count(*)::int`,
      })
        .from(airatomaDeliveries)
        .groupBy(airatomaDeliveries.status);
      const stats = { ...empty };
      for (const r of rows as Array<{ status: string; count: number }>) {
        const n = Number(r.count) || 0;
        if (r.status === "pending") stats.pending = n;
        else if (r.status === "delivered") stats.delivered = n;
        else if (r.status === "failed") stats.failed = n;
        stats.total += n;
      }
      return stats;
    } catch (error) {
      console.error("[Storage] getAirAtomaDeliveryStats error:", error);
      return empty;
    }
  }
}

export const storage = new DatabaseStorage();
