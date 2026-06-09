import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the caller-details failure alerts added alongside the silent
// contact-memory write bug:
//   - upsertContactMemory records a write failure AND emits a [Storage][DRIFT]
//     log when the DB rejects a write with a schema-drift pg code (42703).
//   - upsertContactMemory records a (non-drift) failure without the DRIFT log
//     for a generic DB error.
//   - checkContactMemoryDrift reports the missing column(s) when the live table
//     lacks a schema-declared column, and reports ok when the columns match.
//
// The real Postgres / drizzle layer is swapped for a configurable fake `db` +
// `pool`. getTableColumns stays real so the drift check compares against the
// actual schema-declared columns. The twilio client (built at import time) is
// stubbed.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = {
    insertError: null as any,
    liveColumns: [] as string[],
    queryError: null as any,
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
                  return Promise.resolve([{ id: "cm-1" }]);
                },
              };
            },
          };
        },
      };
    },
  };

  const pool = {
    query: async (_sql: string, _params: any[]) => {
      if (state.queryError) throw state.queryError;
      return { rows: state.liveColumns.map((c) => ({ column_name: c })) };
    },
  };

  return { state, db, pool };
});

vi.mock("../db", () => ({
  db: h.db,
  pool: h.pool,
  dbReady: Promise.resolve(),
  isDatabaseAvailable: () => true,
  testDatabaseConnection: async () => true,
  isDevDatabase: true,
}));

// twilioService builds a Twilio client at import time; not needed here.
vi.mock("../twilioService", () => ({
  configureVoiceWebhook: vi.fn(),
}));

const { storage, getContactMemoryHealth, checkContactMemoryDrift } = await import("../storage");

// The schema-declared columns for contact_memory (snake_case, as stored live).
const ALL_COLUMNS = [
  "id",
  "user_id",
  "phone_number",
  "name",
  "summary",
  "notes",
  "importance",
  "last_call_at",
  "created_at",
  "updated_at",
];

beforeEach(() => {
  h.state.insertError = null;
  h.state.queryError = null;
  h.state.liveColumns = [...ALL_COLUMNS];
});

describe("upsertContactMemory write-failure alerts", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("records a failure and emits a [Storage][DRIFT] log on a schema-drift pg code", async () => {
    const before = getContactMemoryHealth().writeFailures;
    const driftError: any = new Error('column "name" of relation "contact_memory" does not exist');
    driftError.code = "42703"; // undefined_column
    driftError.table = "contact_memory";
    driftError.column = "name";
    h.state.insertError = driftError;

    const result = await storage.upsertContactMemory({
      userId: "user-a",
      phoneNumber: "+15559998888",
      name: "John",
      summary: "first call",
    });

    // The silent-failure contract: it still returns undefined (does not throw)…
    expect(result).toBeUndefined();

    // …but the failure is now LOUD: counter bumped + last error flagged as drift.
    const health = getContactMemoryHealth();
    expect(health.writeFailures).toBe(before + 1);
    expect(health.lastError).not.toBeNull();
    expect(health.lastError!.code).toBe("42703");
    expect(health.lastError!.isSchemaDrift).toBe(true);
    expect(health.lastError!.operation).toBe("upsertContactMemory");

    // And a [Storage][DRIFT] line was logged.
    const driftLogged = errorSpy.mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes("[Storage][DRIFT]"),
    );
    expect(driftLogged).toBe(true);
  });

  it("records a non-drift failure (no DRIFT log) for a generic DB error", async () => {
    const before = getContactMemoryHealth().writeFailures;
    const genericError: any = new Error("connection terminated unexpectedly");
    genericError.code = "57P01"; // admin_shutdown — not a drift code
    h.state.insertError = genericError;

    const result = await storage.upsertContactMemory({
      userId: "user-a",
      phoneNumber: "+15559998888",
      summary: "x",
    });

    expect(result).toBeUndefined();

    const health = getContactMemoryHealth();
    expect(health.writeFailures).toBe(before + 1);
    expect(health.lastError!.code).toBe("57P01");
    expect(health.lastError!.isSchemaDrift).toBe(false);

    const driftLogged = errorSpy.mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes("[Storage][DRIFT]"),
    );
    expect(driftLogged).toBe(false);
  });
});

describe("checkContactMemoryDrift", () => {
  it("reports missing columns when the live table lacks a schema-declared column", async () => {
    // The live DB is missing the column behind the caller-name bug.
    h.state.liveColumns = ALL_COLUMNS.filter((c) => c !== "name");

    const report = await checkContactMemoryDrift();

    expect(report.checked).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.table).toBe("contact_memory");
    expect(report.missingColumns).toContain("name");
  });

  it("reports more than one missing column when several are absent", async () => {
    h.state.liveColumns = ALL_COLUMNS.filter((c) => c !== "name" && c !== "importance");

    const report = await checkContactMemoryDrift();

    expect(report.ok).toBe(false);
    expect(report.missingColumns).toEqual(expect.arrayContaining(["name", "importance"]));
  });

  it("reports ok when the live columns match the schema", async () => {
    h.state.liveColumns = [...ALL_COLUMNS];

    const report = await checkContactMemoryDrift();

    expect(report.checked).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.missingColumns).toEqual([]);
  });
});
