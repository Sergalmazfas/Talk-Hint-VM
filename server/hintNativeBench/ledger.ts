import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { LIMIT_MICRO_USD, SERIES } from "./contracts";

const EntrySchema = z.object({
  id: z.string().min(1), kind: z.enum(["control", "session", "judge", "diagnostic"]),
  identity: z.string().regex(/^[a-f0-9]{64}$/), reserve: z.number().int().positive(),
  charged: z.number().int().nonnegative(), status: z.enum(["reserved", "spent", "unknown"]),
  startedAt: z.string(), endedAt: z.string().optional(),
  httpStatus: z.number().int().optional(), requestId: z.string().nullable().optional(),
}).strict();
type Entry = z.infer<typeof EntrySchema>;
const StateSchema = z.object({
  series: z.literal(SERIES), limitMicro: z.literal(LIMIT_MICRO_USD),
  entries: z.array(EntrySchema),
}).strict();
type State = z.infer<typeof StateSchema>;

/** A new series, never reads/writes the previous polygon ledger. One writer.
 * A stale lock is NOT deleted automatically: interruption needs reconciliation. */
export class NativeLedger {
  private state: State = { series: SERIES, limitMicro: LIMIT_MICRO_USD, entries: [] };
  private queue = Promise.resolve();
  private poisoned = false;
  private closing = false;
  private constructor(private path: string, private lock: fs.FileHandle) {}
  static async open(path: string) {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const lock = await fs.open(path + ".lock", "wx", 0o600);
    const ledger = new NativeLedger(path, lock);
    try {
      let raw: string | undefined;
      try { raw = await fs.readFile(path, "utf8"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (raw !== undefined) ledger.state = StateSchema.parse(JSON.parse(raw));
      const entries = ledger.state.entries;
      if (new Set(entries.map(e => e.id)).size !== entries.length ||
          entries.some(e => e.charged > e.reserve ||
            (e.status !== "spent" && e.charged !== e.reserve)) ||
          ledger.held() > LIMIT_MICRO_USD) throw Error("CORRUPT_NATIVE_LEDGER");
      // A process stopped after reserving, possibly after transmitting. Never retry.
      for (const entry of entries) if (entry.status === "reserved") entry.status = "unknown";
      await ledger.persist();
      return ledger;
    } catch (e) {
      await lock.close(); await fs.unlink(path + ".lock"); throw e;
    }
  }
  snapshot() { return structuredClone(this.state); }
  held() {
    return this.state.entries.reduce((sum, e) => sum + (e.status === "spent" ? e.charged : e.reserve), 0);
  }
  private persist() {
    const data = JSON.stringify(this.state);
    const write = this.queue.then(async () => {
      const tmp = this.path + ".tmp";
      const f = await fs.open(tmp, "w", 0o600);
      try { await f.writeFile(data); await f.sync(); } finally { await f.close(); }
      await fs.rename(tmp, this.path);
      const dir = await fs.open(dirname(this.path), "r");
      try { await dir.sync(); } finally { await dir.close(); }
    });
    this.queue = write.catch(() => { this.poisoned = true; });
    return write;
  }
  async reserve(id: string, kind: Entry["kind"], reserve: number, identity: string) {
    if (this.poisoned || this.closing) throw Error("LEDGER_CLOSED_OR_WRITE_FAILED");
    if (this.state.entries.some(e => e.id === id ||
        (e.identity === identity && e.status !== "spent"))) throw Error("REQUEST_ALREADY_STARTED_NO_RETRY");
    const entry = EntrySchema.parse({
      id, kind, identity, reserve, charged: reserve, status: "reserved", startedAt: new Date().toISOString(),
    });
    if (this.held() + reserve > LIMIT_MICRO_USD) throw Error("NATIVE_SERIES_BUDGET_EXHAUSTED");
    this.state.entries.push(entry);
    await this.persist(); // Caller must await this BEFORE any network operation.
  }
  async finish(id: string, charged: number, meta: { httpStatus?: number; requestId?: string | null } = {}) {
    if (this.poisoned || this.closing) throw Error("LEDGER_CLOSED_OR_WRITE_FAILED");
    const e = this.state.entries.find(e => e.id === id);
    if (!e || e.status !== "reserved") throw Error("RESERVATION_NOT_ACTIVE");
    if (!Number.isSafeInteger(charged) || charged < 0 || charged > e.reserve)
      throw Error("COST_OUTSIDE_RESERVATION");
    Object.assign(e, { charged, status: "spent", endedAt: new Date().toISOString() }, meta);
    EntrySchema.parse(e);
    await this.persist();
  }
  async unknown(id: string, meta: { httpStatus?: number; requestId?: string | null } = {}) {
    const e = this.state.entries.find(e => e.id === id);
    if (e?.status === "reserved") {
      Object.assign(e, { status: "unknown", endedAt: new Date().toISOString() }, meta);
      await this.persist();
    }
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    for (const e of this.state.entries) if (e.status === "reserved") e.status = "unknown";
    // A failed persistence retains the lock, rather than making an unsafe restart possible.
    await this.persist();
    await this.lock.close(); await fs.unlink(this.path + ".lock");
  }
}
