import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// REAL-DATABASE integration coverage for the atomic caller-name auto-fill.
//
// Unlike contactMemoryStorage.test.ts (which swaps in an in-memory fake that
// *emulates* the COALESCE semantics), this suite exercises the genuine Postgres
// `INSERT ... ON CONFLICT DO UPDATE` path in DatabaseStorage.upsertContactMemory
// under real concurrency: many writers race on the same (user_id, phone_number)
// at once, and we prove the originally-set name survives and no duplicate row is
// created.
//
// It connects to whatever DATABASE_URL points at (the dev Postgres in this
// environment). If no database is reachable it skips, so it is safe to run in
// CI. All rows it creates are namespaced under a freshly-created throwaway user
// and cleaned up afterwards.
// ---------------------------------------------------------------------------

import { db, pool, dbReady, isDatabaseAvailable } from "../db";
import { storage } from "../storage";
import { contactMemory, users } from "@shared/schema";
import { eq } from "drizzle-orm";

await dbReady;
const dbUp = isDatabaseAvailable();

const suite = dbUp ? describe : describe.skip;

// A unique-per-run identity so parallel/CI runs never collide with each other.
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let testUserId: string;

async function freshPhone(): Promise<string> {
  // A distinct phone per test keeps the (user, phone) key isolated between cases.
  return `+1${Math.floor(1_000_000_0000 + Math.random() * 8_999_999_999)}`;
}

suite("upsertContactMemory — real Postgres concurrency", () => {
  beforeAll(async () => {
    // The schema declares contact_memory.name; make sure the column exists on
    // whatever database we are pointed at so the COALESCE upsert can run. This
    // is idempotent and keeps the test self-contained / CI-safe.
    await pool!.query("ALTER TABLE contact_memory ADD COLUMN IF NOT EXISTS name text");

    // contact_memory.user_id has a FK to users.id, so create a throwaway user.
    const [u] = await db
      .insert(users)
      .values({ email: `concurrency-test-${runId}@example.invalid`, password: "x" })
      .returning();
    testUserId = u.id;
  });

  afterEach(async () => {
    // Remove this user's contact rows between cases; phones are unique per test
    // but this also guards against a half-written state from a failed assertion.
    await db.delete(contactMemory).where(eq(contactMemory.userId, testUserId));
  });

  afterAll(async () => {
    if (!testUserId) return;
    await db.delete(contactMemory).where(eq(contactMemory.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it("preserves a pre-existing name when many writers race to overwrite it", async () => {
    const phoneNumber = await freshPhone();

    // An earlier call (or the user) already set the canonical name.
    const seeded = await storage.upsertContactMemory({
      userId: testUserId,
      phoneNumber,
      name: "Jonathan",
      summary: "seed",
    });
    expect(seeded!.name).toBe("Jonathan");

    // 12 truly simultaneous upserts each try to write a *different* name plus
    // their own summary. With the atomic COALESCE conflict set, none of them may
    // clobber the established name even though they all run at once.
    const RACERS = 12;
    const results = await Promise.all(
      Array.from({ length: RACERS }, (_, i) =>
        storage.upsertContactMemory({
          userId: testUserId,
          phoneNumber,
          name: `Impostor-${i}`,
          summary: `racer-${i}`,
        }),
      ),
    );

    // Every concurrent writer observed the preserved name.
    for (const r of results) {
      expect(r!.name).toBe("Jonathan");
    }

    // And the persisted state agrees: name intact, exactly one row.
    const rows = await db
      .select()
      .from(contactMemory)
      .where(eq(contactMemory.userId, testUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0].phoneNumber).toBe(phoneNumber);
    expect(rows[0].name).toBe("Jonathan");
  });

  it("converges to one row with a single stable name when racers insert a brand-new contact", async () => {
    const phoneNumber = await freshPhone();

    // No row exists yet. Many writers race the INSERT; exactly one wins the
    // INSERT and the rest fall through to ON CONFLICT DO UPDATE. The COALESCE
    // means the first-inserted name is what sticks for everyone.
    const RACERS = 12;
    await Promise.all(
      Array.from({ length: RACERS }, (_, i) =>
        storage.upsertContactMemory({
          userId: testUserId,
          phoneNumber,
          name: `Caller-${i}`,
          summary: `racer-${i}`,
        }),
      ),
    );

    const rows = await db
      .select()
      .from(contactMemory)
      .where(eq(contactMemory.userId, testUserId));

    // No duplicate despite the concurrent inserts.
    expect(rows).toHaveLength(1);
    const settledName = rows[0].name;
    expect(settledName).toMatch(/^Caller-\d+$/);

    // A second concurrent wave with new names must not change the settled name.
    await Promise.all(
      Array.from({ length: RACERS }, (_, i) =>
        storage.upsertContactMemory({
          userId: testUserId,
          phoneNumber,
          name: `Later-${i}`,
          summary: `wave2-${i}`,
        }),
      ),
    );

    const after = await db
      .select()
      .from(contactMemory)
      .where(eq(contactMemory.userId, testUserId));
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe(settledName);
  });

  it("fills a blank/whitespace name even under concurrent writers", async () => {
    const phoneNumber = await freshPhone();

    // Seed with a whitespace-only name — NULLIF(TRIM(...),'') treats it as empty.
    await storage.upsertContactMemory({
      userId: testUserId,
      phoneNumber,
      name: "   ",
      summary: "seed",
    });

    const RACERS = 8;
    await Promise.all(
      Array.from({ length: RACERS }, (_, i) =>
        storage.upsertContactMemory({
          userId: testUserId,
          phoneNumber,
          name: `Filled-${i}`,
          summary: `racer-${i}`,
        }),
      ),
    );

    const rows = await db
      .select()
      .from(contactMemory)
      .where(eq(contactMemory.userId, testUserId));
    expect(rows).toHaveLength(1);
    // The blank was treated as empty and filled by one of the racers; once set
    // it stays put (a single non-blank value, not whitespace).
    expect(rows[0].name).toMatch(/^Filled-\d+$/);
  });
});
