import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { airatomaDeliveries } from "@shared/schema";

// ---------------------------------------------------------------------------
// REAL-Postgres integration coverage for the airatoma_deliveries storage layer
// (server/storage.ts). The orchestration tests (airatomaRetryWorker.test.ts)
// mock storage, so they never exercise the actual SQL. Here we hit a live DB so
// a regression in the SQL itself is caught:
//   - enqueue inserts a pending row (payload + targetUrl persisted)
//   - re-enqueuing the same callId re-arms ONE row (onConflict dedupe) instead
//     of creating a duplicate
//   - getDueAirAtomaDeliveries returns only pending rows whose next_attempt_at
//     has elapsed, oldest-first, bounded by the limit
//   - the succeeded / retry / failed marks set status, attempts, last error
//
// The dev DB is shared, so every row this test touches is namespaced with a
// unique PREFIX and removed afterwards; assertions filter to PREFIX rows so
// unrelated production data never makes them flaky. When no DB is reachable
// (e.g. CI without Postgres) the whole suite is skipped rather than failing.
// twilioService builds a Twilio client at import time; stub it (not needed here)
// while keeping the REAL ../db so the SQL actually runs.
// ---------------------------------------------------------------------------

vi.mock("../twilioService", () => ({ configureVoiceWebhook: vi.fn() }));

const dbmod = await import("../db");
const { storage } = await import("../storage");
const { db } = dbmod;

await dbmod.dbReady;
const DB_UP = dbmod.isDatabaseAvailable();

const PREFIX = `__test_airatoma_${process.pid}_${Date.now()}_`;
const cid = (name: string) => `${PREFIX}${name}`;

function payloadFor(callId: string, extra: Record<string, unknown> = {}) {
  return { callId, transcript: "Owner: hi", callerName: "Bob", durationSecs: 7, ...extra };
}

async function getByCallId(callId: string) {
  const [row] = await db.select().from(airatomaDeliveries).where(eq(airatomaDeliveries.callId, callId));
  return row;
}

async function cleanup() {
  await db.delete(airatomaDeliveries).where(like(airatomaDeliveries.callId, `${PREFIX}%`));
}

