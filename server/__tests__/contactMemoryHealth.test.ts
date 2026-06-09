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
    liveColumnsByTable: {} as Record<string, string[]>,
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
    query: async (_sql: string, params: any[]) => {
      if (state.queryError) throw state.queryError;
      const tableNames: string[] = params?.[0] ?? [];
      const rows: Array<{ table_name: string; column_name: string }> = [];
      for (const t of tableNames) {
        for (const c of state.liveColumnsByTable[t] ?? []) {
          rows.push({ table_name: t, column_name: c });
        }
      }
      return { rows };
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

const { storage, getContactMemoryHealth, checkContactMemoryDrift, checkSchemaDrift } = await import("../storage");
const { getTableColumns } = await import("drizzle-orm");
const schema = await import("@shared/schema");

// Map of live table name -> drizzle table, mirroring APP_TABLES in storage.ts.
const TABLE_DEFS: Record<string, any> = {
  users: schema.users,
  phone_numbers: schema.phoneNumbers,
  user_prompts: schema.userPrompts,
  prompt_templates: schema.promptTemplates,
  calls: schema.calls,
  contact_memory: schema.contactMemory,
  knowledge_cards: schema.knowledgeCards,
  available_numbers: schema.availableNumbers,
  sessions: schema.sessions,
};

const columnsFor = (table: any): string[] =>
  Object.values(getTableColumns(table)).map((col: any) => col.name as string);

// The schema-declared columns for contact_memory (snake_case, as stored live).
const ALL_COLUMNS = columnsFor(schema.contactMemory);

// A live DB whose columns exactly match every app table's schema (no drift).
const fullLiveColumns = (): Record<string, string[]> =>
  Object.fromEntries(Object.entries(TABLE_DEFS).map(([name, table]) => [name, columnsFor(table)]));

beforeEach(() => {
  h.state.insertError = null;
  h.state.queryError = null;
  h.state.liveColumnsByTable = fullLiveColumns();
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
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("reports missing columns when the live table lacks a schema-declared column", async () => {
    // The live DB is missing the column behind the caller-name bug.
    h.state.liveColumnsByTable.contact_memory = ALL_COLUMNS.filter((c) => c !== "name");

    const report = await checkContactMemoryDrift();

    expect(report.checked).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.table).toBe("contact_memory");
    expect(report.missingColumns).toContain("name");
  });

  it("reports more than one missing column when several are absent", async () => {
    h.state.liveColumnsByTable.contact_memory = ALL_COLUMNS.filter(
      (c) => c !== "name" && c !== "importance",
    );

    const report = await checkContactMemoryDrift();

    expect(report.ok).toBe(false);
    expect(report.missingColumns).toEqual(expect.arrayContaining(["name", "importance"]));
  });

  it("reports ok when the live columns match the schema", async () => {
    h.state.liveColumnsByTable.contact_memory = [...ALL_COLUMNS];

    const report = await checkContactMemoryDrift();

    expect(report.checked).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.missingColumns).toEqual([]);
  });
});

describe("checkSchemaDrift", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("reports ok for every app table when the live columns match the schema", async () => {
    const report = await checkSchemaDrift();

    expect(report.checked).toBe(true);
    expect(report.ok).toBe(true);
    // Every declared app table is checked, not just contact_memory.
    const checkedTables = report.tables.map((t) => t.table).sort();
    expect(checkedTables).toEqual(Object.keys(TABLE_DEFS).sort());
    expect(report.tables.every((t) => t.ok && t.missingColumns.length === 0)).toBe(true);
  });

  it("detects drift on a non-contact-memory table (e.g. calls)", async () => {
    h.state.liveColumnsByTable.calls = columnsFor(schema.calls).filter((c) => c !== "transcript");

    const report = await checkSchemaDrift();

    expect(report.ok).toBe(false);
    const callsReport = report.tables.find((t) => t.table === "calls");
    expect(callsReport!.ok).toBe(false);
    expect(callsReport!.missingColumns).toContain("transcript");
    // Other tables remain healthy.
    expect(report.tables.find((t) => t.table === "contact_memory")!.ok).toBe(true);
  });

  it("detects drift across several tables at once", async () => {
    h.state.liveColumnsByTable.knowledge_cards = columnsFor(schema.knowledgeCards).filter(
      (c) => c !== "body",
    );
    h.state.liveColumnsByTable.user_prompts = columnsFor(schema.userPrompts).filter(
      (c) => c !== "content",
    );

    const report = await checkSchemaDrift();

    expect(report.ok).toBe(false);
    expect(report.tables.find((t) => t.table === "knowledge_cards")!.missingColumns).toContain("body");
    expect(report.tables.find((t) => t.table === "user_prompts")!.missingColumns).toContain("content");
  });

  it("reports a missing table as fully drifted (all columns missing)", async () => {
    delete h.state.liveColumnsByTable.knowledge_cards;

    const report = await checkSchemaDrift();

    expect(report.ok).toBe(false);
    const kc = report.tables.find((t) => t.table === "knowledge_cards")!;
    expect(kc.ok).toBe(false);
    expect(kc.missingColumns).toEqual(expect.arrayContaining(columnsFor(schema.knowledgeCards)));
  });

  it("marks every table as errored when the drift query throws", async () => {
    h.state.queryError = new Error("information_schema unavailable");

    const report = await checkSchemaDrift();

    expect(report.checked).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.tables.every((t) => !t.ok && t.error)).toBe(true);
  });
});
