import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { voiceLabClones, voiceLabCartesiaClones, voiceLabRuns } from "@shared/schema";
import { withAbsolutePlaybackTimings, type PlaybackOffsets, type VoiceLabTimings } from "./timings";

export type LabTimings = VoiceLabTimings;

export async function getClone(userId: string) {
  const [clone] = await db.select().from(voiceLabClones).where(eq(voiceLabClones.userId, userId)).limit(1);
  return clone ?? null;
}

export async function getCartesiaClone(userId: string) {
  const [clone] = await db.select().from(voiceLabCartesiaClones)
    .where(eq(voiceLabCartesiaClones.userId, userId)).limit(1);
  return clone ?? null;
}

export async function reserveCartesiaClone(userId: string, durationMs: number) {
  const [row] = await db.insert(voiceLabCartesiaClones).values({
    userId, status: "creating", durationMs,
  }).onConflictDoNothing().returning();
  if (row) return row;
  const [retry] = await db.update(voiceLabCartesiaClones).set({
    status: "creating", voiceId: null, durationMs, createdAt: new Date(),
  }).where(and(eq(voiceLabCartesiaClones.userId, userId), eq(voiceLabCartesiaClones.status, "retryable")))
    .returning();
  return retry ?? null;
}

export async function finishCartesiaClone(userId: string, voiceId: string) {
  const [row] = await db.update(voiceLabCartesiaClones).set({ voiceId, status: "ready" })
    .where(and(eq(voiceLabCartesiaClones.userId, userId), eq(voiceLabCartesiaClones.status, "creating")))
    .returning();
  return row;
}

export async function failCartesiaClone(userId: string, status: "retryable" | "uncertain") {
  await db.update(voiceLabCartesiaClones).set({ status })
    .where(and(eq(voiceLabCartesiaClones.userId, userId), eq(voiceLabCartesiaClones.status, "creating")));
}

export async function reserveClone(userId: string, durationMs: number) {
  const [row] = await db.insert(voiceLabClones).values({
    userId, status: "creating", durationMs,
  }).onConflictDoNothing().returning();
  if (row) return row;
  // A provider HTTP 4xx conclusively rejected the create request. Allow a
  // deliberate retry, but never race two retry requests into duplicate clones.
  const [retry] = await db.update(voiceLabClones).set({
    status: "creating",
    voiceId: null,
    durationMs,
    createdAt: new Date(),
  }).where(and(eq(voiceLabClones.userId, userId), eq(voiceLabClones.status, "retryable")))
    .returning();
  return retry ?? null;
}

export async function reserveExistingClone(userId: string, voiceId: string) {
  const [row] = await db.insert(voiceLabClones).values({
    userId, voiceId, status: "ready", durationMs: 0,
  }).onConflictDoNothing().returning();
  if (row) return row;
  // Only a definitively rejected creation may be replaced. The conditional
  // update is atomic, so simultaneous link/create attempts cannot overwrite
  // an existing, creating, or uncertain clone.
  const [retry] = await db.update(voiceLabClones).set({
    voiceId,
    status: "ready",
    durationMs: 0,
    createdAt: new Date(),
  }).where(and(eq(voiceLabClones.userId, userId), eq(voiceLabClones.status, "retryable")))
    .returning();
  return retry ?? null;
}

export async function finishClone(userId: string, voiceId: string, status = "ready") {
  const [row] = await db.update(voiceLabClones)
    .set({ voiceId, status })
    .where(eq(voiceLabClones.userId, userId))
    .returning();
  return row;
}

export async function failClone(userId: string, status: "retryable" | "uncertain") {
  await db.update(voiceLabClones)
    .set({ status })
    .where(and(eq(voiceLabClones.userId, userId), eq(voiceLabClones.status, "creating")));
}

export async function listVoiceLab(userId: string) {
  const [clone] = await db.select().from(voiceLabClones).where(eq(voiceLabClones.userId, userId)).limit(1);
  const runs = await db.select().from(voiceLabRuns)
    .where(eq(voiceLabRuns.userId, userId))
    .orderBy(desc(voiceLabRuns.createdAt))
    .limit(100);
  return { clone: clone ?? null, runs };
}

export async function insertRun(userId: string, values: {
  transcript: string;
  english: string;
  voiceId: string;
  provider: string;
  timings: LabTimings;
}) {
  const [run] = await db.insert(voiceLabRuns).values({ userId, ...values }).returning();
  return run;
}

export async function getRun(userId: string, id: string) {
  const [run] = await db.select().from(voiceLabRuns)
    .where(and(eq(voiceLabRuns.id, id), eq(voiceLabRuns.userId, userId)))
    .limit(1);
  return run ?? null;
}

export async function recordPlayback(userId: string, id: string, details: {
  firstAudioMs: PlaybackOffsets["firstAudioMs"];
  playResult: string;
  elevenlabsRequestMs?: PlaybackOffsets["elevenlabsRequestMs"];
}) {
  const run = await getRun(userId, id);
  if (!run) return null;
  const timings = withAbsolutePlaybackTimings(run.timings as LabTimings, details);
  const [updated] = await db.update(voiceLabRuns).set({
    timings, playResult: details.playResult,
  }).where(and(eq(voiceLabRuns.id, id), eq(voiceLabRuns.userId, userId))).returning();
  return updated ?? null;
}

export function toPublicRun(run: any) {
  return {
    id: run.id,
    transcript: run.transcript,
    english: run.english,
    voiceId: run.voiceId,
    provider: run.provider,
    timings: run.timings,
    playResult: run.playResult,
    createdAt: run.createdAt,
  };
}

export function toPublicClone(clone: any) {
  return clone ? {
    voiceId: clone.voiceId,
    status: clone.status,
    durationMs: clone.durationMs,
    createdAt: clone.createdAt,
  } : null;
}