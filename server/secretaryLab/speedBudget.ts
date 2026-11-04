import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export type SpeedBudgetState = { limitMicroUsd: number; probeDebitMicroUsd: number;
  runs: Record<string, { variant: string; reserved: number; spent: number; status: "reserved" | "settled" | "unknown" }> };
const initial = (): SpeedBudgetState => ({ limitMicroUsd: 5_000_000, probeDebitMicroUsd: 100_000, runs: {} });
/** One fixed $5 series, persisted across restarts. No reset/refill HTTP method.
 * Crash locks fail closed; they are never removed based on a guessed TTL. */
export class SpeedBudget {
  constructor(private path = "generated-artifacts/secretary-speed-series/runtime-budget.json") {}
  private async load(): Promise<SpeedBudgetState> {
    try {
      const s = JSON.parse(await readFile(this.path, "utf8"));
      if (s.limitMicroUsd !== 5_000_000 || s.probeDebitMicroUsd !== 100_000 || !s.runs || typeof s.runs !== "object")
        throw Error("SPEED_BUDGET_INVALID");
      for (const r of Object.values(s.runs) as any[]) {
        if (!r || !["A", "B", "C"].includes(r.variant) || !["reserved", "settled", "unknown"].includes(r.status) ||
          !Number.isSafeInteger(r.reserved) || !Number.isSafeInteger(r.spent) || r.reserved < 0 || r.spent < 0 ||
          r.reserved + r.spent > 2_000_000 ||
          (r.status === "reserved" ? r.reserved !== 2_000_000 || r.spent !== 0 : r.reserved !== 0) ||
          (r.status === "unknown" && r.spent !== 2_000_000)) throw Error("SPEED_BUDGET_INVALID");
      }
      return s;
    } catch (e: any) { if (e.code === "ENOENT") return initial(); throw e; }
  }
  async state() {
    const s = await this.load();
    const spent = s.probeDebitMicroUsd + Object.values(s.runs).reduce((n, r) => n + r.spent, 0);
    const reserved = Object.values(s.runs).reduce((n, r) => n + r.reserved, 0);
    return { ...s, spentMicroUsd: spent, reservedMicroUsd: reserved, remainingMicroUsd: s.limitMicroUsd - spent - reserved };
  }
  private async change(fn: (s: SpeedBudgetState) => void) {
    await mkdir(dirname(this.path), { recursive: true });
    let lock;
    try { lock = await open(this.path + ".lock", "wx"); }
    catch { throw Error("SPEED_BUDGET_BUSY_OR_CRASH_LOCK"); }
    try {
      const s = await this.load(); fn(s);
      await writeFile(this.path + ".tmp", JSON.stringify(s, null, 2), { mode: 0o600 });
      await rename(this.path + ".tmp", this.path);
    } finally { await lock.close(); await unlink(this.path + ".lock"); }
  }
  reserve(id: string, variant: string) {
    return this.change(s => {
      if (s.runs[id]) throw Error("SPEED_REQUEST_ALREADY_RESERVED_NO_RETRY");
      if (Object.values(s.runs).some(r => r.status === "reserved")) throw Error("SPEED_SESSION_ACTIVE_OR_UNKNOWN");
      // The automated runner limits its sample count to four. The owner's
      // separately requested manual voice test shares this same $5 ceiling,
      // but is not disabled just because automation used its sample slots.
      const used = s.probeDebitMicroUsd + Object.values(s.runs).reduce((n, r) => n + r.spent + r.reserved, 0);
      // New runtime: <= $1 model envelopes (including unknown/cancelled requests)
      // + $1 protective voice envelope / 5 minutes, enforced before requests.
      // Legacy admissions retain their original accounting; no history repricing.
      if (used + 2_000_000 > s.limitMicroUsd) throw Error("SPEED_SERIES_BUDGET_EXHAUSTED");
      s.runs[id] = { variant, reserved: 2_000_000, spent: 0, status: "reserved" };
    });
  }
  settle(id: string, debit: number | null) {
    return this.change(s => {
      const r = s.runs[id];
      if (!r || r.status !== "reserved") return;
      if (debit !== null && (!Number.isSafeInteger(debit) || debit < 0 || debit > r.reserved))
        throw Error("SPEED_ACCOUNTING_OUT_OF_BOUNDS");
      r.spent = debit === null ? r.reserved : debit;
      r.reserved = 0; r.status = debit === null ? "unknown" : "settled";
    });
  }
}
