import { and, eq, gt, like } from "drizzle-orm";
import { sessions } from "@shared/schema";
import { db } from "../db";
import type { MarkerStore } from "./security";

/**
 * Fixed-size, namespaced expiry markers reuse the existing sessions table.
 * No raw credentials, transcripts or instructions are stored here.
 * Revocation expires only integration markers; no existing data is deleted.
 */
export const integrationStore: MarkerStore = {
  async put(marker) {
    await db.insert(sessions).values(marker).onConflictDoNothing();
  },
  async get(id) {
    const [row] = await db.select().from(sessions).where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()))).limit(1);
    return row;
  },
  async consume(id) {
    const [row] = await db.update(sessions).set({ expiresAt: new Date(0) })
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()))).returning();
    return row;
  },
  async list(userId) {
    return db.select().from(sessions).where(and(eq(sessions.userId, userId),
      like(sessions.id, "chatgpt:grant:%"), gt(sessions.expiresAt, new Date())));
  },
  async expire(id, userId) {
    if (!id.startsWith("chatgpt:grant:")) return;
    await db.update(sessions).set({ expiresAt: new Date(0) })
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
  },
};
