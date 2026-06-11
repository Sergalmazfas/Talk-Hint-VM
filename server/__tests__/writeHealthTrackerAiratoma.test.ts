import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// writeHealthTrackerTables.test.ts locks in the users / calls / knowledge_cards
// / sessions write paths; writeHealthTracker.test.ts locks in contact_memory.
// These tests lock in the last remaining recordWriteFailure callers: the
// AirAtoma CRM durable-retry-queue methods on the "airatoma_deliveries" table:
//   - enqueueAirAtomaDelivery        (insert … onConflictDoUpdate … returning)
//   - markAirAtomaDeliverySucceeded  (update … set … where, awaited directly)
//   - markAirAtomaDeliveryRetry      (update … set … where, awaited directly)
//   - markAirAtomaDeliveryFailed     (update … set … where, awaited directly)
//
// For each we assert the per-table counter bumps, lastError carries the right
// operation name + pg code, and a schema-drift pg code is distinguished from a
// generic DB error (drift flag + [Storage][DRIFT] log) exactly like the other
// tables. All four swallow the error (enqueue returns undefined, the three
// mark* methods return void) — never rethrowing — so a refactor can't silently
// drop failure tracking on the retry queue without a test noticing.
//
// The real Postgres / drizzle layer is swapped for a configurable fake `db`.
// enqueue's chain ends `insert().values().onConflictDoUpdate().returning()`;
// the mark* chains end `update().set().where()` awaited directly (no
// .returning()), so where() is a thenable. The twilio client (built at import
// time) is stubbed.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = {
    insertError: null as any,
    updateError: null as any,
  };

  const db = {
    insert() {
      return {
        values() {
          return {
            onConflictDoUpdate() {
              return {
                returning() {
                  if (state.insertError) return Promise.reject(state.insertError);
                  return Promise.resolve([{ id: "del-1" }]);
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          // where() is awaited directly by the mark* methods, so it must be a
          // thenable that settles to the configured update outcome.
          return {
            where() {
              const settle = () =>
                state.updateError ? Promise.reject(state.updateError) : Promise.resolve([{ id: "del-1" }]);
              return {
                then: (resolve: any, reject: any) => settle().then(resolve, reject),
              };
            },
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

const TABLE = "airatoma_deliveries";

function driftError() {
  const e: any = new Error('column "x" does not exist');
  e.code = "42703"; // undefined_column
  e.table = "airatoma_deliveries";
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
});

type ErrorSlot = "insert" | "update";

interface WritePathCase {
  operation: string;
  slot: ErrorSlot;
  // All four swallow the error; assert the swallowed return value as-is.
  assertResult: (result: unknown) => void;
  run: () => Promise<unknown>;
}

const CASES: WritePathCase[] = [
  {
    operation: "enqueueAirAtomaDelivery",
    slot: "insert",
    assertResult: (result) => expect(result).toBeUndefined(), // swallows: returns undefined
    run: () =>
      storage.enqueueAirAtomaDelivery({
        callId: "CA-1",
        transcript: "hello",
        callerName: "Caller",
        durationSecs: 10,
      } as any),
  },
  {
    operation: "markAirAtomaDeliverySucceeded",
    slot: "update",
    assertResult: (result) => expect(result).toBeUndefined(), // swallows: returns void
    run: () => storage.markAirAtomaDeliverySucceeded("del-1", 1),
  },
  {
    operation: "markAirAtomaDeliveryRetry",
    slot: "update",
    assertResult: (result) => expect(result).toBeUndefined(), // swallows: returns void
    run: () => storage.markAirAtomaDeliveryRetry("del-1", 1, new Date(Date.now() + 60_000), "boom"),
  },
  {
    operation: "markAirAtomaDeliveryFailed",
    slot: "update",
    assertResult: (result) => expect(result).toBeUndefined(), // swallows: returns void
    run: () => storage.markAirAtomaDeliveryFailed("del-1", 8, "boom"),
  },
];

function setError(slot: ErrorSlot, error: any) {
  if (slot === "insert") h.state.insertError = error;
  else h.state.updateError = error;
}

for (const c of CASES) {
  describe(`${c.operation} (${TABLE}) write-failure tracking`, () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("records a failure and emits a [Storage][DRIFT] log on a schema-drift pg code", async () => {
      const before = failuresFor(TABLE);
      setError(c.slot, driftError());

      // Swallowing path must NOT throw.
      const result = await c.run();
      c.assertResult(result);

      const health = getWriteHealth()[TABLE];
      expect(health).toBeDefined();
      expect(health.writeFailures).toBeGreaterThanOrEqual(before + 1);
      expect(health.lastError).not.toBeNull();
      expect(health.lastError!.code).toBe("42703");
      expect(health.lastError!.isSchemaDrift).toBe(true);
      expect(health.lastError!.operation).toBe(c.operation);
      expect(driftLogged(errorSpy)).toBe(true);
    });

    it("records a non-drift failure (no DRIFT log) for a generic DB error", async () => {
      const before = failuresFor(TABLE);
      setError(c.slot, genericError());

      const result = await c.run();
      c.assertResult(result);

      const health = getWriteHealth()[TABLE];
      expect(health.writeFailures).toBeGreaterThanOrEqual(before + 1);
      expect(health.lastError!.code).toBe("57P01");
      expect(health.lastError!.isSchemaDrift).toBe(false);
      expect(health.lastError!.operation).toBe(c.operation);
      expect(driftLogged(errorSpy)).toBe(false);
    });
  });
}
