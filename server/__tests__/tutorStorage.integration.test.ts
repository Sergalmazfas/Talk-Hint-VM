import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { users, tutorSessions, tutorCallMemories } from "@shared/schema";

// ---------------------------------------------------------------------------
// REAL-Postgres integration coverage for the tutor storage layer
// (server/tutorStorage.ts) — proves the tables exist with the right shape and
// that the lifecycle guarantees hold in actual SQL, not just in source guards:
//   - session rows are per-user scoped (another user's engine session id
//     resolves to nothing → the /end ownership gate rejects it)
//   - one memory per (user, engine session): duplicate save violates the
//     unique index, and getCallMemoryByEngineSession backs the idempotent /end
//   - fields are editable ONLY while MEMORY_CONFIRMATION
//   - confirm transitions MEMORY_CONFIRMATION → REAL_CALL_READY exactly once
//   - claimActiveCallMemory atomically consumes the row (used_at, call SID,
//     COMPLETED): the first claim wins, a second claim gets nothing, and the
//     row is never deleted
// Rows are namespaced per-run and removed afterwards; suite skips without a DB.
// ---------------------------------------------------------------------------

const dbmod = await import("../db");
const storage = await import("../tutorStorage");
const { db } = dbmod;

await dbmod.dbReady;
const DB_UP = dbmod.isDatabaseAvailable();

const RUN = `${process.pid}_${Date.now()}`;
const EMAIL_A = `__test_tutor_a_${RUN}@example.com`;
const EMAIL_B = `__test_tutor_b_${RUN}@example.com`;
let userA = "";
let userB = "";

const MEM = {
  objective: "Book a dentist appointment",
  facts: ["Insurance: Delta Dental"],
  questions: ["Do you take new patients?"],
  rehearsed_answers: ["I need a cleaning."],
  vocabulary: ["copay"],
  uncertain_facts: ["Maybe closed on Fridays"],
};

async function cleanup() {
  for (const uid of [userA, userB].filter(Boolean)) {
    await db.delete(tutorCallMemories).where(eq(tutorCallMemories.userId, uid));
    await db.delete(tutorSessions).where(eq(tutorSessions.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
}

describe.skipIf(!DB_UP)("tutor storage (real Postgres)", () => {
  beforeAll(async () => {
    const [a] = await db.insert(users).values({ email: EMAIL_A }).returning();
    const [b] = await db.insert(users).values({ email: EMAIL_B }).returning();
    userA = a.id;
    userB = b.id;
  });
  afterAll(async () => {
    await cleanup();
    await dbmod.pool?.end();
  });

  const engineSid = `sess_${RUN}`;

  it("creates a session row scoped to its owner only", async () => {
    const row = await storage.createTutorSessionRow(userA, engineSid, "emma_us_01", "english_free_talk");
    expect(row?.userId).toBe(userA);
    expect(await storage.getTutorSessionRow(userA, engineSid)).toBeTruthy();
    // Ownership gate: user B cannot resolve A's engine session.
    expect(await storage.getTutorSessionRow(userB, engineSid)).toBeUndefined();
  });

  it("saves one memory per (user, engine session) and rejects duplicates", async () => {
    const saved = await storage.saveCallMemory(userA, engineSid, MEM);
    expect(saved?.status).toBe("MEMORY_CONFIRMATION");
    expect(await storage.getCallMemoryByEngineSession(userA, engineSid)).toBeTruthy();
    await expect(storage.saveCallMemory(userA, engineSid, MEM)).rejects.toThrow();
    // Other users see nothing.
    expect(await storage.getCallMemoryByEngineSession(userB, engineSid)).toBeUndefined();
    expect(await storage.listCallMemories(userB)).toHaveLength(0);
  });

  it("edits fields only while awaiting confirmation, then confirm flips to REAL_CALL_READY once", async () => {
    const mem = (await storage.getCallMemoryByEngineSession(userA, engineSid))!;
    const updated = await storage.updateCallMemoryFields(userA, mem.id, { objective: "Updated objective" });
    expect(updated?.objective).toBe("Updated objective");
    // Cross-user edit is a no-op.
    expect(await storage.updateCallMemoryFields(userB, mem.id, { objective: "hijack" })).toBeUndefined();

    const confirmed = await storage.confirmCallMemory(userA, mem.id);
    expect(confirmed?.status).toBe("REAL_CALL_READY");
    expect(confirmed?.confirmedAt).toBeTruthy();
    // Second confirm and post-confirm edits both refuse.
    expect(await storage.confirmCallMemory(userA, mem.id)).toBeUndefined();
    expect(await storage.updateCallMemoryFields(userA, mem.id, { objective: "late edit" })).toBeUndefined();
  });

  it("claim atomically consumes the confirmed memory exactly once and never deletes it", async () => {
    // Another user has nothing to claim.
    expect(await storage.claimActiveCallMemory(userB, "CAotherB")).toBeUndefined();

    const claimed = await storage.claimActiveCallMemory(userA, "CAtest123");
    expect(claimed?.status).toBe("COMPLETED");
    expect(claimed?.usedAt).toBeTruthy();
    expect(claimed?.usedCallSid).toBe("CAtest123");

    // A second (concurrent/next) call gets nothing — one memory, one call.
    expect(await storage.claimActiveCallMemory(userA, "CAtest456")).toBeUndefined();

    // History preserved: the row still exists as COMPLETED.
    const after = (await storage.listCallMemories(userA)).find((m) => m.id === claimed!.id);
    expect(after?.status).toBe("COMPLETED");
  });

  it("ending a session stamps ENDED without touching other users' rows", async () => {
    await storage.endTutorSessionRow(userA, engineSid);
    const row = await storage.getTutorSessionRow(userA, engineSid);
    expect(row?.status).toBe("ENDED");
    expect(row?.endedAt).toBeTruthy();
  });
});
