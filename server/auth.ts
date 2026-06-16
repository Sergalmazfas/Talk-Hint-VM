import { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

const SALT_ROUNDS = 12;
const SESSION_DURATION_MS = 90 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function registerUser(email: string, password: string, language: string = "ru") {
  const existing = await storage.getUserByEmail(email);
  if (existing) {
    throw new Error("User already exists");
  }
  
  const hashedPassword = await hashPassword(password);
  return storage.createUser({
    email,
    password: hashedPassword,
    language,
  });
}

export async function loginUser(email: string, password: string) {
  const user = await storage.getUserByEmail(email);
  if (!user) {
    throw new Error("User not found");
  }
  
  if (!user.password) {
    throw new Error("Please use Google login for this account");
  }
  
  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    throw new Error("Invalid password");
  }
  
  return user;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        language: string;
        plan: string | null;
      };
    }
  }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await storage.createSession(token, userId, expiresAt);
  return token;
}

export async function getSessionUserId(token: string): Promise<string | undefined> {
  const session = await storage.getSession(token);
  return session?.userId;
}

export async function deleteSession(token: string): Promise<void> {
  await storage.deleteSession(token);
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // First check if user is already set by Replit Auth (passport session)
  if (req.user) {
    const passportUser = req.user as any;
    // Passport stores user with claims.sub as user ID
    const userId = passportUser.id || passportUser.claims?.sub;
    
    console.log("[Auth] Passport user found, userId:", userId, "type:", typeof userId);
    
    if (userId) {
      const user = await storage.getUser(String(userId));
      console.log("[Auth] User lookup result:", user ? `found ${user.email}` : "NOT FOUND");
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          language: user.language,
          plan: user.plan,
        };
        return next();
      }
    }
  }
  
  // Fall back to Bearer token auth
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const token = authHeader.substring(7);
  const userId = await getSessionUserId(token);
  
  if (!userId) {
    return res.status(401).json({ error: "Invalid session" });
  }
  
  const user = await storage.getUser(userId);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }
  
  req.user = {
    id: user.id,
    email: user.email,
    language: user.language,
    plan: user.plan,
  };
  
  next();
}
