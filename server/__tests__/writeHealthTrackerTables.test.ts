import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// The write-health tracker (recordWriteSuccess / recordWriteFailure, surfaced
// per-table via getWriteHealth) is generic. contactMemoryHealth.test.ts and
// writeHealthTracker.test.ts already lock in the contact_memory paths; these
// tests lock in EVERY OTHER write path that calls recordWriteFailure so a
// refactor can't silently drop failure tracking on one of them:
//   - users:           createUser, updateUser
//   - calls:           createCall, updateCall
//   - knowledge_cards: createKnowledgeCard, updateKnowledgeCardById,
//                      deleteKnowledgeCardById
//   - sessions:        createSession, deleteSession, cleanExpiredSessions
//
// For each we assert the per-table counter bumps, lastError carries the right
// operation name + pg code, and a schema-drift pg code is distinguished from a
// generic DB error (drift flag + [Storage][DRIFT] log) exactly like the
// contact_memory paths.
//
// Return/throw behavior differs by method and is asserted as-is (the task note
// that "users/sessions rethrow" does not match the code — only createCall /
// updateCall rethrow; users + sessions swallow and fall back, knowledge_cards
// return undefined/false). The real Postgres / drizzle layer is swapped for a
// configurable fake `db` whose insert/update/delete chains reject on demand.
// The twilio client (built at import time) is stubbed.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = {
    insertError: null as any,
    updateError: null as any,
    deleteError: null as any,
  };

  const db = {
    insert() {
      return {
        values() {
          return {
            returning() {
              if (state.insertError) return Promise.reject(state.insertError);
              return Promise.resolve([{ id: "row-1" }]);
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where() {
              return {
                returning() {
                  if (state.updateError) return Promise.reject(state.updateError);
                  return Promise.resolve([{ id: "row-1" }]);
                },
              };
            },
          };
        },
      };
    },
    delete() {
      return {
        // where() is awaited directly by deleteSession/cleanExpiredSessions and
        // chained with .returning() by deleteKnowledgeCardById, so it must be
        // both a thenable AND expose .returning().
        where() {
          const settle = () =>
            state.deleteError ? Promise.reject(state.deleteError) : Promise.resolve([{ id: "row-1" }]);
          return {
            returning: () => settle(),
            then: (resolve: any, reject: any) => settle().then(resolve, reject),
          };
        },
      };
    },
  };

  return { state, db };
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

const { storage, getWriteHealth } = await import("../storage");

function driftError() {
  const e: any = new Error('column "x" does not exist');
  e.code = "42703"; // undefined_column
  e.table = "some_table";
  e.column = "x";
  return e;
}

function genericError() {
  const e: any = new Error("connection terminated unexpectedly");
  e.code = "57P01"; // admin_shutdown — not a drift code
  return e;
}

function driftLogged(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.some(
    (call) => typeof call[0] === "string" && call[0].includes("[Storage][DRIFT]"),
  );
}

function failuresFor(table: string): number {
  return getWriteHealth()[table]?.writeFailures ?? 0;
}

beforeEach(() => {
  h.state.insertError = null;
  h.state.updateError = null;
  h.state.deleteError = null;
});

// A single matrix: each entry is one write path, how to invoke it, which fake-db
// error slot it routes through, and how it reports back to the caller. The two
// generated tests per entry assert drift vs. non-drift tracking identically.
type ErrorSlot = "insert" | "update" | "delete";
type ResultMode = "throws" | "value";

interface WritePathCase {
  table: string;
  operation: string;
  slot: ErrorSlot;
  mode: ResultMode;
  run: () => Promise<unknown>;
}

const CASES: WritePathCase[] = [
  {
    table: "users",
    operation: "createUser",
    slot: "insert",
    mode: "value", // swallows: returns an in-memory fallback user
    run: () => storage.createUser({ email: "a@b.com" } as any),
  },
  {
    table: "users",
    operation: "updateUser",
    slot: "update",
    mode: "value", // swallows: returns undefined
    run: () => storage.updateUser("user-1", { language: "en" } as any),
  },
  {
    table: "calls",
    operation: "createCall",
    slot: "insert",
    mode: "throws", // rethrows after recording
    run: () => storage.createCall({ userId: "user-1" } as any),
  },
  {
    table: "calls",
    operation: "updateCall",
    slot: "update",
    mode: "throws", // rethrows after recording
    run: () => storage.updateCall("call-1", { transcript: "hi" } as any),
  },
  {
    table: "knowledge_cards",
    operation: "createKnowledgeCard",
    slot: "insert",
    mode: "value", // swallows: returns undefined
    run: () =>
      storage.createKnowledgeCard({
        userId: "user-1",
        cardType: "fact",
        title: "t",
        body: "b",
      }),
  },
  {
    table: "knowledge_cards",
    operation: "updateKnowledgeCardById",
    slot: "update",
    mode: "value", // swallows: returns undefined
    run: () => storage.updateKnowledgeCardById("user-1", "card-1", { title: "t2" }),
  },
  {
    table: "knowledge_cards",
    operation: "deleteKnowledgeCardById",
    slot: "delete",
    mode: "value", // swallows: returns false
    run: () => storage.deleteKnowledgeCardById("user-1", "card-1"),
  },
  {
    table: "sessions",
    operation: "createSession",
    slot: "insert",
    mode: "value", // swallows: returns an in-memory fallback session
    run: () => storage.createSession("sess-1", "user-1", new Date(Date.now() + 60_000)),
  },
  {
    table: "sessions",
    operation: "deleteSession",
    slot: "delete",
    mode: "value", // swallows: returns void
    run: () => storage.deleteSession("sess-1"),
  },
  {
    table: "sessions",
    operation: "cleanExpiredSessions",
    slot: "delete",
    mode: "value", // swallows: returns void
    run: () => storage.cleanExpiredSessions(),
  },
];

function setError(slot: ErrorSlot, error: any) {
  if (slot === "insert") h.state.insertError = error;
  else if (slot === "update") h.state.updateError = error;
  else h.state.deleteError = error;
}

async function invoke(c: WritePathCase) {
  if (c.mode === "throws") {
    // Rethrowing paths must surface the DB error to the caller.
    await expect(c.run()).rejects.toBeTruthy();
  } else {
    // Swallowing paths must NOT throw (they fall back / return undefined|void|false).
    // A throw here would reject and fail the test.
    await c.run();
  }
}

for (const c of CASES) {
  describe(`${c.operation} (${c.table}) write-failure tracking`, () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("records a failure and emits a [Storage][DRIFT] log on a schema-drift pg code", async () => {
      const before = failuresFor(c.table);
      setError(c.slot, driftError());

      await invoke(c);

      const health = getWriteHealth()[c.table];
      expect(health).toBeDefined();
      expect(health.writeFailures).toBeGreaterThanOrEqual(before + 1);
      expect(health.lastError).not.toBeNull();
      expect(health.lastError!.code).toBe("42703");
      expect(health.lastError!.isSchemaDrift).toBe(true);
      expect(health.lastError!.operation).toBe(c.operation);
      expect(driftLogged(errorSpy)).toBe(true);
    });

    it("records a non-drift failure (no DRIFT log) for a generic DB error", async () => {
      const before = failuresFor(c.table);
      setError(c.slot, genericError());

      await invoke(c);

      const health = getWriteHealth()[c.table];
      expect(health.writeFailures).toBeGreaterThanOrEqual(before + 1);
      expect(health.lastError!.code).toBe("57P01");
      expect(health.lastError!.isSchemaDrift).toBe(false);
      expect(health.lastError!.operation).toBe(c.operation);
      expect(driftLogged(errorSpy)).toBe(false);
    });
  });
}
