import { users, type User } from "@shared/schema";
import { db, isDatabaseAvailable } from "../../db";
import { eq } from "drizzle-orm";
import { memoryUsers, memoryUsersByEmail } from "../../storage";

export interface OAuthUserData {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(userData: OAuthUserData): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    if (!isDatabaseAvailable()) {
      return memoryUsers.get(id);
    }
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user;
    } catch (error) {
      console.error("[AuthStorage] Database error in getUser:", error);
      return memoryUsers.get(id);
    }
  }

  async upsertUser(userData: OAuthUserData): Promise<User> {
    const newUser: User = {
      id: userData.id,
      email: userData.email || `oauth_${userData.id}@replit.user`,
      password: null,
      language: "ru",
      forwardingPhone: null,
      userContext: null,
      callMode: "live",
      plan: "free",
      authProvider: "replit",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      twilioSubaccountSid: null,
      twilioSubaccountToken: null,
      airatomaWebhookUrl: null,
      createdAt: new Date(),
    };

    if (!isDatabaseAvailable()) {
      const existing = memoryUsers.get(userData.id);
      if (existing) return existing;
      memoryUsers.set(userData.id, newUser);
      memoryUsersByEmail.set(newUser.email, newUser);
      console.log("[AuthStorage] Created user in memory:", userData.id);
      return newUser;
    }

    try {
      const existing = await this.getUser(userData.id);
      if (existing) {
        return existing;
      }
      
      const [user] = await db
        .insert(users)
        .values({
          id: userData.id,
          email: userData.email || `oauth_${userData.id}@replit.user`,
          password: null,
          language: "ru",
          plan: "free",
          authProvider: "replit",
        } as any)
        .returning();
      console.log("[AuthStorage] Created user in database:", userData.id);
      return user;
    } catch (error) {
      console.error("[AuthStorage] Database error in upsertUser:", error);
      memoryUsers.set(userData.id, newUser);
      memoryUsersByEmail.set(newUser.email, newUser);
      return newUser;
    }
  }
}

export const authStorage = new AuthStorage();
