import { closeSync, existsSync, openSync, readFileSync, renameSync, writeFileSync, fsyncSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { LIMIT_MICRO_USD, SERIES } from "./contracts";
import { z } from "zod";

type Entry = { id: string; kind: string; reserve: number; status: "reserved"|"spent"|"unknown"; charged: number; started: string; ended?: string; requestId?: string|null; httpStatus?: number; payloadHash?:string; errorMessage?:string;errorParam?:string };
type State = { series: string; limit: number; entries: Entry[] };
/** Single-writer process lease, write/fsync/rename before every paid request.
 * Interrupted reserves stay charged. No daily reset or retry of an identity. */
export class Ledger {
  private state: State;
  private fd: number;
  private lock: string;
  constructor(private path: string) {
    mkdirSync(dirname(path), {recursive:true}); this.lock = path+".lock";
    this.fd = openSync(this.lock, "wx", 0o600);
    try {
      this.state = existsSync(path) ? JSON.parse(readFileSync(path,"utf8")) : {series:SERIES,limit:LIMIT_MICRO_USD,entries:[]};
      z.object({series:z.literal(SERIES),limit:z.literal(LIMIT_MICRO_USD),entries:z.array(z.object({
        id:z.string().min(1),kind:z.string().min(1),reserve:z.number().int().positive(),
        charged:z.number().int().nonnegative(),status:z.enum(["reserved","spent","unknown"]),
        started:z.string(),ended:z.string().optional(),requestId:z.string().nullable().optional(),
        httpStatus:z.number().optional(),payloadHash:z.string().regex(/^[0-9a-f]{64}$/).optional(),
        errorMessage:z.string().max(800).optional(),errorParam:z.string().max(120).optional(),
      }).strict())}).strict().parse(this.state);
      if(new Set(this.state.entries.map(e=>e.id)).size!==this.state.entries.length ||
         this.state.entries.some(e=>e.charged>e.reserve) || this.held()>LIMIT_MICRO_USD)throw Error("CORRUPT_LEDGER");
      if (this.state.series !== SERIES || this.state.limit !== LIMIT_MICRO_USD) throw Error("SERIES_MISMATCH");
      // Unknown is charged at FULL reservation, not freed. It forbids replay
      // of that identity/payload, not an unrelated bounded diagnostic request.
      this.save();
    } catch(e) { closeSync(this.fd); unlinkSync(this.lock); throw e; }
  }
  private save() {
    const tmp = join(dirname(this.path), `.ledger-${process.pid}.tmp`);
    const fd = openSync(tmp, "w", 0o600);
    try { writeFileSync(fd, JSON.stringify(this.state)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path);
    const dir = openSync(dirname(this.path), "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  snapshot() { return structuredClone(this.state); }
  held() { return this.state.entries.reduce((s,e)=>s+(e.status==="spent"?e.charged:e.reserve),0); }
  reserve(id: string, kind: string, amount: number, payloadHash?:string) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw Error("INVALID_RESERVE");
    if (this.state.entries.some(e=>e.id===id)) throw Error("REQUEST_ALREADY_STARTED_NO_RETRY");
    if(payloadHash && this.state.entries.some(e=>e.status!=="spent" && e.payloadHash===payloadHash))throw Error("UNKNOWN_PAYLOAD_NO_RETRY");
    if (this.held()+amount > this.state.limit) throw Error("SERIES_BUDGET_EXHAUSTED");
    this.state.entries.push({id,kind,reserve:amount,charged:amount,status:"reserved",started:new Date().toISOString(),...(payloadHash?{payloadHash}:{})}); this.save();
  }
  finish(id: string, actual: number, meta: {requestId?:string|null;httpStatus?:number} = {}) {
    const e = this.state.entries.find(e=>e.id===id);
    if (!e || e.status!=="reserved") throw Error("RESERVATION_NOT_ACTIVE");
    if (!Number.isSafeInteger(actual) || actual<0 || actual>e.reserve) throw Error("COST_OUTSIDE_RESERVATION");
    Object.assign(e,{status:"spent",charged:actual,ended:new Date().toISOString()},meta); this.save();
  }
  unknown(id: string, meta: {requestId?:string|null;httpStatus?:number} = {}) {
    const e=this.state.entries.find(e=>e.id===id);
    if(e?.status==="reserved"){Object.assign(e,{status:"unknown",ended:new Date().toISOString()},meta);this.save();}
  }
  diagnostic(id:string,errorMessage:string,errorParam:string) {
    const e=this.state.entries.find(e=>e.id===id);
    if(e){e.errorMessage=errorMessage.slice(0,800);e.errorParam=errorParam.slice(0,120);this.save();}
  }
  close() {
    for(const e of this.state.entries) if(e.status==="reserved")e.status="unknown";
    this.save();closeSync(this.fd);unlinkSync(this.lock);
  }
}
