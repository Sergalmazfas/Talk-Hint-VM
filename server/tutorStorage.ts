// Storage for tutor practice sessions and Call Memories. Kept in a small
// dedicated module (direct Drizzle usage) — all rows are strictly per-user
// scoped, and practice history is never deleted (lifecycle only).
import { db, isDatabaseAvailable } from "./db";
import { tutorSessions, tutorCallMemories, type TutorSession, type TutorCallMemory } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import type { EngineCallMemory } from "./tutorEngine";

export async function createTutorSessionRow(
  userId: string,
  engineSessionId: string,
  tutorId: string,
  scenarioId: string,
): Promise<TutorSession | undefined> {
  if (!isDatabaseAvailable()) return undefined;
  const [row] = await db
    .insert(tutorSessions)
    .values({ userId, engineSessionId, tutorId, scenarioId })
    .returning();
  return row;
}

export async function endTutorSessionRow(userId: string, engineSessionId: string): Promise<void> {
  if (!isDatabaseAvailable()) return;
  await db
    .update(tutorSessions)
    .set({ status: "ENDED", endedAt: new Date() })
    .where(and(eq(tutorSessions.userId, userId), eq(tutorSessions.engineSessionId, engineSessionId)));
}

export async function listTutorSessions(userId: string): Promise<TutorSession[]> {
  if (!isDatabaseAvailable()) return [];
  return db.select().from(tutorSessions).where(eq(tutorSessions.userId, userId)).orderBy(desc(tutorSessions.createdAt));
}

export async function getTutorSessionRow(userId: string, engineSessionId: string): Promise<TutorSession | undefined> {
  if (!isDatabaseAvailable()) return undefined;
  const [row] = await db
    .select()
    .from(tutorSessions)
    .where(and(eq(tutorSessions.userId, userId), eq(tutorSessions.engineSessionId, engineSessionId)));
  return row;
}

export async function getCallMemoryByEngineSession(userId: string, engineSessionId: string): Promise<TutorCallMemory | undefined> {
  if (!isDatabaseAvailable()) return undefined;
  const [row] = await db
    .select()
    .from(tutorCallMemories)
    .where(and(eq(tutorCallMemories.userId, userId), eq(tutorCallMemories.engineSessionId, engineSessionId)));
  return row;
}

export async function saveCallMemory(
  userId: string,
  engineSessionId: string,
  mem: EngineCallMemory,
): Promise<TutorCallMemory | undefined> {
  if (!isDatabaseAvailable()) return undefined;
  const [row] = await db
    .insert(tutorCallMemories)
    .values({
      userId,
      engineSessionId,
      objective: mem.objective,
      facts: mem.facts,
      questions: mem.questions,
      rehearsedAnswers: mem.rehearsed_answers,
      vocabulary: mem.vocabulary,
      uncertainFacts: mem.uncertain_facts,
    })
    .returning();
  return row;
}

export async function listCallMemories(userId: string): Promise<TutorCallMemory[]> {
  if (!isDatabaseAvailable()) return [];
  return db
    .select()
    .from(tutorCallMemories)
    .where(eq(tutorCallMemories.userId, userId))
    .orderBy(desc(tutorCallMemories.createdAt));
}

export async function getCallMemory(userId: string, id: string): Promise<TutorCallMemory | undefined> {
  if (!isDatabaseAvailable()) return undefined;
  const [row] = await db
    .select()
    .from(tutorCallMemories)
    .where(and(eq(tutorCallMemories.userId, userId), eq(tutorCallMemories.id, id)));
  return row;
}

