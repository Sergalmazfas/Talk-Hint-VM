import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the Contact Memory storage methods on DatabaseStorage:
//   - upsertContactMemory inserts a row, then UPDATES the same row on a repeat
//     for the same (user_id, phone_number) — no duplicate is created.
//   - getContactMemory is scoped per (user, phone): one user's memory never
//     leaks into another user's, and the same phone under a different user is a
//     distinct row.
//
// The real Postgres / drizzle layer is swapped for a small in-memory fake `db`
// that honours the (user_id, phone_number) unique constraint used by
// onConflictDoUpdate. Heavy module-load side effects (twilio client) are stubbed.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  interface Row {
    id: string;
    userId: string;
    phoneNumber: string;
    summary: string | null;
    notes: string | null;
    importance: string | null;
    lastCallAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }
  const store: { rows: Row[] } = { rows: [] };

  // drizzle columns expose a snake_case `.name`; our rows use camelCase keys.
  const toCamel = (snake: string) =>
    snake.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
  const fieldName = (col: any) => toCamel(String(col?.name ?? col));

  const matchPred = (row: any, pred: any): boolean => {
    if (!pred) return true;
    if (pred.__op === "eq") return row[pred.field] === pred.val;
    if (pred.__op === "and") return pred.conds.every((c: any) => matchPred(row, c));
    return true;
  };

  const eq = (col: any, val: any) => ({ __op: "eq", field: fieldName(col), val });
  const and = (...conds: any[]) => ({ __op: "and", conds });

  let idSeq = 0;

  const db = {
    select() {
      return {
        from() {
          let pred: any = null;
          const run = () =>
            store.rows.filter((r) => matchPred(r, pred)).map((r) => ({ ...r }));
          const result: any = {
            where(p: any) {
              pred = p;
              return result;
            },
            then(resolve: any, reject: any) {
              return Promise.resolve(run()).then(resolve, reject);
            },
          };
          return result;
        },
      };
    },
    insert() {
      return {
        values(v: any) {
          const incoming = Array.isArray(v) ? v : [v];
          // Honour the (userId, phoneNumber) unique index: an existing row with
          // the same key is updated (onConflictDoUpdate) rather than duplicated.
          const apply = (conflictSet: any | null) => {
            const out: any[] = [];
            for (const r of incoming) {
              const existing = store.rows.find(
                (row) => row.userId === r.userId && row.phoneNumber === r.phoneNumber,
              );
              if (existing) {
                if (conflictSet) Object.assign(existing, conflictSet);
                out.push({ ...existing });
              } else {
                const now = new Date();
                const row = {
                  id: `cm-${++idSeq}`,
                  createdAt: now,
                  updatedAt: now,
                  ...r,
                };
                store.rows.push(row);
                out.push({ ...row });
              }
            }
            return out;
          };

          const builder: any = {
            onConflictDoUpdate(args: any) {
              const conflictSet = args?.set ?? {};
              const afterConflict: any = {
                returning() {
                  return Promise.resolve(apply(conflictSet));
                },
                then(resolve: any, reject: any) {
                  return Promise.resolve(apply(conflictSet)).then(resolve, reject);
                },
              };
              return afterConflict;
            },
            returning() {
              return Promise.resolve(apply(null));
            },
            then(resolve: any, reject: any) {
              return Promise.resolve(apply(null)).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
  };

  return { store, db, eq, and };
});

// Keep real drizzle (schema needs sql/pgTable etc.) but route the query
// predicate helpers through the fake so the in-memory store can evaluate them.
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: h.eq, and: h.and };
});

vi.mock("../db", () => ({
  db: h.db,
  pool: {},
  dbReady: Promise.resolve(),
  isDatabaseAvailable: () => true,
  testDatabaseConnection: async () => true,
  isDevDatabase: true,
}));

// twilioService builds a Twilio client at import time; not needed here.
vi.mock("../twilioService", () => ({
  configureVoiceWebhook: vi.fn(),
}));

const { storage } = await import("../storage");

const USER_A = "user-a";
const USER_B = "user-b";
const PHONE = "+15559998888";

beforeEach(() => {
  h.store.rows = [];
});

describe("upsertContactMemory", () => {
  it("inserts a new row on first call", async () => {
    const saved = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      summary: "First call summary.",
      notes: "note A",
      importance: "medium",
    });

    expect(saved).toBeDefined();
    expect(saved!.userId).toBe(USER_A);
    expect(saved!.phoneNumber).toBe(PHONE);
    expect(saved!.summary).toBe("First call summary.");
    expect(h.store.rows).toHaveLength(1);
  });

  it("UPDATES the same row on a repeat for the same (user, phone) — no duplicate", async () => {
    const first = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      summary: "First.",
      importance: "low",
    });

    const second = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      summary: "Second, updated.",
      importance: "high",
    });

    // Still exactly one row, same id, with the new values.
    expect(h.store.rows).toHaveLength(1);
    expect(second!.id).toBe(first!.id);
    expect(h.store.rows[0].summary).toBe("Second, updated.");
    expect(h.store.rows[0].importance).toBe("high");
  });

  it("keeps separate rows for the same phone under different users", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "A's view" });
    await storage.upsertContactMemory({ userId: USER_B, phoneNumber: PHONE, summary: "B's view" });

    expect(h.store.rows).toHaveLength(2);
  });

  it("defaults null-ish optional fields to null", async () => {
    const saved = await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE });
    expect(saved!.summary).toBeNull();
    expect(saved!.notes).toBeNull();
    expect(saved!.importance).toBeNull();
    expect(saved!.lastCallAt).toBeInstanceOf(Date);
  });
});

describe("getContactMemory", () => {
  it("returns the row scoped to (user, phone)", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "A's memory" });

    const mem = await storage.getContactMemory(USER_A, PHONE);
    expect(mem).toBeDefined();
    expect(mem!.summary).toBe("A's memory");
  });

  it("does not leak one user's memory into another user", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "A only" });

    const forB = await storage.getContactMemory(USER_B, PHONE);
    expect(forB).toBeUndefined();
  });

  it("returns undefined for an unknown phone", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "x" });

    const other = await storage.getContactMemory(USER_A, "+10000000000");
    expect(other).toBeUndefined();
  });

  it("reads back exactly what upsert most recently wrote", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "v1", importance: "low" });
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "v2", importance: "high" });

    const mem = await storage.getContactMemory(USER_A, PHONE);
    expect(mem!.summary).toBe("v2");
    expect(mem!.importance).toBe("high");
  });
});
