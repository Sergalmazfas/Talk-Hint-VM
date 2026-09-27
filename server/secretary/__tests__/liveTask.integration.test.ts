import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { secretaryTasks, users } from "@shared/schema";

const dbmod = await import("../../db");
const tasks = await import("../tasks");
const { db } = dbmod;
await dbmod.dbReady;
const DB_UP = dbmod.isDatabaseAvailable();

let userId = "";
const phoneNumber = "+19545551234";
const instruction = "Ask about the returned deposit.";
const sid = () => `CA${randomUUID().replace(/-/g, "")}`;
const intent = (clientRequestId = randomUUID()) => ({
  phoneNumber, instruction, clientRequestId,
});

describe.skipIf(!DB_UP)("Secretary live owner lock (real Postgres; no phone calls)", () => {
  beforeAll(async () => {
    const [user] = await db.insert(users).values({
      email: `__secretary_live_test_${randomUUID()}@example.com`,
    }).returning();
    userId = user.id;
  });

  beforeEach(async () => {
    // Previous test's completed attempt may still be inside the 3-second window.
    await db.update(secretaryTasks).set({ dialStartedAt: new Date(Date.now() - 5_000) })
      .where(eq(secretaryTasks.userId, userId));
  });

  afterAll(async () => {
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await dbmod.pool?.end();
  });

  it.each([
    ["completed", "completed"],
    ["failed", "failed"],
    ["busy", "busy"],
    ["no-answer", "no_answer"],
    ["canceled", "cancelled"],
  ])("releases the owner after %s and allows a new request ID", async (providerStatus, expected) => {
    const first = await tasks.createLiveSecretaryTask(userId, intent());
    const callSid = sid();
    await tasks.attachSecretaryCall(first.task.id, callSid);
    // Simulate a call that began beyond the short technical cooldown.
    await db.update(secretaryTasks).set({ dialStartedAt: new Date(Date.now() - 5_000) })
      .where(eq(secretaryTasks.id, first.task.id));
    const finish = await tasks.finishSecretaryAttempt(first.task.id, callSid, providerStatus);
    if (providerStatus === "completed") {
      expect(finish?.status).toBe("finalizing");
      await db.update(secretaryTasks).set({ finalizationDeadlineAt: new Date(Date.now() - 1_000) })
        .where(eq(secretaryTasks.id, first.task.id));
      await tasks.finishSecretaryAttempt(first.task.id, callSid, providerStatus);
    }
    expect((await tasks.getSecretaryTaskById(first.task.id))?.status).toBe(expected);
    expect((await tasks.createLiveSecretaryTask(userId, intent(first.task.clientRequestId!))).created).toBe(false);
    const next = await tasks.createLiveSecretaryTask(userId, intent());
    expect(next.created).toBe(true);
    expect(next.task.id).not.toBe(first.task.id);
    await tasks.markSecretaryPreDialFailed(next.task.id);
  });

  it("does not count confirmed pre-dial failures toward a daily budget, but applies the short cooldown", async () => {
    for (let i = 0; i < 4; i++) {
      const attempt = await tasks.createLiveSecretaryTask(userId, intent());
      expect((await tasks.markSecretaryPreDialFailed(attempt.task.id))?.status).toBe("failed");
      expect((await tasks.createLiveSecretaryTask(userId, intent(attempt.task.clientRequestId!))).created).toBe(false);
      await expect(tasks.createLiveSecretaryTask(userId, intent())).rejects.toMatchObject({
        status: 429, code: "SECRETARY_COOLDOWN",
      });
      await db.update(secretaryTasks).set({ dialStartedAt: new Date(Date.now() - 5_000) })
        .where(eq(secretaryTasks.id, attempt.task.id));
    }
    const next = await tasks.createLiveSecretaryTask(userId, intent());
    expect(next.created).toBe(true);
    await tasks.markSecretaryPreDialFailed(next.task.id);
  });

  it("keeps a separate three-attempt rolling budget for the scheduled queue", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T19:00:00Z"));
    try {
      // The live attempts above must not exhaust scheduled tasks.
      const queued = await tasks.createSecretaryTask(userId, { phoneNumber, instruction });
      const claimed = await tasks.claimNextSecretaryTask(userId);
      expect(claimed?.id).toBe(queued.id);
      expect(claimed?.status).toBe("starting");
      await tasks.markSecretaryPreDialFailed(queued.id);
      for (let i = 0; i < 2; i++) {
        const task = await tasks.createSecretaryTask(userId, { phoneNumber, instruction });
        const next = await tasks.claimNextSecretaryTask(userId);
        expect(next?.id).toBe(task.id);
        await tasks.markSecretaryPreDialFailed(task.id);
      }
      const fourth = await tasks.createSecretaryTask(userId, { phoneNumber, instruction });
      expect(await tasks.claimNextSecretaryTask(userId)).toBeUndefined();
      expect((await tasks.getSecretaryTaskById(fourth.id))?.status).toBe("queued");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the short cooldown for a fresh ID but safely recovers the same ID", async () => {
    const first = await tasks.createLiveSecretaryTask(userId, intent());
    const callSid = sid();
    await tasks.attachSecretaryCall(first.task.id, callSid);
    await tasks.finishSecretaryAttempt(first.task.id, callSid, "busy");
    expect((await tasks.createLiveSecretaryTask(userId, intent(first.task.clientRequestId!))).created).toBe(false);
    await expect(tasks.createLiveSecretaryTask(userId, intent())).rejects.toMatchObject({
      status: 429, code: "SECRETARY_COOLDOWN", retryAfterSeconds: expect.any(Number),
    });
    await db.update(secretaryTasks).set({ dialStartedAt: new Date(Date.now() - 5_000) })
      .where(eq(secretaryTasks.id, first.task.id));
    const next = await tasks.createLiveSecretaryTask(userId, intent());
    expect(next.created).toBe(true);
    await tasks.markSecretaryPreDialFailed(next.task.id);
  });

  it("allows only one active task per owner across racing new IDs and deduplicates the same ID", async () => {
    const [first, second] = await Promise.allSettled([
      tasks.createLiveSecretaryTask(userId, intent()),
      tasks.createLiveSecretaryTask(userId, intent()),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const active = (outcomes.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof tasks.createLiveSecretaryTask>>>).value;
    const original = await tasks.getSecretaryTaskById(active.task.id);
    const [repeatA, repeatB] = await Promise.all([
      tasks.createLiveSecretaryTask(userId, intent(original!.clientRequestId!)),
      tasks.createLiveSecretaryTask(userId, intent(original!.clientRequestId!)),
    ]);
    expect(repeatA.task.id).toBe(active.task.id);
    expect(repeatB.task.id).toBe(active.task.id);
    expect(repeatA.created).toBe(false);
    expect(repeatB.created).toBe(false);
    await tasks.markSecretaryPreDialFailed(active.task.id);
  });

  it("holds an ambiguous no-SID result, then releases it through the bounded watchdog", async () => {
    const attempt = await tasks.createLiveSecretaryTask(userId, intent());
    await expect(tasks.createLiveSecretaryTask(userId, intent())).rejects.toMatchObject({ status: 409 });
    await db.update(secretaryTasks).set({ dialStartedAt: new Date(Date.now() - 3 * 60_000) })
      .where(eq(secretaryTasks.id, attempt.task.id));
    expect(await tasks.expireAmbiguousSecretaryStarts(userId)).toBe(1);
    expect((await tasks.getSecretaryTaskById(attempt.task.id))?.status).toBe("unknown");
    const next = await tasks.createLiveSecretaryTask(userId, intent());
    expect(next.created).toBe(true);
    await tasks.markSecretaryPreDialFailed(next.task.id);
  });

  it.each(["ringing", "connected"])("releases a %s task without a terminal callback after the bounded call timeout", async (status) => {
    const attempt = await tasks.createLiveSecretaryTask(userId, intent());
    await tasks.attachSecretaryCall(attempt.task.id, sid());
    await db.update(secretaryTasks).set({
      status, dialStartedAt: new Date(Date.now() - 9 * 60_000),
    }).where(eq(secretaryTasks.id, attempt.task.id));
    await expect(tasks.createLiveSecretaryTask(userId, intent())).rejects.toMatchObject({ status: 409 });
    expect(await tasks.expireStaleSecretaryCalls(userId)).toBe(1);
    expect((await tasks.getSecretaryTaskById(attempt.task.id))?.status).toBe("unknown");
    const next = await tasks.createLiveSecretaryTask(userId, intent());
    expect(next.created).toBe(true);
    await tasks.markSecretaryPreDialFailed(next.task.id);
  });

  it("releases a repeatedly unfinalizable call without losing its transcript or claiming success", async () => {
    const attempt = await tasks.createLiveSecretaryTask(userId, intent());
    const callSid = sid();
    await tasks.attachSecretaryCall(attempt.task.id, callSid);
    await db.update(secretaryTasks).set({
      transcript: "Other party: We received the request.",
      dialStartedAt: new Date(Date.now() - 10 * 60_000),
    }).where(eq(secretaryTasks.id, attempt.task.id));
    expect((await tasks.finishSecretaryAttempt(attempt.task.id, callSid, "completed"))?.status).toBe("finalizing");
    expect(await tasks.expireStaleSecretaryFinalizations(userId)).toBe(0);
    await expect(tasks.createLiveSecretaryTask(userId, intent())).rejects.toMatchObject({ status: 409 });
    // A stuck/repeatedly renewed settlement claim cannot finish the report.
    await db.update(secretaryTasks).set({
      finalizationDeadlineAt: new Date(Date.now() - 5 * 60_000),
      finalizationClaimedAt: new Date(),
    }).where(eq(secretaryTasks.id, attempt.task.id));
    for (let i = 0; i < 2; i++) {
      expect((await tasks.finishSecretaryAttempt(attempt.task.id, callSid, "completed"))?.status).toBe("finalizing");
    }
    expect(await tasks.expireStaleSecretaryFinalizations(userId)).toBe(1);
    const terminal = await tasks.getSecretaryTaskById(attempt.task.id);
    expect(terminal).toMatchObject({
      status: "unknown", outcome: "unknown",
      transcript: "Other party: We received the request.",
      callSid,
    });
    expect((await tasks.createLiveSecretaryTask(userId, intent(attempt.task.clientRequestId!))).created).toBe(false);
    const next = await tasks.createLiveSecretaryTask(userId, intent());
    expect(next.created).toBe(true);
    await tasks.markSecretaryPreDialFailed(next.task.id);
  });
});