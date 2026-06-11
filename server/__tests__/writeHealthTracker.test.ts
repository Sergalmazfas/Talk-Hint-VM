import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// The write-health tracker (recordWriteSuccess / recordWriteFailure, surfaced
// via getWriteHealth) is generic and keyed per table — not specific to the
// caller-details upsert. These tests lock in that EVERY contact_memory write
// path (not just upsertContactMemory) feeds the tracker:
//   - updateContactMemoryById records a failure (counter + lastError) and
//     distinguishes a schema-drift pg code from a generic DB error, exactly
//     like upsertContactMemory does.
//   - deleteContactMemoryById does the same.
//   - getWriteHealth() returns a correctly-shaped per-table snapshot.
//
// The real Postgres / drizzle layer is swapped for a configurable fake `db`
// whose update/delete chains reject on demand. The twilio client (built at
// import time) is stubbed.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = {
    updateError: null as any,
    deleteError: null as any,
  };

  const db = {
    update() {
      return {
        set() {
          return {
            where() {
              return {
                returning() {
                  if (state.updateError) return Promise.reject(state.updateError);
                  return Promise.resolve([{ id: "cm-1" }]);
                },
              };
            },
          };
        },
      };
    },
    delete() {
      return {
        where() {
          return {
            returning() {
              if (state.deleteError) return Promise.reject(state.deleteError);
              return Promise.resolve([{ id: "cm-1" }]);
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

const { storage, getWriteHealth, getContactMemoryHealth } = await import("../storage");

const USER_A = "user-a";

function driftError() {
  const e: any = new Error('column "name" of relation "contact_memory" does not exist');
  e.code = "42703"; // undefined_column
  e.table = "contact_memory";
  e.column = "name";
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

beforeEach(() => {
  h.state.updateError = null;
  h.state.deleteError = null;
});

describe("updateContactMemoryById write-failure tracking", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("records a failure and emits a [Storage][DRIFT] log on a schema-drift pg code", async () => {
    const before = getContactMemoryHealth().writeFailures;
    h.state.updateError = driftError();

    const result = await storage.updateContactMemoryById(USER_A, "cm-1", { summary: "x" });

    // Silent-failure contract: returns undefined, does not throw…
    expect(result).toBeUndefined();

    // …but the failure is tracked loudly: counter bumped + drift-flagged error.
    const health = getContactMemoryHealth();
    expect(health.writeFailures).toBe(before + 1);
    expect(health.lastError).not.toBeNull();
    expect(health.lastError!.code).toBe("42703");
    expect(health.lastError!.isSchemaDrift).toBe(true);
    expect(health.lastError!.operation).toBe("updateContactMemoryById");
    expect(driftLogged(errorSpy)).toBe(true);
  });

  it("records a non-drift failure (no DRIFT log) for a generic DB error", async () => {
    const before = getContactMemoryHealth().writeFailures;
    h.state.updateError = genericError();

    const result = await storage.updateContactMemoryById(USER_A, "cm-1", { summary: "x" });

    expect(result).toBeUndefined();

    const health = getContactMemoryHealth();
    expect(health.writeFailures).toBe(before + 1);
    expect(health.lastError!.code).toBe("57P01");
    expect(health.lastError!.isSchemaDrift).toBe(false);
    expect(health.lastError!.operation).toBe("updateContactMemoryById");
    expect(driftLogged(errorSpy)).toBe(false);
  });
});

describe("deleteContactMemoryById write-failure tracking", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("records a failure and emits a [Storage][DRIFT] log on a schema-drift pg code", async () => {
    const before = getContactMemoryHealth().writeFailures;
    h.state.deleteError = driftError();

    const result = await storage.deleteContactMemoryById(USER_A, "cm-1");

    // Silent-failure contract: returns false, does not throw…
    expect(result).toBe(false);

    const health = getContactMemoryHealth();
    expect(health.writeFailures).toBe(before + 1);
    expect(health.lastError).not.toBeNull();
    expect(health.lastError!.code).toBe("42703");
    expect(health.lastError!.isSchemaDrift).toBe(true);
    expect(health.lastError!.operation).toBe("deleteContactMemoryById");
    expect(driftLogged(errorSpy)).toBe(true);
  });

  it("records a non-drift failure (no DRIFT log) for a generic DB error", async () => {
    const before = getContactMemoryHealth().writeFailures;
    h.state.deleteError = genericError();

    const result = await storage.deleteContactMemoryById(USER_A, "cm-1");

    expect(result).toBe(false);

    const health = getContactMemoryHealth();
    expect(health.writeFailures).toBe(before + 1);
    expect(health.lastError!.code).toBe("57P01");
    expect(health.lastError!.isSchemaDrift).toBe(false);
    expect(health.lastError!.operation).toBe("deleteContactMemoryById");
    expect(driftLogged(errorSpy)).toBe(false);
  });
});

describe("getWriteHealth per-table snapshot", () => {
  it("returns a per-table map keyed by table name with the WriteHealth shape", async () => {
    // A successful write registers the table and bumps its success counter.
    const okResult = await storage.updateContactMemoryById(USER_A, "cm-1", { summary: "ok" });
    expect(okResult).toBeDefined();

    const snapshot = getWriteHealth();
    expect(snapshot).toHaveProperty("contact_memory");

    const table = snapshot.contact_memory;
    expect(table).toHaveProperty("writeSuccesses");
    expect(table).toHaveProperty("writeFailures");
    expect(table).toHaveProperty("lastError");
    expect(typeof table.writeSuccesses).toBe("number");
    expect(typeof table.writeFailures).toBe("number");
    expect(table.writeSuccesses).toBeGreaterThan(0);
  });

  it("reflects a recorded failure in the same per-table snapshot", async () => {
    const before = getWriteHealth().contact_memory?.writeFailures ?? 0;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.state.deleteError = genericError();

    await storage.deleteContactMemoryById(USER_A, "cm-1");
    errorSpy.mockRestore();

    const snapshot = getWriteHealth();
    expect(snapshot.contact_memory.writeFailures).toBe(before + 1);
    expect(snapshot.contact_memory.lastError).not.toBeNull();
    expect(snapshot.contact_memory.lastError!.operation).toBe("deleteContactMemoryById");
  });
});