describe.skipIf(!DB_UP)("airatoma_deliveries storage (real Postgres)", () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbmod.pool?.end();
  });

  it("enqueue inserts a pending row with payload + target URL persisted", async () => {
    const callId = cid("insert");
    const url = "https://crm.example.com/hook";

    const row = await storage.enqueueAirAtomaDelivery(payloadFor(callId), url);

    expect(row).toBeDefined();
    expect(row!.callId).toBe(callId);
    expect(row!.status).toBe("pending");
    expect(row!.attempts).toBe(0);
    expect(row!.lastError).toBeNull();
    expect(row!.targetUrl).toBe(url);
    expect((row!.payload as any).callerName).toBe("Bob");

    // It really hit the table (not just an in-memory echo).
    const persisted = await getByCallId(callId);
    expect(persisted).toBeDefined();
    expect(persisted.id).toBe(row!.id);
  });

  it("defaults target URL to null when none is supplied", async () => {
    const callId = cid("nourl");
    const row = await storage.enqueueAirAtomaDelivery(payloadFor(callId));
    expect(row!.targetUrl).toBeNull();
  });

  it("re-enqueuing the same callId re-arms ONE row instead of duplicating", async () => {
    const callId = cid("rearm");

    const first = await storage.enqueueAirAtomaDelivery(payloadFor(callId), "https://a.example.com/h");
    // Simulate prior failed attempts: bump attempts, record an error, push out.
    await storage.markAirAtomaDeliveryRetry(first!.id, 3, new Date(Date.now() + 3_600_000), "http_500");

    // The call ends again -> enqueue with a fresh payload + a different URL.
    const second = await storage.enqueueAirAtomaDelivery(
      payloadFor(callId, { callerName: "Alice" }),
      "https://b.example.com/h",
    );

    // Same physical row, fully re-armed.
    expect(second!.id).toBe(first!.id);
    expect(second!.status).toBe("pending");
    expect(second!.attempts).toBe(0);
    expect(second!.lastError).toBeNull();
    expect(second!.targetUrl).toBe("https://b.example.com/h");
    expect((second!.payload as any).callerName).toBe("Alice");

    // Exactly one row exists for this callId (the unique constraint held).
    const rows = await db.select().from(airatomaDeliveries).where(eq(airatomaDeliveries.callId, callId));
    expect(rows).toHaveLength(1);
  });

  it("getDueAirAtomaDeliveries returns only due pending rows, oldest-first, within the limit", async () => {
    const dueOld = cid("due_old");
    const dueNew = cid("due_new");
    const future = cid("future");
    const delivered = cid("delivered");

    const rOld = await storage.enqueueAirAtomaDelivery(payloadFor(dueOld));
    const rNew = await storage.enqueueAirAtomaDelivery(payloadFor(dueNew));
    const rFuture = await storage.enqueueAirAtomaDelivery(payloadFor(future));
    const rDelivered = await storage.enqueueAirAtomaDelivery(payloadFor(delivered));

    // Deterministic, far-past due times (a day apart >> any tz offset) so their
    // relative order is unambiguous; the future row is not yet due; delivered is
    // excluded by status.
    await storage.markAirAtomaDeliveryRetry(rOld!.id, 1, new Date("2000-01-01T00:00:00Z"), null);
    await storage.markAirAtomaDeliveryRetry(rNew!.id, 1, new Date("2000-01-02T00:00:00Z"), null);
    await storage.markAirAtomaDeliveryRetry(rFuture!.id, 1, new Date(Date.now() + 3_600_000), null);
    await storage.markAirAtomaDeliverySucceeded(rDelivered!.id, 1);

    const due = await storage.getDueAirAtomaDeliveries(1000);
    const ids = due.map((r) => r.callId);
    const mineIds = ids.filter((c) => c.startsWith(PREFIX));

    expect(mineIds).toContain(dueOld);
    expect(mineIds).toContain(dueNew);
    expect(mineIds).not.toContain(future); // next_attempt_at in the future
    expect(mineIds).not.toContain(delivered); // not pending

    // Oldest-first ordering across our rows.
    expect(ids.indexOf(dueOld)).toBeLessThan(ids.indexOf(dueNew));

    // The whole result set is globally ascending by next_attempt_at.
    const times = due.map((r) => new Date(r.nextAttemptAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));

    // The limit is honored (at least our two due rows exist, so 1 means capped).
    const capped = await storage.getDueAirAtomaDeliveries(1);
    expect(capped).toHaveLength(1);
  });

  it("markAirAtomaDeliverySucceeded marks delivered and clears the error", async () => {
    const callId = cid("succ");
    const r = await storage.enqueueAirAtomaDelivery(payloadFor(callId));
    await storage.markAirAtomaDeliveryRetry(r!.id, 2, new Date(), "earlier failure");

    await storage.markAirAtomaDeliverySucceeded(r!.id, 3);

    const row = await getByCallId(callId);
    expect(row.status).toBe("delivered");
    expect(row.attempts).toBe(3);
    expect(row.lastError).toBeNull();
  });

  it("markAirAtomaDeliveryRetry keeps the row pending with attempts + last error recorded", async () => {
    const callId = cid("retry");
    const r = await storage.enqueueAirAtomaDelivery(payloadFor(callId));

    await storage.markAirAtomaDeliveryRetry(r!.id, 1, new Date(Date.now() + 30_000), "http_503");

    const row = await getByCallId(callId);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("http_503");
    expect(row.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("markAirAtomaDeliveryFailed marks the row failed once retries are exhausted", async () => {
    const callId = cid("failed");
    const r = await storage.enqueueAirAtomaDelivery(payloadFor(callId));

    await storage.markAirAtomaDeliveryFailed(r!.id, 8, "http_500");

    const row = await getByCallId(callId);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(8);
    expect(row.lastError).toBe("http_500");

    // A failed row is never returned as due.
    const due = await storage.getDueAirAtomaDeliveries(1000);
    expect(due.map((d) => d.callId)).not.toContain(callId);
  });

  it("getAirAtomaDeliveryStats buckets are internally consistent", async () => {
    const stats = await storage.getAirAtomaDeliveryStats();
    expect(stats.total).toBe(stats.pending + stats.delivered + stats.failed);
    expect(stats.total).toBeGreaterThanOrEqual(0);
  });
});
