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
            orderBy() {
              // Ordering is irrelevant to the scoping/field assertions here.
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
                if (conflictSet) {
                  const resolved = { ...conflictSet };
                  // upsertContactMemory sets `name` to a drizzle sql COALESCE
                  // expression (an object, not a plain string/null). Emulate
                  // `coalesce(nullif(trim(existing.name), ''), incoming.name)`
                  // so the atomic never-overwrite-name behaviour is exercised.
                  if (resolved.name && typeof resolved.name === "object") {
                    const current = typeof existing.name === "string" ? existing.name.trim() : "";
                    resolved.name = current ? existing.name : r.name ?? null;
                  }
                  Object.assign(existing, resolved);
                }
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
    update() {
      return {
        set(setVals: any) {
          let pred: any = null;
          const run = () => {
            const matched = store.rows.filter((r) => matchPred(r, pred));
            for (const r of matched) Object.assign(r, setVals);
            return matched.map((r) => ({ ...r }));
          };
          const builder: any = {
            where(p: any) {
              pred = p;
              return builder;
            },
            returning() {
              return Promise.resolve(run());
            },
            then(resolve: any, reject: any) {
              return Promise.resolve(run()).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
    delete() {
      let pred: any = null;
      const run = () => {
        const matched = store.rows.filter((r) => matchPred(r, pred));
        store.rows = store.rows.filter((r) => !matchPred(r, pred));
        return matched.map((r) => ({ ...r }));
      };
      const builder: any = {
        where(p: any) {
          pred = p;
          return builder;
        },
        returning() {
          return Promise.resolve(run());
        },
        then(resolve: any, reject: any) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return builder;
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

  it("auto-fills the name when the contact has none yet", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "first" });
    const filled = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      name: "John",
      summary: "second",
    });
    expect(filled!.name).toBe("John");
  });

  it("never overwrites an existing name on conflict (atomic COALESCE)", async () => {
    // The user (or an earlier call) has already set a name.
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, name: "Jonathan", summary: "v1" });

    // A later auto-fill tries to write a different name in the same upsert.
    const after = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      name: "John",
      summary: "v2",
    });

    // Name is preserved; the rest of the row still updates.
    expect(after!.name).toBe("Jonathan");
    expect(after!.summary).toBe("v2");
  });

  it("treats a blank/whitespace stored name as empty and fills it", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, name: "   ", summary: "v1" });
    const after = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      name: "John",
      summary: "v2",
    });
    expect(after!.name).toBe("John");
  });

  it("leaves the name untouched when an upsert omits it (no race window)", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, name: "Jane", summary: "v1" });
    // The post-call summarizer with no extracted name upserts without `name`.
    const after = await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "v2" });
    expect(after!.name).toBe("Jane");
    expect(after!.summary).toBe("v2");
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

describe("listContactMemories", () => {
  it("returns only the calling user's rows", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: "+1111", summary: "A1" });
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: "+2222", summary: "A2" });
    await storage.upsertContactMemory({ userId: USER_B, phoneNumber: "+3333", summary: "B1" });

    const forA = await storage.listContactMemories(USER_A);
    expect(forA).toHaveLength(2);
    expect(forA.every((c) => c.userId === USER_A)).toBe(true);

    const forB = await storage.listContactMemories(USER_B);
    expect(forB).toHaveLength(1);
    expect(forB[0].userId).toBe(USER_B);
  });

  it("returns an empty array for a user with no contacts", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "x" });
    const forB = await storage.listContactMemories(USER_B);
    expect(forB).toEqual([]);
  });
});

describe("updateContactMemoryById", () => {
  it("updates a row the user owns and returns the new values", async () => {
    const row = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      summary: "old summary",
      notes: "old notes",
      importance: "low",
    });

    const updated = await storage.updateContactMemoryById(USER_A, row!.id, {
      summary: "new summary",
      importance: "high",
    });

    expect(updated).toBeDefined();
    expect(updated!.id).toBe(row!.id);
    expect(updated!.summary).toBe("new summary");
    expect(updated!.importance).toBe("high");
  });

  it("only changes the fields provided, leaving others untouched", async () => {
    const row = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      name: "Jane",
      summary: "keep me",
      notes: "keep notes",
      importance: "medium",
    });

    await storage.updateContactMemoryById(USER_A, row!.id, { name: "Janet" });

    const after = await storage.getContactMemory(USER_A, PHONE);
    expect(after!.name).toBe("Janet");
    expect(after!.summary).toBe("keep me");
    expect(after!.notes).toBe("keep notes");
    expect(after!.importance).toBe("medium");
  });

  it("preserves lastCallAt (it is never part of the update set)", async () => {
    const lastCallAt = new Date("2026-02-01T08:00:00Z");
    const row = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      summary: "s",
      lastCallAt,
    });

    await storage.updateContactMemoryById(USER_A, row!.id, { summary: "edited" });

    const after = await storage.getContactMemory(USER_A, PHONE);
    expect(after!.lastCallAt).toEqual(lastCallAt);
    expect(after!.summary).toBe("edited");
  });

  it("cannot update another user's row (scoped by userId) and leaves it unchanged", async () => {
    const row = await storage.upsertContactMemory({
      userId: USER_A,
      phoneNumber: PHONE,
      summary: "A's private summary",
    });

    const result = await storage.updateContactMemoryById(USER_B, row!.id, {
      summary: "B tried to edit",
    });

    expect(result).toBeUndefined();
    // A's row is untouched.
    const stillA = await storage.getContactMemory(USER_A, PHONE);
    expect(stillA!.summary).toBe("A's private summary");
  });

  it("returns undefined for an unknown id", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "x" });
    const result = await storage.updateContactMemoryById(USER_A, "cm-does-not-exist", { summary: "y" });
    expect(result).toBeUndefined();
  });
});

describe("deleteContactMemoryById", () => {
  it("deletes a row the user owns and returns true", async () => {
    const row = await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "x" });

    const ok = await storage.deleteContactMemoryById(USER_A, row!.id);
    expect(ok).toBe(true);
    expect(h.store.rows).toHaveLength(0);
  });

  it("cannot delete another user's row (scoped by userId) and leaves it intact", async () => {
    const row = await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "A's row" });

    const ok = await storage.deleteContactMemoryById(USER_B, row!.id);
    expect(ok).toBe(false);
    expect(h.store.rows).toHaveLength(1);
    const stillA = await storage.getContactMemory(USER_A, PHONE);
    expect(stillA!.summary).toBe("A's row");
  });

  it("returns false for an unknown id", async () => {
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: PHONE, summary: "x" });
    const ok = await storage.deleteContactMemoryById(USER_A, "cm-does-not-exist");
    expect(ok).toBe(false);
    expect(h.store.rows).toHaveLength(1);
  });

  it("deletes only the targeted row, not the user's other contacts", async () => {
    const r1 = await storage.upsertContactMemory({ userId: USER_A, phoneNumber: "+1111", summary: "one" });
    await storage.upsertContactMemory({ userId: USER_A, phoneNumber: "+2222", summary: "two" });

    const ok = await storage.deleteContactMemoryById(USER_A, r1!.id);
    expect(ok).toBe(true);
    const remaining = await storage.listContactMemories(USER_A);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].phoneNumber).toBe("+2222");
  });
});
