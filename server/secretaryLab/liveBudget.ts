import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const LIVE_SERIES_LIMIT = 20_000_000;
export const LIVE_RESERVE = 500_000; // Ten voice minutes; server closes at five.
type Run = { state: "reserved" | "settled" | "unknown"; debit: number };
type Ledger = { limit: number; runs: Record<string, Run> };
/** Separate Dev series, not the Retell A/B/C series. Unknowns block new sessions. */
export class LiveBudget {
  constructor(private path = "generated-artifacts/secretary-live-series/budget.json") {}
  private async load(): Promise<Ledger> {
    try {
      const s = JSON.parse(await readFile(this.path, "utf8")) as Ledger;
      if (s.limit !== LIVE_SERIES_LIMIT || !s.runs || typeof s.runs !== "object" || Array.isArray(s.runs))
        throw Error("LIVE_BUDGET_INVALID");
      for (const r of Object.values(s.runs)) if (!r || !["reserved","settled","unknown"].includes(r.state) ||
        !Number.isSafeInteger(r.debit) || r.debit < 0 || r.debit > LIVE_RESERVE ||
        (r.state !== "settled" && r.debit !== LIVE_RESERVE)) throw Error("LIVE_BUDGET_INVALID");
      return s;
    } catch (e: any) { if (e.code === "ENOENT") return { limit: LIVE_SERIES_LIMIT, runs: {} }; throw e; }
  }
  async state() {
    const s = await this.load();
    const spent = Object.values(s.runs).filter(r => r.state !== "reserved").reduce((n,r)=>n+r.debit,0);
    const reserved = Object.values(s.runs).filter(r => r.state === "reserved").reduce((n,r)=>n+r.debit,0);
    return { ...s, spentMicroUsd: spent, reservedMicroUsd: reserved, remainingMicroUsd: s.limit-spent-reserved };
  }
  private async change(fn: (s: Ledger) => void) {
    if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw Error("LIVE_DEV_ONLY");
    await mkdir(dirname(this.path), { recursive: true });
    const lock = await open(this.path+".lock","wx").catch(()=>{throw Error("LIVE_BUDGET_BUSY_NO_RETRY");});
    try {
      const s=await this.load(); fn(s);
      await writeFile(this.path+".tmp", JSON.stringify(s), {mode:0o600});
      await rename(this.path+".tmp",this.path);
    } finally { await lock.close(); await unlink(this.path+".lock"); }
  }
  reserve(id: string) {
    return this.change(s=>{
      if (s.runs[id]) throw Error("LIVE_ALREADY_RESERVED_NO_RETRY");
      if (Object.values(s.runs).some(r=>r.state!=="settled")) throw Error("LIVE_ACTIVE_OR_UNKNOWN_NO_RETRY");
      if (Object.values(s.runs).reduce((n,r)=>n+r.debit,0)+LIVE_RESERVE>s.limit) throw Error("LIVE_SERIES_BUDGET_EXHAUSTED");
      s.runs[id]={state:"reserved",debit:LIVE_RESERVE};
    });
  }
  settle(id: string, seconds: number | null) {
    return this.change(s=>{
      const r=s.runs[id]; if(!r || r.state!=="reserved") throw Error("LIVE_SETTLEMENT_NO_RETRY");
      if(seconds!==null && (!Number.isFinite(seconds)||seconds<0||seconds>600)) throw Error("LIVE_USAGE_OUT_OF_BOUNDS");
      r.state=seconds===null?"unknown":"settled";
      r.debit=seconds===null?LIVE_RESERVE:Math.ceil(seconds*50_000/60);
    });
  }
}
