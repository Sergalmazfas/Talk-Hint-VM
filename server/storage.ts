import { 
  type Call, type InsertCall, 
  type User, type InsertUser,
  type PhoneNumber, type InsertPhoneNumber,
  type UserPrompt, type InsertUserPrompt,
  type PromptTemplate,
  type AvailableNumber,
  type Session,
  type ContactMemory,
  users, phoneNumbers, userPrompts, promptTemplates, calls, availableNumbers, sessions, contactMemory
} from "@shared/schema";
import { db, pool, isDatabaseAvailable } from "./db";
import { eq, and, sql, gt, desc } from "drizzle-orm";
import { configureVoiceWebhook } from "./twilioService";
import { resolveProductionBaseUrl } from "./baseUrl";

export const MAX_USER_CONTEXT_LENGTH = 4000;

export const memoryUsers = new Map<string, User>();
export const memorySessions = new Map<string, Session>();
export const memoryUsersByEmail = new Map<string, User>();

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  getUserContext(id: string): Promise<string>;
  setUserContext(id: string, context: string): Promise<string>;
  
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
        createdAt: new Date(),
      };
      memoryUsers.set(newUser.id, newUser);
      memoryUsersByEmail.set(newUser.email, newUser);
      console.log("[Storage] Created user in memory:", newUser.id);
      return newUser;
    }
    try {
      const [newUser] = await db.insert(users).values(user).returning();
      return newUser;
    } catch (error) {
      console.error("[Storage] createUser error:", error);
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
      return updated;
    } catch (error) {
      console.error("[Storage] updateUser error:", error);
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
          // Create subaccount first
          console.log(`[Pool] Creating subaccount: ${subaccountName}`);
          const subaccount = await masterClient.api.accounts.create({
            friendlyName: subaccountName
          });
          
          // Create client for subaccount
          const subClient = twilio(subaccount.sid, subaccount.authToken);
          
          const host = process.env.REPLIT_DEPLOYMENT_URL || 'talkhint-v2.replit.app';
          const result = await subClient.incomingPhoneNumbers.create({
            phoneNumber: numbers[0].phoneNumber,
            voiceUrl: `https://${host}/twilio/voice`,
            voiceMethod: 'POST',
            friendlyName: subaccountName
          });
          
          await db.insert(availableNumbers).values({
            twilioNumber: result.phoneNumber,
            twilioSid: result.sid,
            subaccountSid: subaccount.sid,
            subaccountToken: subaccount.authToken,
            subaccountName: subaccountName,
            isAssigned: false,
            country: 'US'
          });
          
          console.log(`[Pool] Purchased ${result.phoneNumber} in subaccount ${subaccountName}`);
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
    const [newCall] = await db.insert(calls).values(call).returning();
    return newCall;
  }
  
  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const [updated] = await db.update(calls).set(updates).where(eq(calls.id, id)).returning();
    return updated;
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
      if (data.name !== undefined) conflictSet.name = data.name;
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
      return row;
    } catch (error) {
      console.error("[Storage] upsertContactMemory error:", error);
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
      return row;
    } catch (error) {
      console.error("[Storage] updateContactMemoryById error:", error);
      return undefined;
    }
  }

  async deleteContactMemoryById(userId: string, id: string): Promise<boolean> {
    if (!isDatabaseAvailable()) return false;
    try {
      const rows = await db.delete(contactMemory)
        .where(and(eq(contactMemory.id, id), eq(contactMemory.userId, userId)))
        .returning();
      return rows.length > 0;
    } catch (error) {
      console.error("[Storage] deleteContactMemoryById error:", error);
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
      return session;
    } catch (error) {
      console.error("[Storage] createSession error:", error);
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
    } catch (error) {
      console.error("[Storage] deleteSession error:", error);
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
    } catch (error) {
      console.error("[Storage] cleanExpiredSessions error:", error);
    }
  }
}

export const storage = new DatabaseStorage();