// Edit fields — allowed ONLY while the memory awaits confirmation.
export async function updateCallMemoryFields(
  userId: string,
  id: string,
  fields: Partial<Pick<EngineCallMemory, "objective" | "facts" | "questions" | "rehearsed_answers" | "vocabulary" | "uncertain_facts">>,
): Promise<TutorCallMemory | undefined> {
  if (!isDatabaseAvailable()) return undefined;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof fields.objective === "string") patch.objective = fields.objective;
  if (Array.isArray(fields.facts)) patch.facts = fields.facts.map(String);
  if (Array.isArray(fields.questions)) patch.questions = fields.questions.map(String);
  if (Array.isArray(fields.rehearsed_answers)) patch.rehearsedAnswers = fields.rehearsed_answers.map(String);
  if (Array.isArray(fields.vocabulary)) patch.vocabulary = fields.vocabulary.map(String);
  if (Array.isArray(fields.uncertain_facts)) patch.uncertainFacts = fields.uncertain_facts.map(String);
  const [row] = await db
    .update(tutorCallMemories)
    .set(patch)
    .where(and(
      eq(tutorCallMemories.userId, userId),
      eq(tutorCallMemories.id, id),
      eq(tutorCallMemories.status, "MEMORY_CONFIRMATION"),
    ))
    .returning();
  return row;
}

// Explicit user confirmation — the ONLY way a memory becomes REAL_CALL_READY.
export async function confirmCallMemory(userId: string, id: string): Promise<TutorCallMemory | undefined> {
  if (!isDatabaseAvailable()) return undefined;
  const [row] = await db
    .update(tutorCallMemories)
    .set({ status: "REAL_CALL_READY", confirmedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(tutorCallMemories.userId, userId),
      eq(tutorCallMemories.id, id),
      eq(tutorCallMemories.status, "MEMORY_CONFIRMATION"),
    ))
    .returning();
  return row;
}

// Atomically CLAIM the single eligible memory (most recently confirmed
// REAL_CALL_READY row) for a starting real call: the same UPDATE that selects
// it also stamps used_at + COMPLETED and records the call SID, so two
// concurrent calls can never both inject the same memory, and a crash after
// injection can never make it reusable. Returns the claimed row or undefined.
export async function claimActiveCallMemory(userId: string, callSid?: string): Promise<TutorCallMemory | undefined> {
  if (!isDatabaseAvailable()) return undefined;
  // Conditional-update loop: pick the current candidate, then transition it
  // only if it is STILL REAL_CALL_READY. A lost race just retries once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [candidate] = await db
      .select()
      .from(tutorCallMemories)
      .where(and(eq(tutorCallMemories.userId, userId), eq(tutorCallMemories.status, "REAL_CALL_READY")))
      .orderBy(desc(tutorCallMemories.confirmedAt))
      .limit(1);
    if (!candidate) return undefined;
    const [claimed] = await db
      .update(tutorCallMemories)
      .set({ status: "COMPLETED", usedAt: new Date(), usedCallSid: callSid ?? null, updatedAt: new Date() })
      .where(and(
        eq(tutorCallMemories.userId, userId),
        eq(tutorCallMemories.id, candidate.id),
        eq(tutorCallMemories.status, "REAL_CALL_READY"),
      ))
      .returning();
    if (claimed) return claimed;
  }
  return undefined;
}

// Render a confirmed Call Memory as a prompt context block for live hints.
// Uncertain facts are explicitly flagged so the model never asserts them.
export function formatCallMemoryBlock(mem: TutorCallMemory): string {
  const lines: string[] = [];
  lines.push("TRAINING_CALL_MEMORY (user-confirmed preparation from a practice session — use it to ground suggestions):");
  if (mem.objective) lines.push(`Objective: ${mem.objective}`);
  const list = (label: string, v: unknown) => {
    const arr = Array.isArray(v) ? (v as unknown[]).map(String).filter((s) => s.trim()) : [];
    if (arr.length) lines.push(`${label}:\n${arr.map((s) => `- ${s}`).join("\n")}`);
  };
  list("Facts", mem.facts);
  list("Questions the user wants to ask", mem.questions);
  list("Rehearsed answers", mem.rehearsedAnswers);
  list("Key vocabulary", mem.vocabulary);
  const unc = Array.isArray(mem.uncertainFacts) ? (mem.uncertainFacts as unknown[]).map(String).filter((s) => s.trim()) : [];
  if (unc.length) {
    lines.push(`UNCERTAIN facts (NOT confirmed — never assert these; prompt the user to verify instead):\n${unc.map((s) => `- ${s}`).join("\n")}`);
  }
  return lines.join("\n");
}
